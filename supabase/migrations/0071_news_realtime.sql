-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0070).
-- Safe to re-run: idempotent.
--
-- ============================================================
-- เปิด Realtime ให้ตาราง news
-- ============================================================
-- ให้ badge บนปุ่ม "ข่าว" (AppHeader) ป้ายหมวดข่าวใหม่ และจำนวนข่าวต่อหมวด
-- ในหน้า /news อัปเดตเองทันทีที่แอดมินเผยแพร่/แก้ไขข่าว โดยไม่ต้องรอผู้ใช้
-- กดรีเฟรช — postgres_changes เคารพ RLS ของตารางอยู่แล้ว (news_public_read,
-- 0018) ผู้ใช้ที่ไม่ได้ล็อกอิน/ยังไม่ใช่แอดมินจะได้รับ event เฉพาะแถวที่
-- status = 'published' และถึงเวลา published_at แล้วเท่านั้น
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'news'
  ) then
    alter publication supabase_realtime add table public.news;
  end if;
end
$$;
