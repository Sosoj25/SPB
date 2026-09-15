-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0096).
-- Safe to re-run: idempotent.
--
-- ============================================================
-- เปิด Realtime ให้เธรดติดต่อเรา (0096)
-- ============================================================
-- หน้าติดต่อเราของลูกค้ากับหน้าข้อความติดต่อของแอดมินคุยกันคนละจอ ต่างฝ่าย
-- ต่างเปิดค้างไว้ระหว่างรอ — ถ้าไม่มี Realtime ทั้งสองฝั่งต้องกดรีเฟรชเองถึงจะ
-- เห็นข้อความใหม่ ซึ่งแปลว่าคนที่พิมพ์ตอบไปไม่มีทางรู้ว่าอีกฝั่งได้รับหรือยัง
--
-- postgres_changes เคารพ RLS ของตารางอยู่แล้ว (support_tickets_select /
-- support_ticket_replies_select, 0096) ลูกค้าที่ subscribe จึงได้เฉพาะ event
-- ของเรื่องตัวเอง ส่วนแอดมินได้ทุกเรื่องตาม is_admin() — ไม่ต้องมี filter
-- ฝั่ง client ให้ถูกต้องเองเหมือนกรณี notifications (0065)
--
-- ต้องเปิดทั้งสองตาราง: ตาราง replies คือข้อความที่พิมพ์ตอบกัน ส่วน tickets
-- คือเรื่องใหม่ที่เพิ่งส่งเข้ามาและการเปลี่ยนสถานะ (ปิด/เปิดใหม่) ซึ่งทั้งคู่
-- ต้องเด้งขึ้นคิวของแอดมินทันทีเหมือนกัน

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'support_tickets'
  ) then
    alter publication supabase_realtime add table public.support_tickets;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'support_ticket_replies'
  ) then
    alter publication supabase_realtime add table public.support_ticket_replies;
  end if;
end
$$;
