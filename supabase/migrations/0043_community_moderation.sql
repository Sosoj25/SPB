-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0042).
-- Safe to re-run: every step is idempotent.
--
-- หน้าแอดมิน "จัดการชุมชน" — คิวรายงาน ซ่อน/ปักหมุด/ลบโพสต์ และหมวดหมู่
--
-- RLS ฝั่งจัดการมีครบอยู่แล้วตั้งแต่ 0000: posts_update_own /
-- posts_delete_own / comments_* ทุกตัวมี `or is_admin()` ต่อท้าย และ
-- community_reports ก็มี reports_admin_manage ให้แอดมิน update ได้ — migration
-- นี้จึงไม่ต้องเพิ่ม policy ใหม่เลย ที่ขาดจริง ๆ คือ
--   1) คอลัมน์ปักหมุด (Figma มี แต่ตารางไม่มี)
--   2) ช่องโหว่: เจ้าของโพสต์กด "เลิกซ่อน" โพสต์ที่แอดมินซ่อนไว้ได้ (หัวข้อ 2)
--   3) view/RPC สำหรับหน้าแอดมินโดยเฉพาะ


-- ============================================================
-- 1. ปักหมุด + บันทึกว่าใครเป็นคนซ่อน
-- ============================================================
alter table public.community_posts
  add column if not exists is_pinned boolean not null default false,
  -- ว่าง = ยังไม่เคยถูกแอดมินซ่อน (เจ้าของซ่อนเองได้ ไม่ถือเป็นการมอเดอเรต)
  add column if not exists hidden_by uuid references public.profiles(id) on delete set null;

create index if not exists community_posts_pinned_idx
  on public.community_posts (is_pinned)
  where is_pinned;

create index if not exists community_posts_status_idx
  on public.community_posts (status);


-- ============================================================
-- 2. กันเจ้าของโพสต์แก้สถานะที่แอดมินตั้งไว้
-- ============================================================
-- posts_update_own ให้เจ้าของแถวแก้ได้ "ทุกคอลัมน์" ซึ่งเป็นบั๊กแบบเดียวกับ
-- ที่ 0002/0003/0029 ตามแก้มาแล้วกับ profiles/bookings — พอมี is_pinned กับ
-- status เข้ามา เจ้าของโพสต์จะ
--   supabase.from('community_posts').update({ is_pinned: true })
-- ปักหมุดโพสต์ตัวเองขึ้นหัวฟีดได้ทันที และที่แย่กว่าคือกด
--   .update({ status: 'published' })
-- ปลดโพสต์ที่แอดมินเพิ่งซ่อนเพราะผิดกฎ กลับขึ้นหน้าเว็บได้เองทั้งที่ยังไม่มี
-- ใครทบทวน ใช้ trigger กันแบบเดียวกับของเดิม
create or replace function public.protect_community_post_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or public.is_admin() then
    return new;
  end if;

  if new.is_pinned is distinct from old.is_pinned then
    raise exception 'การปักหมุดโพสต์ทำได้เฉพาะผู้ดูแลระบบ';
  end if;

  if new.hidden_by is distinct from old.hidden_by then
    raise exception 'ไม่สามารถแก้ไขข้อมูลการตรวจสอบของผู้ดูแลระบบได้';
  end if;

  -- hidden_by ว่าง = เจ้าของซ่อนเอง ยังกดแสดงกลับเองได้ตามปกติ
  if old.hidden_by is not null and new.status is distinct from old.status then
    raise exception 'โพสต์นี้ถูกซ่อนโดยผู้ดูแลระบบ ไม่สามารถเปลี่ยนสถานะเองได้';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_community_post_privileged_columns on public.community_posts;
create trigger protect_community_post_privileged_columns
before update on public.community_posts
for each row execute function public.protect_community_post_privileged_columns();


