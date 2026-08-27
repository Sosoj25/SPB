-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0020).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- สรุปจากการตรวจสอบระบบทั้งหมดรอบที่สอง (2026-08-26)
-- ============================================================
-- รอบนี้เจอ 2 เรื่องที่กระทบผู้ใช้จริง (บัญชีที่ถูกระงับยังล็อกอินได้,
-- ช่วงเวลาจองกำลังจะหมด) กับอีกหลายเรื่องที่เป็นงานค้างของหน้า admin


-- ============================================================
-- 1. [แก้ด่วน] ปิดช่องที่บัญชีถูกระงับยังล็อกอินได้
-- ============================================================
-- get_email_by_username() (0004) เช็ค is_active อยู่ — และมันคือ "ที่เดียว
-- ในระบบ" ที่เช็ค แต่ login-with-username จะเรียกมันเฉพาะตอนที่ผู้ใช้กรอก
-- ชื่อผู้ใช้เท่านั้น ถ้ากรอกอีเมลมาตรง ๆ (มี '@') มันข้ามไปยิง
-- /auth/v1/token เลย ด่านเดียวที่มีจึงถูกข้ามไปทั้งดุ้น
--
--     บัญชีถูกกด "ระงับ" -> ล็อกอินด้วย username ไม่ผ่าน (ถูกต้อง)
--                        -> ล็อกอินด้วย email ผ่านฉลุย (ช่องโหว่)
--
-- แก้โดยรวมสองทางเข้าให้เหลือฟังก์ชันเดียวที่เช็ค is_active เสมอ ไม่ว่าจะ
-- ส่งอะไรเข้ามา — edge function จะไม่มีทาง "ลืม" เช็คได้อีก เพราะไม่มี
-- โค้ดพาธไหนที่ไม่ผ่านตรงนี้
--
-- ยังคง get_email_by_username ไว้ตามเดิม (ไม่ drop) เผื่อมีอะไรเรียกอยู่

create or replace function public.resolve_login_email(p_identifier text)
returns text
language sql
stable
security definer
set search_path = public
as $function$
  select u.email
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.is_active = true
    and (
      -- กรอกอีเมลมาตรง ๆ
      lower(u.email) = lower(btrim(p_identifier))
      -- หรือกรอกชื่อผู้ใช้
      or lower(p.username) = lower(btrim(p_identifier))
    )
  limit 1;
$function$;

revoke execute on function public.resolve_login_email(text) from public, anon, authenticated;
grant execute on function public.resolve_login_email(text) to service_role;


-- ============================================================
-- 2. [แก้ด่วน] ต่ออายุช่วงเวลาจองอัตโนมัติ
-- ============================================================
-- 0010 เขียนไว้เองว่า "พอเลย 60 วันแล้วจะไม่มีอะไรให้จองจนกว่าแอดมินจะกด
-- สร้างเพิ่ม" — ตอนนี้ slot ล่าสุดอยู่ที่ 2026-10-24 และ frontend เปิด
-- ปฏิทินกว้าง 62 วัน (BOOKING_WINDOW_DAYS) แปลว่านับจากวันนี้ปฏิทินจะโชว์
-- วันว่างเปล่าเพิ่มขึ้นทุกวัน แล้วจองไม่ได้เลยหลัง 24 ต.ค. โดยไม่มี error
-- อะไรฟ้อง — ไม่มีใครรู้จนกว่าลูกค้าจะบ่น
--
-- ทำให้เป็นงานอัตโนมัติแทน: ทุกคืนเติมช่วงเวลาให้ครบ p_days วันข้างหน้า
-- ตามรูปแบบเดียวกับที่ 0008/0010 seed ไว้ (ยาวตามเวลาเปิด-ปิดของ venue,
-- ช่วงละ 60 นาทีสำหรับคอร์ตเดี่ยว 120 นาทีสำหรับสนามทีม)
--
-- generate_facility_slots ข้ามช่วงที่ทับของเดิมให้อยู่แล้ว การรันซ้ำทุกคืน
-- จึงเติมเฉพาะวันใหม่ที่ยังไม่มี ไม่ไปทับของที่แอดมินแก้เป็นวัน ๆ ไว้

create or replace function public.ensure_future_slots(p_days integer default 70)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  r          record;
  v_total    integer := 0;
begin
  if p_days < 1 or p_days > 365 then
    raise exception 'จำนวนวันล่วงหน้าต้องอยู่ระหว่าง 1 ถึง 365';
  end if;

  for r in
    select
      f.id,
      v.opening_time,
      v.closing_time,
      case when s.name in ('แบดมินตัน', 'เทนนิส') then 60 else 120 end as slot_minutes
    from public.facilities f
    join public.venues v on v.id = f.venue_id
    join public.sports s on s.id = f.sport_id
    where f.status = 'available'
      and v.status = 'active'
  loop
    v_total := v_total + public.generate_facility_slots(
      r.id,
      current_date,
      current_date + p_days,
      r.opening_time,
      r.closing_time,
      r.slot_minutes
    );
  end loop;

  return v_total;
