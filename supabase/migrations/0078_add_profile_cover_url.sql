-- เพิ่มรูปภาพปก (banner) ให้โปรไฟล์ผู้ใช้ ใช้ทั้งในหน้าโปรไฟล์ส่วนตัวและ
-- โปรไฟล์ชุมชน คอลัมน์เดิมของ profiles ไม่มีช่องนี้มาก่อน

alter table public.profiles add column if not exists cover_url text;

create or replace view public.public_profiles as
select
  id,
  username,
  full_name,
  avatar_url,
  bio,
  sports,
  area,
  home_venue,
  available_time,
  created_at,
  last_seen_at,
  cover_url
from public.profiles
where is_active;

create or replace view public.community_profile_stats as
select
  id,
  username,
  full_name,
  avatar_url,
  bio,
  sports,
  area,
  home_venue,
  available_time,
  created_at,
  ((select count(*) from community_posts p where p.user_id = pp.id and p.status = 'published'::content_status))::integer as post_count,
  ((select count(*) from user_follows f where f.following_id = pp.id))::integer as follower_count,
  ((select count(*) from user_follows f where f.follower_id = pp.id))::integer as following_count,
  ((select count(*) from community_posts p join community_categories c on c.id = p.category_id where p.user_id = pp.id and p.status = 'published'::content_status and (c.name::text = any (array['หาเพื่อนเล่นกีฬา'::character varying, 'หาคนร่วมทีม'::character varying]::text[])) ))::integer as team_post_count,
  (exists (select 1 from user_follows f where f.following_id = pp.id and f.follower_id = ((select auth.uid() as uid)))) as is_following,
  pp.cover_url
from public_profiles pp;
