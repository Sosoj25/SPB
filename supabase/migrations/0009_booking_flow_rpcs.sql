-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0008).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ปัญหา: flow การจองทำจากฝั่ง client ล้วน ๆ ไม่ได้เลย ติดอยู่ 3 เรื่อง
-- ============================================================
--
-- 1) "ช่วงเวลาไหนว่าง" ถามจาก client ไม่ได้
--    bookings_select_own (0000) ให้ผู้ใช้เห็นเฉพาะแถวของตัวเอง ซึ่งถูกต้องแล้ว
--    (ไม่ควรเห็นว่าใครจองอะไร) แต่ผลข้างเคียงคือ
--        supabase.from('bookings').select().eq('facility_id', ...)
--    จะกลับมาเป็น [] เสมอ ต่อให้สนามเต็มทั้งวัน ปฏิทินเลยโกหกผู้ใช้ทุกครั้ง
--    แล้วไปพังตอน insert ด้วย exclusion constraint แทน
--    -> ต้องมี security definer ที่ตอบแค่ "ว่าง/ไม่ว่าง" โดยไม่เปิดเผยว่าใครจอง
--
-- 2) total_amount ถูกส่งมาจาก client ได้
--    protect_booking_privileged_columns (0003) กันแค่ตอน UPDATE
--    แต่ INSERT ยังใส่ total_amount เท่าไหร่ก็ได้ ผู้ใช้จึงจองสนาม 0 บาทได้
--    -> ราคาต้องคูณจาก facilities.price_per_hour ที่ฝั่ง server เท่านั้น
--
-- 3) ชำระเงินแล้วอัปเดตสถานะไม่ได้
--    trigger เดียวกันบล็อก status / payment_status ของเจ้าของแถวเอง
--    (ตั้งใจไว้แบบนั้น ไม่งั้นกดยืนยันให้ตัวเองฟรีได้) แต่ก็แปลว่า flow
--    unpaid -> paid -> confirmed ต้องวิ่งผ่านโค้ดฝั่ง server ที่เชื่อถือได้


-- ============================================================
-- 1. ช่องทางให้เฉพาะ RPC ในไฟล์นี้ผ่าน trigger ที่ล็อกคอลัมน์ไว้
-- ============================================================
-- ใช้ GUC แบบ local (is_local = true) ซึ่งมีผลเฉพาะใน transaction ที่ตั้ง
-- ค่านั้นเท่านั้น PostgREST เปิดคนละ transaction ต่อ 1 request และ
-- set_config() อยู่ใน pg_catalog ไม่ได้ถูก expose เป็น RPC
-- ผู้ใช้ผ่าน API จึงตั้งค่านี้เองไม่ได้ และค่าไม่รั่วข้าม request

create or replace function public.protect_booking_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.role() = 'service_role'
     or public.is_admin()
     or coalesce(current_setting('app.booking_engine', true), '') = 'on'
  then
    return new;
  end if;

  if new.status is distinct from old.status then
    raise exception 'booking status cannot be modified directly';
  end if;

  if new.payment_status is distinct from old.payment_status then
    raise exception 'payment status cannot be modified directly';
  end if;

  if new.total_amount is distinct from old.total_amount then
    raise exception 'total_amount cannot be modified directly';
  end if;

  return new;
end;
$fn$;


-- ============================================================
-- 2. ช่วงเวลาว่างของสนามหนึ่งสนามในหนึ่งวัน
-- ============================================================
-- แบ่งเป็นช่องละ 1 ชั่วโมงตามเวลาเปิด-ปิดของ venue แล้วบอกแค่ว่าช่องนั้น
-- จองได้หรือไม่ ไม่คืน user_id / booking_code ออกไป
--
-- DB timezone เป็น UTC แต่ผู้ใช้อยู่ไทย ถ้าตัดช่วงเวลาที่ผ่านมาแล้วด้วย
-- now() ตรง ๆ ช่วงเช้าของไทยจะยังโชว์ว่าง ทั้งที่เลยเวลาไปแล้ว 7 ชม.
-- จึงเทียบกับ now() at time zone Asia/Bangkok เสมอ

create or replace function public.facility_slots(
  p_facility_id bigint,
  p_date date
)
returns table (
  slot_start time,
  slot_end   time,
  is_booked  boolean
)
language sql
security definer
set search_path = public
stable
as $fn$
  with fac as (
    select v.opening_time, v.closing_time
    from public.facilities f
    join public.venues v on v.id = f.venue_id
    where f.id = p_facility_id
      and f.status = 'available'
      and v.status = 'active'
  ),
  slot as (
    select
      g::time                       as s_start,
      (g + interval '1 hour')::time as s_end
    from fac
    cross join lateral generate_series(
      p_date + fac.opening_time,
      p_date + fac.closing_time - interval '1 hour',
      interval '1 hour'
    ) as g
  )
  select
    slot.s_start,
    slot.s_end,
    (p_date + slot.s_start) <= (now() at time zone 'Asia/Bangkok')
    or exists (
      select 1
      from public.bookings b
      where b.facility_id = p_facility_id
        and b.booking_date = p_date
        and b.status in ('pending', 'confirmed')
        and b.start_time < slot.s_end
        and b.end_time   > slot.s_start
    )
  from slot
  order by slot.s_start;
