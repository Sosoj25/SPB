-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0061).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ลบ index ที่ซ้ำกับของเดิมใน 0000
-- ============================================================
--
-- 0041 สร้าง index สามตัวโดยไม่รู้ว่า 0000 ทำไว้แล้วบนคอลัมน์เดียวกันเป๊ะ ๆ
-- (เทียบ indexdef แล้วตรงกันทุกตัวอักษร ทั้งคอลัมน์และทิศทางเรียง):
--
--   community_posts_created_idx  = idx_posts_created      (created_at desc)
--   community_posts_user_idx     = idx_posts_user         (user_id)
--   user_follows_following_idx   = idx_follows_following  (following_id)
--
-- index ซ้ำไม่ได้ทำให้อ่านเร็วขึ้นเลย เพราะ planner เลือกใช้ได้ทีละตัว แต่
-- ต้นทุนฝั่งเขียนจ่ายเต็มสองเท่า — ทุก insert/update/delete บน community_posts
-- ต้องไปแก้ทั้งสองตัว และกินพื้นที่ซ้ำอีกชุด ที่หน้างานคือทุกครั้งที่มีคน
-- โพสต์ กดไลก์ หรือแอดมินซ่อน/ปักหมุด
--
-- เก็บของ 0000 ไว้ ลบของ 0041 ทิ้ง — เพราะ 0000 เป็น schema ฐานและใช้
-- ชื่อแบบ idx_* เหมือนตารางอื่นทั้งโปรเจกต์ ส่วนชื่อแบบ *_idx เพิ่งโผล่มาใน
-- 0041 ไฟล์เดียว
--
-- ไม่แก้ไฟล์ 0041 ย้อนหลัง (migration ที่รันไปแล้วไม่ควรถูกแก้) — ถ้าสร้าง
-- ฐานข้อมูลใหม่จากศูนย์ 0041 จะสร้าง index ซ้ำขึ้นมาแล้วไฟล์นี้ลบทิ้งตามลำดับ
-- ผลลัพธ์ปลายทางเหมือนกัน

drop index if exists public.community_posts_created_idx;
drop index if exists public.community_posts_user_idx;
drop index if exists public.user_follows_following_idx;
