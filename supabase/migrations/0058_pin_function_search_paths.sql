-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0057).
-- Safe to re-run: every step is idempotent.
--
-- ล็อก search_path ของสองฟังก์ชันที่เพิ่งเขียนใน 0052/0055
--
-- Supabase database linter (0011_function_search_path_mutable) เตือนว่าฟังก์ชัน
-- ที่ไม่ตั้ง search_path จะหยิบ schema ตามของผู้เรียก ซึ่งเปิดช่องให้คนที่สร้าง
-- schema ของตัวเองได้เอาตารางชื่อซ้ำมาวางบังของจริง
--
-- ทั้งสองตัวไม่ได้เป็น security definer ความเสี่ยงจึงจำกัด แต่ทุกฟังก์ชันอื่น
-- ในโปรเจกต์นี้ตั้ง search_path ไว้หมดแล้ว ปล่อยไว้สองตัวจะกลายเป็นข้อยกเว้น
-- ที่ไม่มีเหตุผลรองรับ

alter function public.reward_fulfillment_step(public.reward_fulfillment_status)
  set search_path = public;

alter function public.admin_community_stats()
  set search_path = public;


-- index ที่ 0057 สร้างไว้แล้วไม่ได้ใช้ — ไม่มีคิวรีไหนเรียงหรือกรองด้วย
-- last_seen_at เลย (ทุกที่อ่านผ่าน join ด้วย profiles.id) ปล่อยไว้มีแต่ต้นทุน
-- ตอนเขียน ซึ่งคอลัมน์นี้ถูกเขียนทุกนาทีต่อผู้ใช้ที่เปิดแอปค้างไว้หนึ่งคน
drop index if exists public.idx_profiles_last_seen;
