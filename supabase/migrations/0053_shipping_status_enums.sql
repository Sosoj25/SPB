-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0052).
-- Safe to re-run: every step is idempotent.
--
-- ค่าใหม่ของ enum เท่านั้น — ห้ามรวมกับไฟล์อื่น
--
-- Postgres ห้าม "เพิ่มค่า enum แล้วใช้ค่านั้น" ในทรานแซกชันเดียวกัน (unsafe
-- use of new value of enum type) migration ที่ใช้ค่าเหล่านี้จริง (0054) จึงต้อง
-- แยกไฟล์ออกไป ไม่ใช่เพราะอยากแบ่งให้อ่านง่าย แต่เพราะรวมแล้วรันไม่ผ่าน
--
-- สถานะจัดส่งของเดิมมีแค่ 4 ค่าและกระโดดจาก "กำลังจัดส่ง" ไป "จัดส่งแล้ว"
-- ทีเดียว ลูกค้าจึงไม่มีทางรู้ว่าของอยู่ตรงไหนของเส้นทาง เติมให้ครบตามลำดับ
-- จริง: รอดำเนินการ → กำลังเตรียมสินค้า → จัดส่งแล้ว → อยู่ระหว่างขนส่ง →
-- จัดส่งสำเร็จ → ลูกค้ายืนยันได้รับแล้ว
--
-- ค่าเดิม 'shipping' ยังอยู่ต่อ (ลบค่าออกจาก enum ไม่ได้) — 0054 จะย้ายแถวเก่า
-- ไปเป็น 'in_transit' และหน้าเว็บแมป 'shipping' ให้เป็นป้ายเดียวกัน เผื่อมีแถว
-- ที่หลุดรอดมาจากที่ไหน

alter type public.reward_fulfillment_status add value if not exists 'preparing'  after 'pending';
alter type public.reward_fulfillment_status add value if not exists 'in_transit' after 'shipped';
alter type public.reward_fulfillment_status add value if not exists 'delivered'  after 'in_transit';
alter type public.reward_fulfillment_status add value if not exists 'received'   after 'delivered';

-- สิทธิ์จองล่วงหน้า: 0049 มีสิทธิประโยชน์แค่ "ลดเป็นเงิน" กับ "ฟรีค่าสนามราย
-- ชั่วโมง" ส่วนรางวัล "สิทธิ์จองล่วงหน้า 30 วัน" ที่ seed ไว้ตั้งแต่ 0047 เป็น
-- benefit_type = 'none' คือแลกแล้วไม่มีผลอะไรกับระบบเลยสักอย่าง
alter type public.reward_benefit_type add value if not exists 'advance_booking';
