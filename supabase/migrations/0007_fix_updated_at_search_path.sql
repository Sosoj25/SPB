-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0006).
-- Safe to re-run: replacing the function is idempotent.
--
-- ============================================================
-- ปัญหา: set_updated_at() ไม่ได้ set search_path (Supabase advisor เตือน)
-- ============================================================
-- ฟังก์ชันอื่นทุกตัวตั้งแต่ 0002 เป็นต้นมา set search_path = public ไว้แล้ว
-- ยกเว้น set_updated_at() (0000/0001) ตัวเดียวที่ตกหล่น ทำให้ function
-- resolution พึ่ง search_path ของ session ที่เรียก แทนที่จะ fix ไว้ตายตัว --
-- ช่องโหว่คลาสสิกคือถ้ามีคนสร้าง schema/ฟังก์ชันชื่อชนกันแล้วแก้ search_path
-- ของ role หรือ session ได้ ก็สามารถ hijack ให้ trigger ไปเรียกโค้ดอื่นแทนได้

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
