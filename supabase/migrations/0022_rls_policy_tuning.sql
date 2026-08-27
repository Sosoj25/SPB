-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0021).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- จัดระเบียบ RLS policy ทั้งระบบ — ไม่เปลี่ยน "ใครเห็นอะไร" แม้แต่ข้อเดียว
-- ============================================================
-- Supabase advisor รายงานสามเรื่องบนตารางเกือบทุกตัว:
--
--   1. auth_rls_initplan (35 รายการ) — auth.uid() / is_admin() ที่เขียนลอย ๆ
--      ใน policy ถูกเรียกใหม่ "ทุกแถว" ที่สแกน เพราะ planner มองว่าอาจให้ค่า
--      ต่างกันได้ในแต่ละแถว การครอบด้วย (select ...) ทำให้กลายเป็น InitPlan
--      คือคำนวณครั้งเดียวต่อ query แล้วใช้ค่าเดิมกับทุกแถว
--
--   2. multiple_permissive_policies (14 รายการ) — ตารางที่มีทั้ง
--      "<table>_public_read" (for select) และ "<table>_admin_manage" (for all)
--      จะมี policy สอง อันซ้อนกันบน SELECT ทุกครั้ง Postgres ต้อง OR ทั้งคู่
--      ทุกแถว ทั้งที่ policy public_read มี "or is_admin()" ครอบเคสแอดมิน
--      อยู่แล้ว — เปลี่ยน admin_manage จาก "for all" เป็น insert/update/delete
--      แยกกันจึงตัดตัวซ้ำบน SELECT ทิ้งได้โดยสิทธิ์ไม่เปลี่ยน
--
--   3. profiles มี policy ยุคแรกค้างอยู่สองตัว ("Users can view own profile",
--      "Users can update own profile" ที่ผูกกับ role public) ซึ่ง 0001 สร้าง
--      ตัวใหม่ profiles_select_own / profiles_update_own มาแทนแล้วแต่ลืมลบของเก่า
--
-- หมายเหตุเรื่อง unused_index ที่ advisor รายงานอีก 21 รายการ: ไม่แตะ
-- ทั้งหมดเป็น index บนตารางที่ยังแทบไม่มีข้อมูล/ยังไม่มีหน้าจอเรียกใช้
-- (community_*, notifications, rewards) มันขึ้นว่า "unused" เพราะยังไม่มี
-- ทราฟฟิก ไม่ใช่เพราะออกแบบผิด — ลบทิ้งตอนนี้แล้วต้องสร้างใหม่ทีหลัง


-- ============================================================
-- 1. profiles
-- ============================================================

-- policy ยุคแรกที่ถูกแทนที่ไปแล้ว
drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select to authenticated
using ( id = (select auth.uid()) or (select public.is_admin()) );

-- แตก profiles_admin_all (for all) ออกจาก SELECT/UPDATE — สองคำสั่งนั้นมี
-- policy ของตัวเองที่ครอบเคสแอดมินด้วย "or is_admin()" อยู่แล้ว เหลือ
-- INSERT/DELETE ที่ยังต้องมี policy ของแอดมินแยก
drop policy if exists "profiles_admin_all" on public.profiles;

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update to authenticated
using ( id = (select auth.uid()) or (select public.is_admin()) )
with check ( id = (select auth.uid()) or (select public.is_admin()) );

drop policy if exists "profiles_admin_insert" on public.profiles;
create policy "profiles_admin_insert"
on public.profiles for insert to authenticated
with check ( (select public.is_admin()) );

drop policy if exists "profiles_admin_delete" on public.profiles;
create policy "profiles_admin_delete"
on public.profiles for delete to authenticated
using ( (select public.is_admin()) );


-- ============================================================
-- 2. sports / venues / facilities / facility_images
-- ============================================================

drop policy if exists "sports_public_read" on public.sports;
create policy "sports_public_read"
on public.sports for select to anon, authenticated
using ( is_active = true or (select public.is_admin()) );

