-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0068).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- บันทึกว่าแอดมิน/ผู้ใช้คนไหนกดยกเลิกการจอง และด้วยเหตุผลอะไร
-- ============================================================
-- หน้า "การจองทั้งหมด" (AdminBookings.jsx) เดิมโชว์แค่ผลลัพธ์ (status =
-- cancelled) ไม่รู้เลยว่าใครเป็นคนกดยกเลิกและทำไม ต่างจาก checked_in_by /
-- checked_out_by (0038) หรือ payments.verified_by / rejection_reason (0000)
-- ที่มีร่องรอยอยู่แล้ว — เพิ่มคอลัมน์ให้ bookings ชุดเดียวกัน แล้วให้
-- cancel_booking() (0012) บันทึกให้ทุกครั้งที่ยกเลิกสำเร็จ (ทั้งลูกค้ายกเลิกเอง
-- และแอดมินยกเลิกแทน)

alter table public.bookings
  add column if not exists cancelled_at timestamptz;

alter table public.bookings
  add column if not exists cancelled_by uuid
    references public.profiles(id)
    on delete set null;

alter table public.bookings
  add column if not exists cancel_reason text;


-- ============================================================
-- cancel_booking() — เพิ่ม p_reason (ไม่บังคับ) + บันทึกผู้ยกเลิก/เวลา
-- ============================================================
-- ของเดิมรับพารามิเตอร์เดียว (uuid) ต้อง drop ก่อนสร้างใหม่ ไม่งั้นจะได้
-- ฟังก์ชันสองตัวซ้อนกัน (overload) ซึ่ง PostgREST เลือกไม่ถูกว่าจะเรียกตัวไหน
-- เมื่อฝั่งหน้าเว็บส่งมาแค่ p_booking_id ตัวเดียว

drop function if exists public.cancel_booking(uuid);

create or replace function public.cancel_booking(
  p_booking_id uuid,
  p_reason     text default null
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
  set status        = 'cancelled',
      cancelled_at  = now(),
      cancelled_by  = v_user,
      cancel_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_booking_id
  returning * into v_booking;

  perform set_config('app.booking_engine', 'off', true);

  return v_booking;
end;
$fn$;

revoke all on function public.cancel_booking(uuid, text) from public, anon;
grant execute on function public.cancel_booking(uuid, text) to authenticated;
