-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0093).
-- Safe to re-run: every step is idempotent.
--
-- แชท: เครื่องมือจัดการห้องที่ยังขาดไปทั้งชุด
--
-- ตั้งแต่ 0041 มาจนถึงตอนนี้ แชททำได้แค่ "เปิดห้อง / ส่ง / อ่าน" เท่านั้น —
-- ห้องที่ไม่อยากได้ยินก็ปิดเสียงไม่ได้ คนที่ไม่อยากคุยด้วยก็กันไม่ได้ ข้อความ
-- ที่ส่งผิดก็ลบไม่ได้ ห้องที่ไม่อยากเห็นแล้วก็ซ่อนไม่ได้ ไฟล์นี้เติมหกอย่าง:
--
--   1) ปิดการแจ้งเตือนรายห้อง (ชั่วคราวหรือถาวร)
--   2) บล็อกผู้ใช้ — กันข้อความสองทาง ไม่ใช่แค่ซ่อนจากตา
--   3) ปักหมุดห้องไว้บนสุด
--   4) ทำเครื่องหมายว่ายังไม่อ่าน
--   5) ลบแชท (ล้างประวัติเฉพาะฝั่งตัวเอง) — cleared_at
--   6) ลบข้อความที่ตัวเองส่ง — deleted_at
--
-- ทุกการเขียนยังผ่าน RPC security definer ที่ล็อก auth.uid() ไว้ข้างในเหมือนเดิม
-- เพราะ conversations/conversation_members ตั้งใจไม่มี policy insert/update/delete
-- ให้ผู้ใช้ยิงตรง (ดูเหตุผลเต็มในหัวข้อ 10 ของ 0041)


-- ============================================================
-- 1. คอลัมน์ใหม่บน conversation_members
-- ============================================================
-- ทั้งสามค่าเป็น "การตั้งค่าของสมาชิกคนนั้นต่อห้องนั้น" จึงอยู่บนแถวสมาชิก
-- ไม่ใช่บน conversations — ปิดเสียงห้องกลุ่มของเราต้องไม่ไปปิดของคนอื่นด้วย
--
-- muted_until เก็บเป็นเวลาหมดอายุ ไม่ใช่ boolean เพราะ "ปิด 8 ชั่วโมง" ต้อง
-- กลับมาดังเองโดยไม่ต้องมี cron มาตามเคลียร์ทีหลัง ส่วนการปิดถาวรใช้ค่า
-- 'infinity' ซึ่ง timestamptz รองรับอยู่แล้ว เทียบกับ now() ได้ตรง ๆ
--
-- cleared_at = "ลบแชท" ฝั่งเรา ข้อความก่อนเวลานี้ถูกซ่อนจากสายตาเราอย่างเดียว
-- ไม่ได้ลบของจริง อีกฝ่ายยังเห็นบทสนทนาเดิมครบ (แบบเดียวกับ Messenger)
alter table public.conversation_members
  add column if not exists muted_until timestamptz,
  add column if not exists is_pinned   boolean not null default false,
  add column if not exists cleared_at  timestamptz;


-- ============================================================
-- 2. ตารางบล็อกผู้ใช้
-- ============================================================
create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);

-- ถามบ่อยพอ ๆ กับทางกลับ ("ใครบล็อกเราไว้บ้าง") ซึ่ง PK ช่วยไม่ได้เพราะ
-- blocked_id เป็นคอลัมน์ที่สอง
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;

-- อ่านได้เฉพาะรายการที่ตัวเองเป็นคนบล็อก — ตั้งใจไม่เปิดให้ query ว่า "ใคร
-- บล็อกฉันไว้" เพราะการบล็อกที่ประกาศตัวเองเท่ากับเชิญให้ไปสร้างบัญชีใหม่
-- มาตามต่อ ฝั่งหน้าเว็บจึงบอกได้แค่ "ส่งข้อความไม่ได้ในตอนนี้"
--
-- ไม่มี policy insert/update/delete — ผ่าน block_user()/unblock_user() เท่านั้น
-- เพราะการบล็อกมีผลข้างเคียง (เลิกติดตามสองทาง) ที่ต้องเกิดพร้อมกันเสมอ
drop policy if exists user_blocks_read_own on public.user_blocks;
create policy user_blocks_read_own on public.user_blocks
for select to authenticated
using ( blocker_id = (select auth.uid()) );