drop policy if exists "sports_admin_manage" on public.sports;
drop policy if exists "sports_admin_insert" on public.sports;
create policy "sports_admin_insert"
on public.sports for insert to authenticated
with check ( (select public.is_admin()) );
drop policy if exists "sports_admin_update" on public.sports;
create policy "sports_admin_update"
on public.sports for update to authenticated
using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );
drop policy if exists "sports_admin_delete" on public.sports;
create policy "sports_admin_delete"
on public.sports for delete to authenticated
using ( (select public.is_admin()) );


drop policy if exists "venues_public_read" on public.venues;
create policy "venues_public_read"
on public.venues for select to anon, authenticated
using ( status = 'active' or (select public.is_admin()) );

drop policy if exists "venues_admin_manage" on public.venues;
drop policy if exists "venues_admin_insert" on public.venues;
create policy "venues_admin_insert"
on public.venues for insert to authenticated
with check ( (select public.is_admin()) );
drop policy if exists "venues_admin_update" on public.venues;
create policy "venues_admin_update"
on public.venues for update to authenticated
using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );
drop policy if exists "venues_admin_delete" on public.venues;
create policy "venues_admin_delete"
on public.venues for delete to authenticated
using ( (select public.is_admin()) );


drop policy if exists "facilities_public_read" on public.facilities;
create policy "facilities_public_read"
on public.facilities for select to anon, authenticated
using ( status <> 'inactive' or (select public.is_admin()) );

drop policy if exists "facilities_admin_manage" on public.facilities;
drop policy if exists "facilities_admin_insert" on public.facilities;
create policy "facilities_admin_insert"
on public.facilities for insert to authenticated
with check ( (select public.is_admin()) );
drop policy if exists "facilities_admin_update" on public.facilities;
create policy "facilities_admin_update"
on public.facilities for update to authenticated
using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );
drop policy if exists "facilities_admin_delete" on public.facilities;
create policy "facilities_admin_delete"
on public.facilities for delete to authenticated
using ( (select public.is_admin()) );


drop policy if exists "facility_images_admin_manage" on public.facility_images;
drop policy if exists "facility_images_admin_insert" on public.facility_images;
create policy "facility_images_admin_insert"
on public.facility_images for insert to authenticated
with check ( (select public.is_admin()) );
drop policy if exists "facility_images_admin_update" on public.facility_images;
create policy "facility_images_admin_update"
on public.facility_images for update to authenticated
using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );
drop policy if exists "facility_images_admin_delete" on public.facility_images;
create policy "facility_images_admin_delete"
on public.facility_images for delete to authenticated
using ( (select public.is_admin()) );


-- ============================================================
-- 3. facility_time_slots
-- ============================================================

drop policy if exists "facility_time_slots_public_read" on public.facility_time_slots;
create policy "facility_time_slots_public_read"
on public.facility_time_slots for select to anon, authenticated
using ( is_active = true or (select public.is_admin()) );

drop policy if exists "facility_time_slots_admin_manage" on public.facility_time_slots;
drop policy if exists "facility_time_slots_admin_insert" on public.facility_time_slots;
create policy "facility_time_slots_admin_insert"
on public.facility_time_slots for insert to authenticated
with check ( (select public.is_admin()) );
drop policy if exists "facility_time_slots_admin_update" on public.facility_time_slots;
create policy "facility_time_slots_admin_update"
on public.facility_time_slots for update to authenticated
using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );
drop policy if exists "facility_time_slots_admin_delete" on public.facility_time_slots;
create policy "facility_time_slots_admin_delete"
on public.facility_time_slots for delete to authenticated
using ( (select public.is_admin()) );


-- ============================================================
-- 4. bookings / payments
-- ============================================================

drop policy if exists "bookings_select_own" on public.bookings;
create policy "bookings_select_own"
on public.bookings for select to authenticated
using ( user_id = (select auth.uid()) or (select public.is_admin()) );

drop policy if exists "bookings_insert_own" on public.bookings;
create policy "bookings_insert_own"
on public.bookings for insert to authenticated
with check ( user_id = (select auth.uid()) );

