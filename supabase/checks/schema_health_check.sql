-- ============================================================
-- SPORTSBOOKING — SCHEMA HEALTH CHECK
-- ============================================================
-- ไม่ใช่ migration (อยู่นอกโฟลเดอร์ migrations โดยตั้งใจ)
-- อ่านอย่างเดียว ไม่แก้ไขอะไรทั้งสิ้น รันซ้ำได้ตลอด
--
-- วิธีใช้: Supabase Dashboard -> SQL Editor -> วาง PART 1 -> Run
--         แล้ว copy ผลลัพธ์ทั้งตารางกลับมาให้ดู
--
-- ทุก query ใน PART 1 อ่านจาก system catalog เท่านั้น จึงรันผ่านเสมอ
-- แม้ตารางในแอปจะยังไม่ถูกสร้างเลยสักตาราง
-- ============================================================


-- ============================================================
-- PART 1 — รันอันนี้ก่อน (ปลอดภัยเสมอ)
-- ============================================================

select ord, section, detail
from (

  -- Extensions ที่ schema ต้องใช้ (btree_gist จำเป็นสำหรับกันจองซ้อน)
  select 1 as ord,
         'EXTENSIONS' as section,
         coalesce(string_agg(extname, ', ' order by extname), '❌ ไม่มีทั้งคู่') as detail
  from pg_extension
  where extname in ('pgcrypto', 'btree_gist')

  union all

  select 2,
         'TABLES ที่มีอยู่จริง',
         coalesce(string_agg(tablename, ', ' order by tablename), '❌ ว่างเปล่า')
  from pg_tables
  where schemaname = 'public'

  union all

  -- ตารางที่ 0000_initial_schema.sql ควรสร้างไว้ แต่ยังไม่มี
  select 3,
         'TABLES ที่ขาดไป',
         coalesce(string_agg(t.name, ', '), '✅ ครบทั้ง 21 ตาราง')
  from (values
      ('profiles'), ('sports'), ('venues'), ('facilities'), ('facility_images'),
      ('bookings'), ('payments'), ('reviews'), ('point_transactions'), ('rewards'),
      ('reward_redemptions'), ('community_categories'), ('community_posts'),
      ('post_images'), ('community_comments'), ('post_likes'), ('post_bookmarks'),
      ('community_reports'), ('user_follows'), ('notifications'), ('news')
  ) as t(name)
  where not exists (
      select 1 from pg_tables
      where schemaname = 'public' and tablename = t.name
  )

  union all

  select 4,
         'ENUM types',
         coalesce(string_agg(t.typname, ', ' order by t.typname), '❌ ไม่มีเลย')
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' and t.typtype = 'e'

  union all

  -- ตารางที่ยังไม่ได้เปิด RLS = ใครถือ anon key ก็อ่าน/เขียนได้หมด
  select 5,
         '⚠️ ตารางที่ยังไม่เปิด RLS',
         coalesce(string_agg(c.relname, ', ' order by c.relname), '✅ เปิดครบทุกตาราง')
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity

  union all

  select 6,
         'จำนวน RLS policies ทั้งหมด',
         count(*)::text
  from pg_policies
  where schemaname = 'public'

  union all

  select 7,
         'FUNCTIONS ใน public',
         coalesce(string_agg(distinct p.proname, ', ' order by p.proname), '❌ ไม่มีเลย')
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'

  union all

  -- ตัวที่ Login.jsx / ForgotPasswordStep1.jsx เรียกใช้ — ถ้าไม่มี login พังทันที
  select 8,
         '🔑 RPC get_email_by_username',
         case when exists (
             select 1 from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'get_email_by_username'
         ) then '✅ มีอยู่แล้ว'
           else '❌ ไม่มี → ต้องรัน 0004_get_email_by_username.sql'
         end

  union all

  select 9,
         'profiles: คอลัมน์ทั้งหมด',
         coalesce(string_agg(column_name, ', ' order by ordinal_position), '❌ ไม่มีตาราง profiles')
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles'

  union all

  select 10,
         'bookings: คอลัมน์ทั้งหมด',
         coalesce(string_agg(column_name, ', ' order by ordinal_position), '❌ ไม่มีตาราง bookings')
  from information_schema.columns
  where table_schema = 'public' and table_name = 'bookings'

  union all

  -- trigger ป้องกันแก้ points/role/is_active/booking status เอง (จาก 0002 + 0003)
  select 11,
         '🛡 TRIGGERS บน profiles / bookings',
         coalesce(string_agg(c.relname || '.' || t.tgname, ', ' order by c.relname, t.tgname),
                  '❌ ไม่มีเลย → 0002/0003 ยังไม่ถูกรัน')
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('profiles', 'bookings')
    and not t.tgisinternal

  union all

  -- ถ้าไม่มี trigger นี้ สมัครสมาชิกแล้วจะไม่มีแถวใน profiles เลย
  select 12,
         '👤 TRIGGER บน auth.users (สร้าง profile อัตโนมัติ)',
         coalesce(string_agg(t.tgname, ', '),
                  '❌ ไม่มี on_auth_user_created → สมัครแล้วจะไม่มี profile')
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'auth'
    and c.relname = 'users'
    and not t.tgisinternal

  union all

  -- exclusion constraint กันจองสนามเดียวกันเวลาซ้อนกัน
  select 13,
         '🚫 constraint bookings_no_overlap',
         case when exists (
             select 1 from pg_constraint where conname = 'bookings_no_overlap'
         ) then '✅ มี' else '❌ ไม่มี → จองซ้อนเวลากันได้' end

  union all

  select 14,
         '🖼 storage bucket "avatars"',
         coalesce((
             select 'public=' || b.public::text
                 || ' | size_limit=' || coalesce(b.file_size_limit::text, 'ไม่จำกัด ⚠️')
                 || ' | mime=' || coalesce(array_to_string(b.allowed_mime_types, '/'), 'ไม่จำกัด ⚠️')
             from storage.buckets b
             where b.id = 'avatars'
         ), '❌ ไม่มี bucket avatars → อัปโหลดรูปโปรไฟล์ไม่ได้')

  union all

  select 15,
         'storage policies',
         coalesce(string_agg(policyname, ' | ' order by policyname), '❌ ไม่มีเลย')
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'

) r
order by ord;


-- ============================================================
-- PART 2 — รันต่อ "เฉพาะเมื่อ PART 1 บอกว่าตารางครบแล้ว"
-- ============================================================
-- ถ้าตารางยังไม่มี query ชุดนี้จะ error (ปกติ) ให้ข้ามไปก่อน
-- ใช้ดูว่ามีข้อมูลจริงอยู่เท่าไหร่ และ seed ถูกใส่ไปหรือยัง

-- select 'profiles'             as table_name, count(*) from public.profiles
-- union all select 'sports',              count(*) from public.sports
-- union all select 'community_categories', count(*) from public.community_categories
-- union all select 'venues',              count(*) from public.venues
-- union all select 'facilities',          count(*) from public.facilities
-- union all select 'bookings',            count(*) from public.bookings
-- union all select 'payments',            count(*) from public.payments
-- union all select 'notifications',       count(*) from public.notifications;


-- ============================================================
-- PART 3 — รายชื่อ RLS policy ทั้งหมด (ถ้าอยากดูละเอียด)
-- ============================================================

-- select tablename, policyname, cmd, roles::text
-- from pg_policies
-- where schemaname = 'public'
-- order by tablename, policyname;
