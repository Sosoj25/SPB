-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0043).
-- Safe to re-run: every step is idempotent.
--
-- เก็บงานค้างของระบบชุมชนจากรอบรีวิว
--   1) ยอดถูกใจ/คอมเมนต์ เป็นคอลัมน์จริง แทน correlated subquery ต่อแถว
--   2) กันรายงานซ้ำจากคนเดิมกับเนื้อหาเดิม
--   3) แจ้งเตือน: มีคนคอมเมนต์โพสต์เรา / มีคนติดตาม / มีข้อความใหม่
--   4) นับยอดเข้าชมโพสต์
--   5) view สำหรับหน้าจัดการคอมเมนต์ฝั่งแอดมิน


-- ============================================================
-- 1. คอลัมน์นับยอด
-- ============================================================
-- เดิม community_feed_posts (0041) นับ like/comment ด้วย subquery ต่อโพสต์
-- ซึ่งอ่านง่ายแต่ต้นทุนโตตามจำนวนแถวที่ดึง พอฟีดยาวขึ้นจะกลายเป็นคอขวด
-- ย้ายมาเป็นคอลัมน์จริงที่ trigger คอยซิงก์ให้แทน
alter table public.community_posts
  add column if not exists like_count    int not null default 0,
  add column if not exists comment_count int not null default 0;

-- คำนวณใหม่ทั้งค่า ไม่ใช่ +1/-1 — ถ้าเคยเพี้ยนไปแล้วจะกลับมาตรงเองรอบถัดไป
-- (แบบ +1/-1 พลาดครั้งเดียวคือเพี้ยนถาวร) ต้นทุนพอกันเพราะมี index รองรับ
create or replace function public.recount_community_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_post_id is null then
    return;
  end if;

  -- บอก protect_community_post_privileged_columns ว่าการอัปเดตรอบนี้มาจาก
  -- ตัวนับของระบบ ไม่ใช่ผู้ใช้ยิง .update() เอง (pattern เดียวกับ
  -- app.booking_engine ใน 0021)
  perform set_config('app.community_counter', 'on', true);

  update public.community_posts
  set like_count = (
        select count(*) from public.post_likes l where l.post_id = p_post_id
      ),
      comment_count = (
        select count(*) from public.community_comments c
        where c.post_id = p_post_id and c.status = 'published'
      )
  where id = p_post_id;

  perform set_config('app.community_counter', '', true);
end;
$$;