drop policy if exists "bookings_update_own" on public.bookings;
create policy "bookings_update_own"
on public.bookings for update to authenticated
using ( user_id = (select auth.uid()) or (select public.is_admin()) )
with check ( user_id = (select auth.uid()) or (select public.is_admin()) );

drop policy if exists "bookings_admin_delete" on public.bookings;
create policy "bookings_admin_delete"
on public.bookings for delete to authenticated
using ( (select public.is_admin()) );


drop policy if exists "payments_select_own" on public.payments;
create policy "payments_select_own"
on public.payments for select to authenticated
using ( user_id = (select auth.uid()) or (select public.is_admin()) );

drop policy if exists "payments_admin_insert" on public.payments;
create policy "payments_admin_insert"
on public.payments for insert to authenticated
with check ( (select public.is_admin()) );

drop policy if exists "payments_admin_manage" on public.payments;
create policy "payments_admin_manage"
on public.payments for update to authenticated
using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );


-- ============================================================
-- 5. reviews
-- ============================================================

drop policy if exists "reviews_public_read" on public.reviews;
create policy "reviews_public_read"
on public.reviews for select to anon, authenticated
using (
  status = 'published'
  or user_id = (select auth.uid())
  or (select public.is_admin())
);

drop policy if exists "reviews_insert_own" on public.reviews;
create policy "reviews_insert_own"
on public.reviews for insert to authenticated
with check (
  user_id = (select auth.uid())
  -- ต้องระบุชื่อตารางให้ชัด: bookings มีคอลัมน์ facility_id ด้วย ถ้าเขียน
  -- facility_id ลอย ๆ ในซับคิวรี มันจะ resolve เป็น b.facility_id (สโคปใน
  -- ชนะ) กลายเป็นเงื่อนไขที่เป็นจริงเสมอ = ข้อจำกัด "รีวิวได้เฉพาะสนามที่
  -- ตัวเองจอง" หายไปเงียบ ๆ
  and exists (
    select 1 from public.bookings b
    where b.id = reviews.booking_id
      and b.user_id = (select auth.uid())
      and b.facility_id = reviews.facility_id
      and b.status = 'completed'
  )
);

drop policy if exists "reviews_update_own" on public.reviews;
create policy "reviews_update_own"
on public.reviews for update to authenticated
using ( user_id = (select auth.uid()) or (select public.is_admin()) )
with check ( user_id = (select auth.uid()) or (select public.is_admin()) );

drop policy if exists "reviews_delete_own" on public.reviews;
create policy "reviews_delete_own"
on public.reviews for delete to authenticated
using ( user_id = (select auth.uid()) or (select public.is_admin()) );


-- ============================================================
-- 6. points / rewards / redemptions
-- ============================================================

drop policy if exists "points_select_own" on public.point_transactions;
create policy "points_select_own"
on public.point_transactions for select to authenticated
using ( user_id = (select auth.uid()) or (select public.is_admin()) );

drop policy if exists "points_admin_manage" on public.point_transactions;
drop policy if exists "points_admin_insert" on public.point_transactions;
create policy "points_admin_insert"
on public.point_transactions for insert to authenticated
with check ( (select public.is_admin()) );
drop policy if exists "points_admin_update" on public.point_transactions;
create policy "points_admin_update"
on public.point_transactions for update to authenticated
using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );
drop policy if exists "points_admin_delete" on public.point_transactions;
create policy "points_admin_delete"
on public.point_transactions for delete to authenticated
using ( (select public.is_admin()) );


drop policy if exists "rewards_public_read" on public.rewards;
create policy "rewards_public_read"
on public.rewards for select to anon, authenticated
using ( is_active = true or (select public.is_admin()) );

drop policy if exists "rewards_admin_manage" on public.rewards;
drop policy if exists "rewards_admin_insert" on public.rewards;
create policy "rewards_admin_insert"
on public.rewards for insert to authenticated
with check ( (select public.is_admin()) );
drop policy if exists "rewards_admin_update" on public.rewards;
create policy "rewards_admin_update"
on public.rewards for update to authenticated
using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );
drop policy if exists "rewards_admin_delete" on public.rewards;
create policy "rewards_admin_delete"
on public.rewards for delete to authenticated
using ( (select public.is_admin()) );