-- ============================================================
-- 3. ฟีดสาธารณะ: โพสต์ปักหมุดขึ้นก่อน
-- ============================================================
-- เพิ่มคอลัมน์ is_pinned เข้า view เดิม (0041) — ต้อง drop ก่อนเพราะ
-- create or replace view เปลี่ยนชุดคอลัมน์ไม่ได้
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
  (select count(*) from public.post_likes l
    where l.post_id = p.id)::int as like_count,
  (select count(*) from public.community_comments c
    where c.post_id = p.id
      and c.status = 'published')::int as comment_count,
  exists (select 1 from public.post_likes l
    where l.post_id = p.id
      and l.user_id = (select auth.uid())) as is_liked,
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


-- ============================================================
-- 4. admin_community_posts — รายการโพสต์ฝั่งแอดมิน
-- ============================================================
-- ต่างจากฟีดสาธารณะ 3 อย่าง: รวมโพสต์ที่ถูกซ่อนด้วย, join profiles ตรง ๆ
-- แบบ left join (แอดมินต้องเห็นโพสต์ของบัญชีที่ถูกระงับด้วย ซึ่ง
-- public_profiles ตัดออกไปแล้ว) และมียอดรายงานที่ยังค้างอยู่
--
-- security_invoker = on ทำให้ posts_public_read เป็นตัวกั้นเอง คนที่ไม่ใช่
-- แอดมินเรียก view นี้จะเห็นแค่โพสต์สาธารณะกับของตัวเอง ไม่ใช่ของที่ซ่อนไว้
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
  (select count(*) from public.post_likes l
    where l.post_id = p.id)::int as like_count,
  (select count(*) from public.community_comments c
    where c.post_id = p.id
      and c.status = 'published')::int as comment_count,
  (select count(*) from public.community_reports r
    where r.post_id = p.id
      and r.status = 'pending')::int as pending_report_count
from public.community_posts p
left join public.profiles pr on pr.id = p.user_id
left join public.community_categories cc on cc.id = p.category_id
where p.status <> 'deleted';

grant select on public.admin_community_posts to authenticated;


-- ============================================================
-- 5. admin_community_reports — คิวรายงาน จัดกลุ่มตามเนื้อหาที่ถูกรายงาน
-- ============================================================
-- จัดกลุ่มตามโพสต์/คอมเมนต์ ไม่ใช่เรียงทีละใบรายงาน เพราะเนื้อหาชิ้นเดียว
-- ถูกรายงานได้หลายคน — แอดมินต้องตัดสินใจต่อ "เนื้อหา" ครั้งเดียว ไม่ใช่กด
-- ทีละใบ 5 รอบสำหรับโพสต์เดียวกัน
create or replace view public.admin_community_reports
with (security_invoker = on) as
select
  g.post_id,
  g.comment_id,
  case when g.post_id is not null then 'post' else 'comment' end as target_type,
  g.report_count,
  g.reasons,
  g.last_reported_at,
  coalesce(p.content, c.content) as target_content,
  coalesce(p.user_id, c.user_id) as target_author_id,
  coalesce(pa.full_name, pa.username, 'ผู้ใช้ไม่ระบุตัวตน') as target_author,
  p.status as post_status
from (
  select
    r.post_id,
    r.comment_id,
    count(*)::int                     as report_count,
    array_agg(distinct r.reason::text) as reasons,
    max(r.created_at)                 as last_reported_at
  from public.community_reports r
  where r.status = 'pending'
  group by r.post_id, r.comment_id
) g
left join public.community_posts p    on p.id = g.post_id
left join public.community_comments c on c.id = g.comment_id
left join public.profiles pa          on pa.id = coalesce(p.user_id, c.user_id);

grant select on public.admin_community_reports to authenticated;


-- ============================================================
-- 6. admin_community_categories — หมวดหมู่พร้อมยอดโพสต์
-- ============================================================
create or replace view public.admin_community_categories
with (security_invoker = on) as
select
  cc.id,
  cc.name,
  cc.description,
  (select count(*) from public.community_posts p
    where p.category_id = cc.id
      and p.status = 'published')::int as post_count
