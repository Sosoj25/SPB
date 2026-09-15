-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0060).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ถอนสิทธิ์ execute ของ anon ที่หลุดติดมากับฟังก์ชัน 4 ตัว
-- ============================================================
--
-- Supabase advisor (anon_security_definer_function_executable) ชี้ว่ายังมี
-- ฟังก์ชัน security definer ที่ role `anon` เรียกได้อยู่ ทุกตัวในไฟล์นี้มาจาก
-- การลืมเขียน `revoke ... from public, anon` ต่อท้ายตอนสร้าง — ไม่ใช่ความตั้งใจ
-- (ต่างจาก is_admin / facility_slots / platform_stats ฯลฯ ที่ตั้งใจให้คนยังไม่
--  ล็อกอินเรียกได้ และไม่ได้แตะในไฟล์นี้)
--
-- ตรวจแล้วว่าไม่มีตัวไหนเป็นช่องโหว่จริง:
--
--   * activate_privilege_redemption เป็น trigger function (อ่าน new, return
--     null) เรียกเป็น RPC ตรง ๆ ไม่ได้อยู่แล้ว — trigger function ไม่ควรมี
--     grant execute ให้ role ไหนเลยตั้งแต่ต้น
--   * create_group_conversation / add_conversation_members มีด่าน
--     "ต้องเข้าสู่ระบบก่อน" อยู่ในตัว
--   * leave_conversation ลบด้วย `user_id = auth.uid()` ซึ่งเป็น null ตอน anon
--     จึงไม่เข้าเงื่อนไขแถวไหน
--
-- แต่การปล่อยสิทธิ์ที่ไม่ได้ใช้ทิ้งไว้แปลว่าด่านชั้นในกลายเป็นด่านเดียวที่กั้น
-- อยู่ — วันที่มีคนแก้ฟังก์ชันเหล่านี้แล้วเผลอถอดด่านออก จะไม่มีอะไรเหลือเลย
-- ปิดที่ชั้น grant ด้วยให้ครบสองชั้นเหมือนฟังก์ชันตัวอื่นในโปรเจกต์

revoke all on function public.activate_privilege_redemption()
  from public, anon, authenticated;

revoke all on function public.create_group_conversation(text, uuid[])
  from public, anon;
grant execute on function public.create_group_conversation(text, uuid[])
  to authenticated;

revoke all on function public.add_conversation_members(uuid, uuid[])
  from public, anon;
grant execute on function public.add_conversation_members(uuid, uuid[])
  to authenticated;

revoke all on function public.leave_conversation(uuid)
  from public, anon;
grant execute on function public.leave_conversation(uuid)
  to authenticated;
