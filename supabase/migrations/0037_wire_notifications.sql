-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0036).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- เชื่อมตาราง notifications (มีอยู่แล้วตั้งแต่ 0000_initial_schema.sql พร้อม
-- RLS select/update/delete ของเจ้าของเอง) เข้ากับ 5 เหตุการณ์จริงที่แอดมิน
-- เป็นคนกดเปลี่ยนสถานะแทนลูกค้า — ก่อนหน้านี้ไม่มีอะไรเขียนแถวลงตารางนี้เลย
-- นอกจาก policy "notifications_admin_insert" ที่ไม่เคยมี UI ไหนเรียกใช้จริง
-- หน้า Profile.jsx (แท็บ "การแจ้งเตือน") จึงว่างเปล่าตลอด
--
-- เลือกเฉพาะ 5 จุดที่แอดมินเป็นคนกดคนละเวลาคนละที่กับตอนลูกค้าส่งคำขอ —
-- ตอนลูกค้ากดเอง (ส่งสลิป/ขอคืนเงิน) เขาเห็นผลบนจอทันทีอยู่แล้ว ไม่ต้องแจ้งซ้ำ
-- reference_type/reference_id ชี้กลับไปที่ booking_id เสมอ (ไม่ใช่ payment_id/
-- refund_request.id) เพราะฝั่งหน้าเว็บมีแค่ route /booking/receipt?booking=
-- ที่พาไปดูรายละเอียดได้จริง

-- ------------------------------------------------------------
-- 1. admin_approve_refund_request
-- ------------------------------------------------------------
create or replace function public.admin_approve_refund_request(
  p_id              uuid,
  p_override_amount numeric default null
)
returns public.refund_requests
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_request public.refund_requests;
  v_booking public.bookings;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  select * into v_request from public.refund_requests where id = p_id for update;

  if not found then
    raise exception 'ไม่พบคำขอคืนเงินนี้';
  end if;

  if v_request.status = 'approved' then
    return v_request;
  end if;

  if v_request.status <> 'pending' then
    raise exception 'คำขอนี้ไม่อยู่ในสถานะที่อนุมัติได้';
  end if;

  if p_override_amount is not null then
    if p_override_amount < 0 then
      raise exception 'ยอดคืนเงินต้องไม่ติดลบ';
    end if;

    select * into v_booking from public.bookings where id = v_request.booking_id;

    if p_override_amount > v_booking.total_amount then
      raise exception 'ยอดคืนเงินต้องไม่เกินยอดชำระเดิมของการจองนี้ (%)', v_booking.total_amount;
    end if;
  end if;

  update public.refund_requests
  set status        = 'approved',
      refund_amount = coalesce(p_override_amount, refund_amount),
      reviewed_by   = auth.uid(),
      reviewed_at   = now(),
      rejection_reason = null
  where id = p_id
  returning * into v_request;

  insert into public.notifications (user_id, type, title, message, reference_type, reference_id)
  values (
    v_request.user_id,
    'refund_approved',
    'คำขอคืนเงินได้รับการอนุมัติ',
    format(
      'คำขอคืนเงิน %s บาท ได้รับการอนุมัติแล้ว เจ้าหน้าที่จะโอนเงินคืนและแนบสลิปให้เร็ว ๆ นี้',
      to_char(v_request.refund_amount, 'FM999,999,990.00')
    ),
    'booking',
    v_request.booking_id::text
  );

  return v_request;
end;
$fn$;

revoke all on function public.admin_approve_refund_request(uuid, numeric) from public, anon;
grant execute on function public.admin_approve_refund_request(uuid, numeric) to authenticated, service_role;


-- ------------------------------------------------------------
-- 2. admin_reject_refund_request
-- ------------------------------------------------------------
create or replace function public.admin_reject_refund_request(
  p_id     uuid,
  p_reason text default null
)
returns public.refund_requests
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_request public.refund_requests;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  select * into v_request from public.refund_requests where id = p_id for update;

  if not found then
    raise exception 'ไม่พบคำขอคืนเงินนี้';
  end if;

  if v_request.status = 'rejected' then
    return v_request;
  end if;

  if v_request.status = 'refunded' then
    raise exception 'คำขอนี้คืนเงินสำเร็จไปแล้ว ไม่สามารถปฏิเสธย้อนหลังได้';
  end if;

  update public.refund_requests
  set status           = 'rejected',
      reviewed_by      = auth.uid(),
      reviewed_at      = now(),
      rejection_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_id
  returning * into v_request;

  insert into public.notifications (user_id, type, title, message, reference_type, reference_id)
  values (
    v_request.user_id,
    'refund_rejected',
    'คำขอคืนเงินถูกปฏิเสธ',
    coalesce(
      nullif(btrim(coalesce(p_reason, '')), ''),
      'คำขอคืนเงินของคุณถูกปฏิเสธ กรุณาติดต่อเจ้าหน้าที่หากต้องการทราบรายละเอียดเพิ่มเติม'
    ),
    'booking',
    v_request.booking_id::text
  );

  return v_request;
