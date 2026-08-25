-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0011).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ปัญหา: การจองเกิดได้อย่างเดียว แต่ตายไม่เป็น
-- ============================================================
--
-- 1) กดยืนยันแล้วปิดแท็บหนี = ล็อกช่วงเวลานั้นตลอดกาล
--    bookings_no_overlap (0000) นับ status = 'pending' เป็นการจองที่ชนได้
--    ซึ่งถูกต้อง (ไม่งั้นสองคนจ่ายเงินช่วงเดียวกันได้) แต่ไม่มีอะไรมาเก็บกวาด
--    รายการที่ค้าง ช่วงเวลาที่ไม่มีใครจ่ายเงินจึงหายไปจากระบบถาวร
--
-- 2) ยกเลิกไม่ได้เลย
--    protect_booking_privileged_columns บล็อก status ของเจ้าของแถวเอง
--    (จำเป็น ไม่งั้นกดยืนยันให้ตัวเองฟรีได้) แต่ก็แปลว่าไม่มีทางยกเลิกเลย
--    ทั้งที่ 0011 เพิ่งบอกผู้ใช้ว่า "กรุณายกเลิกแล้วจองใหม่"


-- ============================================================
-- 1. เก็บกวาดรายการที่กันเวลาไว้แล้วไม่จ่าย
-- ============================================================
-- ไม่ grant ให้ role ไหนเลยโดยตั้งใจ — ฟังก์ชันนี้แก้ status ของการจอง
-- คนอื่นได้ จึงต้องไม่มีทางเรียกจาก API ตรง ๆ ทางเข้ามีสองทางเท่านั้น:
--   - create_booking() เรียกเองก่อน insert (security definer รันเป็น owner)
--   - cron / แอดมินผ่าน service_role
--
-- p_facility_id / p_date มีไว้ให้ create_booking เก็บกวาดเฉพาะจุดที่กำลังจะ
-- จองจริง ๆ ไม่ต้องสแกนทั้งตารางทุกครั้งที่มีคนกดจอง

