-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0015).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ปัญหา: profiles_admin_all (0000) ให้ admin update role ของคนอื่นตรง ๆ
-- ผ่าน supabase-js ได้เลย แต่ is_admin() คืน true ให้ทั้ง 'admin' และ
-- 'super_admin' เหมือนกัน (ไม่มีระดับต่างกันใน RLS เลย) — ถ้าเปิดหน้า
-- SuperAdminUsers ให้เรียก .from('profiles').update({role}) ตรง ๆ
-- บัญชี admin ธรรมดา (ไม่ใช่ super_admin) จะยกระดับตัวเองเป็น super_admin
-- ได้ทันทีด้วย request เดียวกัน เพราะ RLS มองไม่เห็นความต่างระหว่างสองบทบาทนี้
-- ============================================================
--
-- ฟังก์ชันนี้บังคับว่าการเปลี่ยน role ต้องผ่าน is_super_admin() เท่านั้น
-- (เข้มกว่า is_admin() ที่ RLS ใช้อยู่) และกันไม่ให้ super_admin เปลี่ยน
-- role ของตัวเอง (กันมือลื่นเปลี่ยนตัวเองจนล็อกตัวเองออกจากสิทธิ์)

create or replace function public.set_user_role(
  p_user_id uuid,
  p_role    public.user_role
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_profile public.profiles;
begin
  if not public.is_super_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบสูงสุดเท่านั้น';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'ไม่สามารถเปลี่ยนบทบาทของตัวเองได้';
  end if;

  update public.profiles
  set role = p_role
  where id = p_user_id
  returning * into v_profile;

  if not found then
    raise exception 'ไม่พบผู้ใช้นี้';
  end if;

  return v_profile;
end;
$fn$;

revoke all on function public.set_user_role(uuid, public.user_role) from public, anon;
grant execute on function public.set_user_role(uuid, public.user_role) to authenticated;
