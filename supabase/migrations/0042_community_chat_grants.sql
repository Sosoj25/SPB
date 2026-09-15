-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0041).
-- Safe to re-run: every step is idempotent.
--
-- แก้ของที่พลาดใน 0041: RPC ของแชททั้งชุดยังเรียกได้จาก role anon
--
-- 0041 เขียน `revoke all on function ... from public` แล้วคิดว่าจบ แต่ 0009
-- บันทึกกับดักนี้ไว้ตั้งแต่ตอนนั้นแล้วว่า revoke จาก public อย่างเดียว "ไม่พอ"
-- บน Supabase เพราะโปรเจกต์ grant execute ให้ anon / authenticated /
-- service_role ไว้ต่างหากผ่าน default privileges ทุกฟังก์ชันที่สร้างใหม่ใน
-- schema public จึงต้อง revoke จาก anon ตรง ๆ อีกชั้น
--
-- ของจริงยังไม่มีอะไรรั่ว เพราะทุกตัวกรองด้วย auth.uid() ซึ่งเป็น null ตอนยัง
-- ไม่ล็อกอิน (list คืนศูนย์แถว / mark_read ไม่โดนแถวไหน / start_direct
-- raise ทิ้ง) แต่ปิดตั้งแต่ประตูดีกว่าไปหวังพึ่งด่านสุดท้าย

revoke all on function public.is_conversation_member(uuid) from anon;
revoke all on function public.start_direct_conversation(uuid) from anon;
revoke all on function public.list_my_conversations() from anon;
revoke all on function public.mark_conversation_read(uuid) from anon;

-- ตัวนี้เป็น trigger function ล้วน ๆ ไม่มีใครควรเรียกผ่าน REST ได้เลยสักคน
-- (เรียกตรง ๆ ก็ error "can only be called as trigger" อยู่แล้ว แต่ไม่ควรโผล่
--  เป็น endpoint /rest/v1/rpc/ ให้เห็นตั้งแต่แรก) — trigger ยังทำงานปกติ
-- เพราะมันรันด้วยสิทธิ์ของ owner ไม่ได้ผ่าน ACL ของผู้เรียก
revoke all on function public.touch_conversation_last_message()
  from public, anon, authenticated;
