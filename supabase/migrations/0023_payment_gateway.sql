-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0022).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ทำให้ระบบชำระเงิน "ใช้ได้จริง" (2026-08-26)
-- ============================================================
-- เดิม pay_booking (0009) จำลองการจ่ายเงิน: ผู้ใช้กดปุ่มเดียว บันทึกว่า
-- จ่ายแล้วและยืนยันการจองให้ทันที โดยไม่มีการตรวจสอบใด ๆ ทั้งสิ้น — ใครก็ตาม
-- ที่มี access token ยิง POST /rest/v1/rpc/pay_booking ตรง ๆ ก็ยืนยันการจอง
-- ให้ตัวเองได้ฟรีโดยไม่ต้องโอนเงินจริงสักบาท คอมเมนต์เดิมในไฟล์นั้นเขียนไว้
-- แล้วว่า "วันเปลี่ยนไปใช้ payment gateway จริง จุดที่ต้องแก้คือ pay_booking
-- ที่เดียว: ให้ webhook ของ gateway เป็นคนเรียก แทนที่จะเชื่อหน้าเว็บ" — นี่คือ
-- วันนั้น
--
-- เปลี่ยนเป็นสองเส้นทางที่ตรวจสอบได้จริงทั้งคู่:
--
--   1. พร้อมเพย์ผ่าน Omise (Opn Payments) — สร้าง QR จริงฝั่งเซิร์ฟเวอร์ผ่าน
--      Edge Function (create-omise-charge) ยืนยันอัตโนมัติเมื่อ Omise ยิง
--      webhook กลับมา (omise-webhook) โดย webhook เองก็ไม่เชื่อ payload ที่
--      ส่งเข้ามาตรง ๆ แต่ยิงถาม Omise API ซ้ำด้วย secret key ก่อนเชื่อ
--      ("อีกฝ่ายบอกว่า charge นี้จ่ายแล้ว จริงไหม" ไม่ใช่ "เชื่อว่าจ่ายแล้ว")
--
--   2. โอนผ่านบัญชีธนาคาร + แนบสลิป — เข้าคิว "รอตรวจสอบ" ที่หน้า
--      /admin/payments ให้แอดมินกดอนุมัติ/ปฏิเสธเอง (admin_approve_payment /
--      admin_reject_payment มีอยู่แล้วตั้งแต่ 0021 แต่ไม่เคยมีทางป้อนข้อมูล
--      เข้าคิวจริงเพราะ pay_booking เดิมอนุมัติเองไปตั้งแต่ต้นทาง)
--
-- ทั้งสองเส้นทางไม่มีจุดไหนที่ "หน้าเว็บบอกเองว่าจ่ายแล้ว" อีกต่อไป


-- ============================================================
-- 1. ปิดทาง pay_booking (จำลอง) ไม่ให้ผู้ใช้ทั่วไปเรียกได้อีก
-- ============================================================
-- ไม่ลบฟังก์ชันทิ้งเพราะยังมีที่อ้างอิงไว้เป็นตัวอย่าง/เผื่อ service_role
-- ต้องใช้เฉพาะกิจ (เช่น ทดสอบ) — แต่ authenticated ต้องเรียกไม่ได้อีกต่อไป

revoke all on function public.pay_booking(uuid, public.payment_method) from authenticated;
grant execute on function public.pay_booking(uuid, public.payment_method) to service_role;


-- ============================================================
-- 2. คอลัมน์เพิ่มเติมบน payments สำหรับ payment gateway
-- ============================================================
-- gateway แยกให้รู้ว่าแถวนี้ยืนยันโดยอะไร: 'manual' (แอดมินตรวจสลิปเอง,
-- ค่าเริ่มต้น ครอบคลุมแถวเก่าทั้งหมดที่มีอยู่แล้วด้วย) หรือ 'omise'
-- (ยืนยันอัตโนมัติผ่าน webhook) — gateway_charge_id ผูก 1:1 กับ charge ฝั่ง
-- Omise ใช้เป็นกุญแจค้นหาตอน webhook ยิงกลับมา

