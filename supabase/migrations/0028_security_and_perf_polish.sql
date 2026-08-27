-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0027).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ตามผลตรวจระบบทั้งหมดรอบล่าสุด (2026-08-27) — ไม่มีช่องโหว่ร้ายแรง
-- แต่มีจุดที่ควรปิดให้เรียบร้อย
-- ============================================================


-- ============================================================
-- 1. payment_accounts มี RLS policy ซ้อนกันบน SELECT
-- ============================================================
-- 0027 สร้าง payment_accounts_admin_manage เป็น "for all" ซึ่งครอบ SELECT
-- ทับกับ payment_accounts_authenticated_read ที่มีอยู่แล้ว (advisor:
-- multiple_permissive_policies) — Postgres ต้อง OR ทั้งสอง policy ทุกแถวที่
-- สแกน ทั้งที่ authenticated_read (using true) ครอบทุกกรณีอยู่แล้ว
--
-- แก้ตาม pattern เดียวกับที่ 0022 ทำกับตารางอื่นทั้งหมด: แยก "for all" ออก
-- เหลือแค่ insert/update/delete ไม่แตะ SELECT เลย สิทธิ์ไม่เปลี่ยนแม้แต่ข้อเดียว

drop policy if exists "payment_accounts_admin_manage" on public.payment_accounts;

drop policy if exists "payment_accounts_admin_insert" on public.payment_accounts;
create policy "payment_accounts_admin_insert"
on public.payment_accounts for insert to authenticated
with check ( (select public.is_admin()) );

drop policy if exists "payment_accounts_admin_update" on public.payment_accounts;
create policy "payment_accounts_admin_update"
on public.payment_accounts for update to authenticated
using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );

drop policy if exists "payment_accounts_admin_delete" on public.payment_accounts;
create policy "payment_accounts_admin_delete"
on public.payment_accounts for delete to authenticated
using ( (select public.is_admin()) );

-- เดิม payment_accounts_authenticated_read เขียน auth.uid()/is_admin() ไว้ลอย ๆ
-- ก็ไม่มี (using (true) ไม่ต้องเรียกฟังก์ชันอะไร) จึงไม่มี auth_rls_initplan
-- ให้ต้องแก้ตรงนี้เพิ่ม


-- ============================================================
-- 2. index ที่ขาดบน foreign key
-- ============================================================
-- facility_price_history.changed_by ไม่มี index คู่ — advisor: unindexed_foreign_keys
-- ตารางนี้ถูก query ตาม facility_id เป็นหลัก แต่หน้า admin ที่จะโชว์ "ใครแก้ราคา
-- เมื่อไหร่" ในอนาคตจะ join กับ profiles ผ่านคอลัมน์นี้ ใส่ไว้ตอนตารางยังเล็ก
-- ถูกกว่าใส่ทีหลังตอนข้อมูลเยอะ

create index if not exists idx_facility_price_history_changed_by
on public.facility_price_history (changed_by);


-- ============================================================
-- 3. confirm_gateway_payment / fail_gateway_payment: กันเผื่อ charge_id ไม่ตรง
-- ============================================================
-- ปัจจุบันปลอดภัยอยู่แล้วเพราะสองฟังก์ชันนี้ grant ให้ service_role เท่านั้น
-- และ Edge Function ที่เรียก (check-plernpay-payment) ก็อ่าน gateway_charge_id
-- มาจากแถวเดิมใน DB เองก่อนส่งกลับเข้ามา ไม่ได้รับค่านี้จาก client ตรง ๆ —
-- แต่ถ้าวันหนึ่งมีจุดเรียกอื่นเพิ่ม (retry job, admin manual override ฯลฯ)
-- ควรมีชั้นตรวจสอบในฟังก์ชันเองไม่ใช่หวังพึ่งแค่ว่า "ผู้เรียกทำถูกทุกที"

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

  -- webhook อาจยิงซ้ำได้ (retry) — กดซ้ำต้องไม่ทำอะไรเพิ่ม
  if v_payment.status = 'approved' then
    return v_payment;
  end if;

  -- เคยผูก charge_id ไว้ก่อนแล้วและไม่ตรงกับที่ส่งมารอบนี้ — แปลว่าคนละ
  -- transaction กัน ไม่ควรยืนยันทับ (ป้องกันไว้เผื่ออนาคตมีจุดเรียกเพิ่ม)
  if v_payment.gateway_charge_id is not null
     and v_payment.gateway_charge_id <> p_charge_id
  then
    raise exception 'charge id ไม่ตรงกับรายการชำระเงินนี้';
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

  if v_payment.gateway_charge_id is not null
     and v_payment.gateway_charge_id <> p_charge_id
  then
    raise exception 'charge id ไม่ตรงกับรายการชำระเงินนี้';
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


-- ============================================================
-- 4. [ทำเองใน Dashboard — ไม่มี API ให้ migration ตั้งค่านี้ได้]
-- ============================================================
-- Auth advisor: auth_leaked_password_protection ยังปิดอยู่ เปิดได้ที่
-- Dashboard -> Authentication -> Policies -> "Leaked password protection"
-- (เช็ครหัสผ่านตอนสมัคร/เปลี่ยนรหัสกับฐานข้อมูล HaveIBeenPwned)
