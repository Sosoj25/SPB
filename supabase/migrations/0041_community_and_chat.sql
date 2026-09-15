-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0040).
-- Safe to re-run: every step is idempotent.
--
-- ต่อหน้าชุมชนทั้ง 4 หน้า (ฟีด / โพสต์ / โปรไฟล์ / ข้อความ) เข้ากับของจริง
--
-- ตารางฝั่งชุมชนมีมาตั้งแต่ 0000 แล้ว (community_posts, community_comments,
-- post_likes, post_images, user_follows) พร้อม RLS ครบ — ที่ยังขาดคือ
--   1) ทางอ่านชื่อ/รูปของ "คนอื่น" (ดูหัวข้อ 3)
--   2) ยอดถูกใจ/คอมเมนต์ ที่ไม่ต้องยิงทีละโพสต์
--   3) ระบบแชท ซึ่งยังไม่มีตารางเลยสักตัว
--
-- migration นี้เพิ่มของใหม่อย่างเดียว ไม่แก้และไม่ลบตารางหรือ policy เดิม


-- ============================================================
-- 1. หมวดหมู่ที่แบบใน Figma มีแต่ DB ยังไม่มี
-- ============================================================
-- อีก 7 หมวดที่ seed มาตั้งแต่ 0000 ใช้ตามเดิม ไม่แตะ เพราะ community_posts
-- อ้าง category_id อยู่ ถ้าไปเปลี่ยนชื่อหรือลบทิ้งโพสต์เก่าจะชี้ผิดหมวดทันที
insert into public.community_categories (name, description)
values ('แนะนำสนาม', 'รีวิวและแนะนำสนามกีฬาที่เคยไปเล่น')
on conflict (name) do nothing;


-- ============================================================
-- 2. คอลัมน์โปรไฟล์ที่หน้าโปรไฟล์ชุมชนต้องใช้
-- ============================================================
-- ทั้ง 4 คอลัมน์ไม่อยู่ในรายการที่ protect_profile_privileged_columns() กันไว้
-- (role / points / is_active / username ดู 0003 + 0029) เจ้าของแถวจึงแก้เองได้
-- ผ่าน profiles_update_own ตามปกติ ไม่ต้องเพิ่ม policy ใหม่
alter table public.profiles
  add column if not exists sports         text[] not null default '{}',
  add column if not exists area           varchar(120),
  add column if not exists home_venue     varchar(160),
  add column if not exists available_time varchar(120);


-- ============================================================
-- 3. public_profiles — ชื่อกับรูปของ "คนอื่น" ที่ฟีดต้องใช้
-- ============================================================
-- profiles_select_own (0000) ให้อ่านได้เฉพาะแถวตัวเอง ซึ่งถูกต้องแล้ว เพราะ
-- แถวเดียวกันมี phone / points / role / is_active / is_student ติดอยู่ด้วย
-- แต่ฟีดชุมชนต้องโชว์ชื่อกับรูปโปรไฟล์ของคนอื่น ถ้าไปคลาย policy ให้อ่าน
-- profiles ได้ทั้งตารางเท่ากับแจกเบอร์โทรและแต้มสะสมของทุกคนไปด้วย
--
-- view นี้จึงตั้ง security_invoker = off โดยตั้งใจ (รันด้วยสิทธิ์เจ้าของ view
-- จึงข้าม RLS ของ profiles) แต่ฉายออกมาเฉพาะคอลัมน์ที่เปิดเผยได้ และตัดบัญชี
-- ที่ถูกระงับ (is_active = false) ออกไปเลย — Supabase advisor จะเตือนว่าเป็น
-- security definer view ซึ่งเป็นความตั้งใจ ไม่ใช่ของหลุด
create or replace view public.public_profiles
with (security_invoker = off) as
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
  created_at
from public.profiles
where is_active;

grant select on public.public_profiles to authenticated;


-- ============================================================
-- 4. community_feed_posts — ฟีดพร้อมยอดถูกใจ/คอมเมนต์ในคิวรีเดียว
-- ============================================================
-- ไม่มีคอลัมน์ like_count / comment_count ในตาราง (ตั้งใจ ไม่งั้นต้องมี trigger
-- คอยซิงก์แล้วเพี้ยนเมื่อลบแถว) แต่ถ้าให้หน้าเว็บนับเองจะกลายเป็นยิง query
-- ต่อโพสต์ละ 2 ครั้ง — รวมมาไว้ใน view ให้จบในคิวรีเดียว
--
-- security_invoker = on เพื่อให้ posts_public_read ยังทำงาน โพสต์ที่ถูกซ่อน
-- หรือลบจึงยังหายไปตามเดิม และเจ้าของยังเห็นโพสต์ที่ตัวเองซ่อนไว้
create or replace view public.community_feed_posts
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
-- join แบบ inner โดยตั้งใจ: โพสต์ของบัญชีที่ถูกระงับหายไปจากฟีดด้วยเลย
join public.public_profiles au on au.id = p.user_id
left join public.community_categories cc on cc.id = p.category_id;

grant select on public.community_feed_posts to authenticated;