$fn$;


-- ============================================================
-- 3. จำนวนช่องว่างรายวัน (ใช้ระบายสีปฏิทิน)
-- ============================================================
-- จำกัดช่วงไว้ 62 วัน เพื่อไม่ให้ client ขอทีเดียวทั้งปีแล้วลาก DB ไปด้วย

create or replace function public.facility_day_availability(
  p_facility_id bigint,
  p_from date,
  p_to   date
)
returns table (
  day         date,
  free_slots  integer,
  total_slots integer
)
language sql
security definer
set search_path = public
stable
as $fn$
  select
    d::date,
    count(*) filter (where s.is_booked is false)::integer,
    count(s.slot_start)::integer
  from generate_series(p_from, least(p_to, p_from + 62), interval '1 day') as d
  left join lateral public.facility_slots(p_facility_id, d::date) as s on true
  group by d
  order by d;
$fn$;


-- ============================================================
-- 4. ความว่างของทุกสนามในกีฬาหนึ่ง (ใช้ที่หน้ารายการสนาม)
-- ============================================================
-- left join lateral ไม่ใช่ cross join: สนามที่ไม่เหลือช่องว่างเลย
-- ต้องยังอยู่ในรายการ แค่แสดงว่า "เต็ม" ไม่ใช่หายไปเฉย ๆ

create or replace function public.sport_facility_availability(
  p_sport_id bigint,
  p_date     date
)
returns table (
  facility_id bigint,
  free_slots  integer,
  total_slots integer
)
language sql
security definer
set search_path = public
stable
as $fn$
  select
    f.id,
    count(*) filter (where s.is_booked is false)::integer,
    count(s.slot_start)::integer
  from public.facilities f
  join public.venues v on v.id = f.venue_id
  left join lateral public.facility_slots(f.id, p_date) as s on true
  where f.sport_id = p_sport_id
    and f.status = 'available'
    and v.status = 'active'
  group by f.id;
$fn$;


-- ============================================================
-- 5. สร้างการจอง (pending / unpaid)
-- ============================================================
-- ราคาคิดจาก price_per_hour ฝั่ง server, client ส่งมาแค่ "จะจองอะไร เมื่อไหร่"
--
-- การกันจองชนกันยังพึ่ง exclusion constraint bookings_no_overlap (0000)
-- เป็นด่านสุดท้ายเหมือนเดิม เพราะเป็นด่านเดียวที่กันสองคนกดพร้อมกันได้จริง
-- ตรงนี้แค่แปลง error ให้เป็นข้อความที่ผู้ใช้อ่านรู้เรื่อง