end;
$function$;

revoke execute on function public.ensure_future_slots(integer) from public, anon;
-- แอดมินกดเติมเองได้ทันทีโดยไม่ต้องรอ cron (เช่นหลังเพิ่มสนามใหม่)
grant execute on function public.ensure_future_slots(integer) to authenticated, service_role;


-- ตี 1 ตามเวลาไทย (18:00 UTC) — ช่วงที่ไม่มีใครจอง
-- unschedule ก่อนเพื่อให้รันซ้ำได้โดยไม่เกิด job ซ้อน
do $$
begin
  if exists (select 1 from cron.job where jobname = 'ensure-future-slots') then
    perform cron.unschedule('ensure-future-slots');
  end if;

  perform cron.schedule(
    'ensure-future-slots',
    '0 18 * * *',
    $cron$ select public.ensure_future_slots(70) $cron$
  );
end;
$$;

-- เติมให้ครบทันทีตั้งแต่ตอนรัน migration ไม่ต้องรอถึงตี 1
select public.ensure_future_slots(70);


-- ============================================================
-- 3. จำกัดขนาด/ชนิดไฟล์ของ bucket news และ amenities
-- ============================================================
-- bucket avatars (0001) ตั้ง 5 MB + 4 mime types ไว้ แต่ news (0018) และ
-- amenities (0020) สร้างด้วย insert into storage.buckets ธรรมดาจึงได้
-- file_size_limit = null / allowed_mime_types = null คือ "อะไรก็ได้"
--
-- หน้า admin เขียนบอกผู้ใช้ว่า "ไม่เกิน 5 MB" อยู่แล้วแต่ไม่เคยมีใครบังคับ
-- ทั้ง client และ server — ตรงนี้คือด่านที่ข้ามไม่ได้

update storage.buckets
set file_size_limit   = 5242880,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
where id in ('news', 'amenities');


-- ============================================================
-- 4. กัน booking_code ถูกแก้โดยเจ้าของแถว
-- ============================================================
-- bookings_update_own (0000) ให้เจ้าของ update แถวตัวเองได้ และ trigger
-- (0003) กัน status/payment_status/total_amount/สนาม/เวลาไว้ครบ — แต่ลืม
-- booking_code ซึ่งเป็นเลขอ้างอิงบนใบเสร็จและเป็น unique key ที่หน้างานใช้
-- เรียกดูการจอง เจ้าของแถวจึงแก้เลขบนใบเสร็จตัวเองได้

create or replace function public.protect_booking_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.role() = 'service_role'
     or public.is_admin()
     or coalesce(current_setting('app.booking_engine', true), '') = 'on'
  then
    return new;
  end if;

  if new.status is distinct from old.status then
    raise exception 'booking status cannot be modified directly';
  end if;

  if new.payment_status is distinct from old.payment_status then
    raise exception 'payment status cannot be modified directly';
  end if;

  if new.total_amount is distinct from old.total_amount then
    raise exception 'total_amount cannot be modified directly';
  end if;

  if new.booking_code is distinct from old.booking_code then
    raise exception 'booking code cannot be modified directly';
  end if;

  if new.facility_id  is distinct from old.facility_id
     or new.slot_id      is distinct from old.slot_id
     or new.booking_date is distinct from old.booking_date
     or new.start_time   is distinct from old.start_time
     or new.end_time     is distinct from old.end_time
  then
    raise exception 'สนามและช่วงเวลาของการจองแก้ไขเองไม่ได้ กรุณายกเลิกแล้วจองใหม่';
  end if;

  return new;
end;
$function$;

revoke execute on function public.protect_booking_privileged_columns() from public;
grant execute on function public.protect_booking_privileged_columns() to service_role;


-- ============================================================
-- 5. ตรวจสอบการชำระเงินฝั่งแอดมิน
-- ============================================================
-- ตาราง payments มี status / verified_by / verified_at / rejection_reason
-- รอไว้ตั้งแต่ 0000 และ RLS payments_admin_manage ก็เปิดให้แอดมิน update
-- ได้อยู่แล้ว — แต่ไม่เคยมีหน้าไหนเรียกใช้ หน้า /admin/payments ที่มีอยู่
-- เป็น mock ล้วน ไม่แตะ Supabase เลยสักบรรทัด
--
-- ทำเป็น RPC ไม่ใช่ปล่อยให้หน้าเว็บ update สองตารางเอง เพราะสถานะของ
-- payments กับ bookings ต้องขยับพร้อมกันเสมอ ถ้าแยกเป็นสองคำสั่งแล้วอันที่
-- สองพลาด จะเหลือการจองที่ payment อนุมัติแล้วแต่ยังขึ้นว่ารอชำระเงิน

