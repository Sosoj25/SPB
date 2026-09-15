-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0067).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ลดเวลากันช่วงเวลาไว้ (booking hold) จาก 30 นาที เหลือ 10 นาที
-- ============================================================
-- ผู้ใช้ขอให้ลดเวลาที่ระบบกันช่วงเวลาไว้รอชำระเงินจาก 30 เหลือ 10 นาที
-- ค่านี้ถูกฝัง (hardcode) เป็นตัวเลข 30 ไว้ 4 จุดในฝั่งเซิร์ฟเวอร์:
--   1. expire_unpaid_bookings() — ค่า default ของ p_minutes (ไม่มีผลจริง
--      เพราะทุกจุดที่เรียกส่งค่ามาเองเสมอ แต่แก้ให้ตรงกันไว้กันสับสน)
--   2. create_booking() (0056) — เรียก expire_unpaid_bookings(30, ...)
--      ก่อน insert เพื่อเคลียร์ที่ให้ตัวเองถ้าชนกับรายการที่ค้างนานเกิน
--   3. admin_create_walk_in_booking() (0064) — เรียกจุดเดียวกันเพื่อเหตุผล
--      เดียวกัน (แม้ walk-in เองจะ insert เป็น confirmed ทันที ไม่ต้องรอ)
--   4. pg_cron job "expire-unpaid-bookings" (0012) — กวาดรายการที่ค้างทั้ง
--      ระบบทุก 5 นาที
--
-- ฝั่งหน้าเว็บ (BOOKING_HOLD_MINUTES ใน frontend/src/lib/bookings.js) ต้อง
-- แก้คู่กันให้ตรงกับค่านี้เสมอ ไม่งั้นข้อความบนหน้าจอจะสัญญาเวลาที่ไม่จริง


-- ============================================================
-- 1. expire_unpaid_bookings() — แก้แค่ default ให้ตรงกัน
-- ============================================================

