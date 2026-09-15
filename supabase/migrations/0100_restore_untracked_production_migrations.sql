-- ============================================================
-- กู้ migration 5 ตัวที่รันบน production ไปแล้วแต่ไม่มีไฟล์ใน repo
-- ============================================================
-- เทียบ supabase_migrations.schema_migrations กับไฟล์ในโฟลเดอร์นี้แล้วพบว่า
-- มี 5 ตัวที่ถูก apply ผ่าน MCP/SQL Editor โดยไม่เคยถูกเขียนกลับมาเป็นไฟล์:
--
--   20260825032340  seed_sport_descriptions
--   20260825032622  restrict_booking_rpcs_from_anon
--   20260914033320  chat_mark_unread_precision
--   20260914033502  chat_messages_replica_identity_full
--   20260914065305  support_tickets_revoke_anon_execute
--
-- สองตัวเป็นงาน security (ถอน execute ของ anon) และสองตัวเป็นบั๊กฟิกซ์ของแชท
-- ถ้าวันหนึ่งสร้างฐานใหม่จาก repo (db reset / branch / ย้ายโปรเจกต์) จะได้ฐาน
-- ที่ anon ยิง RPC ได้อีกครั้ง และฟีเจอร์ลบข้อความแชทพัง โดยไม่มีอะไรฟ้องเลย
--
-- ไฟล์นี้เอาเนื้อ SQL ของทั้ง 5 ตัวกลับเข้า repo ที่ท้ายลำดับ (ไม่แทรกกลาง
-- เพื่อไม่ให้เลข migration ที่ถูกอ้างอยู่ในคอมเมนต์ทั่วโค้ดเลื่อนตามไปหมด)
-- ทุกคำสั่งเขียนให้รันซ้ำได้ ฐานที่มีของพวกนี้อยู่แล้วรันผ่านโดยไม่เปลี่ยนอะไร
-- ============================================================


-- ------------------------------------------------------------
-- 1) seed_sport_descriptions — เติมคำอธิบายกีฬาแทนค่า placeholder
-- ------------------------------------------------------------
-- เงื่อนไข where ท้าย query ทำให้แตะเฉพาะแถวที่ยังเป็นค่า placeholder
-- ('กีฬา' + ชื่อ) อยู่ ถ้าแอดมินแก้คำอธิบายเองไปแล้วจะไม่ถูกเขียนทับ
update public.sports set description = case name
    when 'ฟุตบอล'     then 'สนามหญ้าเทียมมาตรฐาน ปรับให้เข้ากับสภาพอากาศไทย มีทั้งสนาม 7 คนและ 11 คน'
    when 'ฟุตซอล'     then 'สนามฟุตซอลพื้นยางทั้งในร่มและกลางแจ้ง เหมาะกับทีม 5 คน เล่นได้ทุกสภาพอากาศ'
    when 'บาสเกตบอล'  then 'สนามมาตรฐาน FIBA ทั้ง 5x5 และ 3x3 มีทั้งสเตเดียมและโดม พร้อมเครื่องเก็บลูกอัตโนมัติให้ยืม'
    when 'แบดมินตัน'  then 'คอร์ตในร่มพื้นยาง PU มาตรฐานแข่งขัน แสงไฟไม่แยงตา มีทั้งห้องแอร์และห้องพัดลม'
    when 'เทนนิส'     then 'คอร์ตในร่มและกลางแจ้งมาตรฐานแข่งขัน พร้อมเครื่องยิงลูกให้เช่าเพื่อฝึกซ้อม'
    when 'วอลเลย์บอล' then 'สนามมาตรฐานสากลในร่มและสนามชายหาด มีที่นั่งผู้ชม ใช้จัดแข่งขันหรือฝึกซ้อมได้'
  end
where name in ('ฟุตบอล', 'ฟุตซอล', 'บาสเกตบอล', 'แบดมินตัน', 'เทนนิส', 'วอลเลย์บอล')
  and description = 'กีฬา' || name;


