-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0081).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ส่งรายการรูปทั้งหมดของโพสต์มาพร้อมกับฟีด (สำหรับ mosaic แบบเฟซบุ๊ก)
-- ============================================================
-- เดิม view มีแค่ cover_image (รูปแรก) — ไม่พอให้การ์ดในฟีดวางเลย์เอาต์แบบ
-- เฟซบุ๊ก (1 รูปเต็ม/2 รูปคู่/3 รูปใหญ่-เล็ก/ฯลฯ) ต้องมี URL ของทุกรูปมาด้วย
-- ในคิวรีเดียวกัน ไม่งั้นฟีด 20 โพสต์จะต้องยิงแยกทีละโพสต์ (N+1)

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
    where i.post_id = p.id)::int as image_count,
  (select coalesce(array_agg(i.image_url order by i.sort_order, i.id), '{}')
    from public.post_images i
    where i.post_id = p.id) as image_urls
from public.community_posts p
join public.public_profiles au on au.id = p.user_id
left join public.community_categories cc on cc.id = p.category_id;

grant select on public.community_feed_posts to authenticated;
