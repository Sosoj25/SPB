-- mark_conversation_read() เดิมอัปเดตแค่ conversation_members.last_read_at
-- (ใช้คำนวณป้าย "ข้อความ" บน AppHeader) แต่ notify_new_message (0044) แยก
-- insert แถวลง public.notifications ไว้อีกชุด (type 'community_message',
-- reference_type 'conversation') สำหรับกระดิ่งแจ้งเตือน — สองระบบไม่เคยผูกกัน
-- ผู้ใช้จึงเห็นป้ายกระดิ่งค้างแม้เพิ่งเปิดอ่านข้อความในห้องแชทไปแล้ว
--
-- เพิ่ม UPDATE แถว notifications ที่ยังไม่อ่านของห้องนั้นให้ is_read = true
-- ไปพร้อมกันในฟังก์ชันเดียว — Realtime ของ notifications (0065) จะดันอัปเดต
-- ไปให้กระดิ่งบนหน้าเว็บเองโดยไม่ต้องรีเฟรช
create or replace function public.mark_conversation_read(p_conversation uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.conversation_members
  set last_read_at = now()
  where conversation_id = p_conversation
    and user_id = (select auth.uid());

  update public.notifications
  set is_read = true
  where user_id = (select auth.uid())
    and reference_type = 'conversation'
    and reference_id = p_conversation::text
    and is_read = false;
$$;
