-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0095).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ระบบ "ติดต่อเรา" — ลูกค้าส่งคำถาม/ปัญหาเข้ามา แอดมินตอบกลับในเธรดเดียวกัน
-- ============================================================
-- ก่อนหน้านี้ลูกค้าที่เจอปัญหานอกเหนือจากการจอง (จ่ายเงินไปแล้วระบบยังขึ้นค้าง
-- ชำระ แต้มหาย อยากเปลี่ยนเวลา ฯลฯ) ไม่มีช่องทางในเว็บเลย — หน้าใบเสร็จบอกให้
-- "ติดต่อเจ้าหน้าที่สนามโดยตรง" ซึ่งแปลว่าโทรศัพท์อย่างเดียว เรื่องที่เข้ามา
-- ทางโทรศัพท์ไม่เหลือร่องรอยให้แอดมินคนถัดไปรู้ว่าใครรับเรื่องไปแล้วบ้าง
--
-- ทั้งสองตารางเขียนผ่าน RPC security definer เท่านั้น (ไม่ grant insert/update
-- ให้ authenticated ตรง ๆ) เหมือน refund_requests (0034) เพราะสถานะของเรื่อง
-- ต้องขยับตามเหตุการณ์จริง — ลูกค้าตั้งสถานะเอง หรือปิดเรื่องของตัวเองไม่ได้


-- ============================================================
-- 1. ตาราง support_tickets
-- ============================================================
-- category เก็บเป็น text + check constraint ไม่ใช่ enum — หัวข้อติดต่อเป็น
-- ข้อความที่อยากแก้ตามหน้างาน (เพิ่ม "ปัญหาการเช็คอิน" ทีหลังได้) ส่วน enum
-- ต้อง ALTER TYPE ซึ่งใช้ค่าใหม่ในทรานแซกชันเดียวกันไม่ได้ (เหตุผลเดียวกับที่
-- 0034 เลือกไม่แตะ enum payment_status)
--
-- full_name / phone / email ถ่ายสำเนาจากฟอร์ม ณ ตอนส่ง ไม่ได้อ่านสดจาก
-- profiles ตอนแอดมินเปิดอ่าน — ลูกค้ากรอกเบอร์ที่ติดต่อได้จริงตอนนั้นได้
-- (อาจไม่ใช่เบอร์ในโปรไฟล์) และถ้าเขาแก้โปรไฟล์ทีหลัง เรื่องเก่าต้องยังเก็บ
-- ข้อมูลติดต่อชุดที่แอดมินใช้คุยกันจริงไว้
--
-- status: new = ยังไม่มีใครตอบ, pending = คุยกันอยู่ (มีฝ่ายใดฝ่ายหนึ่งตอบแล้ว
-- แต่ยังไม่ปิด), closed = แอดมินกดปิดเรื่อง

create table if not exists public.support_tickets (

    id uuid primary key default gen_random_uuid(),

    user_id uuid not null
        references public.profiles(id)
        on delete cascade,

    category text not null,

    full_name text not null,

    phone text,

    email text not null,

    message text not null,

    -- การจองที่เกี่ยวข้อง (ถ้าลูกค้าเลือกมา) — on delete set null เพราะเรื่อง
    -- ที่คุยกันไว้ต้องไม่หายไปพร้อมการจองที่ถูกลบ
    booking_id uuid
        references public.bookings(id)
        on delete set null,

    status text not null default 'new',

    first_replied_at timestamptz,

    last_reply_at timestamptz,

    closed_at timestamptz,

    closed_by uuid
        references public.profiles(id)
        on delete set null,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    constraint support_tickets_status_check
        check (status in ('new', 'pending', 'closed')),

    constraint support_tickets_category_check
        check (category in (
          'ปัญหาการจอง',
          'ปัญหาการชำระเงิน',
          'ปัญหาการคืนเงิน',
          'สอบถามทั่วไป',
          'ข้อเสนอแนะ',
          'อื่นๆ'
        )),

    constraint support_tickets_message_check
        check (char_length(btrim(message)) between 10 and 4000)

);