-- ============================================================
-- 5. community_profile_stats — ตัวเลขบนหัวโปรไฟล์
-- ============================================================
create or replace view public.community_profile_stats
with (security_invoker = on) as
select
  pp.*,
  (select count(*) from public.community_posts p
    where p.user_id = pp.id
      and p.status = 'published')::int as post_count,
  (select count(*) from public.user_follows f
    where f.following_id = pp.id)::int as follower_count,
  (select count(*) from public.user_follows f
    where f.follower_id = pp.id)::int as following_count,
  -- แบบใน Figma มีช่อง "แมตช์ที่จัด" แต่ระบบไม่มีตารางแมตช์ให้นับ — ใช้จำนวน
  -- โพสต์ในหมวดหาคนแทน เป็นตัวเลขที่มีอยู่จริงและใกล้ความหมายที่สุด
  -- (หน้าเว็บจึงเรียกช่องนี้ว่า "โพสต์หาทีม" ไม่ได้เขียนว่าแมตช์)
  (select count(*) from public.community_posts p
     join public.community_categories c on c.id = p.category_id
    where p.user_id = pp.id
      and p.status = 'published'
      and c.name in ('หาเพื่อนเล่นกีฬา', 'หาคนร่วมทีม'))::int as team_post_count,
  exists (select 1 from public.user_follows f
    where f.following_id = pp.id
      and f.follower_id = (select auth.uid())) as is_following
from public.public_profiles pp;

grant select on public.community_profile_stats to authenticated;


-- ============================================================
-- 6. community_post_comments — คอมเมนต์พร้อมชื่อคนเขียน
-- ============================================================
-- ต้อง join ผ่าน public_profiles เหมือนฟีด เพราะ community_comments เก็บแค่
-- user_id ส่วนชื่อกับรูปอยู่ใน profiles ที่อ่านข้ามคนไม่ได้ (ดูหัวข้อ 3)
create or replace view public.community_post_comments
with (security_invoker = on) as
select
  c.id,
  c.post_id,
  c.user_id,
  c.parent_id,
  c.content,
  c.status,
  c.created_at,
  c.updated_at,
  au.username   as author_username,
  au.full_name  as author_full_name,
  au.avatar_url as author_avatar_url
from public.community_comments c
join public.public_profiles au on au.id = c.user_id;

grant select on public.community_post_comments to authenticated;


-- ============================================================
-- 7. index รองรับคิวรีที่ view ข้างบนยิง
-- ============================================================
-- post_likes / post_bookmarks มี post_id เป็นคอลัมน์แรกของ PK อยู่แล้วจึงข้าม
create index if not exists community_comments_post_idx
  on public.community_comments (post_id)
  where status = 'published';

create index if not exists community_posts_created_idx
  on public.community_posts (created_at desc);

create index if not exists community_posts_user_idx
  on public.community_posts (user_id);

create index if not exists user_follows_following_idx
  on public.user_follows (following_id);


-- ============================================================
-- 8. bucket รูปในโพสต์
-- ============================================================
-- ตั้ง limit และ mime ตั้งแต่ตอนสร้างเลย ไม่ซ้ำรอย news/amenities ที่สร้างแบบ
-- "อะไรก็ได้" แล้วต้องตามแก้ทีหลังใน 0021
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community', 'community', true, 5242880,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
set public             = true,
    file_size_limit    = 5242880,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

drop policy if exists "Community images are publicly accessible" on storage.objects;
create policy "Community images are publicly accessible"
on storage.objects for select
using ( bucket_id = 'community' );

-- ต่างจาก bucket news ที่ให้เฉพาะแอดมินอัปโหลด — ที่นี่ผู้ใช้ทั่วไปโพสต์รูปเอง
-- ได้ แต่ล็อกให้เขียนได้เฉพาะในโฟลเดอร์ที่ชื่อตรงกับ user id ของตัวเอง
drop policy if exists "Users upload own community images" on storage.objects;
create policy "Users upload own community images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'community'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users update own community images" on storage.objects;
create policy "Users update own community images"
on storage.objects for update
to authenticated
using (
  bucket_id = 'community'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users delete own community images" on storage.objects;
create policy "Users delete own community images"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'community'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.is_admin()
  )
);


-- ============================================================
-- 9. ตารางแชท
-- ============================================================
create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  is_group        boolean not null default false,
  title           varchar(120),
  created_by      uuid not null references public.profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz,
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id) on delete cascade,
  content         text,
  image_url       text,
  created_at      timestamptz not null default now(),
  -- กันข้อความว่างเปล่าที่ไม่มีทั้งข้อความและรูป
  constraint messages_not_empty
    check (coalesce(content, '') <> '' or image_url is not null)
);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at);

create index if not exists conversation_members_user_idx
  on public.conversation_members (user_id);

create index if not exists conversations_last_message_idx
  on public.conversations (last_message_at desc);