drop policy if exists "redemptions_select_own" on public.reward_redemptions;
create policy "redemptions_select_own"
on public.reward_redemptions for select to authenticated
using ( user_id = (select auth.uid()) or (select public.is_admin()) );

drop policy if exists "redemptions_insert_own" on public.reward_redemptions;
create policy "redemptions_insert_own"
on public.reward_redemptions for insert to authenticated
with check ( user_id = (select auth.uid()) );

drop policy if exists "redemptions_admin_manage" on public.reward_redemptions;
create policy "redemptions_admin_manage"
on public.reward_redemptions for update to authenticated
using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );


-- ============================================================
-- 7. community
-- ============================================================

drop policy if exists "categories_public_read" on public.community_categories;
create policy "categories_public_read"
on public.community_categories for select to anon, authenticated
using ( true );

drop policy if exists "categories_admin_manage" on public.community_categories;
drop policy if exists "categories_admin_insert" on public.community_categories;
create policy "categories_admin_insert"
on public.community_categories for insert to authenticated
with check ( (select public.is_admin()) );
drop policy if exists "categories_admin_update" on public.community_categories;
create policy "categories_admin_update"
on public.community_categories for update to authenticated
using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );
drop policy if exists "categories_admin_delete" on public.community_categories;
create policy "categories_admin_delete"
on public.community_categories for delete to authenticated
using ( (select public.is_admin()) );


drop policy if exists "posts_public_read" on public.community_posts;
create policy "posts_public_read"
on public.community_posts for select to anon, authenticated
using (
  status = 'published'
  or user_id = (select auth.uid())
  or (select public.is_admin())
);

drop policy if exists "posts_insert_own" on public.community_posts;
create policy "posts_insert_own"
on public.community_posts for insert to authenticated
with check ( user_id = (select auth.uid()) );

drop policy if exists "posts_update_own" on public.community_posts;
create policy "posts_update_own"
on public.community_posts for update to authenticated
using ( user_id = (select auth.uid()) or (select public.is_admin()) )
with check ( user_id = (select auth.uid()) or (select public.is_admin()) );

drop policy if exists "posts_delete_own" on public.community_posts;
create policy "posts_delete_own"
on public.community_posts for delete to authenticated
using ( user_id = (select auth.uid()) or (select public.is_admin()) );


drop policy if exists "post_images_admin_manage" on public.post_images;
drop policy if exists "post_images_owner_manage" on public.post_images;
drop policy if exists "post_images_owner_insert" on public.post_images;
create policy "post_images_owner_insert"
on public.post_images for insert to authenticated
with check (
  exists (
    select 1 from public.community_posts p
    where p.id = post_images.post_id
      and (p.user_id = (select auth.uid()) or (select public.is_admin()))
  )
);
drop policy if exists "post_images_owner_update" on public.post_images;
create policy "post_images_owner_update"
on public.post_images for update to authenticated
using (
  exists (
    select 1 from public.community_posts p
    where p.id = post_images.post_id
      and (p.user_id = (select auth.uid()) or (select public.is_admin()))
  )
)
with check (
  exists (
    select 1 from public.community_posts p
    where p.id = post_images.post_id
      and (p.user_id = (select auth.uid()) or (select public.is_admin()))
  )
);
drop policy if exists "post_images_owner_delete" on public.post_images;
create policy "post_images_owner_delete"
on public.post_images for delete to authenticated
using (
  exists (
    select 1 from public.community_posts p
    where p.id = post_images.post_id
      and (p.user_id = (select auth.uid()) or (select public.is_admin()))
  )
);


drop policy if exists "comments_public_read" on public.community_comments;
create policy "comments_public_read"
on public.community_comments for select to anon, authenticated
using (
  status = 'published'
  or user_id = (select auth.uid())
  or (select public.is_admin())
);

drop policy if exists "comments_insert_own" on public.community_comments;
create policy "comments_insert_own"
on public.community_comments for insert to authenticated
with check ( user_id = (select auth.uid()) );

