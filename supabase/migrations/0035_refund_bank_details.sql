-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0034).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ลูกค้ากรอกบัญชีรับเงินคืน + แอดมินตรวจสลิปการชำระเงินเดิมก่อนอนุมัติ
-- ============================================================
-- ปัญหาเดิม: request_refund() (0034) ไม่เก็บว่าจะโอนเงินคืนเข้าบัญชีไหน —
-- แอดมินต้องไปถามลูกค้าเองนอกระบบทุกครั้งก่อนโอน แถมไม่มีทางเช็กว่าบัญชีที่
-- จะโอนคืนเป็นของคนเดียวกับที่โอนเงินมาจริงไหม (กันเคสสวมรอยขอคืนเงินเข้า
-- บัญชีคนอื่น) — เพิ่มคอลัมน์ธนาคาร/ชื่อบัญชี/เลขบัญชีไว้ตอนขอคืนเงิน ให้
-- แอดมินเทียบชื่อกับสลิปการชำระเงินเดิม (payments.slip_url, ดู lib/payments.js
-- fetchLatestPaymentSlipPath ฝั่ง frontend) ก่อนกดอนุมัติ
--
-- ตั้งชื่อคอลัมน์ตาม pattern เดียวกับ payment_accounts (0027, ดู
-- paymentSettings.js): bank_name / account_name / account_number

alter table public.refund_requests
  add column if not exists bank_name text,
  add column if not exists account_name text,
  add column if not exists account_number text;

-- เปลี่ยน signature ของ request_refund (เพิ่ม 3 พารามิเตอร์) — ต้อง drop ก่อน
-- เพราะ create or replace แทนที่ฟังก์ชัน signature เดิมไม่ได้ ไม่งั้นจะได้
-- ฟังก์ชันสอง overload ค้างอยู่ (ตัวเก่า 2 อาร์กิวเมนต์ยังเรียกได้อยู่)
drop function if exists public.request_refund(uuid, text);

create or replace function public.request_refund(
  p_booking_id      uuid,
  p_reason          text default null,
  p_bank_name       text default null,
  p_account_name    text default null,
  p_account_number  text default null
)
returns public.refund_requests
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user       uuid := auth.uid();
  v_booking    public.bookings;
  v_policy     public.refund_policy_settings;
  v_hours      numeric;
  v_percent    numeric;
  v_refundable numeric;
  v_request    public.refund_requests;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนจึงจะขอคืนเงินได้';
  end if;

  if btrim(coalesce(p_bank_name, '')) = ''
     or btrim(coalesce(p_account_name, '')) = ''
     or btrim(coalesce(p_account_number, '')) = ''
  then
    raise exception 'กรุณากรอกธนาคาร ชื่อบัญชี และเลขบัญชีสำหรับรับเงินคืนให้ครบ';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found or (v_booking.user_id <> v_user and not public.is_admin()) then
    raise exception 'ไม่พบรายการจองนี้';
  end if;

  if v_booking.status <> 'cancelled' then
    raise exception 'ต้องยกเลิกการจองนี้ก่อนจึงจะขอคืนเงินได้';
  end if;

  if v_booking.payment_status not in ('paid', 'approved') then
    raise exception 'รายการจองนี้ยังไม่ได้ชำระเงิน ไม่มีเงินให้คืน';
  end if;

  if exists (select 1 from public.refund_requests where booking_id = p_booking_id) then
    raise exception 'มีคำขอคืนเงินสำหรับการจองนี้อยู่แล้ว';
  end if;

  select * into v_policy from public.refund_policy_settings where id = 1;

  v_hours := extract(epoch from (
    (v_booking.booking_date + v_booking.start_time) - (now() at time zone 'Asia/Bangkok')
  )) / 3600.0;

  if v_policy is null then
    v_percent := 0;
  elsif v_hours >= v_policy.full_refund_hours then
    v_percent := 100;
  elsif v_hours >= v_policy.partial_refund_hours then
    v_percent := v_policy.partial_refund_percent;
  else
    v_percent := 0;
  end if;

  -- ยอดมัดจำ (deposit_amount, 0024) ไม่คืนเสมอไม่ว่าจะยกเลิกก่อนเวลากี่ชั่วโมง
  -- ก็ตาม — ตัดออกจากฐานคำนวณก่อนคูณเปอร์เซ็นต์ตามนโยบาย แม้แต่กรณี "คืนเต็ม
  -- จำนวน" (v_percent = 100) ก็คืนได้แค่ total_amount - deposit_amount เท่านั้น
  v_refundable := greatest(v_booking.total_amount - coalesce(v_booking.deposit_amount, 0), 0);

  insert into public.refund_requests (
    booking_id, user_id, reason, refund_amount, lead_time_hours, status,
    bank_name, account_name, account_number
  )
  values (
    p_booking_id, v_booking.user_id,
    nullif(btrim(coalesce(p_reason, '')), ''),
    round(v_refundable * v_percent / 100.0, 2),
    v_hours,
    'pending',
    btrim(p_bank_name), btrim(p_account_name), btrim(p_account_number)
  )
  returning * into v_request;

  return v_request;
end;
$fn$;

revoke all on function public.request_refund(uuid, text, text, text, text) from public, anon;
grant execute on function public.request_refund(uuid, text, text, text, text) to authenticated;
