-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0010).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ต่อจาก 0010: ให้การจองอ้างอิง "ช่วงเวลาที่แอดมินเปิดไว้" เท่านั้น
-- ============================================================
-- และปิดช่องโหว่ที่ทดสอบแล้วว่าใช้งานได้จริงตอนนี้ 3 อย่าง:
--
-- A) ยืดเวลาเองหลังจอง
--    protect_booking_privileged_columns (0003) ล็อกไว้แค่ status /
--    payment_status / total_amount แต่ bookings_update_own ยังให้แก้คอลัมน์
--    อื่นได้หมด ทดสอบแล้ว: จอง 10:00-11:00 (฿450) แล้วสั่ง
--        update bookings set end_time = '20:00'
--    ผ่านฉลุย ได้สนาม 10 ชั่วโมงในราคา 1 ชั่วโมง
--
-- B) ย้ายไปสนามที่แพงกว่า
--    ช่องเดียวกัน: update bookings set facility_id = <สนาม ฿900> ก็ผ่าน
--
-- C) แทรกแถว payments เองว่าจ่ายแล้ว
--    payments_insert_own (0000) เช็คแค่ user_id = auth.uid() ไม่ได้เช็คว่า
--    booking_id เป็นของคนนั้นด้วย ผู้ใช้จึงแทรกแถว "จ่ายแล้ว ฿1" ใส่การจอง
--    ของตัวเองหรือของคนอื่นก็ได้ ยังไม่ทำให้ได้ของฟรี (trigger ยังกัน
--    payment_status ของ bookings อยู่) แต่ทำให้หน้า Admin ตรวจสลิปในอนาคต
--    เชื่อข้อมูลในตารางนี้ไม่ได้เลย


-- ============================================================
-- 1. ผูกการจองกับช่วงเวลา
-- ============================================================
-- booking_date / start_time / end_time ยังเก็บไว้เหมือนเดิม ไม่ได้ย้ายไป
-- อ่านผ่าน slot_id อย่างเดียว เพราะ bookings_no_overlap กับรายงานย้อนหลัง
-- ต้องอ่านเวลาได้ตรง ๆ และการจองที่เกิดขึ้นแล้วต้องไม่เปลี่ยนตามภายหลัง
-- ถ้าแอดมินแก้ช่วงเวลาหรือลบทิ้ง (on delete set null)

alter table public.bookings
add column if not exists slot_id bigint
    references public.facility_time_slots(id)
    on delete set null;

create index if not exists idx_bookings_slot
on public.bookings(slot_id);


-- ============================================================
-- 2. ช่วงเวลาว่างของสนามหนึ่งในหนึ่งวัน (อ่านจากตารางจริงแล้ว)
-- ============================================================
-- return type เปลี่ยน (เพิ่ม slot_id) จึง create or replace ไม่ได้ ต้อง drop ก่อน
--
-- facility_day_availability / sport_facility_availability ใน 0009 เรียก
-- ฟังก์ชันนี้ต่อ แต่อ้างคอลัมน์ด้วยชื่อ (s.slot_start / s.is_booked)
-- จึงใช้ได้ต่อโดยไม่ต้องแก้ — เปลี่ยนแค่ความหมาย: วันที่แอดมินไม่ได้เปิด
-- ช่วงเวลาไว้เลยจะได้ total_slots = 0 (คนละเรื่องกับ "เต็ม")

drop function if exists public.facility_slots(bigint, date);

create function public.facility_slots(
  p_facility_id bigint,
  p_date date
)
returns table (
  slot_id    bigint,
  slot_start time,
  slot_end   time,
  is_booked  boolean
)
language sql
security definer
set search_path = public
stable
as $fn$
  select
    s.id,
    s.start_time,
    s.end_time,
    -- DB เป็น UTC แต่ผู้ใช้อยู่ไทย ต้องเทียบเวลาไทยเสมอ ไม่งั้นช่วงเช้าของไทย
    -- จะยังโชว์ว่าจองได้ทั้งที่เลยเวลาไปแล้ว 7 ชม.
    (p_date + s.start_time) <= (now() at time zone 'Asia/Bangkok')
    or exists (
      select 1
      from public.bookings b
      where b.facility_id  = p_facility_id
        and b.booking_date = p_date
        and b.status in ('pending', 'confirmed')
        and b.start_time < s.end_time
        and b.end_time   > s.start_time
    )
  from public.facility_time_slots s
  join public.facilities f on f.id = s.facility_id
  join public.venues     v on v.id = f.venue_id
  where s.facility_id = p_facility_id
    and s.slot_date   = p_date
    and s.is_active
    and f.status = 'available'
    and v.status = 'active'
  order by s.start_time;
