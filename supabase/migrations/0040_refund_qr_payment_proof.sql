-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0039).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ให้ลูกค้าแนบสลิป/ประวัติการโอนของตัวเองตอนขอคืนเงิน สำหรับกรณีจ่ายผ่าน
-- พร้อมเพย์ QR
-- ============================================================
-- ปัญหาเดิม: การจ่ายผ่าน PlernPay QR ไม่มีสลิปเก็บไว้เลย (ระบบรู้แค่ว่า
-- PlernPay ยืนยันว่ามีเงินเข้าจริง ไม่รู้ว่าใครเป็นคนโอน — ดู
-- fetchLatestPaymentInfo ฝั่ง frontend) พอลูกค้าขอคืนเงิน แอดมินจึงไม่มีทาง
-- เทียบชื่อบัญชีก่อนอนุมัติเหมือนเคสโอนผ่านบัญชีธนาคารปกติเลย
--
-- ทางแก้: แอปธนาคารของลูกค้าเองก็มีประวัติการโอน/สลิปอยู่แล้วตอนที่เขาสแกน
-- จ่าย QR — บังคับให้แนบตอนขอคืนเงินแทน (คนละช่วงเวลากับตอนจ่ายเงินจริง แต่
-- ยังหาได้จากประวัติแอปธนาคาร) แอดมินเอาไปเทียบชื่อกับบัญชีที่ขอคืนได้เหมือน
-- เคส bank_transfer ปกติ ความน่าเชื่อถือเท่ากับสลิปที่ลูกค้าอัปโหลดตอนจ่ายเงิน
-- แบบ bank_transfer อยู่แล้ว (เป็นหลักฐานที่ลูกค้าส่งเอง ไม่ใช่ระบบยืนยัน
-- อัตโนมัติ แต่มาตรฐานเดียวกับที่ระบบใช้อยู่ทุกวันนี้ ไม่ได้แย่ลง)

-- ------------------------------------------------------------
-- 1. คอลัมน์ใหม่ — แยกจาก slip_path (สลิปโอนคืนที่แอดมินอัปโหลด) เพราะคนละ
--    เจ้าของไฟล์ คนละช่วงเวลา
-- ------------------------------------------------------------
alter table public.refund_requests
  add column if not exists payment_proof_slip_path text;


-- ------------------------------------------------------------
-- 2. Storage bucket ใหม่ — ลูกค้าเป็นคนอัปโหลดเอง (ต่างจาก refund-slips ที่
--    แอดมินอัปโหลดฝ่ายเดียว) path <booking_id>/<timestamp>.<ext> เหมือนกัน
--    เพราะ RLS ต้อง join กลับไปเช็ก bookings.user_id เหมือนกัน
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'refund-payment-proofs', 'refund-payment-proofs', false,
  5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public             = false,
    file_size_limit     = 5242880,
    allowed_mime_types  = array['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

drop policy if exists "Booking owners can upload refund payment proof" on storage.objects;
create policy "Booking owners can upload refund payment proof"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'refund-payment-proofs'
  and exists (
    select 1
    from public.bookings b
    where b.id::text = (storage.foldername(name))[1]
      and b.user_id = (select auth.uid())
  )
);

drop policy if exists "Admins and booking owners can view refund payment proof" on storage.objects;
create policy "Admins and booking owners can view refund payment proof"
on storage.objects for select
to authenticated
using (
  bucket_id = 'refund-payment-proofs'
  and (
    public.is_admin()
    or exists (
      select 1
      from public.bookings b
      where b.id::text = (storage.foldername(name))[1]
        and b.user_id = (select auth.uid())
    )
  )
);


-- ------------------------------------------------------------
-- 3. request_refund(): เพิ่ม p_payment_proof_slip_path บังคับกรอกเฉพาะ
--    booking ที่จ่ายเงินสำเร็จผ่าน QR (payment_method='qr') เท่านั้น
-- ------------------------------------------------------------
drop function if exists public.request_refund(uuid, text, text, text, text);

create or replace function public.request_refund(
  p_booking_id              uuid,
  p_reason                  text default null,
  p_bank_name               text default null,
  p_account_name            text default null,
  p_account_number          text default null,
  p_payment_proof_slip_path text default null
)
returns public.refund_requests
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user           uuid := auth.uid();
  v_booking        public.bookings;
  v_policy         public.refund_policy_settings;
  v_hours          numeric;
  v_percent        numeric;
  v_refundable     numeric;
  v_request        public.refund_requests;
  v_payment_method public.payment_method;
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

  if exists (
    select 1 from public.refund_requests
    where booking_id = p_booking_id and status <> 'rejected'
  ) then
    raise exception 'มีคำขอคืนเงินสำหรับการจองนี้อยู่แล้ว';
  end if;

  select payment_method into v_payment_method
  from public.payments
  where booking_id = p_booking_id and status = 'approved'
  order by verified_at desc nulls last, created_at desc
  limit 1;

  if v_payment_method = 'qr' and btrim(coalesce(p_payment_proof_slip_path, '')) = '' then
    raise exception 'กรุณาแนบสลิปหรือประวัติการโอนจากแอปธนาคารของคุณ เนื่องจากจ่ายผ่านพร้อมเพย์ QR ระบบไม่มีสลิปการชำระเงินเดิมให้ตรวจสอบ';
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

  v_refundable := greatest(v_booking.total_amount - coalesce(v_booking.deposit_amount, 0), 0);

  insert into public.refund_requests (
    booking_id, user_id, reason, refund_amount, lead_time_hours, status,
    bank_name, account_name, account_number, payment_proof_slip_path
  )
  values (
    p_booking_id, v_booking.user_id,
    nullif(btrim(coalesce(p_reason, '')), ''),
    round(v_refundable * v_percent / 100.0, 2),
    v_hours,
    'pending',
    btrim(p_bank_name), btrim(p_account_name), btrim(p_account_number),
    nullif(btrim(coalesce(p_payment_proof_slip_path, '')), '')
  )
  returning * into v_request;

  return v_request;

exception
  when unique_violation then
    raise exception 'มีคำขอคืนเงินสำหรับการจองนี้อยู่แล้ว';
end;
$fn$;

revoke all on function public.request_refund(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.request_refund(uuid, text, text, text, text, text) to authenticated;