-- ============================================================
-- 3. ตัวช่วยเช็คการบล็อก
-- ============================================================
-- security definer เพราะต้องอ่านแถวที่ "อีกฝ่ายเป็นคนบล็อก" ซึ่ง
-- user_blocks_read_own ปิดไว้ — ฟังก์ชันคืนแค่ boolean ไม่ได้คายว่าใครบล็อกใคร
create or replace function public.is_blocked_with(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = (select auth.uid()) and b.blocked_id = p_user)
       or (b.blocker_id = p_user and b.blocked_id = (select auth.uid()))
  );
$$;

revoke all on function public.is_blocked_with(uuid) from public, anon;
grant execute on function public.is_blocked_with(uuid) to authenticated;


-- ห้องคู่ที่มีการบล็อกคั่นอยู่ — ใช้กันการส่งข้อความ
--
-- เช็คเฉพาะห้องคู่โดยตั้งใจ: ในห้องกลุ่ม การที่สองคนบล็อกกันไม่ควรทำให้ทั้ง
-- กลุ่มคุยไม่ได้ (คนที่เหลือไม่เกี่ยว) — ฝั่งกลุ่มจัดการด้วยการไม่ส่งแจ้งเตือน
-- ให้คนที่บล็อกกันแทน ดูหัวข้อ 6
create or replace function public.conversation_has_block(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversations c
    join public.conversation_members a on a.conversation_id = c.id
    join public.conversation_members b on b.conversation_id = c.id and b.user_id <> a.user_id
    join public.user_blocks ub on ub.blocker_id = a.user_id and ub.blocked_id = b.user_id
    where c.id = p_conversation
      and not c.is_group
  );
$$;

revoke all on function public.conversation_has_block(uuid) from public, anon;
grant execute on function public.conversation_has_block(uuid) to authenticated;


-- ============================================================
-- 4. ข้อความ: ลบได้ และเคารพ "ลบแชท"
-- ============================================================
alter table public.messages
  add column if not exists deleted_at timestamptz;

-- constraint เดิมบังคับว่าต้องมีข้อความหรือรูปอย่างน้อยหนึ่งอย่าง (0041) ซึ่ง
-- ถูกต้องตอน insert แต่ทำให้ลบข้อความไม่ได้ เพราะการลบคือการล้างทั้งสองช่อง —
-- ผ่อนให้เฉพาะแถวที่ถูกทำเครื่องหมายว่าลบแล้ว
alter table public.messages drop constraint if exists messages_not_empty;
alter table public.messages
  add constraint messages_not_empty
  check (deleted_at is not null or coalesce(content, '') <> '' or image_url is not null);


-- ข้อความที่เรา "ลบแชท" ไปแล้วต้องหายจริงระดับ RLS ไม่ใช่แค่ฝั่งหน้าเว็บกรอง
-- ทิ้ง — ไม่งั้นเปิด DevTools ยิงคิวรีตรงก็ดึงกลับมาได้หมด
--
-- ยังเป็นฟังก์ชัน security definer เหมือน is_conversation_member ไม่ใช่
-- subquery ตรง ๆ ใน policy ด้วยเหตุผลเดียวกัน (กัน policy เรียกซ้อนตัวเอง)
create or replace function public.message_visible_to_me(p_conversation uuid, p_created_at timestamptz)
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
      and (m.cleared_at is null or p_created_at > m.cleared_at)
  );
$$;

revoke all on function public.message_visible_to_me(uuid, timestamptz) from public, anon;
grant execute on function public.message_visible_to_me(uuid, timestamptz) to authenticated;

drop policy if exists messages_member_read on public.messages;
create policy messages_member_read on public.messages
for select to authenticated
using ( public.message_visible_to_me(conversation_id, created_at) );

-- ส่งไม่ได้เมื่อมีการบล็อกคั่นอยู่ — ด่านที่สองต่อจาก trigger ข้างล่าง เผื่อ
-- ทางที่ยิง insert ตรงผ่าน REST
drop policy if exists messages_member_insert on public.messages;
create policy messages_member_insert on public.messages
for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and public.is_conversation_member(conversation_id)
  and not public.conversation_has_block(conversation_id)
);

