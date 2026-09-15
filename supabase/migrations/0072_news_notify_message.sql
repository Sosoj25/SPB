-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0071).
-- Safe to re-run: idempotent.
--
-- ============================================================
-- ข้อความแจ้งเตือนที่แอดมินเขียนเองสำหรับข่าวเด่น
-- ============================================================
-- ข่าวเด่น (is_featured) ที่ยังไม่มีใครอ่านจะโผล่เป็นแจ้งเตือนสังเคราะห์ที่
-- กระดิ่งแจ้งเตือนของลูกค้า (NotificationBell ใน AppHeader.jsx เหมือน
-- unpaidBookingToNotificationItem ที่ทำกับการจองรอชำระเงินอยู่แล้ว) —
-- แอดมินเขียนข้อความเองได้ว่าจะให้ขึ้นว่าอะไร ถ้าไม่กรอกไว้ ฝั่งหน้าเว็บจะ
-- ใช้คำโปรย/เนื้อหาย่อของข่าวแทน (ดู featuredNewsToNotificationItem)
alter table public.news
add column if not exists notify_message text;