create or replace function public.expire_unpaid_bookings(
  p_minutes     integer default 30,
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


revoke all on function public.expire_unpaid_bookings(integer, bigint, date)
from public, anon, authenticated;


-- ============================================================
-- 2. ยกเลิกการจอง
-- ============================================================
-- ยกเลิกได้ถึงก่อนเวลาเริ่มเล่น หลังจากนั้นเป็นเรื่องของหน้างาน ไม่ใช่ของระบบ
--
-- ข้อจำกัดที่ต้องรู้: enum payment_status ไม่มีค่า 'refunded' รายการที่จ่าย
-- แล้วจึงถูกยกเลิกโดยที่ payment_status ยังเป็น 'paid' อยู่ — ช่วงเวลาถูก
-- ปล่อยคืนทันที แต่ "การคืนเงิน" ยังเป็นงานที่คนต้องทำเอง ระบบยังไม่มีส่วนนี้
-- (ถ้าจะทำจริงต้องเพิ่มค่า enum + ตารางบันทึกการคืนเงิน ไม่ใช่แค่แก้สถานะ)

create or replace function public.cancel_booking(
  p_booking_id uuid
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
    raise exception 'ต้องเข้าสู่ระบบก่อนจึงจะยกเลิกการจองได้';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  -- ของคนอื่นกับไม่มีจริง ตอบข้อความเดียวกัน ไม่ยืนยันว่ารหัสนี้มีอยู่
  if not found or (v_booking.user_id <> v_user and not public.is_admin()) then
    raise exception 'ไม่พบรายการจองนี้';
  end if;

  -- กดยกเลิกซ้ำ (refresh, กดปุ่มรัว) ไม่ควรเป็น error
  if v_booking.status = 'cancelled' then
    return v_booking;
  end if;

  if v_booking.status <> 'pending' and v_booking.status <> 'confirmed' then
    raise exception 'รายการจองนี้ไม่อยู่ในสถานะที่ยกเลิกได้';
  end if;

  if (v_booking.booking_date + v_booking.start_time)
       <= (now() at time zone 'Asia/Bangkok')
     and not public.is_admin()
  then
    raise exception 'เลยเวลาเริ่มใช้สนามแล้ว ไม่สามารถยกเลิกเองได้ กรุณาติดต่อสนามโดยตรง';
  end if;

  perform set_config('app.booking_engine', 'on', true);

  update public.bookings
  set status = 'cancelled'
  where id = p_booking_id
  returning * into v_booking;

  perform set_config('app.booking_engine', 'off', true);

  return v_booking;
end;
$fn$;


revoke all on function public.cancel_booking(uuid) from public, anon;
grant execute on function public.cancel_booking(uuid) to authenticated;


-- ============================================================
-- 3. ให้ create_booking เก็บกวาดก่อนจอง
-- ============================================================
-- ไม่พึ่ง cron อย่างเดียว เพราะจังหวะที่ "ต้องการ" ให้ช่วงเวลาว่างจริง ๆ คือ
-- ตอนมีคนกำลังจะจองมันพอดี ถ้ารอ cron รอบถัดไป ผู้ใช้จะเห็นว่าเต็มทั้งที่
-- คนก่อนหน้าทิ้งไปแล้ว
--
-- เก็บกวาดเฉพาะสนาม+วันที่กำลังจะจอง ไม่ได้สแกนทั้งตาราง

create or replace function public.create_booking(
  p_slot_id bigint,
  p_note    text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user    uuid := auth.uid();
  v_slot    record;
  v_hours   numeric;
  v_code    text;
  v_booking public.bookings;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนจึงจะจองสนามได้';
  end if;

  select
    s.id, s.facility_id, s.slot_date, s.start_time, s.end_time,
    f.price_per_hour
  into v_slot
  from public.facility_time_slots s
  join public.facilities f on f.id = s.facility_id
  join public.venues     v on v.id = f.venue_id
  where s.id = p_slot_id
    and s.is_active
    and f.status = 'available'
    and v.status = 'active';

  if not found then
    raise exception 'ไม่พบช่วงเวลานี้ หรือช่วงเวลานี้ถูกปิดไปแล้ว';
  end if;

  if (v_slot.slot_date + v_slot.start_time) <= (now() at time zone 'Asia/Bangkok') then
    raise exception 'ช่วงเวลานี้ผ่านมาแล้ว ไม่สามารถจองได้';
  end if;

  perform public.expire_unpaid_bookings(30, v_slot.facility_id, v_slot.slot_date);

  v_hours := extract(epoch from (v_slot.end_time - v_slot.start_time)) / 3600;

  -- booking_code เป็น unique — สุ่มชนก็สุ่มใหม่ ไม่ใช่โยน error ใส่ผู้ใช้
  for i in 1..10 loop
    v_code := 'SPB-' || to_char(v_slot.slot_date, 'YYYYMMDD') || '-'
              || lpad(floor(random() * 10000)::int::text, 4, '0');

    begin
      insert into public.bookings (
        booking_code, user_id, facility_id, slot_id,
        booking_date, start_time, end_time,
        total_amount, status, payment_status, note
      )
      values (
        v_code, v_user, v_slot.facility_id, v_slot.id,
        v_slot.slot_date, v_slot.start_time, v_slot.end_time,
        round(v_slot.price_per_hour * v_hours, 2), 'pending', 'unpaid',
        nullif(btrim(coalesce(p_note, '')), '')
      )
      returning * into v_booking;

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


revoke all on function public.create_booking(bigint, text) from public, anon;
grant execute on function public.create_booking(bigint, text) to authenticated;


-- ============================================================
-- 4. เก็บกวาดเป็นรอบด้วย pg_cron
-- ============================================================
-- ข้อ 3 ครอบคลุมเฉพาะช่วงเวลาที่มีคนสนใจจองซ้ำ รายการค้างในสนามที่ไม่มีใคร
-- แตะเลยจะยังคงอยู่ ทำให้ตัวเลข "ว่าง N ช่วง" บนหน้ารายการสนามต่ำกว่าจริง
--
-- ถ้าโปรเจกต์ยังไม่ได้เปิด pg_cron ให้ข้ามบล็อกนี้ไปโดยไม่ทำให้ migration พัง
-- (ระบบยังทำงานถูกต้องอยู่ แค่ตัวเลขบนหน้ารายการอาจหน่วงกว่าความจริง)
-- เปิดได้ที่ Dashboard -> Database -> Extensions -> pg_cron แล้วรันไฟล์นี้ซ้ำ

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
    $cron$ select public.expire_unpaid_bookings(30) $cron$
  );
end;
$$;