from public.community_categories cc;

grant select on public.admin_community_categories to authenticated;


-- ============================================================
-- 7. admin_reported_users — ผู้ใช้ที่ถูกรายงานบ่อย
-- ============================================================
-- นับรายงานทุกใบไม่ว่าจะตรวจไปแล้วหรือยัง เพราะประเด็นคือประวัติสะสมของคนคนนั้น
-- ไม่ใช่คิวงานที่ค้างอยู่ตอนนี้
create or replace view public.admin_reported_users
with (security_invoker = on) as
select
  pr.id,
  pr.username,
  pr.full_name,
  pr.avatar_url,
  pr.is_active,
  count(*)::int as report_count
from public.community_reports r
left join public.community_posts p    on p.id = r.post_id
left join public.community_comments c on c.id = r.comment_id
join public.profiles pr on pr.id = coalesce(p.user_id, c.user_id)
group by pr.id, pr.username, pr.full_name, pr.avatar_url, pr.is_active;

grant select on public.admin_reported_users to authenticated;


-- ============================================================
-- 8. admin_community_stats — ตัวเลข 4 ช่องบนหัวหน้า
-- ============================================================
-- ตั้งใจเป็น security invoker (ไม่ใช่ definer): RLS ของแต่ละตารางมี
-- `or is_admin()` อยู่แล้ว แอดมินจึงนับได้ครบเองโดยไม่ต้องข้าม RLS และคนที่
-- ไม่ใช่แอดมินเรียกไปก็ได้แค่ตัวเลขของข้อมูลที่ตัวเองมองเห็นอยู่แล้ว ไม่รั่ว
create or replace function public.admin_community_stats()
returns table (
  total_posts       int,
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


-- ============================================================
-- 9. admin_resolve_report — ปิดงานรายงานทั้งกอง
-- ============================================================
-- "ลบเนื้อหา" กับ "เพิกเฉย" ต้องแตะสองตาราง (เนื้อหา + ใบรายงานทุกใบของ
-- เนื้อหานั้น) ถ้าปล่อยให้หน้าเว็บยิงเองสองครั้ง แล้วครั้งที่สองพลาด จะเหลือ
-- โพสต์ที่ลบไปแล้วแต่ใบรายงานยังค้างในคิวตลอดไป รวมไว้ใน RPC เดียวให้จบใน
-- ทรานแซกชันเดียว
--
-- security definer + เช็ค is_admin() เองที่บรรทัดแรก (ไม่พึ่ง RLS อย่างเดียว
-- เพราะ definer ข้าม RLS ไปแล้ว)
create or replace function public.admin_resolve_report(
  p_post_id    uuid,
  p_comment_id uuid,
  p_action     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบจึงจะจัดการรายงานได้';
  end if;

  if p_action not in ('delete', 'dismiss') then
    raise exception 'คำสั่งไม่ถูกต้อง';
  end if;

  if p_post_id is null and p_comment_id is null then
    raise exception 'ไม่ได้ระบุเนื้อหาที่จะจัดการ';
  end if;

  if p_action = 'delete' then
    if p_post_id is not null then
      update public.community_posts
      set status = 'deleted', hidden_by = v_me
      where id = p_post_id;
    else
      update public.community_comments
      set status = 'deleted'
      where id = p_comment_id;
    end if;
  end if;

  -- ปิดใบรายงานทุกใบของเนื้อหาชิ้นนี้พร้อมกัน
  update public.community_reports
  set status      = case when p_action = 'delete' then 'resolved' else 'rejected' end::report_status,
      reviewed_by = v_me,
      reviewed_at = now()
  where status = 'pending'
    and (
      (p_post_id is not null and post_id = p_post_id)
      or (p_comment_id is not null and comment_id = p_comment_id)
    );
end;
$$;

revoke all on function public.admin_resolve_report(uuid, uuid, text) from public, anon;
grant execute on function public.admin_resolve_report(uuid, uuid, text) to authenticated;