-- ------------------------------------------------------------
-- 2) restrict_booking_rpcs_from_anon — คนไม่ล็อกอินจองสนามไม่ได้
-- ------------------------------------------------------------
-- ของเดิมเขียนอ้าง create_booking(bigint, date, time, time, text) ซึ่งเป็น
-- signature ก่อน 0035_multi_slot_bookings เปลี่ยนมารับ slot หลายช่วงพร้อมกัน
-- ตัวนั้นถูก drop ไปแล้ว ที่นี่จึงเขียนอ้าง signature ปัจจุบันแทน ไม่งั้น
-- migration จะพังตอนสร้างฐานใหม่ ("function does not exist")
revoke all on function public.create_booking(bigint[], text)              from public, anon;
revoke all on function public.pay_booking(uuid, public.payment_method)    from public, anon;

grant execute on function public.create_booking(bigint[], text) to authenticated;
-- pay_booking ถูกแทนที่ด้วยเส้นทาง create_gateway_payment /
-- submit_bank_transfer_payment ไปแล้ว เหลือไว้ให้ service_role เรียกเท่านั้น
-- จึงไม่ grant กลับให้ authenticated


-- ------------------------------------------------------------
-- 3) chat_mark_unread_precision
-- ------------------------------------------------------------
-- ถอย last_read_at แค่ 1 ไมโครวินาที (ความละเอียดสูงสุดของ timestamptz) แทน
-- 1 มิลลิวินาที — กันการกวาดข้อความที่ส่งไล่กันติด ๆ ในเสี้ยววินาทีเดียวกัน
-- เข้ามานับเป็น "ยังไม่อ่าน" ด้วย ทั้งที่ตั้งใจให้ขึ้นแค่ใบเดียว
create or replace function public.mark_conversation_unread(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := (select auth.uid());
  v_last timestamptz;
begin
  if v_me is null or not public.is_conversation_member(p_conversation) then
    raise exception 'คุณไม่ได้อยู่ในห้องสนทนานี้';
  end if;

  select msg.created_at into v_last
  from public.messages msg
  join public.conversation_members m
    on m.conversation_id = msg.conversation_id and m.user_id = v_me
  where msg.conversation_id = p_conversation
    and msg.sender_id <> v_me
    and msg.deleted_at is null
    and (m.cleared_at is null or msg.created_at > m.cleared_at)
  order by msg.created_at desc
  limit 1;

  if v_last is null then
    return;
  end if;

  update public.conversation_members
  set last_read_at = v_last - interval '1 microsecond'
  where conversation_id = p_conversation
    and user_id = v_me;
end;
$$;

revoke all on function public.mark_conversation_unread(uuid) from public, anon;
grant execute on function public.mark_conversation_unread(uuid) to authenticated;


-- ------------------------------------------------------------
-- 4) chat_messages_replica_identity_full
-- ------------------------------------------------------------
-- ให้ Realtime ตรวจ RLS กับแถวเต็มตอน UPDATE ได้ — การลบข้อความ (0094) มาเป็น
-- UPDATE ไม่ใช่ INSERT ฝั่งที่ไม่ได้กดลบจึงต้องได้รับ event นี้ด้วย
alter table public.messages replica identity full;


-- ------------------------------------------------------------
-- 5) support_tickets_revoke_anon_execute
-- ------------------------------------------------------------
-- ถอน execute ของ public/anon ออกจาก RPC ชุดติดต่อเรา (0096) — ทุกตัวต้องมี
-- ผู้ใช้ที่ล็อกอินอยู่แล้วทั้งนั้น ไม่มีเหตุให้ anon ยิงถึง endpoint ได้เลย
revoke execute on function public.submit_support_ticket(text, text, text, text, text, uuid) from public, anon;
revoke execute on function public.reply_support_ticket(uuid, text)                          from public, anon;
revoke execute on function public.admin_reply_support_ticket(uuid, text)                    from public, anon;
revoke execute on function public.admin_set_support_ticket_status(uuid, text)               from public, anon;
revoke execute on function public.admin_support_ticket_stats()                              from public, anon;

grant execute on function public.submit_support_ticket(text, text, text, text, text, uuid) to authenticated;
grant execute on function public.reply_support_ticket(uuid, text)                          to authenticated;
grant execute on function public.admin_reply_support_ticket(uuid, text)                    to authenticated;
grant execute on function public.admin_set_support_ticket_status(uuid, text)               to authenticated;
grant execute on function public.admin_support_ticket_stats()                              to authenticated;