end;
$fn$;


-- ------------------------------------------------------------
-- 3. admin_complete_refund_request
-- ------------------------------------------------------------
create or replace function public.admin_complete_refund_request(
  p_id        uuid,
  p_slip_path text
)
returns public.refund_requests
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_request public.refund_requests;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  if p_slip_path is null or btrim(p_slip_path) = '' then
    raise exception 'กรุณาแนบสลิปการโอนเงินคืน';
  end if;

  select * into v_request from public.refund_requests where id = p_id for update;

  if not found then
    raise exception 'ไม่พบคำขอคืนเงินนี้';
  end if;

  if v_request.status = 'refunded' then
    return v_request;
  end if;

  if v_request.status <> 'approved' then
    raise exception 'ต้องอนุมัติคำขอนี้ก่อนจึงจะแนบสลิปโอนคืนได้';
  end if;

  update public.refund_requests
  set status      = 'refunded',
      slip_path   = p_slip_path,
      refunded_by = auth.uid(),
      refunded_at = now()
  where id = p_id
  returning * into v_request;

  insert into public.notifications (user_id, type, title, message, reference_type, reference_id)
  values (
    v_request.user_id,
    'refund_completed',
    'คืนเงินสำเร็จแล้ว',
    format(
      'โอนเงินคืน %s บาท เข้าบัญชีที่คุณแจ้งไว้เรียบร้อยแล้ว',
      to_char(v_request.refund_amount, 'FM999,999,990.00')
    ),
    'booking',
    v_request.booking_id::text
  );

  return v_request;
end;
$fn$;


-- ------------------------------------------------------------
-- 4. admin_approve_payment
-- ------------------------------------------------------------
create or replace function public.admin_approve_payment(p_payment_id uuid)
returns payments
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_payment public.payments;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'ไม่พบรายการชำระเงินนี้';
  end if;

  if v_payment.status = 'approved' then
    return v_payment;
  end if;

  if v_payment.status = 'rejected' then
    raise exception 'รายการนี้ถูกปฏิเสธไปแล้ว ไม่สามารถอนุมัติย้อนหลังได้';
  end if;

  update public.payments
  set status          = 'approved',
      verified_by     = auth.uid(),
      verified_at     = now(),
      rejection_reason = null
  where id = p_payment_id
  returning * into v_payment;

  update public.bookings
  set payment_status = 'approved',
      status         = case when status = 'pending' then 'confirmed' else status end
  where id = v_payment.booking_id;

  insert into public.notifications (user_id, type, title, message, reference_type, reference_id)
  values (
    v_payment.user_id,
    'payment_approved',
    'ยืนยันการชำระเงินแล้ว',
    'การชำระเงินสำหรับการจองของคุณได้รับการยืนยันแล้ว ขอบคุณที่ใช้บริการ',
    'booking',
    v_payment.booking_id::text
  );

  return v_payment;
end;
$function$;


-- ------------------------------------------------------------
-- 5. admin_reject_payment
-- ------------------------------------------------------------
create or replace function public.admin_reject_payment(
  p_payment_id uuid,
  p_reason     text default null
)
returns payments
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_payment public.payments;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'ไม่พบรายการชำระเงินนี้';
  end if;

  if v_payment.status = 'rejected' then
    return v_payment;
  end if;

  update public.payments
  set status           = 'rejected',
      verified_by      = auth.uid(),
      verified_at      = now(),
      rejection_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_payment_id
  returning * into v_payment;

  -- การจองกลับไปรอชำระเงินใหม่ ไม่ใช่ถูกยกเลิกทิ้ง — ลูกค้าอาจแนบสลิปผิด
  -- แล้วส่งใหม่ได้ ถ้าเลยเวลาไปจริง cron expire_unpaid_bookings จะเก็บกวาดเอง
  update public.bookings
  set payment_status = 'rejected',
      status         = case when status = 'confirmed' then 'pending' else status end
  where id = v_payment.booking_id;

  insert into public.notifications (user_id, type, title, message, reference_type, reference_id)
  values (
    v_payment.user_id,
    'payment_rejected',
    'การชำระเงินถูกปฏิเสธ',
    coalesce(
      nullif(btrim(coalesce(p_reason, '')), ''),
      'การชำระเงินของคุณถูกปฏิเสธ กรุณาชำระเงินใหม่อีกครั้ง'
    ),
    'booking',
    v_payment.booking_id::text
  );

  return v_payment;
end;
$function$;
