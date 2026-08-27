-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0024).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ต่อหน้า Admin/แก้ไขรูปสนาม เข้ากับตารางจริง
-- ============================================================
-- facility_images (0000) มีตารางและ RLS ของฝั่งแอดมินพร้อมอยู่แล้ว (แยก
-- insert/update/delete ตั้งแต่ 0022) แต่ไม่เคยมี storage bucket รองรับ และ
-- ไม่เคยมีหน้า admin ให้อัปโหลดจริง — lib/catalog.js อ่านตารางนี้มาแสดงเป็น
-- รูปสนามอยู่แล้ว (ว่างเปล่ามาตลอดจึงใช้รูปกีฬาแทนไปก่อน ดูคอมเมนต์ใน
-- lib/catalog.js) ไฟล์นี้เติมสองอย่างที่ขาด: bucket + คอลัมน์ metadata รูป


-- ============================================================
-- 1. คอลัมน์เพิ่มเติมสำหรับแสดงผลในหน้า admin (คำบรรยาย, ขนาดไฟล์/รูป)
-- ============================================================
-- width/height/size_bytes เก็บตอนอัปโหลดจากฝั่ง client เลย (อ่านจาก
-- Image()/file.size ก่อนอัปโหลด) ไม่ต้องให้ฝั่ง server มา probe ไฟล์ซ้ำ —
-- ใช้เตือน "รูปนี้ความละเอียดต่ำ" บนหน้า admin โดยไม่ต้องโหลดรูปทุกใบใหม่
-- ทุกครั้งที่เข้าหน้า

alter table public.facility_images
  add column if not exists caption text not null default '',
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists size_bytes integer;


-- ============================================================
-- 2. Storage bucket สำหรับรูปสนาม
-- ============================================================
-- รูปแบบเดียวกับ bucket amenities (0020) + จำกัดขนาด/ชนิดไฟล์ตั้งแต่สร้าง
-- เลย (ต่างจาก news/amenities ที่ลืมตั้งตอนแรกแล้วมาแก้ทีหลังใน 0021)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'facility-images', 'facility-images', true,
  5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public             = true,
    file_size_limit     = 5242880,
    allowed_mime_types  = array['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

drop policy if exists "Facility images are publicly accessible" on storage.objects;
create policy "Facility images are publicly accessible"
on storage.objects for select
using ( bucket_id = 'facility-images' );

drop policy if exists "Admins can upload facility images" on storage.objects;
create policy "Admins can upload facility images"
on storage.objects for insert to authenticated
with check ( bucket_id = 'facility-images' and (select public.is_admin()) );

drop policy if exists "Admins can update facility images" on storage.objects;
create policy "Admins can update facility images"
on storage.objects for update to authenticated
using ( bucket_id = 'facility-images' and (select public.is_admin()) );

drop policy if exists "Admins can delete facility images" on storage.objects;
create policy "Admins can delete facility images"
on storage.objects for delete to authenticated
using ( bucket_id = 'facility-images' and (select public.is_admin()) );


-- ============================================================
-- 3. ตั้งรูปหน้าปก — ทำเป็น RPC กันแข่งกันตั้งสองรูปพร้อมกัน
-- ============================================================
-- ถ้าให้ client ทำสอง update แยกกัน (เคลียร์ is_primary เดิมทั้งหมด แล้ว
-- ค่อยตั้งรูปใหม่) มีช่วงที่ request แรกสำเร็จแต่ request สองพลาด (เช่น
-- เน็ตหลุดกลางทาง) จะเหลือสนามที่ไม่มีรูปหน้าปกเลยชั่วขณะ — รวมเป็น
-- ธุรกรรมเดียวในฟังก์ชันเดียวกันตัดปัญหานี้ทิ้ง

create or replace function public.set_facility_primary_image(p_image_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_facility_id bigint;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  select facility_id into v_facility_id
  from public.facility_images
  where id = p_image_id;

  if not found then
    raise exception 'ไม่พบรูปนี้';
  end if;

  update public.facility_images
  set is_primary = (id = p_image_id)
  where facility_id = v_facility_id
    and is_primary <> (id = p_image_id);
end;
$fn$;

revoke all on function public.set_facility_primary_image(bigint) from public, anon;
grant execute on function public.set_facility_primary_image(bigint) to authenticated;