create index if not exists support_tickets_status_idx
  on public.support_tickets(status, created_at desc);

create index if not exists support_tickets_user_id_idx
  on public.support_tickets(user_id, created_at desc);

drop trigger if exists trg_support_tickets_updated_at on public.support_tickets;
create trigger trg_support_tickets_updated_at
before update on public.support_tickets
for each row
execute function public.set_updated_at();


-- ============================================================
-- 2. ตาราง support_ticket_replies
-- ============================================================
-- is_staff เก็บซ้ำแทนการดูจาก profiles.role ของคนตอบตอนแสดงผล เพราะสิทธิ์ของ
-- คนตอบเปลี่ยนได้ทีหลัง (แอดมินลาออกแล้วถูกลดเป็น customer) แต่ข้อความที่ตอบ
-- ไปแล้วต้องยังแสดงฝั่งเดิมในเธรดตลอดไป
--
-- author_id on delete set null — ผู้ใช้ถูกลบแล้วเธรดยังต้องอ่านรู้เรื่อง

create table if not exists public.support_ticket_replies (

    id uuid primary key default gen_random_uuid(),

    ticket_id uuid not null
        references public.support_tickets(id)
        on delete cascade,

    author_id uuid
        references public.profiles(id)
        on delete set null,

    is_staff boolean not null,

    body text not null,

    created_at timestamptz not null default now(),

    constraint support_ticket_replies_body_check
        check (char_length(btrim(body)) between 1 and 4000)

);

create index if not exists support_ticket_replies_ticket_idx
  on public.support_ticket_replies(ticket_id, created_at);


-- ============================================================
-- 3. RLS — อ่านได้เฉพาะเจ้าของเรื่องกับแอดมิน เขียนผ่าน RPC เท่านั้น
-- ============================================================

alter table public.support_tickets enable row level security;
alter table public.support_ticket_replies enable row level security;

drop policy if exists "support_tickets_select" on public.support_tickets;
create policy "support_tickets_select"
on public.support_tickets
for select
to authenticated
using ( user_id = (select auth.uid()) or public.is_admin() );

drop policy if exists "support_ticket_replies_select" on public.support_ticket_replies;
create policy "support_ticket_replies_select"
on public.support_ticket_replies
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.support_tickets t
    where t.id = support_ticket_replies.ticket_id
      and t.user_id = (select auth.uid())
  )
);

grant select on public.support_tickets to authenticated;
grant select on public.support_ticket_replies to authenticated;


-- ============================================================
-- 4. ลูกค้าส่งเรื่องใหม่
-- ============================================================
-- จำกัด 5 เรื่องต่อ 24 ชม. ต่อผู้ใช้ — ฟอร์มติดต่อเป็นช่องทางเดียวในเว็บที่
-- ผู้ใช้ทั่วไปเขียนข้อความเข้าคิวของแอดมินได้โดยตรง ถ้าไม่จำกัด คนเดียวกดรัว
-- ก็ดันเรื่องของคนอื่นตกหน้าแรกไปหมด

create or replace function public.submit_support_ticket(
  p_category   text,
  p_full_name  text,
  p_phone      text,
  p_email      text,
  p_message    text,
  p_booking_id uuid default null
)
returns public.support_tickets
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ticket    public.support_tickets;
  v_user_id   uuid := auth.uid();
  v_recent    integer;
  v_full_name text := btrim(coalesce(p_full_name, ''));
  v_email     text := btrim(lower(coalesce(p_email, '')));
  v_phone     text := nullif(btrim(coalesce(p_phone, '')), '');
  v_message   text := btrim(coalesce(p_message, ''));