-- RLS ที่ถูกปฏิเสธคืน error ภาษาอังกฤษของ Postgres ซึ่ง errorMessage() ฝั่ง
-- หน้าเว็บกลืนเป็นข้อความกลาง ("เกิดข้อผิดพลาด กรุณาลองใหม่") — ผู้ใช้จะไม่รู้
-- เลยว่าส่งไม่ได้เพราะอะไร trigger นี้ทำงานก่อน with check เสมอ จึงได้ข้อความ
-- ภาษาไทยที่อธิบายเหตุผลจริงแทน
create or replace function public.guard_blocked_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.conversation_has_block(new.conversation_id) then
    raise exception 'ส่งข้อความไม่ได้ เนื่องจากมีการบล็อกระหว่างคุณกับผู้ใช้นี้';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_blocked_message() from public, anon, authenticated;

drop trigger if exists guard_blocked_message on public.messages;
create trigger guard_blocked_message
before insert on public.messages
for each row execute function public.guard_blocked_message();


-- messages อยู่ใน publication ของ Realtime ตั้งแต่ 0041 แล้ว แต่ replica
-- identity เป็นค่าเริ่มต้น (แค่ primary key) ซึ่งพอสำหรับ INSERT อย่างเดียว —
-- การลบข้อความมาเป็น UPDATE ที่ต้องให้ Realtime ตรวจ RLS กับตัวแถวได้ครบ
-- ก่อนส่งต่อให้อีกฝ่าย ถ้าไม่ตั้ง full ฟองของคนที่ไม่ได้กดลบอาจค้างเป็นข้อความ
-- เดิมจนกว่าเขาจะรีโหลดหน้า
--
-- ต้นทุนคือ WAL ที่ใหญ่ขึ้นเฉพาะตอน UPDATE/DELETE ซึ่งตารางนี้แทบไม่มีเลย
-- (ข้อความถูกเขียนครั้งเดียวแล้วอยู่ยาว) ส่วน INSERT ไม่ได้รับผลกระทบ
alter table public.messages replica identity full;


-- ============================================================
-- 5. เปิดห้องคู่กับคนที่บล็อกกันอยู่ไม่ได้
-- ============================================================
-- ห้องเดิมที่มีอยู่แล้วยังคืนให้ตามปกติ (ประวัติไม่ควรหายไปเพราะการบล็อก)
-- แต่ไม่สร้างห้องใหม่ให้ — ไม่งั้นคนที่ถูกบล็อกยังเปิดห้องเปล่าไปโผล่ใน
-- กล่องข้อความของอีกฝ่ายได้อยู่ดี
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

  if public.is_blocked_with(p_other_user) then
    raise exception 'เริ่มการสนทนาไม่ได้ เนื่องจากมีการบล็อกระหว่างคุณกับผู้ใช้นี้';
  end if;

  insert into public.conversations (is_group, created_by)
  values (false, v_me)
  returning id into v_id;

  insert into public.conversation_members (conversation_id, user_id)
  values (v_id, v_me), (v_id, p_other_user);

  return v_id;
end;
$$;

revoke all on function public.start_direct_conversation(uuid) from public, anon;
grant execute on function public.start_direct_conversation(uuid) to authenticated;


-- ============================================================
-- 6. แจ้งเตือนข้อความใหม่ — ข้ามคนที่ปิดเสียงไว้และคนที่บล็อกกัน
-- ============================================================
-- ปิดเสียง = ไม่มีแถวแจ้งเตือนเกิดขึ้นเลย ไม่ใช่ insert แล้วค่อยซ่อนตอนแสดงผล
-- เพราะกระดิ่งกับป้ายตัวเลขอ่านจากตารางเดียวกันนี้ทั้งคู่ (0044/0065) ถ้าปล่อย
-- ให้แถวเกิดก่อนต้องไปไล่กรองทุกจุดที่อ่าน ซึ่งพลาดง่ายกว่ามาก
--
-- ป้าย "ยังไม่อ่าน" ในรายการห้องยังขึ้นตามปกติ — ปิดเสียงคือไม่อยากถูกเรียก
-- ไม่ใช่ไม่อยากรู้ว่ามีข้อความ
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
    and m.user_id <> new.sender_id
    and (m.muted_until is null or m.muted_until <= now())
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = m.user_id      and b.blocked_id = new.sender_id)
         or (b.blocker_id = new.sender_id  and b.blocked_id = m.user_id)
    );

  return new;
