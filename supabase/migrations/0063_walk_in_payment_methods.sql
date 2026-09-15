-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0062).
-- Safe to re-run: every step is idempotent.
--
-- ค่าใหม่ของ enum เท่านั้น — ห้ามรวมกับไฟล์อื่น
--
-- Postgres ห้าม "เพิ่มค่า enum แล้วใช้ค่านั้น" ในทรานแซกชันเดียวกัน (unsafe
-- use of new value of enum type) — migration ที่ใช้ค่าเหล่านี้จริง (0064)
-- จึงต้องแยกไฟล์ออกไป เหมือนที่ 0053/0054 เคยทำไว้
--
-- หน้ารับลูกค้า Walk-in (0064) ให้แอดมินรับชำระที่หน้าเคาน์เตอร์ทันที
-- payment_method เดิมมีแค่ bank_transfer/qr/other ซึ่งทั้งคู่ผูกกับ flow ที่
-- ลูกค้าจ่ายเองผ่านแอป (สลิป/PlernPay) ไม่ตรงกับเงินสดหรือรูดบัตรที่เคาน์เตอร์

alter type public.payment_method add value if not exists 'cash';
alter type public.payment_method add value if not exists 'card';
