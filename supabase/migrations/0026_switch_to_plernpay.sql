-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0023; independent
-- of 0024/0025 which touch pricing/gallery features, not payments).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- เปลี่ยนผู้ให้บริการ QR พร้อมเพย์จาก Omise เป็น PlernPay (2026-08-27)
-- ============================================================
-- 0023 วางโครง gateway ไว้แบบ generic (มี column gateway/gateway_charge_id
-- และ RPC create_gateway_payment / confirm_gateway_payment / fail_gateway_payment
-- ที่ไม่ผูกกับผู้ให้บริการเจ้าใดเจ้าหนึ่ง) โดยตอนนั้นใช้ Omise เป็นตัวอย่าง
-- แต่ยังไม่เคยตั้งค่า secret key จริงเลย (ไม่มีการชำระเงินจริงผ่านไปสักรายการ)
-- จึงเปลี่ยนมาใช้ PlernPay ได้โดยไม่กระทบข้อมูลเดิม — แก้แค่ค่า literal
-- 'omise' -> 'plernpay' และ check constraint เท่านั้น ตัว RPC ที่เหลือ (ที่
-- เป็นจุดตรวจสอบเงินจริง) ไม่ต้องแตะเลยเพราะออกแบบไว้ไม่ผูกกับ gateway ตั้งแต่แรก

update public.payments set gateway = 'plernpay' where gateway = 'omise';

alter table public.payments drop constraint if exists payments_gateway_check;
alter table public.payments
  add constraint payments_gateway_check check (gateway in ('manual', 'plernpay'));

create or replace function public.create_gateway_payment(
  p_booking_id uuid,
  p_method     public.payment_method default 'qr'
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_booking public.bookings;
  v_payment public.payments;
begin
  v_booking := public._assert_payable_booking(p_booking_id);

  insert into public.payments (
    booking_id, user_id, amount, payment_method, status, gateway
  )
  values (
    p_booking_id, v_booking.user_id, v_booking.total_amount, p_method, 'pending', 'plernpay'
  )
  returning * into v_payment;

  return v_payment;
end;
$fn$;