create or replace function public.sync_community_post_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recount_community_post(coalesce(new.post_id, old.post_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists sync_counters_on_like on public.post_likes;
create trigger sync_counters_on_like
after insert or delete on public.post_likes
for each row execute function public.sync_community_post_counters();

drop trigger if exists sync_counters_on_comment on public.community_comments;
create trigger sync_counters_on_comment
after insert or delete or update of status on public.community_comments
for each row execute function public.sync_community_post_counters();

-- เติมค่าให้โพสต์ที่มีอยู่แล้ว
update public.community_posts p
set like_count = (select count(*) from public.post_likes l where l.post_id = p.id),
    comment_count = (select count(*) from public.community_comments c
                     where c.post_id = p.id and c.status = 'published')
where p.like_count is distinct from (select count(*) from public.post_likes l where l.post_id = p.id)
   or p.comment_count is distinct from (select count(*) from public.community_comments c
                                        where c.post_id = p.id and c.status = 'published');


-- ============================================================
-- 2. ยอดเข้าชมโพสต์
-- ============================================================
-- ผู้ใช้อัปเดต view_count ของโพสต์คนอื่นเองไม่ได้ (posts_update_own) จึงต้อง
-- ผ่าน RPC — และไม่นับให้เจ้าของโพสต์เอง ไม่งั้นรีเฟรชหน้าตัวเองยอดก็ขึ้น
create or replace function public.increment_post_view(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.community_counter', 'on', true);

  update public.community_posts
  set view_count = view_count + 1
  where id = p_post_id
    and status = 'published'
    and user_id is distinct from (select auth.uid());

  perform set_config('app.community_counter', '', true);
end;
$$;

revoke all on function public.increment_post_view(uuid) from public, anon;
grant execute on function public.increment_post_view(uuid) to authenticated;


-- ============================================================
-- 3. อัปเดตด่านกันคอลัมน์สงวน ให้รู้จักคอลัมน์นับยอด
-- ============================================================
-- like_count / comment_count / view_count ต้องขยับได้เฉพาะจากตัวนับของระบบ
-- ไม่งั้นใครก็ยิง .update({ like_count: 99999 }) ปั้นยอดโพสต์ตัวเองได้
create or replace function public.protect_community_post_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role'
     or coalesce(current_setting('app.community_counter', true), '') = 'on'
  then
    return new;
  end if;

  if new.like_count    is distinct from old.like_count
     or new.comment_count is distinct from old.comment_count
     or new.view_count    is distinct from old.view_count
  then
    raise exception 'ตัวเลขยอดถูกใจ/ความคิดเห็น/เข้าชม แก้ไขโดยตรงไม่ได้';
  end if;

  if public.is_admin() then
    return new;
  end if;

  if new.is_pinned is distinct from old.is_pinned then
    raise exception 'การปักหมุดโพสต์ทำได้เฉพาะผู้ดูแลระบบ';
  end if;

  if new.hidden_by is distinct from old.hidden_by then
    raise exception 'ไม่สามารถแก้ไขข้อมูลการตรวจสอบของผู้ดูแลระบบได้';
  end if;

  if old.hidden_by is not null and new.status is distinct from old.status then
    raise exception 'โพสต์นี้ถูกซ่อนโดยผู้ดูแลระบบ ไม่สามารถเปลี่ยนสถานะเองได้';
  end if;

  return new;
end;
$$;


-- ============================================================
-- 4. กันรายงานซ้ำ
-- ============================================================
-- คนเดิมกดรายงานเนื้อหาเดิมซ้ำ ๆ ไม่ควรทำให้ตัวเลข "ถูกรายงาน N ครั้ง" พองขึ้น
-- เพราะแอดมินใช้ตัวเลขนั้นตัดสินใจว่าเรื่องไหนด่วนกว่า
create unique index if not exists community_reports_unique_post
  on public.community_reports (reporter_id, post_id)
  where post_id is not null;

create unique index if not exists community_reports_unique_comment
  on public.community_reports (reporter_id, comment_id)
  where comment_id is not null;

create index if not exists community_reports_pending_idx
  on public.community_reports (status, created_at desc)
  where status = 'pending';


-- ============================================================
-- 5. แจ้งเตือนเหตุการณ์ในชุมชน
-- ============================================================
-- ตาราง notifications กับกระดิ่งใน AppHeader มีมาตั้งแต่ 0037 แล้ว แต่ผูกไว้
-- กับงานฝั่งการเงินอย่างเดียว ชุมชนยังเงียบสนิท — ต่อ 3 เหตุการณ์ที่ผู้ใช้
-- อยากรู้จริง ๆ เข้าไป
--
-- ทุกตัวข้ามกรณี "ทำกับตัวเอง" (คอมเมนต์โพสต์ตัวเอง / กดติดตามตัวเอง) และ
-- เขียนด้วย security definer เพราะต้อง insert แถวของ "คนอื่น"

create or replace function public.notify_post_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
  v_name   text;
begin
  if new.status is distinct from 'published' then
    return new;
  end if;

  select user_id into v_author from public.community_posts where id = new.post_id;

  if v_author is null or v_author = new.user_id then
    return new;
  end if;

  select coalesce(full_name, username, 'ผู้ใช้') into v_name
  from public.profiles where id = new.user_id;

  insert into public.notifications (user_id, type, title, message, reference_type, reference_id)
  values (
    v_author,
    'community_comment',
    'มีความคิดเห็นใหม่ในโพสต์ของคุณ',
    format('%s แสดงความคิดเห็น: %s', v_name,
           left(new.content, 80) || case when length(new.content) > 80 then '...' else '' end),
    'community_post',
    new.post_id::text
  );

  return new;
end;
$$;

drop trigger if exists notify_post_comment on public.community_comments;
create trigger notify_post_comment
after insert on public.community_comments
for each row execute function public.notify_post_comment();


create or replace function public.notify_new_follower()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if new.follower_id = new.following_id then
    return new;
  end if;

  select coalesce(full_name, username, 'ผู้ใช้') into v_name
  from public.profiles where id = new.follower_id;

  insert into public.notifications (user_id, type, title, message, reference_type, reference_id)
  values (
    new.following_id,
    'community_follow',
    'มีผู้ติดตามใหม่',
    format('%s เริ่มติดตามคุณแล้ว', v_name),
    'community_profile',
    new.follower_id::text
  );

  return new;
end;
$$;

drop trigger if exists notify_new_follower on public.user_follows;
create trigger notify_new_follower
after insert on public.user_follows
for each row execute function public.notify_new_follower();


create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select coalesce(full_name, username, 'ผู้ใช้') into v_name
  from public.profiles where id = new.sender_id;

  -- ห้องกลุ่มมีได้หลายคน จึงแจ้งทุกคนที่ไม่ใช่คนส่ง
  insert into public.notifications (user_id, type, title, message, reference_type, reference_id)
  select
    m.user_id,
    'community_message',
    format('ข้อความใหม่จาก %s', v_name),
    left(coalesce(new.content, 'ส่งรูปภาพ'), 80)
      || case when length(coalesce(new.content, '')) > 80 then '...' else '' end,
    'conversation',
    new.conversation_id::text
  from public.conversation_members m
  where m.conversation_id = new.conversation_id
    and m.user_id <> new.sender_id;

  return new;
end;
$$;

drop trigger if exists notify_new_message on public.messages;
create trigger notify_new_message
after insert on public.messages
for each row execute function public.notify_new_message();


-- ============================================================
-- 6. view ใช้คอลัมน์นับยอดแทน subquery
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
    limit 1) as cover_image
from public.community_posts p
join public.public_profiles au on au.id = p.user_id
left join public.community_categories cc on cc.id = p.category_id;

grant select on public.community_feed_posts to authenticated;


create or replace view public.admin_community_posts
with (security_invoker = on) as
select
  p.id,
  p.user_id,
  p.category_id,
  cc.name as category_name,
  p.title,
  p.content,
  p.status,
  p.is_pinned,
  p.hidden_by,
  p.created_at,
  pr.username  as author_username,
  pr.full_name as author_full_name,
  pr.avatar_url as author_avatar_url,
  pr.is_active as author_is_active,
  p.like_count,
  p.comment_count,
  (select count(*) from public.community_reports r
    where r.post_id = p.id
      and r.status = 'pending')::int as pending_report_count
from public.community_posts p
left join public.profiles pr on pr.id = p.user_id
left join public.community_categories cc on cc.id = p.category_id
where p.status <> 'deleted';

grant select on public.admin_community_posts to authenticated;


-- ============================================================
-- 7. admin_community_comments — หน้าจัดการคอมเมนต์ฝั่งแอดมิน
-- ============================================================
-- เดิมแอดมินแตะคอมเมนต์ได้ทางเดียวคือรอให้มีคนรายงานเข้ามา ไม่มีรายการให้
-- ไล่ดูเลย ทั้งที่ comments_delete_own มี `or is_admin()` เปิดทางไว้อยู่แล้ว
create or replace view public.admin_community_comments
with (security_invoker = on) as
select
  c.id,
  c.post_id,
  c.user_id,
  c.content,
  c.status,
  c.created_at,
  pr.username   as author_username,
  pr.full_name  as author_full_name,
  pr.avatar_url as author_avatar_url,
  pr.is_active  as author_is_active,
  p.title       as post_title,
  (select count(*) from public.community_reports r
    where r.comment_id = c.id
      and r.status = 'pending')::int as pending_report_count
from public.community_comments c
left join public.profiles pr on pr.id = c.user_id
left join public.community_posts p on p.id = c.post_id
where c.status <> 'deleted';

grant select on public.admin_community_comments to authenticated;


-- ============================================================
-- 8. สถิติแอดมิน: เพิ่มยอดคอมเมนต์
-- ============================================================
drop function if exists public.admin_community_stats();

create function public.admin_community_stats()
returns table (
  total_posts       int,
  total_comments    int,
  pending_reports   int,
  flagged_posts     int,
  hidden_posts      int,
  pinned_posts      int,
  suspended_members int,
  total_members     int
)
language sql
stable
as $$
  select
    (select count(*) from public.community_posts where status <> 'deleted')::int,
    (select count(*) from public.community_comments where status = 'published')::int,
    (select count(*) from public.community_reports where status = 'pending')::int,
    (select count(distinct p.id)
       from public.community_posts p
       join public.community_reports r on r.post_id = p.id and r.status = 'pending'
      where p.status <> 'deleted')::int,
    (select count(*) from public.community_posts where status = 'hidden')::int,
    (select count(*) from public.community_posts where is_pinned)::int,
    (select count(*) from public.profiles where not is_active)::int,
    (select count(*) from public.profiles)::int;
$$;

revoke all on function public.admin_community_stats() from public, anon;
grant execute on function public.admin_community_stats() to authenticated;
