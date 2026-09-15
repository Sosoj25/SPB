-- ============================================================
-- เก็บงานที่ Supabase advisor ค้างไว้: index ของ FK, RLS ที่ประเมินซ้ำทุกแถว
-- และ search_path ของ trigger ที่ตกสำรวจจาก 0058
-- ============================================================

-- ------------------------------------------------------------
-- 1) FK ที่ไม่มี index รองรับ (13 ตัว)
-- ------------------------------------------------------------
-- ทุกครั้งที่ลบแถวในตารางแม่ Postgres ต้องไล่หาแถวลูกที่อ้างถึงเพื่อบังคับ FK
-- ถ้าคอลัมน์นั้นไม่มี index ก็ต้อง seq scan ทั้งตาราง — และ profiles มี policy
-- profiles_admin_delete ที่ให้แอดมินลบผู้ใช้ได้จริง การลบผู้ใช้หนึ่งคนตอนนี้จึง
-- ลาก seq scan ไปทุกตารางในรายการนี้พร้อมกัน
--
-- messages.sender_id กับ support_ticket_replies.author_id ยังช่วยตอน query
-- ปกติด้วย (ดึงข้อความของคนใดคนหนึ่ง) ไม่ใช่แค่ตอนลบ
create index if not exists idx_bookings_cancelled_by            on public.bookings(cancelled_by);
create index if not exists idx_bookings_checked_in_by           on public.bookings(checked_in_by);
create index if not exists idx_bookings_checked_out_by          on public.bookings(checked_out_by);
create index if not exists idx_community_posts_hidden_by        on public.community_posts(hidden_by);
create index if not exists idx_conversations_created_by         on public.conversations(created_by);
create index if not exists idx_messages_sender_id               on public.messages(sender_id);
create index if not exists idx_refund_requests_refunded_by      on public.refund_requests(refunded_by);
create index if not exists idx_refund_requests_reviewed_by      on public.refund_requests(reviewed_by);
create index if not exists idx_reward_settings_updated_by       on public.reward_settings(updated_by);
create index if not exists idx_reward_shipment_events_created_by on public.reward_shipment_events(created_by);
create index if not exists idx_support_ticket_replies_author_id on public.support_ticket_replies(author_id);
create index if not exists idx_support_tickets_booking_id       on public.support_tickets(booking_id);
create index if not exists idx_support_tickets_closed_by        on public.support_tickets(closed_by);

-- หมายเหตุ: advisor ยังรายงาน "unused index" อีก 8 ตัวด้วย แต่ตั้งใจไม่ลบ —
-- ฐานนี้ยังมีข้อมูลจริงหลักสิบแถว คำว่า "ไม่เคยถูกใช้" จึงแปลว่า "ยังไม่ถูกใช้"
-- ไม่ใช่ "ไม่มีประโยชน์" planner เลือก seq scan เพราะตารางเล็กเกินกว่าจะคุ้ม
-- ใช้ index ต่างหาก ค่อยกลับมาดูอีกทีเมื่อมีข้อมูลจริงระดับหมื่นแถว


-- ------------------------------------------------------------
-- 2) RLS policy ที่เรียก auth.uid() แบบไม่ห่อ select
-- ------------------------------------------------------------
-- ตารางอื่นถูกแก้ไปหมดแล้วใน 0028/0022 เหลือสองตัวนี้บน community_posts ที่
-- ตกสำรวจ — auth.uid() ที่ไม่ห่อ (select ...) จะถูกประเมินใหม่ทีละแถวแทนที่จะ
-- คิดครั้งเดียวต่อ query ยิ่งฟีดโตยิ่งช้าเป็นเงาตามตัว
--
-- เงื่อนไขที่เหลือคงไว้ตามเดิมเป๊ะ ๆ: ห้ามโพสต์ลงหมวด "รีวิว" เองเพราะหมวดนั้น
-- ระบบใช้โพสต์รีวิวให้อัตโนมัติ (0080/0095)
drop policy if exists "posts_insert_own" on public.community_posts;

create policy "posts_insert_own"
on public.community_posts for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and category_id <> coalesce(
        (select id from public.community_categories where name = 'รีวิว'),
        -1::bigint
      )
);

drop policy if exists "posts_update_own" on public.community_posts;

create policy "posts_update_own"
on public.community_posts for update
to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_admin())
)
with check (
  (
    user_id = (select auth.uid())
    and category_id <> coalesce(
          (select id from public.community_categories where name = 'รีวิว'),
          -1::bigint
        )
  )
  or (select public.is_admin())
);


-- ------------------------------------------------------------
-- 3) guard_system_category() — search_path ที่ตกสำรวจจาก 0058
-- ------------------------------------------------------------
-- 0058 ไล่ pin search_path ให้ฟังก์ชันทั้งระบบ แต่ตัวนี้ถูกสร้างทีหลังใน 0095
-- เลยไม่ได้ถูกแก้ไปด้วย ฟังก์ชันที่ search_path ไม่ถูก pin เสี่ยงถูกหลอกให้เรียก
-- object ปลอมจาก schema อื่นที่ผู้โจมตีสร้างไว้ — ตัวนี้เป็นแค่ trigger ที่ raise
-- exception ความเสี่ยงจริงต่ำ แต่ pin ให้ครบไปเลยจะได้ไม่ต้องมานั่งยกเว้นทีหลัง
create or replace function public.guard_system_category()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'หมวด "%" เป็นหมวดของระบบ ลบไม่ได้ เพราะระบบใช้โพสต์รีวิวให้อัตโนมัติ', old.name;
  end if;

  if new.name is distinct from old.name then
    raise exception 'หมวด "%" เป็นหมวดของระบบ เปลี่ยนชื่อไม่ได้ เพราะระบบค้นหาหมวดนี้จากชื่อ', old.name;
  end if;

  return new;
end;
$$;
