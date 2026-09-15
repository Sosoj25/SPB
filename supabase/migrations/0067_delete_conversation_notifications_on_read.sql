-- 0066 ทำแค่ mark is_read = true ให้แจ้งเตือนประเภทข้อความตอนอ่านแชท แต่ผู้ใช้
-- อยากให้หายไปจากรายการเลย ไม่ใช่แค่จางลง (ต่างจากแจ้งเตือนอื่น เช่น
-- อนุมัติ/ปฏิเสธการชำระเงิน ที่ยังอยากเก็บประวัติไว้ให้กดย้อนดูได้) —
-- เปลี่ยนจาก update เป็น delete เฉพาะแถวประเภท reference_type = 'conversation'
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

  delete from public.notifications
  where user_id = (select auth.uid())
    and reference_type = 'conversation'
    and reference_id = p_conversation::text;
$$;
