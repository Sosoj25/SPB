-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0072).
-- Safe to re-run: every step is idempotent.
--
-- ค่าใหม่ของ enum เท่านั้น — ห้ามรวมกับไฟล์อื่น (ดูเหตุผลเดียวกับ 0053)
--
-- Postgres ห้าม "เพิ่มค่า enum แล้วใช้ค่านั้น" ในทรานแซกชันเดียวกัน migration
-- ที่ใช้ค่านี้จริง (0074) จึงต้องแยกไฟล์ออกไป
--
-- ============================================================
-- ปัญหา: เล่นจบแล้วกลายเป็น completed ทันที ไม่มีขั้นตอนรีวิวคั่นกลาง
-- ============================================================
-- ตอนนี้ complete_past_bookings() (0013) เปลี่ยน confirmed -> completed ทันที
-- ที่เลยเวลาจบการเล่น โดยไม่มีอะไรบังคับให้เขียนรีวิวก่อน — ต้องมีสถานะคั่น
-- ระหว่างกลางที่บอกว่า "เล่นจบแล้ว รอรีวิวอยู่" (0074 จะย้าย cron ไปตั้งค่านี้
-- แทน completed แล้วเพิ่ม RPC submit_review ให้เขียนรีวิวแล้วค่อยเลื่อนไป
-- completed เอง)

alter type public.booking_status add value if not exists 'awaiting_review' after 'confirmed';
