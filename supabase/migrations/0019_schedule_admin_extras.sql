-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0018).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ต่อหน้า Admin/ตารางเวลา เข้ากับ facility_time_slots (0010) จริง
-- ============================================================
-- ตาราง facility_time_slots และ RLS (facility_time_slots_admin_manage) พร้อม
-- ให้ admin toggle is_active ตรงผ่าน supabase-js ได้อยู่แล้ว ขาดแค่ที่เก็บ
-- เหตุผลตอนปิดช่วงเวลาชั่วคราว ("ปิดปรับปรุงชั่วคราว: ซ่อมบำรุงพื้นสนาม" ฯลฯ)
--
-- ตั้งใจไม่เพิ่มคอลัมน์ราคาต่อช่วงเวลา — create_booking_from_slot (0011) คิด
-- ราคาจาก facilities.price_per_hour คงที่เท่านั้น การเพิ่มราคาต่อช่วงเวลาที่
-- แก้ไขได้จริงต้องแก้ RPC จองเงินจริงด้วย ซึ่งเกินสโคปของงานนี้ (ยืนยันกับ
-- ผู้ใช้แล้ว) หน้า admin จะโชว์ราคาแบบ read-only ที่คำนวณจาก price_per_hour

alter table public.facility_time_slots
add column if not exists closure_note text;

-- ไม่ต้องแก้ policy facility_time_slots_admin_manage — ครอบคลุมคอลัมน์ใหม่
-- ทุกคอลัมน์ของตารางเดิมอยู่แล้ว (for all ... using (is_admin()))