alter table public.payments
  add column if not exists gateway text not null default 'manual',
  add column if not exists gateway_charge_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'payments_gateway_check'
  ) then
    alter table public.payments
      add constraint payments_gateway_check check (gateway in ('manual', 'omise'));
  end if;
end;
$$;

create unique index if not exists payments_gateway_charge_id_key
  on public.payments (gateway_charge_id)
  where gateway_charge_id is not null;


-- ============================================================
-- 3. Storage bucket สำหรับสลิปโอนเงิน (ส่วนตัว ไม่ public)
-- ============================================================
-- ต่างจาก avatars/news/amenities ที่เป็น public=true ทั้งหมด — สลิปมีเลขบัญชี
-- และชื่อบัญชีติดมาด้วย จึงตั้งเป็น private แล้วให้แอดมิน/เจ้าของแถวขอ signed
-- URL เอาตอนจะดูจริง ๆ เท่านั้น (ดู fetchSlipSignedUrl ฝั่ง frontend)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-slips', 'payment-slips', false,
  5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public             = false,
    file_size_limit     = 5242880,
    allowed_mime_types  = array['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

-- path รูปแบบ <user_id>/<booking_id>/<timestamp>.<ext> — โฟลเดอร์แรกคือ
-- เจ้าของ ตรวจสอบแบบเดียวกับ bucket avatars (0001)

drop policy if exists "Users can upload their own payment slip" on storage.objects;
create policy "Users can upload their own payment slip"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'payment-slips'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users and admins can view payment slips" on storage.objects;
create policy "Users and admins can view payment slips"
on storage.objects for select
to authenticated
using (
  bucket_id = 'payment-slips'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select public.is_admin())
  )
);


-- ============================================================
-- 4. Helper: ตรวจสอบว่าการจองนี้ชำระเงินได้ไหม (ใช้ร่วมกันสองเส้นทาง)
-- ============================================================

create or replace function public._assert_payable_booking(p_booking_id uuid)
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
    raise exception 'ต้องเข้าสู่ระบบก่อนจึงจะชำระเงินได้';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  -- ของคนอื่นกับไม่มีจริง ตอบข้อความเดียวกัน ไม่ยืนยันว่ารหัสนี้มีอยู่
  if not found or v_booking.user_id <> v_user then
    raise exception 'ไม่พบรายการจองนี้';
  end if;

  if v_booking.payment_status in ('paid', 'approved') then
    raise exception 'รายการจองนี้ชำระเงินแล้ว';
  end if;

  if v_booking.status not in ('pending', 'confirmed') then
    raise exception 'รายการจองนี้ถูกยกเลิกไปแล้ว ไม่สามารถชำระเงินได้';
  end if;

  return v_booking;
end;
$fn$;

-- ไม่ grant ให้ role ไหนโดยตรง เรียกได้เฉพาะจากฟังก์ชันอื่นที่ security
-- definer เจ้าของเดียวกัน (owner มีสิทธิ์ execute บนฟังก์ชันของตัวเองอยู่แล้ว)
revoke all on function public._assert_payable_booking(uuid) from public, anon, authenticated;


-- ============================================================
-- 5. เส้นทางที่ 1: โอนผ่านบัญชีธนาคาร + แนบสลิป (แอดมินตรวจสอบ)
-- ============================================================
-- ไม่ยืนยันการจองให้ทันที — แค่บันทึกว่า "ส่งหลักฐานแล้ว รอตรวจสอบ" ค้างไว้
-- ที่คิว /admin/payments เหมือนที่ควรจะเป็นตั้งแต่แรก

