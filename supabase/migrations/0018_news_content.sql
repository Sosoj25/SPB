-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0017).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ต่อหน้า Admin/News (จัดการข่าวสาร) เข้ากับตาราง news จริง
-- ============================================================
-- news (0000) มีแค่ title/content/cover_image/status/published_at — ยังไม่พอ
-- สำหรับหน้า admin ที่ต้องมีหมวดหมู่ แท็ก ปักหมุดข่าวเด่น และยอดเข้าชม
--
-- ไม่เพิ่ม news_status ตัวใหม่ (เช่น 'scheduled') สำหรับ "ตั้งเวลาเผยแพร่" —
-- ใช้ status = 'published' + published_at ในอนาคตแทน แล้วแก้ news_public_read
-- ให้เช็ค published_at <= now() ด้วย (เดิมไม่เช็คเลย ทำให้ตั้งเวลาไว้ล่วงหน้า
-- แล้วโชว์สาธารณะทันที) ฝั่ง frontend แสดงป้าย "ตั้งเวลา" เองจากการเทียบเวลา


-- ============================================================
-- 1. หมวดหมู่ข่าว
-- ============================================================

do $$
begin
    if not exists (
        select 1 from pg_type where typname = 'news_category'
    ) then
        create type public.news_category as enum (
            'การแข่งขัน',
            'กิจกรรม',
            'ประกาศ',
            'โปรโมชัน'
        );
    end if;
end
$$;


-- ============================================================
-- 2. คอลัมน์เพิ่มเติมของ news
-- ============================================================

alter table public.news
add column if not exists subtitle text;

alter table public.news
add column if not exists category public.news_category not null default 'ประกาศ';

alter table public.news
add column if not exists tags text[] not null default '{}';

alter table public.news
add column if not exists is_featured boolean not null default false;

-- ยังไม่มีหน้าอ่านข่าวแยก (article detail) ในระบบตอนนี้ — คอลัมน์นี้เตรียมไว้
-- ให้อนาคต ค่าจะค้างที่ 0 จนกว่าจะมีหน้าที่เรียก increment_news_view() จริง
alter table public.news
add column if not exists view_count integer not null default 0;

create index if not exists idx_news_category on public.news(category);
create index if not exists idx_news_featured on public.news(is_featured) where is_featured;


-- ============================================================
-- 3. แก้ news_public_read ให้เช็ค published_at ด้วย
-- ============================================================
-- เดิม (0000): status = 'published' or is_admin() — ไม่สนใจ published_at เลย
-- ผลคือข่าว "ตั้งเวลาเผยแพร่ล่วงหน้า" ที่ตั้ง status เป็น published ไว้แล้ว
-- จะโชว์บนหน้าเว็บสาธารณะทันที ทั้งที่ยังไม่ถึงเวลาที่ตั้งไว้

drop policy if exists "news_public_read" on public.news;

create policy "news_public_read"
on public.news
for select
to anon, authenticated
using (
    (status = 'published' and published_at <= now())
    or public.is_admin()
);


-- ============================================================
-- 4. Storage bucket สำหรับรูปปกข่าว
-- ============================================================
-- อ่านสาธารณะ (ต้องแสดงบนเว็บ) เขียนได้เฉพาะ admin/super_admin — คนละแบบกับ
-- bucket avatars (0001) ที่เช็คจาก owner folder เพราะรูปข่าวไม่มีเจ้าของเป็น
-- รายบุคคล เป็นของแอดมินทั้งทีมร่วมกันดูแล

insert into storage.buckets (id, name, public)
values ('news', 'news', true)
on conflict (id) do nothing;

drop policy if exists "News images are publicly accessible" on storage.objects;
create policy "News images are publicly accessible"
on storage.objects for select
using ( bucket_id = 'news' );

drop policy if exists "Admins can upload news images" on storage.objects;
create policy "Admins can upload news images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'news'
  and public.is_admin()
);

drop policy if exists "Admins can update news images" on storage.objects;
create policy "Admins can update news images"
on storage.objects for update
to authenticated
using (
  bucket_id = 'news'
  and public.is_admin()
);

drop policy if exists "Admins can delete news images" on storage.objects;
create policy "Admins can delete news images"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'news'
  and public.is_admin()
);
