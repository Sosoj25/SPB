-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0053).
-- Safe to re-run: every step is idempotent.
--
-- ยอดชำระ 0 บาท
--
-- ยอดสุทธิเป็น 0 เกิดขึ้นได้จริงอยู่แล้วสองทาง และทั้งสองทางระบบเดินต่อไม่ได้:
--   1) โปรโมชั่นของสนาม (facility_discounts, 0024) — compute_facility_price
--      คืน greatest(subtotal - discount, 0) จึงเป็น 0 ได้ตั้งแต่ตอนกดจอง
--   2) คูปองส่วนลด (0049) — least(benefit_value, base) ทำให้ยอดเหลือ 0 พอดี
--      เมื่อคูปองมีมูลค่าเท่ากับหรือมากกว่าค่าสนาม
--
-- แต่ทั้งสองช่องทางชำระเงินที่มีอยู่ใช้กับยอด 0 ไม่ได้เลย: PlernPay ไม่รับ
-- charge 0 บาท ส่วน "โอนแล้วแนบสลิป" ไม่มีสลิปให้แนบเพราะไม่ต้องโอน ลูกค้าจึง
-- ค้างอยู่ที่หน้าชำระเงินจนการจองหมดเวลา 30 นาทีแล้วถูกปล่อยคืน
--
-- ทางแก้ไม่ใช่ "ข้ามขั้นตอนชำระเงินไปเลย" — คำสั่งซื้อยังต้องถูกยืนยันเป็น
-- เรื่องเป็นราว มีแถวใน payments เป็นหลักฐาน มีใบเสร็จ มีการตัดคูปอง และมี
-- ประวัติให้แอดมินตรวจได้เหมือนรายการที่จ่ายเงินจริงทุกประการ ต่างกันแค่ยอด
-- เป็นศูนย์


-- ============================================================
-- 1. ยอมให้ payments มียอด 0 ได้
-- ============================================================
-- constraint เดิม (amount > 0) มาจากสมมติฐานว่า "ทุกการชำระเงินต้องมีเงินย้าย
-- จริง" ซึ่งไม่จริงเมื่อส่วนลดกินยอดหมดพอดี — ยังกันค่าติดลบไว้เหมือนเดิม
alter table public.payments drop constraint if exists payments_amount_check;

alter table public.payments
  add constraint payments_amount_check check (amount >= 0);


-- ============================================================
-- 2. ยืนยันคำสั่งซื้อยอด 0 บาท
-- ============================================================
-- เดินตามเส้นทางเดียวกับ confirm_gateway_payment ทุกขั้น: ออกแถว payments
-- (approved, gateway = 'manual') → ดัน bookings เป็น approved/confirmed →
-- แจ้งเตือนลูกค้า ส่วนการตัดคูปองเกิดเองจาก trg_consume_booking_coupon (0049)
-- ที่ดักการเปลี่ยน payment_status อยู่แล้ว ไม่ต้องเรียกซ้ำตรงนี้
--
-- ใช้ _assert_payable_booking (0023) ตัวเดียวกับอีกสองช่องทาง เพื่อให้เงื่อนไข
-- "จ่ายได้ไหม" (เป็นของเรา / ยังไม่จ่าย / ยังไม่ถูกยกเลิก) มีนิยามเดียวในระบบ
--
-- กันกดซ้ำด้วยการเช็คแถว payments ที่ approved อยู่แล้วก่อน — ผู้ใช้กดปุ่มรัว
-- หรือเน็ตหลุดแล้วกดใหม่ต้องไม่ได้ใบเสร็จสองใบ

create or replace function public.confirm_zero_amount_booking(p_booking_id uuid)
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

  if coalesce(v_booking.total_amount, 0) <> 0 then
    raise exception 'รายการนี้มียอดที่ต้องชำระ %s บาท กรุณาเลือกวิธีชำระเงิน',
      to_char(v_booking.total_amount, 'FM999,999,990.00');
  end if;

  select * into v_payment
  from public.payments
  where booking_id = p_booking_id
    and status = 'approved'
  limit 1;

  if found then
    return v_payment;
  end if;

  insert into public.payments (
    booking_id, user_id, amount, payment_method, status, gateway, verified_at
  )
  values (
    p_booking_id, v_booking.user_id, 0, 'other', 'approved', 'manual', now()
  )
  returning * into v_payment;

  perform set_config('app.booking_engine', 'on', true);

  update public.bookings
  set payment_status = 'approved',
      status         = case when status = 'pending' then 'confirmed' else status end
  where id = p_booking_id;

  perform set_config('app.booking_engine', 'off', true);

  insert into public.notifications
    (user_id, type, title, message, reference_type, reference_id)
  values (
    v_booking.user_id,
    'payment_approved',
    'ยืนยันการจองเรียบร้อย',
    format(
      'การจอง %s ได้รับการยืนยันแล้ว ยอดสุทธิ 0 บาท จากส่วนลด/คูปองที่ใช้ ไม่ต้องชำระเงินเพิ่ม',
      v_booking.booking_code
    ),
    'booking',
    p_booking_id::text
  );

  return v_payment;
end;
$fn$;

revoke all on function public.confirm_zero_amount_booking(uuid) from public, anon;
grant execute on function public.confirm_zero_amount_booking(uuid) to authenticated;