create or replace function public.admin_approve_payment(p_payment_id uuid)
returns payments
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_payment public.payments;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'ไม่พบรายการชำระเงินนี้';
  end if;

  if v_payment.status = 'approved' then
    return v_payment;
  end if;

  if v_payment.status = 'rejected' then
    raise exception 'รายการนี้ถูกปฏิเสธไปแล้ว ไม่สามารถอนุมัติย้อนหลังได้';
  end if;

  update public.payments
  set status          = 'approved',
      verified_by     = auth.uid(),
      verified_at     = now(),
      rejection_reason = null
  where id = p_payment_id
  returning * into v_payment;

  update public.bookings
  set payment_status = 'approved',
      status         = case when status = 'pending' then 'confirmed' else status end
  where id = v_payment.booking_id;

  return v_payment;
end;
$function$;


create or replace function public.admin_reject_payment(
  p_payment_id uuid,
  p_reason     text default null
)
returns payments
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_payment public.payments;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'ไม่พบรายการชำระเงินนี้';
  end if;

  if v_payment.status = 'rejected' then
    return v_payment;
  end if;

  update public.payments
  set status           = 'rejected',
      verified_by      = auth.uid(),
      verified_at      = now(),
      rejection_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_payment_id
  returning * into v_payment;

  -- การจองกลับไปรอชำระเงินใหม่ ไม่ใช่ถูกยกเลิกทิ้ง — ลูกค้าอาจแนบสลิปผิด
  -- แล้วส่งใหม่ได้ ถ้าเลยเวลาไปจริง cron expire_unpaid_bookings จะเก็บกวาดเอง
  update public.bookings
  set payment_status = 'rejected',
      status         = case when status = 'confirmed' then 'pending' else status end
  where id = v_payment.booking_id;

  return v_payment;
end;
$function$;


revoke execute on function public.admin_approve_payment(uuid) from public, anon;
revoke execute on function public.admin_reject_payment(uuid, text) from public, anon;
grant execute on function public.admin_approve_payment(uuid) to authenticated, service_role;
grant execute on function public.admin_reject_payment(uuid, text) to authenticated, service_role;


-- สรุปตัวเลขหน้า /admin/payments
--
-- แยกเป็น RPC เพราะ payments_select_own ให้แอดมินเห็นทุกแถวก็จริง แต่การ
-- ให้หน้าเว็บดึงทุกแถวมาบวกเองฝั่ง client จะโตตามจำนวนรายการไม่มีเพดาน
-- (บั๊กแบบเดียวกับที่ fetchAdminNewsStats ทำอยู่ ดูข้อ 6)

create or replace function public.admin_payment_stats()
returns table (
  pending_count   integer,
  pending_amount  numeric,
  approved_today  integer,
  revenue_month   numeric,
  rejected_month  integer
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  return query
  select
    count(*) filter (where p.status in ('pending', 'paid'))::integer,
    coalesce(sum(p.amount) filter (where p.status in ('pending', 'paid')), 0),
    count(*) filter (
      where p.status = 'approved'
        and (p.verified_at at time zone 'Asia/Bangkok')::date = v_today
    )::integer,
    coalesce(sum(p.amount) filter (
      where p.status in ('paid', 'approved')
        and date_trunc('month', p.created_at at time zone 'Asia/Bangkok')
            = date_trunc('month', v_today::timestamp)
    ), 0),
    count(*) filter (
      where p.status = 'rejected'
        and date_trunc('month', p.created_at at time zone 'Asia/Bangkok')
            = date_trunc('month', v_today::timestamp)
    )::integer
  from public.payments p;
end;
$function$;

revoke execute on function public.admin_payment_stats() from public, anon;
grant execute on function public.admin_payment_stats() to authenticated, service_role;


-- ============================================================
-- 6. สรุปตัวเลขหน้า /admin/news
-- ============================================================
-- fetchAdminNewsStats เดิมยิง select view_count ของ "ทุกแถว" กลับมาบวกกัน
-- ฝั่ง client เพื่อให้ได้เลขเดียว — โตตามจำนวนข่าวไปเรื่อย ๆ ไม่มีเพดาน

create or replace function public.admin_news_stats()
returns table (
  published_count integer,
  draft_count     integer,
  scheduled_count integer,
  total_views     bigint
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  return query
  select
    count(*) filter (where n.status = 'published' and n.published_at <= now())::integer,
    count(*) filter (where n.status = 'draft')::integer,
    count(*) filter (where n.status = 'published' and n.published_at > now())::integer,
    coalesce(sum(n.view_count), 0)::bigint
  from public.news n;
end;
$function$;

revoke execute on function public.admin_news_stats() from public, anon;
grant execute on function public.admin_news_stats() to authenticated, service_role;


-- ============================================================
-- 7. เก็บกวาด trigger updated_at ที่ซ้ำกันบน profiles
-- ============================================================
-- มีสองตัวทำงานเดียวกันเป๊ะ: set_profiles_updated_at (0000) และ
-- trg_profiles_updated_at (0007) ทุก update จึงเรียก set_updated_at() สองรอบ
-- เก็บตัวที่ตั้งชื่อตรงกับตารางอื่น ๆ (trg_*) ไว้

drop trigger if exists set_profiles_updated_at on public.profiles;