create or replace function public.create_booking(
  p_facility_id bigint,
  p_date        date,
  p_start       time,
  p_end         time,
  p_note        text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user    uuid := auth.uid();
  v_price   numeric(12,2);
  v_open    time;
  v_close   time;
  v_hours   numeric;
  v_code    text;
  v_booking public.bookings;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนจึงจะจองสนามได้';
  end if;

  if p_end <= p_start then
    raise exception 'เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม';
  end if;

  select f.price_per_hour, v.opening_time, v.closing_time
    into v_price, v_open, v_close
  from public.facilities f
  join public.venues v on v.id = f.venue_id
  where f.id = p_facility_id
    and f.status = 'available'
    and v.status = 'active';

  if not found then
    raise exception 'ไม่พบสนามนี้ หรือสนามปิดให้บริการอยู่';
  end if;

  if p_start < v_open or p_end > v_close then
    raise exception 'เวลาที่เลือกอยู่นอกเวลาเปิดให้บริการ (% - %)',
      to_char(v_open, 'HH24:MI'), to_char(v_close, 'HH24:MI');
  end if;

  if (p_date + p_start) <= (now() at time zone 'Asia/Bangkok') then
    raise exception 'ไม่สามารถจองช่วงเวลาที่ผ่านมาแล้วได้';
  end if;

  v_hours := extract(epoch from (p_end - p_start)) / 3600;

  -- booking_code เป็น unique ถ้าสุ่มชนก็สุ่มใหม่ ไม่ใช่โยน error ใส่ผู้ใช้
  for i in 1..10 loop
    v_code := 'SPB-' || to_char(p_date, 'YYYYMMDD') || '-'
              || lpad(floor(random() * 10000)::int::text, 4, '0');

    begin
      insert into public.bookings (
        booking_code, user_id, facility_id,
        booking_date, start_time, end_time,
        total_amount, status, payment_status, note
      )
      values (
        v_code, v_user, p_facility_id,
        p_date, p_start, p_end,
        round(v_price * v_hours, 2), 'pending', 'unpaid',
        nullif(btrim(coalesce(p_note, '')), '')
      )
      returning * into v_booking;

      return v_booking;

    exception
      when unique_violation then
        continue;
      when exclusion_violation then
        raise exception 'ช่วงเวลานี้เพิ่งถูกจองไปแล้ว กรุณาเลือกเวลาอื่น';
    end;
  end loop;

  raise exception 'ไม่สามารถสร้างรหัสการจองได้ กรุณาลองใหม่อีกครั้ง';
end;
$fn$;


-- ============================================================
-- 6. ชำระเงิน (จำลอง): unpaid -> paid -> confirmed
-- ============================================================
-- ยังไม่ต่อ payment gateway จริง ตรงนี้บันทึกว่าจ่ายแล้วและยืนยันการจองให้
-- เมื่อเปลี่ยนไปใช้ gateway จริง จุดที่ต้องแก้คือฟังก์ชันนี้ที่เดียว:
-- ให้ webhook ของ gateway เป็นคนเรียก แทนที่จะเชื่อ client

create or replace function public.pay_booking(
  p_booking_id uuid,
  p_method     public.payment_method default 'qr'
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user    uuid := auth.uid();
  v_booking public.bookings;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนจึงจะชำระเงินได้';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  -- ของคนอื่นกับไม่มีจริง ตอบข้อความเดียวกัน ไม่ยืนยันว่ารหัสนี้มีอยู่
  if not found or v_booking.user_id <> v_user then
    raise exception 'ไม่พบรายการจองนี้';
  end if;

  -- กดจ่ายซ้ำ (refresh หน้าใบเสร็จ, กดปุ่มรัว) ไม่ควรเป็น error
  if v_booking.payment_status in ('paid', 'approved') then
    return v_booking;
  end if;

  if v_booking.status not in ('pending', 'confirmed') then
    raise exception 'รายการจองนี้ถูกยกเลิกไปแล้ว ไม่สามารถชำระเงินได้';
  end if;

  insert into public.payments (
    booking_id, user_id, amount, payment_method, status, verified_at
  )
  values (
    p_booking_id, v_user, v_booking.total_amount, p_method, 'paid', now()
  );

  perform set_config('app.booking_engine', 'on', true);

  update public.bookings
  set payment_status = 'paid',
      status         = 'confirmed'
  where id = p_booking_id
  returning * into v_booking;

  perform set_config('app.booking_engine', 'off', true);

  return v_booking;
end;
$fn$;


-- ============================================================
-- 7. สิทธิ์การเรียก
-- ============================================================
-- Postgres ให้ execute แก่ public อัตโนมัติทุกครั้งที่สร้างฟังก์ชัน จึงต้อง
-- revoke ก่อนเสมอ ไม่งั้น anon เรียก create_booking ได้ (แล้วไปตายที่
-- auth.uid() is null ซึ่งเป็นการกันที่ปลายทางเกินไป)
--
-- ที่สำคัญ: revoke จาก public อย่างเดียว "ไม่พอ" บน Supabase — โปรเจกต์
-- grant execute ให้ role anon/authenticated ไว้ต่างหากด้วย ทดสอบแล้วพบว่า
-- anon ยังยิง /rest/v1/rpc/create_booking เข้ามาถึงตัวฟังก์ชันได้อยู่
-- จึงต้อง revoke จาก anon ตรง ๆ อีกชั้น

revoke all on function public.facility_slots(bigint, date) from public;
revoke all on function public.facility_day_availability(bigint, date, date) from public;
revoke all on function public.sport_facility_availability(bigint, date) from public;
revoke all on function public.create_booking(bigint, date, time, time, text) from public, anon;
revoke all on function public.pay_booking(uuid, public.payment_method) from public, anon;

-- ดูตารางว่างได้โดยไม่ต้องล็อกอิน (หน้า Landing เอาไปใช้โชว์ได้ในอนาคต)
grant execute on function public.facility_slots(bigint, date) to anon, authenticated;
grant execute on function public.facility_day_availability(bigint, date, date) to anon, authenticated;
grant execute on function public.sport_facility_availability(bigint, date) to anon, authenticated;

grant execute on function public.create_booking(bigint, date, time, time, text) to authenticated;
grant execute on function public.pay_booking(uuid, public.payment_method) to authenticated;
