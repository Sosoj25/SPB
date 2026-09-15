-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0074).
-- Safe to re-run: every step is idempotent.
--
-- ค่าใหม่ของ enum เท่านั้น — ห้ามรวมกับไฟล์อื่น (เหตุผลเดียวกับ 0053/0073)
--
-- ============================================================
-- ปัญหา: จ่ายเงินไว้แล้วไม่มาเล่น ก็ยังโดนนับเป็น "รอรีวิว" เหมือนคนที่มาเล่นจริง
-- ============================================================
-- complete_past_bookings() (0074) เปลี่ยน confirmed -> awaiting_review ทันทีที่
-- เลยเวลาจบไป โดยไม่สนใจว่าเช็คอินจริงหรือไม่ — ระบบมี checked_in_at อยู่แล้ว
-- (0038_booking_checkin.sql) แต่ไม่เคยเอามาใช้ตัดสินสถานะเลย ผลคือคนที่จ่ายเงิน
-- จองไว้แล้วไม่มา จะถูกชวนให้รีวิวสนามที่ไม่เคยไปเล่นจริง
--
-- 0076 จะแก้ complete_past_bookings() ให้แยกทาง: เช็คอินแล้ว -> awaiting_review
-- เหมือนเดิม, ไม่เช็คอิน -> no_show (จบทันที รีวิวไม่ได้ เหมือน cancelled/rejected)

alter type public.booking_status add value if not exists 'no_show' after 'awaiting_review';
