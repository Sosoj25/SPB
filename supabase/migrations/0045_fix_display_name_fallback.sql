-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0044).
-- Safe to re-run: every step is idempotent.
--
-- แก้ชื่อผู้ใช้กลายเป็นค่าว่างในแจ้งเตือน/รายการแชท/คิวรายงาน
--
-- profiles.full_name ที่ยังไม่ได้กรอกเก็บเป็นสตริงว่าง '' ไม่ใช่ NULL (ฟอร์ม
-- สมัครส่ง '' มาตรง ๆ) — coalesce() มองว่า '' คือค่าที่ "มีอยู่" จึงคืน ''
-- ออกไปแทนที่จะตกไปใช้ username ผลคือแจ้งเตือนขึ้นว่า
--   " แสดงความคิดเห็น: ..."
-- และรายการแชทขึ้นห้องที่ไม่มีชื่อ
--
-- ฝั่งหน้าเว็บไม่โดนเพราะ JavaScript ใช้ || ซึ่งมองว่า '' เป็น falsy อยู่แล้ว
-- เลยไม่เห็นปัญหาตอนดูจากหน้าจอ
--
-- รวมตรรกะไว้ในฟังก์ชันเดียวเพื่อไม่ให้พลาดซ้ำในที่ที่ 4

create or replace function public.display_name(
  p_full     text,
  p_username text,
  p_fallback text default 'ผู้ใช้'
)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(btrim(coalesce(p_full, '')), ''),
    nullif(btrim(coalesce(p_username, '')), ''),
    p_fallback
  );
$$;

grant execute on function public.display_name(text, text, text) to authenticated, anon, service_role;


-- ------------------------------------------------------------
-- 1. แจ้งเตือน (0044)
-- ------------------------------------------------------------
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

  select public.display_name(full_name, username) into v_name
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

  select public.display_name(full_name, username) into v_name
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


create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select public.display_name(full_name, username) into v_name
  from public.profiles where id = new.sender_id;

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


-- ------------------------------------------------------------
-- 2. รายการห้องแชท (0041)
-- ------------------------------------------------------------
create or replace function public.list_my_conversations()
returns table (
  id              uuid,
  is_group        boolean,
  other_user_id   uuid,
  display_name    text,
  avatar_url      text,
  last_message    text,
  last_message_at timestamptz,
  unread_count    int
)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select c.id, c.is_group, c.title, c.last_message_at, m.last_read_at
    from public.conversations c
    join public.conversation_members m on m.conversation_id = c.id
    where m.user_id = (select auth.uid())
  )
  select
    mine.id,
    mine.is_group,
    other.user_id,
    coalesce(
      nullif(btrim(coalesce(mine.title, '')), ''),
      public.display_name(p.full_name, p.username)
    ),
    p.avatar_url,
    (select msg.content from public.messages msg
      where msg.conversation_id = mine.id
      order by msg.created_at desc
      limit 1),
    mine.last_message_at,
    (select count(*) from public.messages msg
      where msg.conversation_id = mine.id
        and msg.sender_id <> (select auth.uid())
        and (mine.last_read_at is null or msg.created_at > mine.last_read_at))::int
  from mine
  left join lateral (
    select cm.user_id
    from public.conversation_members cm
    where cm.conversation_id = mine.id
      and cm.user_id <> (select auth.uid())
    order by cm.joined_at
    limit 1
  ) other on not mine.is_group
  left join public.profiles p on p.id = other.user_id
  order by mine.last_message_at desc;
$$;

revoke all on function public.list_my_conversations() from public, anon;
grant execute on function public.list_my_conversations() to authenticated;


-- ------------------------------------------------------------
-- 3. คิวรายงานฝั่งแอดมิน (0043)
-- ------------------------------------------------------------
-- ต้อง drop ก่อน: display_name() คืน text ส่วนคอลัมน์เดิมเป็น varchar ที่ได้
-- มาจาก profiles.full_name โดยตรง — create or replace เปลี่ยนชนิดคอลัมน์ไม่ได้
drop view if exists public.admin_community_reports;

create view public.admin_community_reports
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
  public.display_name(pa.full_name, pa.username, 'ผู้ใช้ไม่ระบุตัวตน') as target_author,
  p.status as post_status
from (
  select
    r.post_id,
    r.comment_id,
    count(*)::int                      as report_count,
    array_agg(distinct r.reason::text) as reasons,
    max(r.created_at)                  as last_reported_at
  from public.community_reports r
  where r.status = 'pending'
  group by r.post_id, r.comment_id
) g
left join public.community_posts p    on p.id = g.post_id
left join public.community_comments c on c.id = g.comment_id
left join public.profiles pa          on pa.id = coalesce(p.user_id, c.user_id);

grant select on public.admin_community_reports to authenticated;