-- ============================================================
-- 10. RLS ของแชท
-- ============================================================
-- policy ของ conversation_members ต้องถามว่า "ผู้ใช้คนนี้อยู่ในห้องไหม" ซึ่ง
-- ต้องอ่าน conversation_members เอง — ถ้าเขียนเป็น subquery ตรง ๆ Postgres จะ
-- เรียก policy ซ้อนตัวเองจนขึ้น infinite recursion ทันทีที่ query แรกวิ่ง
-- ตัวช่วยนี้เป็น security definer จึงข้าม RLS ตอนเช็ค ตัดวงจรนั้นทิ้ง
create or replace function public.is_conversation_member(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_members m
    where m.conversation_id = p_conversation
      and m.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_conversation_member(uuid) from public;
grant execute on function public.is_conversation_member(uuid) to authenticated;

alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages             enable row level security;

drop policy if exists conversations_member_read on public.conversations;
create policy conversations_member_read on public.conversations
for select to authenticated
using ( public.is_conversation_member(id) );

drop policy if exists conversation_members_read on public.conversation_members;
create policy conversation_members_read on public.conversation_members
for select to authenticated
using ( public.is_conversation_member(conversation_id) );

drop policy if exists messages_member_read on public.messages;
create policy messages_member_read on public.messages
for select to authenticated
using ( public.is_conversation_member(conversation_id) );

drop policy if exists messages_member_insert on public.messages;
create policy messages_member_insert on public.messages
for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and public.is_conversation_member(conversation_id)
);

-- ตั้งใจไม่มี policy INSERT/UPDATE/DELETE ของ conversations กับ
-- conversation_members — การสร้างห้องและการอัปเดต last_read_at ผ่าน RPC
-- security definer ข้างล่างเท่านั้น ผู้ใช้จึงยัดตัวเองเข้าห้องคนอื่นไม่ได้
-- (ถ้าเปิด UPDATE ให้แก้แถวตัวเอง จะแก้ conversation_id ย้ายตัวเองเข้าห้อง
--  ที่ไม่ได้ถูกเชิญได้ทันที)


-- ============================================================
-- 11. RPC ของแชท
-- ============================================================
-- เปิดห้องคู่ — เจอห้องเดิมคืนห้องเดิม ไม่งั้นทุกครั้งที่กด "ส่งข้อความ"
-- จะได้ห้องใหม่ซ้อนกันไปเรื่อย ๆ จนรายการแชทเต็มไปด้วยห้องว่าง
create or replace function public.start_direct_conversation(p_other_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_id uuid;
begin
  if v_me is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนจึงจะส่งข้อความได้';
  end if;

  if p_other_user is null or p_other_user = v_me then
    raise exception 'เลือกผู้ใช้ที่จะสนทนาด้วยไม่ถูกต้อง';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_other_user and is_active
  ) then
    raise exception 'ไม่พบผู้ใช้นี้';
  end if;

  select c.id into v_id
  from public.conversations c
  where not c.is_group
    and exists (select 1 from public.conversation_members m
                 where m.conversation_id = c.id and m.user_id = v_me)
    and exists (select 1 from public.conversation_members m
                 where m.conversation_id = c.id and m.user_id = p_other_user)
    and (select count(*) from public.conversation_members m
          where m.conversation_id = c.id) = 2
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.conversations (is_group, created_by)
  values (false, v_me)
  returning id into v_id;

  insert into public.conversation_members (conversation_id, user_id)
  values (v_id, v_me), (v_id, p_other_user);

  return v_id;
end;
$$;

revoke all on function public.start_direct_conversation(uuid) from public;
grant execute on function public.start_direct_conversation(uuid) to authenticated;


-- รายการห้องแชทฝั่งซ้าย พร้อมข้อความล่าสุดกับจำนวนที่ยังไม่อ่าน
-- security definer แต่กรองด้วย auth.uid() ทุกชั้น จึงเห็นเฉพาะห้องของตัวเอง
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
    coalesce(mine.title, p.full_name, p.username, 'ผู้ใช้')::text,
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
  -- ห้องคู่เอาชื่อจากอีกฝ่าย ห้องกลุ่มใช้ title ของห้อง (other เป็น null)
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

revoke all on function public.list_my_conversations() from public;
grant execute on function public.list_my_conversations() to authenticated;


-- อ่านแล้ว — แตะได้เฉพาะแถวของตัวเองเพราะ where ล็อก auth.uid() ไว้
create or replace function public.mark_conversation_read(p_conversation uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.conversation_members
  set last_read_at = now()
  where conversation_id = p_conversation
    and user_id = (select auth.uid());
$$;

revoke all on function public.mark_conversation_read(uuid) from public;
grant execute on function public.mark_conversation_read(uuid) to authenticated;


-- ดันห้องขึ้นบนสุดของรายการเมื่อมีข้อความใหม่
create or replace function public.touch_conversation_last_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set last_message_at = new.created_at
  where id = new.conversation_id;

  return new;
end;
$$;

drop trigger if exists touch_conversation_last_message on public.messages;
create trigger touch_conversation_last_message
after insert on public.messages
for each row execute function public.touch_conversation_last_message();


-- ============================================================
-- 12. เปิด Realtime ให้ตาราง messages
-- ============================================================
-- postgres_changes เคารพ RLS ของ messages อยู่แล้ว คนนอกห้องจึงไม่ได้รับ
-- event ถึงจะ subscribe channel เดียวกัน
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end
$$;
