-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0045).
-- Safe to re-run: every step is idempotent.
--
-- ปิดประตูฟังก์ชันที่เพิ่มใน 0044/0045 ให้เรียบร้อย — พลาดแบบเดียวกับ 0042
--
-- Supabase grant execute ให้ anon/authenticated กับทุกฟังก์ชันที่สร้างใหม่ใน
-- schema public ผ่าน default privileges ฟังก์ชันที่ตั้งใจให้ trigger เรียก
-- อย่างเดียวจึงโผล่เป็น endpoint /rest/v1/rpc/ ให้ใครก็ได้ยิง
--
-- การ revoke ไม่กระทบ trigger เลย เพราะ trigger รันด้วยสิทธิ์เจ้าของตาราง
-- ไม่ได้ผ่าน ACL ของผู้เรียก (ยืนยันมาแล้วตอน 0042 กับ
-- touch_conversation_last_message)

revoke all on function public.notify_post_comment()   from public, anon, authenticated;
revoke all on function public.notify_new_follower()   from public, anon, authenticated;
revoke all on function public.notify_new_message()    from public, anon, authenticated;
revoke all on function public.sync_community_post_counters() from public, anon, authenticated;
revoke all on function public.protect_community_post_privileged_columns()
  from public, anon, authenticated;

-- ตัวนับถูกเรียกจาก sync_community_post_counters() ซึ่งเป็น security definer
-- อยู่แล้ว ไม่มีใครต้องเรียกจากฝั่งหน้าเว็บ
revoke all on function public.recount_community_post(uuid) from public, anon, authenticated;

-- ตัวนี้หน้าเว็บเรียกจริง เอาออกเฉพาะ anon
revoke all on function public.increment_post_view(uuid) from public, anon;
grant execute on function public.increment_post_view(uuid) to authenticated;


-- ------------------------------------------------------------
-- search_path ที่ยังไม่ได้ล็อก
-- ------------------------------------------------------------
-- ทั้งสองตัวไม่ได้ตั้ง `set search_path` ไว้ ทำให้ผู้เรียกสลับ search_path มา
-- ชี้ตารางปลอมของตัวเองได้ — 0007 กับ 0017 เคยตามเก็บเรื่องนี้มาแล้วรอบหนึ่ง
alter function public.display_name(text, text, text) set search_path = public;
alter function public.admin_community_stats() set search_path = public;
