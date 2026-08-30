-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0031).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ให้ admin แก้ไข "รูปภาพประจำกีฬา" ได้ (ปัจจุบันรูปกีฬาทั้ง 6 ชนิดฮาร์ดโค้ด
-- เป็น asset ในโค้ด frontend อยู่ที่ lib/catalog.js — ดู SPORT_IMAGES)
-- ============================================================
-- sports.icon_url (0000) มีอยู่แล้วแต่ยังไม่เคยถูกใช้งาน และ sports_admin_manage
-- (0000) ให้สิทธิ์ admin update ตาราง sports ทั้งตารางอยู่แล้ว จึงไม่ต้องเพิ่ม
-- policy ระดับตารางใหม่ — เหลือแค่ต้องมี storage bucket ให้อัปโหลดไฟล์รูปลงไป
-- (รูปแบบเดียวกับ bucket "amenities" ใน 0020 และ "news" ใน 0018)

insert into storage.buckets (id, name, public)
values ('sport-images', 'sport-images', true)
on conflict (id) do nothing;

drop policy if exists "Sport images are publicly accessible" on storage.objects;
create policy "Sport images are publicly accessible"
on storage.objects for select
using ( bucket_id = 'sport-images' );

drop policy if exists "Admins can upload sport images" on storage.objects;
create policy "Admins can upload sport images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'sport-images'
  and public.is_admin()
);

drop policy if exists "Admins can update sport images" on storage.objects;
create policy "Admins can update sport images"
on storage.objects for update
to authenticated
using (
  bucket_id = 'sport-images'
  and public.is_admin()
);

drop policy if exists "Admins can delete sport images" on storage.objects;
create policy "Admins can delete sport images"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'sport-images'
  and public.is_admin()
);
