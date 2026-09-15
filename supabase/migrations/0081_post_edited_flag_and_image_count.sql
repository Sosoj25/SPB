-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0080).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ป้าย "โพสต์นี้ถูกแก้ไข" + จำนวนรูปทั้งหมดต่อโพสต์ (สำหรับ badge "+N" บนฟีด)
-- ============================================================
-- post_images (0000) รองรับหลายรูปต่อโพสต์อยู่แล้ว (sort_order) ฝั่งแอปแค่ไม่
-- เคยใส่มากกว่า 1 แถว — ไม่ต้องแก้สคีมาส่วนนั้น จุดที่ขาดจริงคือ:
--   1) วิธีรู้ว่าโพสต์ "ถูกแก้ไข" แล้ว — updated_at ใช้ไม่ได้เพราะขยับทุกครั้งที่
--      view_count/like_count/comment_count เปลี่ยน (increment_post_view,
--      sync_community_post_counters ใน 0044) หรือแอดมินปักหมุด (0043) ไม่ใช่
--      แค่ตอนเจ้าของแก้เนื้อหาจริง ๆ จึงต้องมีคอลัมน์แยกที่ตั้งค่าเฉพาะตอน
--      updateOwnPost เท่านั้น
--   2) จำนวนรูปทั้งหมดของโพสต์ — เดิม view มีแค่ cover_image (รูปแรก) ไม่พอ
--      ให้ฝั่งฟีดโชว์ "+N" ว่ามีรูปอื่นอีกไหม


-- ============================================================
-- 1. คอลัมน์ edited_at
-- ============================================================

alter table public.community_posts
  add column if not exists edited_at timestamptz;


-- ============================================================
-- 2. เติม edited_at + image_count เข้า view เดิม (0044)
-- ============================================================

drop view if exists public.community_feed_posts;

create view public.community_feed_posts
with (security_invoker = on) as
select
  p.id,
  p.user_id,
  p.category_id,
  cc.name  as category_name,
  p.title,
  p.content,
  p.post_type,
  p.status,
  p.is_pinned,
  p.view_count,
  p.created_at,
  p.updated_at,
  p.edited_at,
  au.username   as author_username,
  au.full_name  as author_full_name,
  au.avatar_url as author_avatar_url,
  p.like_count,
  p.comment_count,
  exists (select 1 from public.post_likes l
    where l.post_id = p.id
      and l.user_id = (select auth.uid())) as is_liked,
  exists (select 1 from public.post_bookmarks b
    where b.post_id = p.id
      and b.user_id = (select auth.uid())) as is_bookmarked,
  exists (select 1 from public.user_follows f
    where f.following_id = p.user_id
      and f.follower_id = (select auth.uid())) as is_author_followed,
  (select i.image_url from public.post_images i
    where i.post_id = p.id
    order by i.sort_order, i.id
    limit 1) as cover_image,
  (select count(*) from public.post_images i
    where i.post_id = p.id)::int as image_count
from public.community_posts p
join public.public_profiles au on au.id = p.user_id
left join public.community_categories cc on cc.id = p.category_id;

grant select on public.community_feed_posts to authenticated;
