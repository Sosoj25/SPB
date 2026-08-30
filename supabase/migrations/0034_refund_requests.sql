-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0033).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ทำให้ "คำขอคืนเงิน" ใช้งานได้จริง — แอดมินแนบสลิปโอนคืนได้
-- ============================================================
-- ที่มา: 0012 บอกไว้ตรง ๆ ว่า "การคืนเงินยังเป็นงานที่คนต้องทำเอง ระบบยังไม่มี
-- ส่วนนี้" และ BookingReceipt.jsx บอกลูกค้าว่า "การคืนเงินต้องติดต่อเจ้าหน้าที่
-- สนามโดยตรง" — ส่วน 0033 ก็ทำแค่ตัวเลขนโยบาย (24 ชม./12 ชม./50%) ให้เป็นค่า
-- จริง แต่ยังไม่มีตาราง refund_requests รองรับคำขอจริงตามที่คอมเมนต์บอกไว้
--
-- ตั้งใจไม่แตะ enum payment_status (ไม่เพิ่มค่า 'refunded') — ALTER TYPE ...
-- ADD VALUE ใช้ค่าใหม่ในทรานแซกชันเดียวกันไม่ได้ใน Postgres และไฟล์นี้ทั้งไฟล์
-- ถูกรันเป็นก้อนเดียวผ่าน SQL Editor พอดี ตาราง refund_requests ด้านล่างจึงเป็น
-- source of truth เรื่องสถานะคืนเงินแยกต่างหาก ไม่ต้องพึ่ง enum เดิมเลย
-- (bookings/payments แถวเดิมไม่ถูกแตะต้องเลย)


-- ============================================================
-- 1. ตาราง refund_requests
-- ============================================================
-- หนึ่งการจองขอคืนเงินได้ครั้งเดียว (unique booking_id) — ถ้าถูกปฏิเสธแล้ว
-- อยากขอใหม่ต้องให้แอดมินจัดการเป็นกรณีไป ยังไม่ทำ resubmit ในรอบนี้
--
-- refund_amount / lead_time_hours คำนวณ ณ ตอนขอ (จาก refund_policy_settings
-- ขณะนั้น) แล้วเก็บเป็นค่านิ่งไว้ — ถ้าแอดมินแก้นโยบายทีหลัง คำขอเก่าต้องไม่
-- เปลี่ยนยอดตามไปด้วย

create table if not exists public.refund_requests (

    id uuid primary key default gen_random_uuid(),

    booking_id uuid not null unique
        references public.bookings(id)
        on delete cascade,

    user_id uuid not null
        references public.profiles(id)
        on delete restrict,

    reason text,

    refund_amount numeric(12,2) not null,

    lead_time_hours numeric,

    status text not null default 'pending',

    reviewed_by uuid
        references public.profiles(id)
        on delete set null,

    reviewed_at timestamptz,

    rejection_reason text,

    slip_path text,

    refunded_by uuid
        references public.profiles(id)
        on delete set null,

    refunded_at timestamptz,

    requested_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    constraint refund_requests_status_check
        check (status in ('pending', 'approved', 'rejected', 'refunded')),

    constraint refund_requests_amount_check
        check (refund_amount >= 0)

);

create index if not exists refund_requests_status_idx on public.refund_requests(status);
create index if not exists refund_requests_user_id_idx on public.refund_requests(user_id);

drop trigger if exists trg_refund_requests_updated_at on public.refund_requests;
create trigger trg_refund_requests_updated_at
before update on public.refund_requests
for each row
execute function public.set_updated_at();

alter table public.refund_requests enable row level security;

-- อ่านได้เฉพาะเจ้าของคำขอกับแอดมิน — เขียนทั้งหมดผ่าน RPC security definer
-- ด้านล่างเท่านั้น (ไม่ grant insert/update ให้ authenticated ตรง ๆ) เพราะ
-- ยอดคืนเงินต้องคำนวณฝั่งเซิร์ฟเวอร์จากนโยบาย ให้ผู้ใช้ส่งยอดเองไม่ได้
drop policy if exists "refund_requests_select" on public.refund_requests;
create policy "refund_requests_select"
on public.refund_requests
for select
to authenticated
using ( user_id = (select auth.uid()) or public.is_admin() );


-- ============================================================
-- 2. Storage bucket สำหรับสลิปโอนเงินคืน (ส่วนตัว ไม่ public)
-- ============================================================
-- ต่างจาก payment-slips (0023) ตรงที่ "แอดมิน" เป็นคนอัปโหลด ไม่ใช่ลูกค้า —
-- path รูปแบบ <booking_id>/<timestamp>.<ext> เพราะโฟลเดอร์เจ้าของไม่ใช่
-- ผู้อัปโหลดอีกต่อไป policy select ฝั่งลูกค้าจึงต้อง join กลับไปที่ bookings
-- เพื่อเช็กว่าเป็นเจ้าของการจองจริง

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'refund-slips', 'refund-slips', false,
  5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public             = false,
    file_size_limit     = 5242880,
    allowed_mime_types  = array['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

drop policy if exists "Admins can upload refund slips" on storage.objects;
create policy "Admins can upload refund slips"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'refund-slips'
  and public.is_admin()
);