drop policy if exists "comments_update_own" on public.community_comments;
create policy "comments_update_own"
on public.community_comments for update to authenticated
using ( user_id = (select auth.uid()) or (select public.is_admin()) )
with check ( user_id = (select auth.uid()) or (select public.is_admin()) );

drop policy if exists "comments_delete_own" on public.community_comments;
create policy "comments_delete_own"
on public.community_comments for delete to authenticated
using ( user_id = (select auth.uid()) or (select public.is_admin()) );


drop policy if exists "likes_public_read" on public.post_likes;
create policy "likes_public_read"
on public.post_likes for select to anon, authenticated
using ( true );

drop policy if exists "likes_insert_own" on public.post_likes;
create policy "likes_insert_own"
on public.post_likes for insert to authenticated
with check ( user_id = (select auth.uid()) );

drop policy if exists "likes_delete_own" on public.post_likes;
create policy "likes_delete_own"
on public.post_likes for delete to authenticated
using ( user_id = (select auth.uid()) );


drop policy if exists "bookmarks_select_own" on public.post_bookmarks;
create policy "bookmarks_select_own"
on public.post_bookmarks for select to authenticated
using ( user_id = (select auth.uid()) );

drop policy if exists "bookmarks_insert_own" on public.post_bookmarks;
create policy "bookmarks_insert_own"
on public.post_bookmarks for insert to authenticated
with check ( user_id = (select auth.uid()) );

drop policy if exists "bookmarks_delete_own" on public.post_bookmarks;
create policy "bookmarks_delete_own"
on public.post_bookmarks for delete to authenticated
using ( user_id = (select auth.uid()) );


drop policy if exists "follows_insert_own" on public.user_follows;
create policy "follows_insert_own"
on public.user_follows for insert to authenticated
with check ( follower_id = (select auth.uid()) );

drop policy if exists "follows_delete_own" on public.user_follows;
create policy "follows_delete_own"
on public.user_follows for delete to authenticated
using ( follower_id = (select auth.uid()) );


drop policy if exists "reports_select_own" on public.community_reports;
create policy "reports_select_own"
on public.community_reports for select to authenticated
using ( reporter_id = (select auth.uid()) or (select public.is_admin()) );

drop policy if exists "reports_insert_own" on public.community_reports;
create policy "reports_insert_own"
on public.community_reports for insert to authenticated
with check ( reporter_id = (select auth.uid()) );

drop policy if exists "reports_admin_manage" on public.community_reports;
create policy "reports_admin_manage"
on public.community_reports for update to authenticated
using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );


-- ============================================================
-- 8. notifications
-- ============================================================

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
on public.notifications for select to authenticated
using ( user_id = (select auth.uid()) );

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
on public.notifications for update to authenticated
using ( user_id = (select auth.uid()) )
with check ( user_id = (select auth.uid()) );

drop policy if exists "notifications_admin_insert" on public.notifications;
create policy "notifications_admin_insert"
on public.notifications for insert to authenticated
with check ( (select public.is_admin()) );

-- เดิมไม่มี policy DELETE เลย ผู้ใช้จึงลบแจ้งเตือนของตัวเองทิ้งไม่ได้
drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own"
on public.notifications for delete to authenticated
using ( user_id = (select auth.uid()) );


-- ============================================================
-- 9. news
-- ============================================================

drop policy if exists "news_public_read" on public.news;
create policy "news_public_read"
on public.news for select to anon, authenticated
using (
  (status = 'published' and published_at <= now())
  or (select public.is_admin())
);

drop policy if exists "news_admin_manage" on public.news;
drop policy if exists "news_admin_insert" on public.news;
create policy "news_admin_insert"
on public.news for insert to authenticated
with check ( (select public.is_admin()) );
drop policy if exists "news_admin_update" on public.news;
create policy "news_admin_update"
on public.news for update to authenticated
using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );
drop policy if exists "news_admin_delete" on public.news;
create policy "news_admin_delete"
on public.news for delete to authenticated
using ( (select public.is_admin()) );


-- ============================================================
-- 10. club amenities / facilities page settings
-- ============================================================

