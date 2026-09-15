-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0050).
-- Safe to re-run: every step is idempotent.
--
-- 0041 สร้างตารางแชทรองรับห้องกลุ่มไว้แล้ว (conversations.is_group / title)
-- แต่มี RPC เดียวคือ start_direct_conversation ซึ่งสร้างได้แต่ห้องคู่ ฝั่งกลุ่ม
-- จึงไม่มีทางสร้างห้อง เพิ่มสมาชิก หรือออกจากกลุ่มได้เลยสักทาง — เติมสามอย่าง
-- นี้ให้ครบ โดยเดินตามแพทเทิร์นเดิมทุกอย่าง (security definer + auth.uid()
-- ล็อกไว้ข้างใน เพราะ conversations/conversation_members ตั้งใจไม่มี policy
-- insert/update/delete ให้ผู้ใช้ยิงตรงเลย)


-- ============================================================
-- 1. สร้างห้องกลุ่ม
-- ============================================================
-- ต้องมีสมาชิกอย่างน้อย 3 คนรวมตัวเอง ไม่งั้นไม่ต่างอะไรจากห้องคู่ที่มี
-- start_direct_conversation อยู่แล้ว
create or replace function public.create_group_conversation(p_title text, p_member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      uuid := (select auth.uid());
  v_id      uuid;
  v_title   text := nullif(trim(p_title), '');
  v_members uuid[];
begin
  if v_me is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนจึงจะสร้างกลุ่มได้';
  end if;

  if v_title is null then
    raise exception 'กรุณาตั้งชื่อกลุ่ม';
  end if;

  -- ตัดตัวเองและบัญชีที่ไม่ active ทิ้ง เผื่อฝั่งเว็บส่งมาปนหรือส่งซ้ำ
  select array_agg(distinct pr.id) into v_members
  from unnest(p_member_ids) as m(id)
  join public.profiles pr on pr.id = m.id and pr.is_active
  where m.id <> v_me;

  if v_members is null or array_length(v_members, 1) < 2 then
    raise exception 'กลุ่มต้องมีสมาชิกอย่างน้อย 3 คน (รวมคุณ)';
  end if;

  insert into public.conversations (is_group, title, created_by)
  values (true, v_title, v_me)
  returning id into v_id;

  insert into public.conversation_members (conversation_id, user_id)
  select v_id, uid from (
    select v_me as uid
    union
    select unnest(v_members)
  ) as members;

  return v_id;
end;
$$;

revoke all on function public.create_group_conversation(text, uuid[]) from public;
grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;


-- ============================================================
-- 2. เพิ่มสมาชิกเข้ากลุ่มที่มีอยู่
-- ============================================================
-- เฉพาะคนที่อยู่ในห้องอยู่แล้วเชิญเพิ่มได้ และเชิญได้เฉพาะห้องกลุ่ม — ห้องคู่
-- ห้ามแตะเพราะจะกลายเป็นย้ายบทสนทนาส่วนตัวไปให้คนที่สามเห็นโดยไม่รู้ตัว
create or replace function public.add_conversation_members(p_conversation uuid, p_member_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or not public.is_conversation_member(p_conversation) then
    raise exception 'คุณไม่ได้อยู่ในห้องสนทนานี้';
  end if;

  if not exists (
    select 1 from public.conversations where id = p_conversation and is_group
  ) then
    raise exception 'เพิ่มสมาชิกได้เฉพาะห้องแชทกลุ่ม';
  end if;

  insert into public.conversation_members (conversation_id, user_id)
  select p_conversation, pr.id
  from unnest(p_member_ids) as m(id)
  join public.profiles pr on pr.id = m.id and pr.is_active
  where pr.id <> v_me
  on conflict (conversation_id, user_id) do nothing;
end;
$$;

revoke all on function public.add_conversation_members(uuid, uuid[]) from public;
grant execute on function public.add_conversation_members(uuid, uuid[]) to authenticated;


-- ============================================================
-- 3. ออกจากกลุ่ม
-- ============================================================
-- จำกัดเฉพาะห้องกลุ่ม — ห้องคู่ไม่มีปุ่มออกในหน้าเว็บอยู่แล้ว เพราะออกฝ่ายเดียว
-- จะเหลืออีกฝ่ายคุยอยู่คนเดียวในห้องที่ควรจะเป็นคู่สนทนาสองคนเสมอ
create or replace function public.leave_conversation(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if not exists (
    select 1 from public.conversations where id = p_conversation and is_group
  ) then
    raise exception 'ออกจากห้องสนทนาได้เฉพาะห้องกลุ่ม';
  end if;

  delete from public.conversation_members
  where conversation_id = p_conversation
    and user_id = v_me;
end;
$$;

revoke all on function public.leave_conversation(uuid) from public;
grant execute on function public.leave_conversation(uuid) to authenticated;


-- ============================================================
-- 4. รายชื่อสมาชิกในห้อง
-- ============================================================
-- ให้หน้าแชทโชว์ว่ากลุ่มนี้มีใครบ้างได้โดยไม่ต้องยิงสองคิวรีแล้ว join เอง
-- ฝั่งเว็บ (conversation_members อ่านชื่อ/รูปคนอื่นตรง ๆ จาก profiles ไม่ได้
-- เหมือนเดิม — ดูเหตุผลในหัวข้อ 3 ของ 0041)
create or replace function public.list_conversation_members(p_conversation uuid)
returns table (user_id uuid, name text, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, coalesce(p.full_name, p.username, 'ผู้ใช้'), p.avatar_url
  from public.conversation_members m
  join public.profiles p on p.id = m.user_id
  where m.conversation_id = p_conversation
    and public.is_conversation_member(p_conversation)
  order by m.joined_at;
$$;

revoke all on function public.list_conversation_members(uuid) from public;
grant execute on function public.list_conversation_members(uuid) to authenticated;