drop policy if exists "Admins and booking owners can view refund slips" on storage.objects;
create policy "Admins and booking owners can view refund slips"
on storage.objects for select
to authenticated
using (
  bucket_id = 'refund-slips'
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


-- ============================================================
-- 3. ลูกค้าขอคืนเงิน — ต้องยกเลิกการจองไปแล้วและเคยจ่ายเงินจริง
-- ============================================================
-- เรียกแยกจาก cancel_booking ตั้งใจ ไม่รวมเข้าไปในขั้นตอนเดียวกัน — ยกเลิกได้
-- โดยไม่ต้องขอคืนเงินทันที (เผื่อลูกค้ายังไม่พร้อมให้เหตุผล) และ cancel_booking
-- เดิมก็ถูกใช้งานอยู่แล้วทั้งฝั่งลูกค้าและแอดมิน ไม่อยากเพิ่มความเสี่ยงตรงนั้น
--
-- lead_time_hours วัดจาก "ตอนขอคืนเงิน" เทียบเวลานัดหมาย ไม่ใช่ตอนกดยกเลิก —
-- ในโฟลว์ปกติสองอย่างนี้เกิดใกล้กันมาก (กดยกเลิกแล้วขอคืนเงินต่อทันที)

create or replace function public.request_refund(
  p_booking_id uuid,
  p_reason     text default null
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
    booking_id, user_id, reason, refund_amount, lead_time_hours, status
  )
  values (
    p_booking_id, v_booking.user_id,
    nullif(btrim(coalesce(p_reason, '')), ''),
    round(v_refundable * v_percent / 100.0, 2),
    v_hours,
    'pending'
  )
  returning * into v_request;

  return v_request;
end;
$fn$;

revoke all on function public.request_refund(uuid, text) from public, anon;
grant execute on function public.request_refund(uuid, text) to authenticated;


-- ============================================================
-- 4. แอดมิน: อนุมัติ / ปฏิเสธ / แนบสลิปโอนคืน
-- ============================================================
-- สามสถานะขยับทีละขั้น: pending -> approved -> refunded (แนบสลิปได้ตอนนี้
-- เท่านั้น) หรือ pending -> rejected เป็นทางตัน — บังคับให้ต้อง "อนุมัติ" ก่อน
-- ค่อย "แนบสลิป" เพราะแนบสลิปคือยืนยันว่าโอนเงินจริงไปแล้ว จะข้ามขั้นอนุมัติ
-- ไปเลยไม่ได้

create or replace function public.admin_approve_refund_request(p_id uuid)
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

  if v_request.status = 'approved' then
    return v_request;
  end if;

  if v_request.status <> 'pending' then
    raise exception 'คำขอนี้ไม่อยู่ในสถานะที่อนุมัติได้';
  end if;

  update public.refund_requests
  set status      = 'approved',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      rejection_reason = null
  where id = p_id
  returning * into v_request;

  return v_request;
end;
$fn$;


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

  return v_request;
end;
$fn$;


-- แนบสลิปโอนคืน = ยืนยันว่าโอนเงินจริงแล้ว เปลี่ยนเป็น 'refunded' ทันที
-- (ไม่มีขั้นตรวจสอบสลิปอีกชั้น ต่างจากสลิปฝั่งลูกค้าที่ต้องรอแอดมินตรวจ เพราะ
-- ที่นี่แอดมินเป็นคนอัปโหลดเอง ไม่ใช่หลักฐานที่ต้องตรวจสอบความน่าเชื่อถือ)

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

  return v_request;
end;
$fn$;


revoke all on function public.admin_approve_refund_request(uuid) from public, anon;
revoke all on function public.admin_reject_refund_request(uuid, text) from public, anon;
revoke all on function public.admin_complete_refund_request(uuid, text) from public, anon;
grant execute on function public.admin_approve_refund_request(uuid) to authenticated, service_role;
grant execute on function public.admin_reject_refund_request(uuid, text) to authenticated, service_role;
grant execute on function public.admin_complete_refund_request(uuid, text) to authenticated, service_role;


-- ============================================================
-- 5. สรุปตัวเลขหน้า /admin/refunds (KPI การ์ดด้านบน)
-- ============================================================
-- ตาม pattern เดียวกับ admin_payment_stats (0021) — ไม่ให้หน้าเว็บดึงทุกแถว
-- มาบวกเองฝั่ง client

create or replace function public.admin_refund_stats()
returns table (
  pending_count    integer,
  approved_month   numeric,
  rejected_month   integer,
  refunded_month   numeric
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  return query
  select
    count(*) filter (where r.status = 'pending')::integer,
    coalesce(sum(r.refund_amount) filter (
      where r.status = 'approved'
        and date_trunc('month', r.reviewed_at at time zone 'Asia/Bangkok')
            = date_trunc('month', v_today::timestamp)
    ), 0),
    count(*) filter (
      where r.status = 'rejected'
        and date_trunc('month', r.reviewed_at at time zone 'Asia/Bangkok')
            = date_trunc('month', v_today::timestamp)
    )::integer,
    coalesce(sum(r.refund_amount) filter (
      where r.status = 'refunded'
        and date_trunc('month', r.refunded_at at time zone 'Asia/Bangkok')
            = date_trunc('month', v_today::timestamp)
    ), 0)
  from public.refund_requests r;
end;
$fn$;

revoke all on function public.admin_refund_stats() from public, anon;
grant execute on function public.admin_refund_stats() to authenticated, service_role;
