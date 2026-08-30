-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0035).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- แก้ 3 จุดของระบบคืนเงิน (0033-0035) ที่พบตอนรีวิว
-- ============================================================
-- 1. unique(booking_id) เดิมบล็อกไม่ให้ขอคืนเงินใหม่ได้เลยถ้าเคยถูกปฏิเสธมา
--    ก่อน (เช่น กรอกเลขบัญชีผิด) ลูกค้าติดตายถาวร ต้องให้แอดมินไปแก้ฐานข้อมูล
--    เองนอกระบบทุกครั้ง — เปลี่ยนเป็น partial unique index ที่ไม่นับแถว
--    'rejected' แทน ยังคงกันคำขอซ้ำซ้อนระหว่างที่มีคำขอ pending/approved/
--    refunded อยู่เหมือนเดิมทุกประการ
-- 2. หน้า AdminRefunds.jsx เขียนไว้ว่า "กรณีสนามไม่พร้อมใช้งานจากฝ่ายสนาม
--    แอดมินอนุมัติคืนเต็มจำนวนได้เองไม่ต้องยึดตามตาราง" แต่
--    admin_approve_refund_request เดิมไม่มีทางแก้ยอดได้เลย (อนุมัติได้แค่ยอด
--    ที่คำนวณตายตัวไว้ตอนขอ) — เพิ่ม p_override_amount ให้ทำได้จริงตามที่
--    ข้อความบอกไว้ จำกัดไม่ให้เกินยอดชำระเดิมของการจองกันแอดมินพิมพ์ผิด
-- 3. race condition: สองคำขอคืนเงินพร้อมกัน (สองแท็บ) ชน unique index ตรง ๆ
--    จะได้ error ดิบของ Postgres แทนข้อความไทยที่ตั้งใจเตรียมไว้อยู่แล้ว —
--    ครอบ exception handler ให้ตอบข้อความเดียวกับตอนเช็คซ้ำปกติ

-- ------------------------------------------------------------
-- 1. เปลี่ยน unique(booking_id) เป็น partial unique (ยกเว้นแถว rejected)
-- ------------------------------------------------------------
alter table public.refund_requests
  drop constraint if exists refund_requests_booking_id_key;

create unique index if not exists refund_requests_active_booking_id_key
  on public.refund_requests (booking_id)
  where status <> 'rejected';


-- ------------------------------------------------------------
-- 2. request_refund(): เช็คซ้ำเฉพาะคำขอที่ยังไม่ถูกปฏิเสธ + ข้อความ
--    unique_violation ที่เป็นมิตร
-- ------------------------------------------------------------
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

  -- แถวที่ถูกปฏิเสธไปแล้วไม่นับว่า "มีคำขออยู่แล้ว" อีกต่อไป ขอใหม่ได้ —
  -- ตรงกับ partial unique index ด้านบนที่ยอมให้แทรกซ้ำในเคสนี้เช่นกัน
  if exists (
    select 1 from public.refund_requests
    where booking_id = p_booking_id and status <> 'rejected'
  ) then
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

exception
  when unique_violation then
    raise exception 'มีคำขอคืนเงินสำหรับการจองนี้อยู่แล้ว';
end;
$fn$;

revoke all on function public.request_refund(uuid, text, text, text, text) from public, anon;
grant execute on function public.request_refund(uuid, text, text, text, text) to authenticated;


-- ------------------------------------------------------------
-- 3. admin_approve_refund_request: เพิ่ม p_override_amount ให้แอดมินแก้ยอด
--    คืนได้จริงตามที่ข้อความในหน้า AdminRefunds.jsx บอกไว้ (เคสสนามไม่พร้อม
--    ใช้งาน ฯลฯ) — ต้อง drop ก่อนเพราะเพิ่มพารามิเตอร์ทำให้ signature ต่างจาก
--    เดิม ไม่งั้น create or replace จะได้ overload ใหม่ซ้อนของเดิมแทนที่จะ
--    แทนที่ (เหมือนที่ 0035 ทำกับ request_refund)
-- ------------------------------------------------------------
drop function if exists public.admin_approve_refund_request(uuid);

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

  return v_request;
end;
$fn$;

revoke all on function public.admin_approve_refund_request(uuid, numeric) from public, anon;
grant execute on function public.admin_approve_refund_request(uuid, numeric) to authenticated, service_role;