begin
  if v_user_id is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนส่งข้อความถึงเรา';
  end if;

  if v_full_name = '' then
    raise exception 'กรุณากรอกชื่อ-นามสกุล';
  end if;

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'รูปแบบอีเมลไม่ถูกต้อง';
  end if;

  -- เบอร์โทรเป็นช่องไม่บังคับ แต่ถ้ากรอกมาต้องเป็นเบอร์ที่โทรกลับได้จริง
  -- (เทียบเฉพาะตัวเลข ผู้ใช้พิมพ์ขีดคั่นมาได้)
  if v_phone is not null and regexp_replace(v_phone, '[^0-9]', '', 'g') !~ '^0[0-9]{8,9}$' then
    raise exception 'รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง';
  end if;

  if char_length(v_message) < 10 then
    raise exception 'กรุณาอธิบายรายละเอียดอย่างน้อย 10 ตัวอักษร';
  end if;

  if char_length(v_message) > 4000 then
    raise exception 'ข้อความยาวเกินไป (ไม่เกิน 4,000 ตัวอักษร)';
  end if;

  if p_booking_id is not null and not exists (
    select 1 from public.bookings where id = p_booking_id and user_id = v_user_id
  ) then
    raise exception 'ไม่พบการจองนี้ในบัญชีของคุณ';
  end if;

  select count(*) into v_recent
  from public.support_tickets
  where user_id = v_user_id
    and created_at > now() - interval '24 hours';

  if v_recent >= 5 then
    raise exception 'ส่งเรื่องติดต่อครบ 5 เรื่องใน 24 ชั่วโมงแล้ว กรุณารอทีมงานตอบกลับก่อน';
  end if;

  insert into public.support_tickets (
    user_id, category, full_name, phone, email, message, booking_id
  )
  values (
    v_user_id, p_category, v_full_name, v_phone, v_email, v_message, p_booking_id
  )
  returning * into v_ticket;

  return v_ticket;
end;
$fn$;


-- ============================================================
-- 5. ลูกค้าตอบกลับในเธรดเดิม
-- ============================================================
-- เรื่องที่ปิดแล้วตอบต่อไม่ได้ ต้องส่งเรื่องใหม่ — ไม่งั้นเรื่องที่ปิดไปเมื่อ
-- สามเดือนก่อนจะเด้งกลับขึ้นคิวโดยที่บริบทเดิมไม่เหลือใครจำได้แล้ว

create or replace function public.reply_support_ticket(
  p_ticket_id uuid,
  p_body      text
)
returns public.support_ticket_replies
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ticket public.support_tickets;
  v_reply  public.support_ticket_replies;
  v_body   text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนตอบกลับ';
  end if;

  if v_body = '' then
    raise exception 'กรุณาพิมพ์ข้อความก่อนส่ง';
  end if;

  if char_length(v_body) > 4000 then
    raise exception 'ข้อความยาวเกินไป (ไม่เกิน 4,000 ตัวอักษร)';
  end if;

  select * into v_ticket
  from public.support_tickets
  where id = p_ticket_id
  for update;

  if not found or v_ticket.user_id <> auth.uid() then
    raise exception 'ไม่พบเรื่องติดต่อนี้ในบัญชีของคุณ';
  end if;

  if v_ticket.status = 'closed' then
    raise exception 'เรื่องนี้ปิดแล้ว กรุณาส่งเรื่องใหม่หากยังต้องการความช่วยเหลือ';
  end if;

  insert into public.support_ticket_replies (ticket_id, author_id, is_staff, body)
  values (p_ticket_id, auth.uid(), false, v_body)
  returning * into v_reply;

  update public.support_tickets
  set status        = 'pending',
      last_reply_at = now()
  where id = p_ticket_id;

  return v_reply;
end;
$fn$;


-- ============================================================
-- 6. แอดมินตอบกลับ
-- ============================================================
-- first_replied_at เขียนครั้งเดียวตอนตอบครั้งแรก (coalesce) เพราะเป็นฐานของ
-- ตัวเลข "เวลาตอบเฉลี่ย" ใน admin_support_ticket_stats() — ตอบรอบสองรอบสาม
-- ไม่ควรรีเซ็ตสถิติการตอบครั้งแรกของเรื่องนั้น

