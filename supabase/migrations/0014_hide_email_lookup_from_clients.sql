-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0013).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ปัญหา: อีเมลของผู้ใช้ทุกคนถูกดึงออกไปได้โดยไม่ต้องล็อกอิน
-- ============================================================
-- 0004 สร้าง get_email_by_username() แล้ว grant ให้ anon เพราะหน้า Login
-- กับ ForgotPassword เรียกจากเบราว์เซอร์โดยตรง คอมเมนต์ในไฟล์นั้นเขียน
-- ข้อแลกเปลี่ยนไว้ตรง ๆ แล้วว่า "ใครที่เข้าถึง anon key ได้ ก็แปลงชื่อผู้ใช้
-- ที่เดาถูกให้กลายเป็นอีเมลของบัญชีนั้นได้" และบอกว่าทางแก้คือย้ายขั้นตอน
-- แลกเปลี่ยนไปไว้ใน Edge Function
--
-- ทดสอบแล้วว่าใช้งานได้จริงด้วย publishable key เปล่า ๆ:
--     POST /rest/v1/rpc/get_email_by_username  {"p_username":"Test1"}
--     -> "ka***@gmail.com"
--
-- Edge Function สองตัวนั้นถูก deploy แล้ว (supabase/functions/):
--     login-with-username           <- หน้า Login
--     forgot-password-by-username   <- หน้า ForgotPassword
-- ทั้งคู่เรียกฟังก์ชันนี้ด้วย service role ที่ฝั่ง server อีเมลจึงไม่ออกไป
-- ถึงเบราว์เซอร์อีก ตัวฟังก์ชันยังอยู่เหมือนเดิม เปลี่ยนแค่ว่าใครเรียกได้
--
-- หมายเหตุ: การเดาว่า "ชื่อผู้ใช้นี้มีคนใช้แล้วหรือยัง" ผ่าน
-- is_username_available() ยังทำได้อยู่ และตั้งใจให้เป็นแบบนั้น — หน้าสมัคร
-- ต้องบอกผู้ใช้ได้ว่าชื่อซ้ำ เว็บที่บังคับชื่อผู้ใช้ไม่ซ้ำกันทุกเว็บก็รู้ได้
-- เหมือนกัน สิ่งที่ต้องปิดคือการได้ "อีเมล" ไม่ใช่การรู้ว่าชื่อนั้นมีอยู่

revoke execute on function public.get_email_by_username(text) from anon, authenticated;

-- ประกาศให้ชัดว่าเหลือใครเรียกได้ (service_role ใช้ผ่าน Edge Function เท่านั้น)
grant execute on function public.get_email_by_username(text) to service_role;
