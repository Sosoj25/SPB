-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0056).
-- Safe to re-run: every step is idempotent.
--
-- แชท: สถานะอ่านแล้ว + ออนไลน์/ออฟไลน์
--
-- 0041 มี conversation_members.last_read_at อยู่แล้ว แต่ถูกใช้ทางเดียวคือนับ
-- "ข้อความที่เรายังไม่ได้อ่าน" — ฝั่งตรงข้ามคือ "อีกฝ่ายอ่านของเราหรือยัง"
-- ไม่เคยถูกอ่านออกมาเลย ทั้งที่ข้อมูลมีครบอยู่แล้วในคอลัมน์เดียวกัน
--
-- ส่วนสถานะออนไลน์ไม่มีอะไรรองรับเลยสักอย่าง ไฟล์นี้เลือกเก็บเป็น
-- profiles.last_seen_at (heartbeat) แทนการใช้ Realtime Presence เพราะ presence
-- อยู่ได้เฉพาะตอนที่ทั้งสองฝ่ายเปิดหน้าแชทค้างไว้พร้อมกัน ตอบคำถาม "ออฟไลน์
-- มาแล้วกี่นาที" ไม่ได้ ซึ่งเป็นสิ่งที่โจทย์ต้องการจริง ๆ


-- ============================================================
-- 1. เวลาที่ใช้งานล่าสุด
-- ============================================================
-- ไม่ต้องเพิ่มลงรายการคอลัมน์ต้องห้ามใน protect_profile_privileged_columns
-- เพราะค่านี้ไม่มีผลกับสิทธิ์หรือเงินอะไรเลย — ผู้ใช้จะโกหกว่าตัวเองออนไลน์
-- อยู่ก็ไม่ได้อะไรขึ้นมา
alter table public.profiles
  add column if not exists last_seen_at timestamptz;

-- ตั้งใจไม่ทำ index บนคอลัมน์นี้: ไม่มีคิวรีไหนเรียงหรือกรองด้วย last_seen_at
-- เลย — ทุกที่อ่านค่านี้ผ่าน join ด้วย profiles.id ที่มี PK อยู่แล้ว การใส่
-- index ไว้เฉย ๆ มีแต่ต้นทุนตอนเขียน ซึ่งคอลัมน์นี้ถูกเขียนทุกนาทีต่อผู้ใช้
-- ที่เปิดแอปอยู่หนึ่งคน


-- ============================================================
-- 2. public_profiles เปิดเผย last_seen_at
-- ============================================================
-- ต่อท้ายคอลัมน์สุดท้ายเท่านั้น — create or replace view เพิ่มคอลัมน์กลางลิสต์
-- ไม่ได้ และ community_profile_stats ที่ select pp.* ไว้ (0041) จะยังคืน
-- คอลัมน์ชุดเดิมของมันต่อไป ไม่พังตาม
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
  created_at,
  last_seen_at
from public.profiles
where is_active;

grant select on public.public_profiles to authenticated;


-- ============================================================
-- 3. heartbeat
-- ============================================================
-- หน้าเว็บเรียกทุก ~60 วินาทีระหว่างเปิดแอปอยู่ เขียนเฉพาะตอนที่ค่าเดิมเก่า
-- เกิน 30 วินาที เพื่อไม่ให้แท็บที่เปิดค้างหลายอันยิง UPDATE ทับกันรัว ๆ
create or replace function public.touch_presence()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me  uuid := (select auth.uid());
  v_now timestamptz := now();
begin
  if v_me is null then
    return null;
  end if;

  update public.profiles
  set last_seen_at = v_now
  where id = v_me
    and (last_seen_at is null or last_seen_at < v_now - interval '30 seconds');

  return v_now;
end;
$fn$;

revoke all on function public.touch_presence() from public, anon;
grant execute on function public.touch_presence() to authenticated;