end;
$$;

revoke all on function public.notify_new_message() from public, anon, authenticated;


-- ============================================================
-- 7. RPC ตั้งค่าห้อง
-- ============================================================
-- ปิดแจ้งเตือน — p_minutes null หมายถึงปิดถาวรจนกว่าจะกดเปิดเอง
create or replace function public.mute_conversation(p_conversation uuid, p_minutes int default null)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := (select auth.uid());
  v_until timestamptz;
begin
  if v_me is null or not public.is_conversation_member(p_conversation) then
    raise exception 'คุณไม่ได้อยู่ในห้องสนทนานี้';
  end if;

  if p_minutes is null then
    v_until := 'infinity';
  elsif p_minutes <= 0 then
    raise exception 'ระยะเวลาปิดการแจ้งเตือนไม่ถูกต้อง';
  else
    v_until := now() + make_interval(mins => p_minutes);
  end if;

  update public.conversation_members
  set muted_until = v_until
  where conversation_id = p_conversation
    and user_id = v_me;

  return v_until;
end;
$$;

revoke all on function public.mute_conversation(uuid, int) from public, anon;
grant execute on function public.mute_conversation(uuid, int) to authenticated;


create or replace function public.unmute_conversation(p_conversation uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.conversation_members
  set muted_until = null
  where conversation_id = p_conversation
    and user_id = (select auth.uid());
$$;

revoke all on function public.unmute_conversation(uuid) from public, anon;
grant execute on function public.unmute_conversation(uuid) to authenticated;


-- ปักหมุด — ค่าบนแถวของตัวเองเท่านั้น ห้องเดียวกันคนอื่นไม่ต้องเห็นหมุดของเรา
create or replace function public.set_conversation_pinned(p_conversation uuid, p_pinned boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.conversation_members
  set is_pinned = coalesce(p_pinned, false)
  where conversation_id = p_conversation
    and user_id = (select auth.uid());
$$;

revoke all on function public.set_conversation_pinned(uuid, boolean) from public, anon;
grant execute on function public.set_conversation_pinned(uuid, boolean) to authenticated;


-- ลบแชท — ล้างประวัติฝั่งเราแล้วห้องหลุดจากรายการไปจนกว่าจะมีข้อความใหม่
--
-- มาร์กอ่านแล้วไปด้วยกันในตัว ไม่งั้นห้องที่เพิ่งลบทิ้งจะกลับมาพร้อมป้าย
-- ยังไม่อ่านค้างของเก่าตอนอีกฝ่ายทักมาครั้งถัดไป และเก็บกวาดแจ้งเตือนของห้อง
-- นั้นด้วยเหตุผลเดียวกับ mark_conversation_read (0067)
create or replace function public.clear_conversation(p_conversation uuid)
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

  update public.conversation_members
  set cleared_at   = now(),
      last_read_at = now(),
      is_pinned    = false
  where conversation_id = p_conversation
    and user_id = v_me;

  delete from public.notifications
  where user_id = v_me
    and reference_type = 'conversation'
    and reference_id = p_conversation::text;
end;
$$;

revoke all on function public.clear_conversation(uuid) from public, anon;
grant execute on function public.clear_conversation(uuid) to authenticated;


-- ทำเครื่องหมายว่ายังไม่อ่าน — ถอย last_read_at ไปอยู่ก่อนข้อความล่าสุดที่
-- อีกฝ่ายส่งมา ห้องจึงขึ้นป้าย "1" ไม่ใช่เด้งเป็นจำนวนข้อความทั้งห้องแบบที่
-- เกิดขึ้นถ้าตั้ง last_read_at = null
--
-- ถอยแค่ 1 ไมโครวินาที ซึ่งเป็นความละเอียดสูงสุดของ timestamptz — ถอยมากกว่านี้
-- (เช่น 1 มิลลิวินาที) จะกวาดข้อความที่ส่งไล่กันติด ๆ ในเสี้ยววินาทีเดียวกัน
-- เข้ามานับเป็นยังไม่อ่านด้วย ทั้งที่ตั้งใจให้ขึ้นแค่ใบเดียว
create or replace function public.mark_conversation_unread(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := (select auth.uid());
  v_last timestamptz;
begin
  if v_me is null or not public.is_conversation_member(p_conversation) then
    raise exception 'คุณไม่ได้อยู่ในห้องสนทนานี้';
  end if;

  select msg.created_at into v_last
  from public.messages msg
  join public.conversation_members m
    on m.conversation_id = msg.conversation_id and m.user_id = v_me
  where msg.conversation_id = p_conversation
    and msg.sender_id <> v_me
    and msg.deleted_at is null
    and (m.cleared_at is null or msg.created_at > m.cleared_at)
  order by msg.created_at desc
  limit 1;

  -- ไม่มีข้อความของอีกฝ่ายเลยก็ไม่มีอะไรให้ทำเป็นยังไม่อ่าน
  if v_last is null then
    return;
  end if;

  update public.conversation_members
  set last_read_at = v_last - interval '1 microsecond'
  where conversation_id = p_conversation
    and user_id = v_me;
end;
$$;

revoke all on function public.mark_conversation_unread(uuid) from public, anon;
grant execute on function public.mark_conversation_unread(uuid) to authenticated;


-- ลบข้อความของตัวเอง — ลบให้ทุกคนในห้อง (แบบ "unsend") ไม่ใช่ซ่อนฝั่งเดียว
--
-- เก็บแถวไว้แล้วล้างเนื้อหาแทนการ delete จริง เพื่อให้ฟองว่า "ข้อความถูกลบแล้ว"
-- ยังคาอยู่ในลำดับเวลาเดิม — ลบแถวทิ้งจะทำให้บทสนทนาของอีกฝ่ายขาดหายไปเฉย ๆ
-- โดยไม่มีร่องรอยว่าเคยมีอะไรอยู่ตรงนั้น
--
-- ไฟล์รูปใน bucket community ไม่ได้ถูกลบตาม — policy ของ bucket ให้เจ้าของ
-- โฟลเดอร์ลบเองได้อยู่แล้ว (0041) แต่ลบจากฝั่ง SQL ต้องใช้สิทธิ์ service role
-- ซึ่งไม่มีในบริบทของ RPC ที่ผู้ใช้เรียก
create or replace function public.delete_message(p_message uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  update public.messages
  set content    = null,
      image_url  = null,
      deleted_at = now()
  where id = p_message
    and sender_id = v_me
    and deleted_at is null;

  if not found then
    raise exception 'ลบข้อความนี้ไม่ได้ (ลบได้เฉพาะข้อความที่คุณส่งเองและยังไม่ถูกลบ)';
  end if;
end;
$$;

revoke all on function public.delete_message(uuid) from public, anon;
grant execute on function public.delete_message(uuid) to authenticated;


-- ============================================================
-- 8. RPC บล็อกผู้ใช้
-- ============================================================
-- บล็อกแล้วเลิกติดตามกันทั้งสองทางไปในตัว — ปล่อยให้ยังตามกันอยู่ทั้งที่คุย
-- กันไม่ได้แล้ว ทำให้โพสต์ของคนที่บล็อกยังไหลเข้าฟีดของอีกฝ่ายเหมือนเดิม
create or replace function public.block_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนจึงจะบล็อกผู้ใช้ได้';
  end if;

  if p_user is null or p_user = v_me then
    raise exception 'เลือกผู้ใช้ที่จะบล็อกไม่ถูกต้อง';
  end if;

  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'ไม่พบผู้ใช้นี้';
  end if;

  insert into public.user_blocks (blocker_id, blocked_id)
  values (v_me, p_user)
  on conflict (blocker_id, blocked_id) do nothing;

  delete from public.user_follows
  where (follower_id = v_me   and following_id = p_user)
     or (follower_id = p_user and following_id = v_me);
end;
$$;

revoke all on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;


create or replace function public.unblock_user(p_user uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.user_blocks
  where blocker_id = (select auth.uid())
    and blocked_id = p_user;
$$;

revoke all on function public.unblock_user(uuid) from public, anon;
grant execute on function public.unblock_user(uuid) to authenticated;


-- รายชื่อคนที่เราบล็อกไว้ พร้อมชื่อ/รูป — อ่าน profiles ของคนอื่นตรง ๆ ไม่ได้
-- (ดูหัวข้อ 3 ของ 0041) จึงต้องผ่าน RPC เหมือน list_conversation_members
create or replace function public.list_blocked_users()
returns table (user_id uuid, name text, avatar_url text, blocked_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, coalesce(p.full_name, p.username, 'ผู้ใช้'), p.avatar_url, b.created_at
  from public.user_blocks b
  join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = (select auth.uid())
  order by b.created_at desc;
$$;

revoke all on function public.list_blocked_users() from public, anon;
grant execute on function public.list_blocked_users() to authenticated;


-- ============================================================
-- 9. รายการห้องแชท — พาค่าใหม่ทั้งหมดออกไปในคิวรีเดียวเหมือนเดิม
-- ============================================================
-- ต้อง drop ก่อนเพราะชุดคอลัมน์ที่คืนเปลี่ยนไป (เหมือนที่ 0057 ทำ)
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
  member_count       int,
  muted_until        timestamptz,
  is_pinned          boolean,
  blocked_by_me      boolean,
  blocked_any        boolean,
  my_cleared_at      timestamptz,
  last_deleted       boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select
      c.id, c.is_group, c.title, c.last_message_at,
      m.last_read_at, m.muted_until, m.is_pinned, m.cleared_at
    from public.conversations c
    join public.conversation_members m on m.conversation_id = c.id
    where m.user_id = (select auth.uid())
      -- ห้องที่กด "ลบแชท" ไว้หายจากรายการจนกว่าจะมีข้อความใหม่เข้ามาจริง ๆ
      and (m.cleared_at is null or c.last_message_at > m.cleared_at)
  )
  select
    mine.id,
    mine.is_group,
    other.user_id,
    coalesce(mine.title, p.full_name, p.username, 'ผู้ใช้')::text,
    p.avatar_url,
    case when last_msg.deleted_at is null then last_msg.content end,
    mine.last_message_at,
    (select count(*) from public.messages msg
      where msg.conversation_id = mine.id
        and msg.sender_id <> (select auth.uid())
        and msg.deleted_at is null
        and (mine.cleared_at is null or msg.created_at > mine.cleared_at)
        and (mine.last_read_at is null or msg.created_at > mine.last_read_at))::int,
    last_msg.sender_id,
    last_msg.image_url is not null,
    mine.last_read_at,
    (select min(cm.last_read_at) from public.conversation_members cm
      where cm.conversation_id = mine.id
        and cm.user_id <> (select auth.uid())),
    p.last_seen_at,
    (select count(*) from public.conversation_members cm
      where cm.conversation_id = mine.id)::int,
    mine.muted_until,
    mine.is_pinned,
    -- เราบล็อกเขา = โชว์ปุ่มเลิกบล็อกได้ ส่วน blocked_any รวมทางที่เขาบล็อกเรา
    -- ด้วย ซึ่งหน้าเว็บบอกได้แค่ว่า "ส่งข้อความไม่ได้" ไม่ระบุว่าใครบล็อกใคร
    exists (select 1 from public.user_blocks b
             where b.blocker_id = (select auth.uid())
               and b.blocked_id = other.user_id),
    exists (select 1 from public.user_blocks b
             where (b.blocker_id = (select auth.uid()) and b.blocked_id = other.user_id)
                or (b.blocker_id = other.user_id and b.blocked_id = (select auth.uid()))),
    mine.cleared_at,
    last_msg.deleted_at is not null
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
    select msg.content, msg.sender_id, msg.image_url, msg.deleted_at
    from public.messages msg
    where msg.conversation_id = mine.id
      and (mine.cleared_at is null or msg.created_at > mine.cleared_at)
    order by msg.created_at desc
    limit 1
  ) last_msg on true
  -- ห้องที่ปักหมุดไว้อยู่บนสุดเสมอ ที่เหลือเรียงตามข้อความล่าสุดเหมือนเดิม
  order by mine.is_pinned desc, mine.last_message_at desc;
$$;

revoke all on function public.list_my_conversations() from public, anon;
grant execute on function public.list_my_conversations() to authenticated;
