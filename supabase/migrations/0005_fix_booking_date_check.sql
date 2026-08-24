-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0004).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ปัญหา: constraint กันจองย้อนหลัง ทำให้ "แก้ไขการจองเก่า" ไม่ได้เลย
-- ============================================================
-- 0000 ประกาศไว้ว่า:
--
--     constraint bookings_date_check check (booking_date >= current_date)
--
-- CHECK constraint ของ Postgres ถูกตรวจซ้ำ "ทุกครั้งที่ UPDATE แถวนั้น"
-- ไม่ใช่แค่ตอน INSERT และ current_date ก็เดินหน้าไปทุกวัน
--
-- ผลคือพอข้ามวัน การจองของเมื่อวานจะกลายเป็นแถวที่แก้ไขไม่ได้ถาวร:
--
--     update bookings set status = 'completed' where id = ...;
--     ERROR: new row for relation "bookings" violates check constraint
--            "bookings_date_check"
--
-- แปลว่าทั้งวงจรชีวิตของการจองพังหมด — ปิดงานที่เล่นจบแล้วไม่ได้,
-- ยกเลิกรายการที่เลยวันมาแล้วไม่ได้, อัปเดตสถานะการชำระเงินย้อนหลังไม่ได้
-- และรีวิวก็ผูกกับ booking ที่ต้องถูกปิดงานก่อน
--
-- ทางแก้: เอาเงื่อนไข "ห้ามจองย้อนหลัง" ออกจาก CHECK แล้วย้ายไปเป็น trigger
-- ที่ตรวจเฉพาะตอนสร้างรายการใหม่ หรือตอนย้ายวันจองจริงๆ เท่านั้น

alter table public.bookings
  drop constraint if exists bookings_date_check;

create or replace function public.reject_past_booking_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- แอดมิน/หลังบ้านต้องจัดการรายการย้อนหลังได้ (เช่น คีย์รายการที่หน้าร้าน)
  if auth.role() = 'service_role' or public.is_admin() then
    return new;
  end if;

  -- หัวใจของการแก้: UPDATE ที่ไม่ได้ย้ายวันจอง ไม่ต้องตรวจอะไรทั้งนั้น
  if tg_op = 'UPDATE' and new.booking_date = old.booking_date then
    return new;
  end if;

  if new.booking_date < current_date then
    raise exception 'ไม่สามารถจองย้อนหลังได้';
  end if;

  return new;
end;
$$;

drop trigger if exists reject_past_booking_date on public.bookings;
create trigger reject_past_booking_date
before insert or update on public.bookings
for each row execute function public.reject_past_booking_date();
