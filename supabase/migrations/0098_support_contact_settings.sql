-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0097).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ข้อมูลติดต่อบนหน้า "ติดต่อเรา" ให้แอดมินแก้เองได้
-- ============================================================
-- เบอร์โทร อีเมล LINE และที่อยู่สำนักงานถูกฮาร์ดโค้ดไว้ใน Contact.jsx ตั้งแต่
-- 0096 — วันที่สนามย้ายที่ตั้งหรือเปลี่ยนเบอร์ ต้องรอคนแก้โค้ดแล้ว deploy ใหม่
-- ซึ่งแปลว่าระหว่างนั้นลูกค้าจะโทรไปเบอร์ที่ไม่มีคนรับ
--
-- แถวเดียวเหมือน facilities_page_settings (0020) และ refund_policy_settings
-- (0033) — ไม่ทำเป็นตารางหลายแถวต่อช่องทาง เพราะสามช่องทางนี้คือช่องคงที่ใน
-- ดีไซน์ (โทรศัพท์/อีเมล/LINE) ไม่ใช่รายการที่แอดมินเพิ่มเองได้เรื่อย ๆ
--
-- ทุกคอลัมน์ default '' และหน้าเว็บซ่อนช่องทางที่ค่าว่าง — สนามที่ยังไม่มี
-- LINE Official จึงลบข้อความออกให้การ์ดหายไปทั้งอันได้ ไม่ต้องใส่ค่าหลอกไว้

create table if not exists public.support_contact_settings (

    id smallint primary key default 1,

    phone text not null default '',

    phone_hint text not null default '',

    email text not null default '',

    email_hint text not null default '',

    line_id text not null default '',

    line_hint text not null default '',

    -- ลิงก์เปิดแชท LINE — เว้นว่างได้ หน้าเว็บจะประกอบจาก line_id ให้เอง
    line_url text not null default '',

    office_address text not null default '',

    -- ลิงก์แผนที่ของสนามเอง (เช่น Google Maps ที่ปักหมุดไว้แล้ว) — เว้นว่างได้
    -- หน้าเว็บจะค้นจาก office_address แทน ซึ่งแม่นน้อยกว่าแต่ไม่ต้องตั้งค่า
    map_url text not null default '',

    updated_at timestamptz not null default now(),

    constraint support_contact_settings_singleton check (id = 1)

);

drop trigger if exists trg_support_contact_settings_updated_at
on public.support_contact_settings;

create trigger trg_support_contact_settings_updated_at
before update on public.support_contact_settings
for each row
execute function public.set_updated_at();

-- seed ด้วยค่าเดิมที่ฮาร์ดโค้ดอยู่ใน Contact.jsx ตอนนี้ หน้าเว็บจะได้ไม่ว่าง
-- ทันทีที่เปลี่ยนไปอ่านจากตารางนี้
insert into public.support_contact_settings (
  id, phone, phone_hint, email, email_hint, line_id, line_hint, line_url, office_address
)
values (
  1,
  '099-191-5489',
  '09:00 – 21:00 น. ทุกวัน',
  'support@sportsbooking.co.th',
  'ตอบกลับภายใน 24 ชม.',
  '@sportsbooking',
  'แชทสดในเวลาทำการ',
  'https://line.me/R/ti/p/@sportsbooking',
  'SPB Arena รามอินทรา 40 แขวงรามอินทรา เขตคันนายาว กรุงเทพฯ 10230'
)
on conflict (id) do nothing;

alter table public.support_contact_settings enable row level security;

-- อ่านได้ทุกคนรวมถึงผู้ที่ยังไม่ล็อกอิน (เผื่อวันหนึ่งย้ายข้อมูลติดต่อไปโชว์
-- บนหน้า Landing ด้วย) ส่วนการแก้ไขจำกัดที่แอดมิน — เหมือน facilities_page_settings
drop policy if exists "support_contact_settings_public_read" on public.support_contact_settings;
create policy "support_contact_settings_public_read"
on public.support_contact_settings
for select
to anon, authenticated
using ( true );

drop policy if exists "support_contact_settings_admin_manage" on public.support_contact_settings;
create policy "support_contact_settings_admin_manage"
on public.support_contact_settings
for update
to authenticated
using ( (select public.is_admin()) )
with check ( (select public.is_admin()) );

grant select on public.support_contact_settings to anon, authenticated;
grant update on public.support_contact_settings to authenticated;
