-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0016).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- สรุปจากการตรวจสอบระบบทั้งหมด (2026-08-26) พบช่องโหว่/จุดที่ควรแก้ 3 เรื่อง
-- ============================================================


-- ============================================================
-- 1. [แก้ด่วน] ปิดช่องโหว่ admin ยกระดับตัวเองเป็น super_admin
-- ============================================================
-- ปัญหา: trigger protect_profile_privileged_columns (0003) ปล่อยผ่านการ
-- แก้ role/points/is_active ทั้งหมดทันทีที่ is_admin() เป็น true — แต่
-- is_admin() คืน true ให้ทั้ง 'admin' และ 'super_admin' เหมือนกัน (ตาม
-- comment ใน 0016 เอง) ผลคือ admin ธรรมดาเรียก
--   PATCH /rest/v1/profiles?id=eq.<ตัวเอง>  { "role": "super_admin" }
-- ตรง ๆ ผ่าน REST API (ไม่ผ่าน frontend/RPC set_user_role เลย) แล้ว
-- ยกระดับตัวเองได้ทันที เพราะทั้ง RLS policy (profiles_admin_all) และ
-- trigger นี้เช็คแค่ is_admin() เหมือนกันทั้งคู่
--
-- แก้โดยแยกเงื่อนไขคอลัมน์ role ออกมาให้ต้องใช้ is_super_admin() เท่านั้น
-- (เข้มกว่าเดิม) ส่วน points/is_active ยังใช้ is_admin() เหมือนเดิม
-- RPC set_user_role() (0016) ยังทำงานได้ปกติ เพราะมันเช็ค is_super_admin()
-- อยู่แล้วก่อนจะ update

create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if new.role is distinct from old.role and not public.is_super_admin() then
    raise exception 'role cannot be modified directly';
  end if;

  if not public.is_admin() then
    if new.points is distinct from old.points then
      raise exception 'points cannot be modified directly';
    end if;

    if new.is_active is distinct from old.is_active then
      raise exception 'is_active cannot be modified directly';
    end if;
  end if;

  return new;
end;
$function$;


-- ============================================================
-- 2. ลด attack surface: revoke EXECUTE ของฟังก์ชันที่ควรใช้เป็น trigger
-- เท่านั้น ไม่ควรถูกเรียกตรงผ่าน /rest/v1/rpc/... ได้
-- ============================================================
-- trigger ไม่ต้องมี EXECUTE grant ก็ทำงานได้ปกติ (Postgres เรียก trigger
-- function ด้วยสิทธิ์เจ้าของ function โดยอัตโนมัติ) การ revoke นี้แค่ปิด
-- ทางที่ anon/authenticated เรียกฟังก์ชันเหล่านี้ตรง ๆ นอก trigger context
--
-- หมายเหตุ: ต้อง revoke จาก PUBLIC ไม่ใช่แค่ anon/authenticated — ฟังก์ชัน
-- ใหม่ทุกตัวได้ EXECUTE ติด PUBLIC มาโดย default ตอนสร้าง (proacl มี "=X"
-- ซึ่งทุก role เป็นสมาชิกโดยปริยาย) revoke จาก anon/authenticated ตรง ๆ
-- จึงไม่มีผลถ้ายังไม่ revoke จาก PUBLIC ก่อน

revoke execute on function public.handle_new_user() from public;
revoke execute on function public.protect_booking_privileged_columns() from public;
revoke execute on function public.protect_profile_privileged_columns() from public;
revoke execute on function public.protect_review_privileged_columns() from public;
revoke execute on function public.reject_past_booking_date() from public;

grant execute on function public.handle_new_user() to service_role;
grant execute on function public.protect_booking_privileged_columns() to service_role;
grant execute on function public.protect_profile_privileged_columns() to service_role;
grant execute on function public.protect_review_privileged_columns() to service_role;
grant execute on function public.reject_past_booking_date() to service_role;


-- ============================================================
-- 3. ย้าย extension btree_gist ออกจาก schema public ไป extensions
-- ============================================================
-- ใช้กับ EXCLUDE USING gist บน bookings/facility_time_slots เท่านั้น
-- database นี้มี search_path เริ่มต้นเป็น "$user", public, extensions
-- อยู่แล้ว (เหมือน pgcrypto/uuid-ossp ที่อยู่ extensions schema อยู่แล้ว)
-- จึงย้ายได้โดยไม่กระทบ constraint เดิมหรือ migration ในอนาคต

alter extension btree_gist set schema extensions;


-- ============================================================
-- 4. เพิ่ม index ให้ foreign key ที่ยังไม่มี covering index
-- ============================================================

create index if not exists idx_payments_verified_by
  on public.payments (verified_by);

create index if not exists idx_reward_redemptions_reward_id
  on public.reward_redemptions (reward_id);

create index if not exists idx_post_images_post_id
  on public.post_images (post_id);

create index if not exists idx_community_reports_reporter_id
  on public.community_reports (reporter_id);

create index if not exists idx_community_reports_reviewed_by
  on public.community_reports (reviewed_by);

create index if not exists idx_news_author_id
  on public.news (author_id);