create or replace function public.admin_reply_support_ticket(
  p_ticket_id uuid,
  p_body      text
)
returns public.support_ticket_replies
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ticket public.support_tickets;
  v_reply  public.support_ticket_replies;
  v_body   text := btrim(coalesce(p_body, ''));
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  if v_body = '' then
    raise exception 'กรุณาพิมพ์ข้อความก่อนส่ง';
  end if;

  if char_length(v_body) > 4000 then
    raise exception 'ข้อความยาวเกินไป (ไม่เกิน 4,000 ตัวอักษร)';
  end if;

  select * into v_ticket
  from public.support_tickets
  where id = p_ticket_id
  for update;

  if not found then
    raise exception 'ไม่พบเรื่องติดต่อนี้';
  end if;

  insert into public.support_ticket_replies (ticket_id, author_id, is_staff, body)
  values (p_ticket_id, auth.uid(), true, v_body)
  returning * into v_reply;

  update public.support_tickets
  set status           = case when status = 'closed' then 'closed' else 'pending' end,
      first_replied_at = coalesce(first_replied_at, now()),
      last_reply_at    = now()
  where id = p_ticket_id;

  insert into public.notifications (user_id, type, title, message, reference_type, reference_id)
  values (
    v_ticket.user_id,
    'support_reply',
    'ทีมงานตอบกลับเรื่องที่คุณติดต่อมา',
    left(v_body, 180),
    'support_ticket',
    v_ticket.id::text
  );

  return v_reply;
end;
$fn$;


-- ============================================================
-- 7. แอดมินเปลี่ยนสถานะเรื่อง (ปิดงาน / เปิดใหม่)
-- ============================================================
-- รวมปิดกับเปิดใหม่ไว้ในฟังก์ชันเดียว เพราะเป็นการขยับสถานะแบบเดียวกัน ต่างกัน
-- แค่ปลายทาง — แจ้งเตือนลูกค้าเฉพาะตอน "ปิด" ซึ่งเป็นเหตุการณ์ที่เขาต้องรู้
-- (เรื่องจบแล้ว ตอบต่อในเธรดเดิมไม่ได้อีก) ส่วนการเปิดใหม่เป็นงานภายในของ
-- แอดมินที่กดปิดพลาด ไม่ต้องไปรบกวนลูกค้า

create or replace function public.admin_set_support_ticket_status(
  p_ticket_id uuid,
  p_status    text
)
returns public.support_tickets
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ticket public.support_tickets;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  if p_status not in ('new', 'pending', 'closed') then
    raise exception 'สถานะไม่ถูกต้อง';
  end if;

  select * into v_ticket
  from public.support_tickets
  where id = p_ticket_id
  for update;

  if not found then
    raise exception 'ไม่พบเรื่องติดต่อนี้';
  end if;

  if v_ticket.status = p_status then
    return v_ticket;
  end if;

  update public.support_tickets
  set status    = p_status,
      closed_at = case when p_status = 'closed' then now() else null end,
      closed_by = case when p_status = 'closed' then auth.uid() else null end
  where id = p_ticket_id
  returning * into v_ticket;

  if p_status = 'closed' then
    insert into public.notifications (user_id, type, title, message, reference_type, reference_id)
    values (
      v_ticket.user_id,
      'support_closed',
      'เรื่องที่คุณติดต่อมาถูกปิดแล้ว',
      format('เรื่อง "%s" ได้รับการดำเนินการเรียบร้อยแล้ว ขอบคุณที่แจ้งเข้ามา', v_ticket.category),
      'support_ticket',
      v_ticket.id::text
    );
  end if;

  return v_ticket;
end;
$fn$;


