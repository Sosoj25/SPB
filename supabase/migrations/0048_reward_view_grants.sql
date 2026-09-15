-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0047).
-- Safe to re-run: every step is idempotent.
--
-- ปิดประตู view ที่เพิ่มใน 0047 ให้เรียบร้อย — พลาดแบบเดียวกับ 0042 และ 0046
--
-- Supabase ตั้ง default privileges ให้ anon/authenticated ได้ ALL บนทุก
-- relation ที่สร้างใหม่ใน schema public ตัว `grant select ... to authenticated`
-- ที่เขียนไว้ใน 0047 จึงไม่ได้ "จำกัด" อะไรเลย มันแค่ให้ซ้ำสิ่งที่มีอยู่แล้ว
-- ตรวจแล้วพบว่า anon ถือครบทั้ง SELECT/INSERT/UPDATE/DELETE บนทั้งสอง view
--
-- ตอนนี้ยังไม่มีข้อมูลรั่วจริง เพราะ:
--   - reward_catalog เป็น security_invoker → rewards_public_read กรองอยู่แล้ว
--   - admin_reward_requests มี is_admin() อยู่ใน where ของตัวเอง (anon ยิงได้
--     แต่ได้ 0 แถวเสมอ — ยืนยันด้วยการยิง REST ด้วย anon key จริงแล้ว)
--   - ทั้งคู่มี join/lateral จึงไม่ใช่ auto-updatable view เขียนทะลุไม่ได้
--
-- แต่ทั้งสามข้อเป็นการ "บังเอิญปลอดภัย" ไม่ใช่การตั้งใจกั้น ถ้าวันหลังมีคนแก้
-- view ให้เรียบขึ้นจนกลายเป็น auto-updatable ขึ้นมา สิทธิ์ INSERT/UPDATE/DELETE
-- ที่ค้างอยู่ตรงนี้จะกลายเป็นช่องเขียนทะลุไปที่ตารางจริงด้วยสิทธิ์เจ้าของ view
-- ทันทีโดยไม่มีใครทันสังเกต

-- ------------------------------------------------------------
-- reward_catalog — หน้าแลกรางวัลอ่านได้ทั้งคนที่ยังไม่ล็อกอิน
-- ------------------------------------------------------------
revoke all on public.reward_catalog from anon, authenticated;
grant select on public.reward_catalog to anon, authenticated;


-- ------------------------------------------------------------
-- admin_reward_requests — คิวจัดส่ง มีชื่อ/เบอร์/ที่อยู่ของลูกค้าอยู่ในนั้น
-- ------------------------------------------------------------
-- ตัด anon ออกทั้งหมด ไม่ใช่แค่ลดเหลือ select — คนที่ยังไม่ล็อกอินไม่มีเหตุผล
-- ที่จะแตะ view นี้เลยแม้แต่การอ่านที่ได้ 0 แถว
revoke all on public.admin_reward_requests from anon, authenticated;
grant select on public.admin_reward_requests to authenticated;
