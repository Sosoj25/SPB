-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0064).
-- Safe to re-run: idempotent.
--
-- ============================================================
-- เปิด Realtime ให้ตาราง notifications
-- ============================================================
-- ให้กระดิ่งแจ้งเตือน (AppHeader) และแท็บ "การแจ้งเตือน" (Profile) อัปเดตเอง
-- ทันทีที่มีแถวใหม่เข้ามาหรือถูกติ๊กอ่านแล้ว โดยไม่ต้องรอผู้ใช้กดรีเฟรช —
-- postgres_changes เคารพ RLS ของตารางอยู่แล้ว (notifications_select_own,
-- 0000/0022) จำกัดเฉพาะแถวของ user_id = auth.uid() คนอื่นที่ subscribe
-- channel ชื่อเดียวกันจะไม่ได้รับ event ของแถวที่ไม่ใช่ของตัวเอง
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
