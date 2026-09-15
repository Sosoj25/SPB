-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0055).
-- Safe to re-run: every step is idempotent.
--
-- บังคับเพดาน "จองล่วงหน้าได้กี่วัน" ที่ฝั่งเซิร์ฟเวอร์
--
-- 0055 วางกติกาไว้แล้ว (reward_settings.advance_booking_days + สิทธิ์จองล่วงหน้า
-- ที่ต่อวันให้) แต่ยังไม่มีใครบังคับใช้ — create_booking รับสล็อตวันไหนก็ได้
-- ที่ยังไม่ผ่านมา ตราบใดที่แอดมินเปิดสล็อตนั้นไว้
--
-- ไฟล์นี้แก้ create_booking จุดเดียว: เพิ่มการเช็คเพดานหลังจากรู้วันที่แล้ว
-- ส่วนที่เหลือคัดลอกมาจาก 0035 ทั้งดุ้นโดยไม่แตะ (การตรวจสล็อตต่อเนื่อง
-- การกันวันที่ผ่านมาแล้ว การสุ่ม booking_code การกันจองชนกัน)


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

  perform public.expire_unpaid_bookings(30, v_facility, v_date);

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
