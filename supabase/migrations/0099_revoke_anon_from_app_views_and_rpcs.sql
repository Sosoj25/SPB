-- ============================================================
-- ปิดช่องที่คนยังไม่ล็อกอินอ่านข้อมูลผู้ใช้ได้
-- ============================================================
-- public_profiles กับ community_profile_stats เป็น view แบบ security definer
-- (ตั้งใจ — มันคือ "หน้ากาก" ที่เลือกเปิดเฉพาะคอลัมน์ปลอดภัยของ profiles ให้
-- คนอื่นเห็นได้ ซึ่ง RLS ของ profiles เองไม่ยอมให้ทำ เพราะ profiles_select_own
-- ปล่อยแค่แถวของตัวเองกับแอดมิน) แต่เดิม grant select ให้ anon ไปด้วย
--
-- ผลคือใครก็ตามที่หยิบ anon key จากบันเดิล (ซึ่งเป็นคีย์สาธารณะโดยตั้งใจ) ยิง
-- GET /rest/v1/public_profiles ได้เลยโดยไม่ต้องล็อกอิน แล้วได้ชื่อจริง bio
-- ย่านที่อยู่ สนามประจำ เวลาว่าง และ last_seen_at ของผู้ใช้ทุกคนในระบบ
--
-- ทั้งที่หน้า /community, /messages, /rewards ในแอปอยู่ใน ProtectedRoute หมด
-- ไม่มีหน้าสาธารณะหน้าไหนอ่าน view พวกนี้เลยสักหน้าเดียว (Landing.jsx ไม่ได้
-- import supabase ด้วยซ้ำ) การ grant ให้ anon จึงไม่เคยมีเหตุผลรองรับ
--
-- ทางแก้คือถอน anon ออก ไม่ใช่เปลี่ยนเป็น security_invoker — ถ้าเปลี่ยนเป็น
-- invoker แล้ว RLS ของ profiles จะเข้ามาบังคับ ผู้ใช้ที่ล็อกอินอยู่จะเห็นแค่
-- โปรไฟล์ของตัวเองคนเดียว ฟีเจอร์ชุมชนทั้งหมดพังทันที
-- ============================================================

revoke select on public.public_profiles          from anon;
revoke select on public.community_profile_stats  from anon;

-- view ฝั่งชุมชนที่เหลือ — พวกนี้เป็น security_invoker อยู่แล้ว RLS จึงกันให้
-- ชั้นหนึ่ง แต่ก็ไม่มีหน้าสาธารณะไหนใช้เหมือนกัน ถอน anon ออกให้หมดเพื่อไม่
-- ต้องมานั่งเดาทีหลังว่าตัวไหนพึ่ง RLS ตัวไหนพึ่ง grant
revoke select on public.community_feed_posts     from anon;
revoke select on public.community_post_comments  from anon;
revoke select on public.reward_catalog           from anon;

-- view ของหน้าแอดมิน — admin_redemption_history เป็น security definer ที่กัน
-- ด้วย where is_admin() ท้าย view อย่างเดียว ไม่มี RLS รองอีกชั้น ยิ่งไม่ควร
-- เปิดถึง anon เลย ส่วนที่เหลือเป็น invoker แต่ไม่มีเหตุให้ anon แตะเช่นกัน
revoke select on public.admin_redemption_history  from anon;
revoke select on public.admin_community_posts     from anon;
revoke select on public.admin_community_comments  from anon;
revoke select on public.admin_community_categories from anon;
revoke select on public.admin_community_reports   from anon;
revoke select on public.admin_reported_users      from anon;

-- ============================================================
-- RPC ที่ anon เรียกได้ทั้งที่ทุกจุดเรียกอยู่หลังประตูล็อกอิน
-- ============================================================
-- ไล่ดูผู้เรียกจริงในโค้ดทีละตัว:
--   platform_stats()               -> Home.jsx          (ProtectedRoute)
--   facility_slots()               -> หน้าจองสนาม       (ProtectedRoute)
--   facility_day_availability()    -> หน้าจองสนาม       (ProtectedRoute)
--   sport_facility_availability()  -> หน้าจองสนาม       (ProtectedRoute)
--
-- is_username_available() ไม่อยู่ในรายการนี้ — Register.jsx เป็นหน้าสาธารณะ
-- และต้องเช็คชื่อซ้ำก่อนสมัคร anon จึงยังต้องเรียกได้ตามเดิม
revoke execute on function public.platform_stats()                                  from anon;
revoke execute on function public.facility_slots(bigint, date)                      from anon;
revoke execute on function public.facility_day_availability(bigint, date, date)     from anon;
revoke execute on function public.sport_facility_availability(bigint, date)         from anon;