-- ============================================================
-- 4. รายการห้องแชท — เพิ่มสถานะอ่านแล้วและเวลาออนไลน์ล่าสุด
-- ============================================================
-- peer_last_read_at = เวลาที่ "อีกฝ่ายที่ตามอ่านช้าที่สุด" อ่านถึง ใช้ min()
-- เพราะในห้องกลุ่มติ๊ก "อ่านแล้ว" ควรขึ้นก็ต่อเมื่อทุกคนอ่านครบ ไม่ใช่แค่
-- คนแรกที่บังเอิญเปิดห้อง
--
-- ต้อง drop ก่อนเพราะชุดคอลัมน์ที่คืนเปลี่ยนไป
drop function if exists public.list_my_conversations();

create function public.list_my_conversations()
returns table (
  id                 uuid,
  is_group           boolean,
  other_user_id      uuid,
  display_name       text,
  avatar_url         text,
  last_message       text,
  last_message_at    timestamptz,
  unread_count       int,
  last_sender_id     uuid,
  last_has_image     boolean,
  my_last_read_at    timestamptz,
  peer_last_read_at  timestamptz,
  other_last_seen_at timestamptz,
  member_count       int
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
    last_msg.content,
    mine.last_message_at,
    (select count(*) from public.messages msg
      where msg.conversation_id = mine.id
        and msg.sender_id <> (select auth.uid())
        and (mine.last_read_at is null or msg.created_at > mine.last_read_at))::int,
    last_msg.sender_id,
    last_msg.image_url is not null,
    mine.last_read_at,
    (select min(cm.last_read_at) from public.conversation_members cm
      where cm.conversation_id = mine.id
        and cm.user_id <> (select auth.uid())),
    p.last_seen_at,
    (select count(*) from public.conversation_members cm
      where cm.conversation_id = mine.id)::int
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
  left join lateral (
    select msg.content, msg.sender_id, msg.image_url
    from public.messages msg
    where msg.conversation_id = mine.id
    order by msg.created_at desc
    limit 1
  ) last_msg on true
  order by mine.last_message_at desc;
$$;

revoke all on function public.list_my_conversations() from public, anon;
grant execute on function public.list_my_conversations() to authenticated;


-- ============================================================
-- 5. สมาชิกในห้อง — เพิ่มอ่านถึงไหนและออนไลน์ล่าสุด
-- ============================================================
drop function if exists public.list_conversation_members(uuid);

create function public.list_conversation_members(p_conversation uuid)
returns table (
  user_id      uuid,
  name         text,
  avatar_url   text,
  last_read_at timestamptz,
  last_seen_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    coalesce(p.full_name, p.username, 'ผู้ใช้'),
    p.avatar_url,
    m.last_read_at,
    p.last_seen_at
  from public.conversation_members m
  join public.profiles p on p.id = m.user_id
  where m.conversation_id = p_conversation
    and public.is_conversation_member(p_conversation)
  order by m.joined_at;
$$;

revoke all on function public.list_conversation_members(uuid) from public, anon;
grant execute on function public.list_conversation_members(uuid) to authenticated;


-- ============================================================
-- 6. Realtime ของ conversation_members
-- ============================================================
-- ติ๊ก "อ่านแล้ว" ต้องขึ้นเองตอนอีกฝ่ายเปิดห้อง ไม่ใช่ตอนที่เราบังเอิญกด
-- รีเฟรช — mark_conversation_read() ยิง UPDATE บนตารางนี้อยู่แล้ว แค่ต้องพา
-- ตารางเข้า publication ให้ event หลุดออกมาถึงหน้าเว็บได้
--
-- RLS ของ conversation_members (conversation_members_read) ยังกั้นตามเดิม
-- คนนอกห้องจึงไม่เห็น event ของห้องที่ตัวเองไม่ได้อยู่
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversation_members'
  ) then
    alter publication supabase_realtime add table public.conversation_members;
  end if;
end
$$;