create or replace function public.expire_unpaid_bookings(
  p_minutes     integer default 10,
  p_facility_id bigint  default null,
  p_date        date    default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_expired integer;
begin
  if p_minutes < 1 then
    raise exception 'ระยะเวลากันเวลาต้องอย่างน้อย 1 นาที';
  end if;

  perform set_config('app.booking_engine', 'on', true);

  update public.bookings
  set status = 'cancelled'
  where status = 'pending'
    and payment_status = 'unpaid'
    and created_at < now() - make_interval(mins => p_minutes)
    and (p_facility_id is null or facility_id  = p_facility_id)
    and (p_date        is null or booking_date = p_date);

  get diagnostics v_expired = row_count;

  perform set_config('app.booking_engine', 'off', true);

  return v_expired;
end;
$fn$;


-- ============================================================
-- 2. create_booking() — คัดลอกมาจาก 0056 ทั้งดุ้น เปลี่ยนแค่ 30 -> 10
-- ============================================================

create or replace function public.create_booking(
  p_slot_ids bigint[],
  p_note     text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user      uuid := auth.uid();
  v_ids       bigint[];
  v_found     integer;
  v_facility  bigint;
  v_date      date;
  v_start     time;
  v_end       time;
  v_prev_end  time;
  v_price     record;
  v_code      text;
  v_window    integer;
  v_last_day  date;
  v_booking   public.bookings;
  r           record;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนจึงจะจองสนามได้';
  end if;

  select array_agg(distinct x) into v_ids
  from unnest(coalesce(p_slot_ids, '{}')) as x;

  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'กรุณาเลือกอย่างน้อยหนึ่งช่วงเวลา';
  end if;

  select count(*) into v_found
  from public.facility_time_slots s
  join public.facilities f on f.id = s.facility_id
  join public.venues     v on v.id = f.venue_id
  where s.id = any(v_ids)
    and s.is_active
    and f.status = 'available'
    and v.status = 'active';

  if v_found <> array_length(v_ids, 1) then
    raise exception 'ไม่พบช่วงเวลานี้ หรือช่วงเวลานี้ถูกปิดไปแล้ว';
  end if;

  -- ไล่ตามลำดับเวลาเช็คว่า: สนามเดียว วันเดียวกัน และต่อกันสนิททุกคู่
  -- (end ของอันก่อนหน้า = start ของอันถัดไป ไม่งั้นถือว่ามีช่องว่างคั่น)
  for r in
    select s.facility_id, s.slot_date, s.start_time, s.end_time
    from public.facility_time_slots s
    where s.id = any(v_ids)
    order by s.start_time
  loop
    if v_facility is null then
      v_facility := r.facility_id;
      v_date     := r.slot_date;
      v_start    := r.start_time;
    elsif r.facility_id <> v_facility or r.slot_date <> v_date then
      raise exception 'เลือกได้เฉพาะช่วงเวลาของสนามและวันเดียวกันเท่านั้น';
    elsif r.start_time <> v_prev_end then
      raise exception 'เลือกได้เฉพาะช่วงเวลาที่ต่อเนื่องกันเท่านั้น ห้ามมีช่วงว่างคั่นกลาง';
    end if;

    v_prev_end := r.end_time;
  end loop;

  v_end := v_prev_end;

  if (v_date + v_start) <= (now() at time zone 'Asia/Bangkok') then
    raise exception 'ช่วงเวลานี้ผ่านมาแล้ว ไม่สามารถจองได้';
  end if;

  -- เพดานจองล่วงหน้า (0055) — ค่าพื้นฐานมาจาก reward_settings และบวกเพิ่มให้
  -- คนที่แลกสิทธิ์จองล่วงหน้าไว้ ต้องเช็คที่นี่ ไม่ใช่แค่ที่ช่องเลือกวันที่
  -- ในหน้าเว็บ เพราะ RPC นี้ยิงตรงได้จากที่ไหนก็ได้
  v_window   := public._booking_window_days(v_user);
  v_last_day := (now() at time zone 'Asia/Bangkok')::date + v_window;

  if v_date > v_last_day then
    raise exception 'จองล่วงหน้าได้ไม่เกิน % วัน (ถึงวันที่ %) แลก "สิทธิ์จองล่วงหน้า" ที่หน้าแลกรางวัลเพื่อขยายระยะเวลาได้',
      v_window, to_char(v_last_day, 'DD/MM/YYYY');
  end if;

  perform public.expire_unpaid_bookings(10, v_facility, v_date);

  select * into v_price
  from public.compute_facility_price(v_facility, v_date, v_start, v_end);

  -- booking_code เป็น unique — สุ่มชนก็สุ่มใหม่ ไม่ใช่โยน error ใส่ผู้ใช้
  for i in 1..10 loop
    v_code := 'SPB-' || to_char(v_date, 'YYYYMMDD') || '-'
              || lpad(floor(random() * 10000)::int::text, 4, '0');

    begin
      insert into public.bookings (
        booking_code, user_id, facility_id, slot_id,
        booking_date, start_time, end_time,
        total_amount, deposit_amount, status, payment_status, note
      )
      values (
        v_code, v_user, v_facility, v_ids[1],
        v_date, v_start, v_end,
        v_price.total_amount, v_price.deposit_amount, 'pending', 'unpaid',
        nullif(btrim(coalesce(p_note, '')), '')
      )
      returning * into v_booking;

      insert into public.booking_slots (booking_id, slot_id)
      select v_booking.id, x from unnest(v_ids) as x;

      return v_booking;

    exception
      when unique_violation then
        continue;
      when exclusion_violation then
        -- bookings_no_overlap ยังเป็นด่านสุดท้ายเหมือนเดิม เพราะเป็นด่านเดียว
        -- ที่กันสองคนกดพร้อมกันได้จริง
        raise exception 'ช่วงเวลานี้เพิ่งถูกจองไปแล้ว กรุณาเลือกช่วงอื่น';
    end;
  end loop;

  raise exception 'ไม่สามารถสร้างรหัสการจองได้ กรุณาลองใหม่อีกครั้ง';
end;
$fn$;

revoke all on function public.create_booking(bigint[], text) from public, anon;
grant execute on function public.create_booking(bigint[], text) to authenticated;


-- ============================================================
-- 3. admin_create_walk_in_booking() — คัดลอกมาจาก 0064 เปลี่ยนแค่ 30 -> 10
-- ============================================================

create or replace function public.admin_create_walk_in_booking(
  p_facility_id       bigint,
  p_slot_ids          bigint[],
  p_customer_user_id  uuid    default null,
  p_customer_name     text    default null,
  p_customer_phone    text    default null,
  p_note              text    default null,
  p_payment_method    text    default 'cash'
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_admin        uuid := auth.uid();
  v_user         uuid;
  v_walk_in_name varchar(150);
  v_walk_in_phone varchar(30);
  v_ids          bigint[];
  v_found        integer;
  v_facility     bigint;
  v_date         date;
  v_start        time;
  v_end          time;
  v_prev_end     time;
  v_price        record;
  v_code         text;
  v_booking      public.bookings;
  r              record;
begin
  if v_admin is null or not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้นจึงจะสร้างรายการนี้ได้';
  end if;

  if p_payment_method not in ('cash', 'card', 'qr', 'bank_transfer') then
    raise exception 'วิธีชำระเงินไม่ถูกต้อง';
  end if;

  select array_agg(distinct x) into v_ids
  from unnest(coalesce(p_slot_ids, '{}')) as x;

  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'กรุณาเลือกอย่างน้อยหนึ่งช่วงเวลา';
  end if;

  select count(*) into v_found
  from public.facility_time_slots s
  join public.facilities f on f.id = s.facility_id
  join public.venues     v on v.id = f.venue_id
  where s.id = any(v_ids)
    and s.facility_id = p_facility_id
    and s.is_active
    and f.status = 'available'
    and v.status = 'active';

  if v_found <> array_length(v_ids, 1) then
    raise exception 'ไม่พบช่วงเวลานี้ หรือช่วงเวลานี้ถูกปิดไปแล้ว';
  end if;

  -- ไล่ตามลำดับเวลาเช็คว่า: สนามเดียว วันเดียวกัน และต่อกันสนิททุกคู่
  for r in
    select s.facility_id, s.slot_date, s.start_time, s.end_time
    from public.facility_time_slots s
    where s.id = any(v_ids)
    order by s.start_time
  loop
    if v_facility is null then
      v_facility := r.facility_id;
      v_date     := r.slot_date;
      v_start    := r.start_time;
    elsif r.facility_id <> v_facility or r.slot_date <> v_date then
      raise exception 'เลือกได้เฉพาะช่วงเวลาของสนามและวันเดียวกันเท่านั้น';
    elsif r.start_time <> v_prev_end then
      raise exception 'เลือกได้เฉพาะช่วงเวลาที่ต่อเนื่องกันเท่านั้น ห้ามมีช่วงว่างคั่นกลาง';
    end if;

    v_prev_end := r.end_time;
  end loop;

  v_end := v_prev_end;

  if (v_date + v_start) <= (now() at time zone 'Asia/Bangkok') then
    raise exception 'ช่วงเวลานี้ผ่านมาแล้ว ไม่สามารถจองได้';
  end if;

  -- ลูกค้าเดิม (ค้นเจอจากเบอร์โทร) ผูก user_id ตรง ๆ — ลูกค้าใหม่ไม่มีบัญชี
  -- ผูกไว้กับแอดมินที่สร้างรายการแทน แล้วเก็บชื่อ/เบอร์ไว้แสดงผลแทนของแอดมิน
  if p_customer_user_id is not null then
    if not exists (select 1 from public.profiles where id = p_customer_user_id) then
      raise exception 'ไม่พบบัญชีลูกค้านี้ในระบบ';
    end if;

    v_user          := p_customer_user_id;
    v_walk_in_name  := null;
    v_walk_in_phone := null;
  else
    v_walk_in_name  := nullif(btrim(coalesce(p_customer_name, '')), '');
    v_walk_in_phone := nullif(btrim(coalesce(p_customer_phone, '')), '');

    if v_walk_in_name is null or v_walk_in_phone is null then
      raise exception 'กรุณาระบุชื่อและเบอร์โทรของลูกค้า หรือค้นหาสมาชิกเดิมด้วยเบอร์โทร';
    end if;

    v_user := v_admin;
  end if;

  perform public.expire_unpaid_bookings(10, v_facility, v_date);

  select * into v_price
  from public.compute_facility_price(v_facility, v_date, v_start, v_end);

  -- booking_code เป็น unique — สุ่มชนก็สุ่มใหม่ ไม่ใช่โยน error ใส่แอดมิน
  for i in 1..10 loop
    v_code := 'SPB-' || to_char(v_date, 'YYYYMMDD') || '-'
              || lpad(floor(random() * 10000)::int::text, 4, '0');

    begin
      insert into public.bookings (
        booking_code, user_id, facility_id, slot_id,
        booking_date, start_time, end_time,
        total_amount, deposit_amount, status, payment_status, note,
        is_walk_in, walk_in_name, walk_in_phone
      )
      values (
        v_code, v_user, v_facility, v_ids[1],
        v_date, v_start, v_end,
        v_price.total_amount, v_price.deposit_amount, 'confirmed', 'approved',
        nullif(btrim(coalesce(p_note, '')), ''),
        true, v_walk_in_name, v_walk_in_phone
      )
      returning * into v_booking;

      insert into public.booking_slots (booking_id, slot_id)
      select v_booking.id, x from unnest(v_ids) as x;

      insert into public.payments (
        booking_id, user_id, amount, payment_method, status, verified_by, verified_at
      )
      values (
        v_booking.id, v_user, v_price.total_amount, p_payment_method::public.payment_method,
        'approved', v_admin, now()
      );

      return v_booking;

    exception
      when unique_violation then
        continue;
      when exclusion_violation then
        raise exception 'ช่วงเวลานี้เพิ่งถูกจองไปแล้ว กรุณาเลือกช่วงอื่น';
    end;
  end loop;

  raise exception 'ไม่สามารถสร้างรหัสการจองได้ กรุณาลองใหม่อีกครั้ง';
end;
$fn$;

revoke all on function public.admin_create_walk_in_booking(
  bigint, bigint[], uuid, text, text, text, text
) from public, anon;

grant execute on function public.admin_create_walk_in_booking(
  bigint, bigint[], uuid, text, text, text, text
) to authenticated;


-- ============================================================
-- 4. pg_cron job "expire-unpaid-bookings" — ตั้งใหม่ให้เรียกด้วย 10 นาที
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'ยังไม่ได้เปิด pg_cron — ข้ามการตั้ง schedule';
    return;
  end if;

  perform cron.unschedule('expire-unpaid-bookings')
  where exists (select 1 from cron.job where jobname = 'expire-unpaid-bookings');

  perform cron.schedule(
    'expire-unpaid-bookings',
    '*/5 * * * *',
    $cron$ select public.expire_unpaid_bookings(10) $cron$
  );
end;
$$;