-- ============================================================
-- 8. ตัวเลขสรุปสำหรับหน้าแอดมิน
-- ============================================================
-- นับ "ตอบแล้ววันนี้" จากแถวตอบกลับของเจ้าหน้าที่ ไม่ใช่จาก first_replied_at
-- เพราะเรื่องที่คุยกันต่อเนื่องหลายวันก็ถือว่าแอดมินทำงานกับมันในวันนี้จริง
--
-- วันที่เทียบตามเวลาไทย ไม่ใช่ UTC (เหตุผลเดียวกับ 0070) — ไม่งั้นช่วง
-- 00:00-07:00 ตามเวลาไทยจะยังถูกนับเป็นเมื่อวาน
--
-- เวลาตอบเฉลี่ยดูย้อนหลัง 30 วัน เพราะเป็นตัวเลขที่ใช้ดูว่าตอนนี้ทีมตอบเร็วแค่ไหน
-- ถ้าเฉลี่ยตั้งแต่เปิดระบบ ค่าจะถูกถ่วงด้วยเรื่องเก่าจนแทบไม่ขยับตามงานจริงอีกเลย

create or replace function public.admin_support_ticket_stats()
returns table (
  total_count        integer,
  new_count          integer,
  pending_count      integer,
  closed_count       integer,
  replied_today      integer,
  avg_response_hours numeric
)
language sql
security definer
set search_path = public
stable
as $fn$
  select
    (select count(*)::integer from public.support_tickets),
    (select count(*)::integer from public.support_tickets where status = 'new'),
    (select count(*)::integer from public.support_tickets where status = 'pending'),
    (select count(*)::integer from public.support_tickets where status = 'closed'),
    (select count(distinct r.ticket_id)::integer
       from public.support_ticket_replies r
      where r.is_staff
        and (r.created_at at time zone 'Asia/Bangkok')::date
            = (now() at time zone 'Asia/Bangkok')::date),
    (select round(
              avg(extract(epoch from (t.first_replied_at - t.created_at)) / 3600.0)::numeric,
              1)
       from public.support_tickets t
      where t.first_replied_at is not null
        and t.created_at > now() - interval '30 days')
  where public.is_admin();
$fn$;


-- ============================================================
-- 9. Grants
-- ============================================================
-- ทุกฟังก์ชันเช็คสิทธิ์เองข้างใน (is_admin / auth.uid) จึง grant ให้
-- authenticated ได้ตามปกติ — pattern เดียวกับ 0037/0047
--
-- ถอน execute ของ public/anon ออกก่อน: ฟังก์ชันใหม่ทุกตัวได้สิทธิ์ execute
-- ของ PUBLIC ติดมาโดยอัตโนมัติ ทำให้ผู้ที่ยังไม่ล็อกอินยิง /rest/v1/rpc/... ได้
-- ถึงแม้จะโดนตีกลับที่บรรทัดแรกของฟังก์ชันก็ตาม (database linter 0028) — ไม่มี
-- เหตุผลให้ anon แตะฟังก์ชันชุดนี้เลย เพราะทั้งหมดต้องมีผู้ใช้ที่ล็อกอินอยู่

revoke execute on function public.submit_support_ticket(text, text, text, text, text, uuid) from public, anon;
revoke execute on function public.reply_support_ticket(uuid, text) from public, anon;
revoke execute on function public.admin_reply_support_ticket(uuid, text) from public, anon;
revoke execute on function public.admin_set_support_ticket_status(uuid, text) from public, anon;
revoke execute on function public.admin_support_ticket_stats() from public, anon;

grant execute on function public.submit_support_ticket(text, text, text, text, text, uuid) to authenticated;
grant execute on function public.reply_support_ticket(uuid, text) to authenticated;
grant execute on function public.admin_reply_support_ticket(uuid, text) to authenticated;
grant execute on function public.admin_set_support_ticket_status(uuid, text) to authenticated;
grant execute on function public.admin_support_ticket_stats() to authenticated;