create or replace function public.submit_bank_transfer_payment(
  p_booking_id uuid,
  p_slip_path  text
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
  if p_slip_path is null or btrim(p_slip_path) = '' then
    raise exception 'กรุณาแนบสลิปการโอนเงิน';
  end if;

  v_booking := public._assert_payable_booking(p_booking_id);

  insert into public.payments (
    booking_id, user_id, amount, payment_method, slip_url, status, gateway
  )
  values (
    p_booking_id, v_booking.user_id, v_booking.total_amount,
    'bank_transfer', p_slip_path, 'pending', 'manual'
  )
  returning * into v_payment;

  perform set_config('app.booking_engine', 'on', true);

  update public.bookings
  set payment_status = 'pending'
  where id = p_booking_id;

  perform set_config('app.booking_engine', 'off', true);

  return v_payment;
end;
$fn$;

revoke all on function public.submit_bank_transfer_payment(uuid, text) from public, anon;
grant execute on function public.submit_bank_transfer_payment(uuid, text) to authenticated;


-- ============================================================
-- 6. เส้นทางที่ 2: พร้อมเพย์ผ่าน Omise (ยืนยันอัตโนมัติผ่าน webhook)
-- ============================================================
-- create_gateway_payment แค่ "จอง" แถว payments สถานะ pending ไว้ — ไม่แตะ
-- bookings เลย (payment_status ยังเป็น unpaid ต่อไประหว่างรอสแกนจ่าย) ปล่อย
-- ให้ผู้ใช้กดสร้าง QR ใหม่ได้เรื่อย ๆ ถ้าอันเก่าหมดอายุ โดยไม่ต้องมี branch
-- พิเศษ — booking จะขยับก็ต่อเมื่อ confirm_gateway_payment ยืนยันว่าจ่ายจริง

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
    p_booking_id, v_booking.user_id, v_booking.total_amount, p_method, 'pending', 'omise'
  )
  returning * into v_payment;

  return v_payment;
end;
$fn$;

revoke all on function public.create_gateway_payment(uuid, public.payment_method) from public, anon;
grant execute on function public.create_gateway_payment(uuid, public.payment_method) to authenticated;


-- เรียกได้เฉพาะ service_role เท่านั้น — Edge Function omise-webhook เป็นคน
-- เรียก หลังจากยิงถาม Omise API ซ้ำด้วย secret key แล้วว่า charge นี้จ่าย
-- จริง ไม่ใช่เชื่อ payload ที่โพสต์เข้ามาตรง ๆ (ดูคอมเมนต์ในตัว Edge Function)

create or replace function public.confirm_gateway_payment(
  p_payment_id uuid,
  p_charge_id  text
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_payment public.payments;
begin
  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'ไม่พบรายการชำระเงินนี้';
  end if;

  -- webhook อาจยิงซ้ำได้ (Omise retry) — กดซ้ำต้องไม่ทำอะไรเพิ่ม
  if v_payment.status = 'approved' then
    return v_payment;
  end if;

  update public.payments
  set status            = 'approved',
      verified_at       = now(),
      gateway_charge_id = p_charge_id,
      rejection_reason  = null
  where id = p_payment_id
  returning * into v_payment;

  perform set_config('app.booking_engine', 'on', true);

  update public.bookings
  set payment_status = 'approved',
      status         = case when status = 'pending' then 'confirmed' else status end
  where id = v_payment.booking_id;

  perform set_config('app.booking_engine', 'off', true);

  return v_payment;
end;
$fn$;

revoke all on function public.confirm_gateway_payment(uuid, text) from public, anon, authenticated;
grant execute on function public.confirm_gateway_payment(uuid, text) to service_role;


-- charge ไม่สำเร็จ/หมดอายุ — แค่ปิดแถว payments แถวนี้เป็น rejected เฉย ๆ
-- ไม่แตะ bookings เลย (payment_status ยังเป็น unpaid อยู่ตั้งแต่ต้น) ผู้ใช้
-- กลับไปหน้าชำระเงินแล้วลองใหม่ได้ทันทีโดยไม่มีอะไรค้าง

create or replace function public.fail_gateway_payment(
  p_payment_id uuid,
  p_charge_id  text,
  p_reason     text default null
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_payment public.payments;
begin
  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'ไม่พบรายการชำระเงินนี้';
  end if;

  if v_payment.status <> 'pending' then
    return v_payment;
  end if;

  update public.payments
  set status            = 'rejected',
      rejection_reason  = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'ชำระเงินไม่สำเร็จ'),
      verified_at       = now(),
      gateway_charge_id = p_charge_id
  where id = p_payment_id
  returning * into v_payment;

  return v_payment;
end;
$fn$;

revoke all on function public.fail_gateway_payment(uuid, text, text) from public, anon, authenticated;
grant execute on function public.fail_gateway_payment(uuid, text, text) to service_role;
