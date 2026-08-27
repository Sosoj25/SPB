-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0026).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- หน้า "ตั้งค่าการรับชำระเงิน" ของแอดมิน (2026-08-27)
-- ============================================================
-- ดีไซน์เดิม (Figma) มีทั้งบัญชีรับเงินหลายบัญชี, ช่องทางชำระเงิน 5 แบบ
-- (บัตรเครดิต/เดบิต, พร้อมเพย์, Online Banking, TrueMoney, เงินสดที่สนาม),
-- รอบการโอนเงินอัตโนมัติ + ปุ่ม "โอนเงินทันที", และนโยบายคืนเงิน — แต่ระบบ
-- จริงตอนนี้ (0023/0026) รองรับแค่ 2 ช่องทาง (พร้อมเพย์ผ่าน PlernPay กับ
-- โอนผ่านบัญชี+แนบสลิป ดู PAYMENT_METHODS ใน lib/payments.js) ไม่มี payout
-- API ไปยังบัญชีสนาม และไม่มีระบบคืนเงินเลย (ดูคอมเมนต์ cancel_booking ใน
-- 0012 ที่บอกตรง ๆ ว่าการคืนเงินยังเป็นงานที่คนต้องทำเอง)
--
-- migration นี้จึงสร้างเฉพาะสองส่วนที่มีของจริงรองรับและอิงกับหน้าเว็บจริง:
--
--   1. payment_accounts — แทนค่าคงที่ BANK_ACCOUNT ที่เคยฮาร์ดโค้ดไว้ในโค้ด
--      (lib/bankAccount.js) ด้วยตารางจริงที่แอดมินแก้ได้ หน้าชำระเงิน
--      (BookingPayment.jsx) อ่านบัญชีหลัก (is_primary) มาแสดงแทนค่าคงที่
--
--   2. payment_channel_settings — เปิด/ปิดสองช่องทางที่มีจริง ปิดแล้ว
--      หน้าชำระเงินจะไม่แสดงช่องทางนั้นให้ลูกค้าเลือกอีก
--
-- ไม่มีตารางสำหรับช่องทางที่ไม่มีอะไรรองรับ, รอบการโอน, หรือนโยบายคืนเงิน —
-- ทำตอนนี้จะได้แค่ UI ที่กดแล้วไม่มีอะไรเกิดขึ้นจริง เหมือนหน้าเดิมที่เพิ่ง
-- ถูกตัดทิ้งไปด้วยเหตุผลเดียวกัน (ดูคอมเมนต์หัวไฟล์ AdminPayments.jsx)


-- ============================================================
-- 1. บัญชีรับเงิน (โอนผ่านบัญชี + แนบสลิป)
-- ============================================================

create table if not exists public.payment_accounts (
    id              uuid primary key default gen_random_uuid(),
    bank_name       text not null,
    account_number  text not null,
    account_name    text not null,
    is_primary      boolean not null default false,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

drop trigger if exists trg_payment_accounts_updated_at on public.payment_accounts;
create trigger trg_payment_accounts_updated_at
before update on public.payment_accounts
for each row
execute function public.set_updated_at();

-- อนุญาตให้ is_primary = true ได้แถวเดียวในตาราง — ฝั่งแอปเป็นคนยิง update
-- ปลดบัญชีเดิมก่อนตั้งบัญชีใหม่เสมอ (ดู setPrimaryPaymentAccount ใน
-- lib/paymentSettings.js) ดัชนีนี้กันไว้อีกชั้นไม่ให้มีสองบัญชีหลักพร้อมกัน
create unique index if not exists payment_accounts_one_primary
on public.payment_accounts (is_primary)
where is_primary;

-- ย้ายค่าคงที่เดิมจาก lib/bankAccount.js มาเป็นข้อมูลตั้งต้น (ยังเป็น
-- "ตัวอย่าง" เหมือนเดิม) แอดมินแก้เป็นบัญชีจริงได้ทันทีจากหน้าตั้งค่า
insert into public.payment_accounts (bank_name, account_number, account_name, is_primary)
select
    'ธนาคารกสิกรไทย',
    'XXX-X-XXXXX-X',
    'ชื่อบัญชี สนามกีฬา (ตัวอย่าง — แก้เป็นบัญชีจริงก่อนใช้งาน)',
    true
where not exists (select 1 from public.payment_accounts);

alter table public.payment_accounts enable row level security;

-- ลูกค้าที่ล็อกอินแล้วต้องเห็นบัญชีตอนเลือกช่องทางโอนผ่านบัญชีในหน้าชำระเงิน
-- จึงให้ authenticated อ่านได้ทุกแถว ไม่ใช่แค่บัญชีหลัก — เลขบัญชีรับเงินของ
-- สนามไม่ใช่ข้อมูลลับที่ต้องปิดจากลูกค้าอยู่แล้ว
drop policy if exists "payment_accounts_authenticated_read" on public.payment_accounts;
create policy "payment_accounts_authenticated_read"
on public.payment_accounts
for select
to authenticated
using ( true );

drop policy if exists "payment_accounts_admin_manage" on public.payment_accounts;
create policy "payment_accounts_admin_manage"
on public.payment_accounts
for all
to authenticated
using ( public.is_admin() )
with check ( public.is_admin() );


-- ============================================================
-- 2. เปิด/ปิดช่องทางชำระเงิน (เฉพาะ 2 ช่องทางที่มีจริง)
-- ============================================================
-- ตั้งใจไม่ใช้ 'other' จาก enum payment_method — ค่านั้นไม่มีช่องทางจริงผูก
-- อยู่ (ดูคอมเมนต์ PAYMENT_METHODS ใน lib/payments.js) จึงไม่ควรเปิดให้เปิด/
-- ปิดจากหน้านี้ได้เหมือนมีของจริงรองรับ

create table if not exists public.payment_channel_settings (
    method      public.payment_method primary key,
    enabled     boolean not null default true,
    updated_at  timestamptz not null default now(),
    constraint payment_channel_settings_supported_method
        check (method in ('qr', 'bank_transfer'))
);

drop trigger if exists trg_payment_channel_settings_updated_at on public.payment_channel_settings;
create trigger trg_payment_channel_settings_updated_at
before update on public.payment_channel_settings
for each row
execute function public.set_updated_at();

insert into public.payment_channel_settings (method, enabled)
values ('qr', true), ('bank_transfer', true)
on conflict (method) do nothing;

alter table public.payment_channel_settings enable row level security;

drop policy if exists "payment_channel_settings_authenticated_read" on public.payment_channel_settings;
create policy "payment_channel_settings_authenticated_read"
on public.payment_channel_settings
for select
to authenticated
using ( true );

drop policy if exists "payment_channel_settings_admin_manage" on public.payment_channel_settings;
create policy "payment_channel_settings_admin_manage"
on public.payment_channel_settings
for update
to authenticated
using ( public.is_admin() )
with check ( public.is_admin() );
