-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0032).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- นโยบายคืนเงิน (Figma node 707:668) — ให้ลูกค้าเห็นตอนชำระเงินและแอดมินแก้ได้
-- ============================================================
-- เดิมตัวเลข 24 ชม./12 ชม./50% ถูกฮาร์ดโค้ดไว้ในหน้า AdminRefunds.jsx เฉย ๆ
-- (ดูคอมเมนต์หัวไฟล์เดิม: "ยังไม่ผูก Supabase") หน้าชำระเงินก็ไม่เคยแสดง
-- นโยบายนี้ให้ลูกค้าเห็นเลย ตาราง single-row นี้ตาม pattern เดียวกับ
-- facilities_page_settings (0020) ทำให้ทั้งสองฝั่งอ่าน/แก้ค่าเดียวกันได้จริง
--
-- ไม่ได้สร้างตาราง refund_requests ในรอบนี้ — ส่วนคำขอคืนเงินของ
-- AdminRefunds.jsx ยังเป็น mock ล้วนเหมือนเดิม (ไม่มี cancel_booking เวอร์ชัน
-- ที่คำนวณคืนเงินจริงในระบบ ดูคอมเมนต์ 0012) ทำตอนนี้ยังไม่มีอะไรรองรับ

create table if not exists public.refund_policy_settings (

    id smallint primary key default 1,

    full_refund_hours integer not null default 24,

    partial_refund_hours integer not null default 12,

    partial_refund_percent integer not null default 50,

    updated_at timestamptz not null default now(),

    constraint refund_policy_settings_singleton check (id = 1),

    constraint refund_policy_settings_hours_order
        check (full_refund_hours > partial_refund_hours and partial_refund_hours >= 0),

    constraint refund_policy_settings_percent_range
        check (partial_refund_percent between 0 and 100)

);

drop trigger if exists trg_refund_policy_settings_updated_at
on public.refund_policy_settings;

create trigger trg_refund_policy_settings_updated_at
before update on public.refund_policy_settings
for each row
execute function public.set_updated_at();

-- seed ด้วยตัวเลขเดิมที่เคยฮาร์ดโค้ดไว้ใน AdminRefunds.jsx
insert into public.refund_policy_settings (id, full_refund_hours, partial_refund_hours, partial_refund_percent)
values (1, 24, 12, 50)
on conflict (id) do nothing;

alter table public.refund_policy_settings enable row level security;

-- ลูกค้าต้องเห็นนโยบายนี้ตอนอยู่หน้าชำระเงินก่อนล็อกอินเสร็จเรียบร้อยด้วยซ้ำ
-- ในบางเคส จึงเปิดอ่านให้ anon ด้วยเหมือน facilities_page_settings — ตัวเลข
-- นโยบายคืนเงินไม่ใช่ข้อมูลลับที่ต้องปิดจากใครอยู่แล้ว
drop policy if exists "refund_policy_settings_public_read" on public.refund_policy_settings;
create policy "refund_policy_settings_public_read"
on public.refund_policy_settings
for select
to anon, authenticated
using ( true );

drop policy if exists "refund_policy_settings_admin_manage" on public.refund_policy_settings;
create policy "refund_policy_settings_admin_manage"
on public.refund_policy_settings
for update
to authenticated
using ( public.is_admin() )
with check ( public.is_admin() );