drop policy if exists "facilities_page_settings_public_read" on public.facilities_page_settings;
create policy "facilities_page_settings_public_read"
on public.facilities_page_settings for select to anon, authenticated
using ( true );

drop policy if exists "facilities_page_settings_admin_manage" on public.facilities_page_settings;
create policy "facilities_page_settings_admin_manage"
on public.facilities_page_settings for update to authenticated
using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );


drop policy if exists "club_amenities_public_read" on public.club_amenities;
create policy "club_amenities_public_read"
on public.club_amenities for select to anon, authenticated
using ( is_visible = true or (select public.is_admin()) );

drop policy if exists "club_amenities_admin_manage" on public.club_amenities;
drop policy if exists "club_amenities_admin_insert" on public.club_amenities;
create policy "club_amenities_admin_insert"
on public.club_amenities for insert to authenticated
with check ( (select public.is_admin()) );
drop policy if exists "club_amenities_admin_update" on public.club_amenities;
create policy "club_amenities_admin_update"
on public.club_amenities for update to authenticated
using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );
drop policy if exists "club_amenities_admin_delete" on public.club_amenities;
create policy "club_amenities_admin_delete"
on public.club_amenities for delete to authenticated
using ( (select public.is_admin()) );


drop policy if exists "club_amenity_facts_public_read" on public.club_amenity_facts;
create policy "club_amenity_facts_public_read"
on public.club_amenity_facts for select to anon, authenticated
using (
  exists (
    select 1 from public.club_amenities a
    where a.id = club_amenity_facts.amenity_id
      and (a.is_visible = true or (select public.is_admin()))
  )
);

drop policy if exists "club_amenity_facts_admin_manage" on public.club_amenity_facts;
drop policy if exists "club_amenity_facts_admin_insert" on public.club_amenity_facts;
create policy "club_amenity_facts_admin_insert"
on public.club_amenity_facts for insert to authenticated
with check ( (select public.is_admin()) );
drop policy if exists "club_amenity_facts_admin_update" on public.club_amenity_facts;
create policy "club_amenity_facts_admin_update"
on public.club_amenity_facts for update to authenticated
using ( (select public.is_admin()) ) with check ( (select public.is_admin()) );
drop policy if exists "club_amenity_facts_admin_delete" on public.club_amenity_facts;
create policy "club_amenity_facts_admin_delete"
on public.club_amenity_facts for delete to authenticated
using ( (select public.is_admin()) );


-- ============================================================
-- 11. storage: ครอบ auth.uid() ใน policy ของ bucket avatars ด้วยเหตุผลเดียวกัน
-- ============================================================

drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (select auth.uid())::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
on storage.objects for update to authenticated
using (
  bucket_id = 'avatars'
  and (select auth.uid())::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar"
on storage.objects for delete to authenticated
using (
  bucket_id = 'avatars'
  and (select auth.uid())::text = (storage.foldername(name))[1]
);

drop policy if exists "Admins can upload news images" on storage.objects;
create policy "Admins can upload news images"
on storage.objects for insert to authenticated
with check ( bucket_id = 'news' and (select public.is_admin()) );

drop policy if exists "Admins can update news images" on storage.objects;
create policy "Admins can update news images"
on storage.objects for update to authenticated
using ( bucket_id = 'news' and (select public.is_admin()) );

drop policy if exists "Admins can delete news images" on storage.objects;
create policy "Admins can delete news images"
on storage.objects for delete to authenticated
using ( bucket_id = 'news' and (select public.is_admin()) );

drop policy if exists "Admins can upload amenity images" on storage.objects;
create policy "Admins can upload amenity images"
on storage.objects for insert to authenticated
with check ( bucket_id = 'amenities' and (select public.is_admin()) );

drop policy if exists "Admins can update amenity images" on storage.objects;
create policy "Admins can update amenity images"
on storage.objects for update to authenticated
using ( bucket_id = 'amenities' and (select public.is_admin()) );

drop policy if exists "Admins can delete amenity images" on storage.objects;
create policy "Admins can delete amenity images"
on storage.objects for delete to authenticated
using ( bucket_id = 'amenities' and (select public.is_admin()) );