$fn$;


-- ============================================================
-- 3. สร้างการจองจาก slot_id
-- ============================================================
-- signature เปลี่ยนทั้งหมด: เดิมรับ (facility, date, start, end) ตอนนี้รับ
-- แค่ id ของช่วงเวลา — สนาม วัน และเวลา อ่านจากแถวที่แอดมินลงไว้ทั้งหมด
-- ไม่มีค่าไหนที่ผู้ใช้กำหนดเองได้อีก นอกจาก note
--
-- 1 การจอง = 1 ช่วงเวลา ตามที่ออกแบบไว้ ถ้าจะเล่นต่อให้จองอีกรายการ

drop function if exists public.create_booking(bigint, date, time, time, text);

create function public.create_booking(
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
        -- bookings_no_overlap ยังเป็นด่านสุดท้ายเหมือนเดิม เพราะเป็นด่านเดียว
        -- ที่กันสองคนกดพร้อมกันได้จริง
        raise exception 'ช่วงเวลานี้เพิ่งถูกจองไปแล้ว กรุณาเลือกช่วงอื่น';
    end;
  end loop;

  raise exception 'ไม่สามารถสร้างรหัสการจองได้ กรุณาลองใหม่อีกครั้ง';
end;
$fn$;


-- ============================================================
-- 4. ปิดช่องโหว่ A + B: ล็อกคอลัมน์ที่เหลือของ bookings
-- ============================================================
-- หลังสร้างรายการแล้ว เจ้าของแก้ได้อย่างเดียวคือ note
-- การเปลี่ยนสนามหรือเวลา = ยกเลิกแล้วจองใหม่ ไม่ใช่ UPDATE
--
-- แยกข้อความ error ออกจากกลุ่ม status/payment_status เพื่อให้ตอนดู log
-- รู้ทันทีว่าเป็นความพยายามแก้เวลา ไม่ใช่แก้สถานะ

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

  if new.facility_id  is distinct from old.facility_id
     or new.slot_id      is distinct from old.slot_id
     or new.booking_date is distinct from old.booking_date
     or new.start_time   is distinct from old.start_time
     or new.end_time     is distinct from old.end_time
  then
    raise exception 'สนามและช่วงเวลาของการจองแก้ไขเองไม่ได้ กรุณายกเลิกแล้วจองใหม่';
  end if;

  return new;
end;
$fn$;


-- ============================================================
-- 5. ปิดช่องโหว่ C: ห้าม client เขียน payments เอง
-- ============================================================
-- แถวใน payments ควรมีทางเดียวคือผ่าน pay_booking() ซึ่งเป็น security
-- definer และคิดยอดจาก bookings.total_amount เอง
-- ตัด policy insert ของผู้ใช้ทิ้ง = ไม่มีทางอื่นเหลืออีก
--
-- (ไม่มี insert policy ไม่ใช่ "ลืมใส่" แต่เป็นการตั้งใจปิด — เพิ่ม policy
--  ของแอดมินไว้แทน เผื่อหน้า Admin ต้องคีย์รายการที่จ่ายหน้าเคาน์เตอร์)

drop policy if exists "payments_insert_own" on public.payments;

drop policy if exists "payments_admin_insert" on public.payments;

create policy "payments_admin_insert"
on public.payments
for insert
to authenticated
with check (
    public.is_admin()
);


-- ============================================================
-- 6. สิทธิ์การเรียก
-- ============================================================
-- revoke จาก public อย่างเดียวไม่พอบน Supabase — โปรเจกต์ grant ให้ role
-- anon/authenticated ไว้ต่างหากด้วย ต้อง revoke จาก anon ตรง ๆ อีกชั้น

revoke all on function public.facility_slots(bigint, date) from public;
grant execute on function public.facility_slots(bigint, date) to anon, authenticated;

revoke all on function public.create_booking(bigint, text) from public, anon;
grant execute on function public.create_booking(bigint, text) to authenticated;
