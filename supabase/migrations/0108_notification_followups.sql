-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0107).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- เก็บตกระบบแจ้งเตือนสองฝั่ง: ปิดของแอดมินที่ปิดไม่ได้ + เตือนก่อนถึงคิวเล่น
-- ============================================================
-- 0107 ทำให้แจ้งเตือน "ที่ต้องลงมือทำ" ของลูกค้าปิดตัวเองเมื่องานเสร็จ ไฟล์นี้
-- ตามเก็บอีกสามเรื่องที่เหลือ:
--
-- 1) แจ้งเตือนคิวของแอดมินไม่มีวันปิด — 'content_reported' (0052) ส่งถึงแอดมิน
--    ทุกคน แต่พอคนใดคนหนึ่งจัดการรายงานนั้นแล้ว แถวของคนที่เหลือค้าง unread
--    ตลอดไป ตอนเขียนไฟล์นี้มีค้างอยู่ 3 ใบตั้งแต่ 4 ก.ย. ซึ่งชี้ไปยังใบรายงาน
--    ที่ถูกลบไปพร้อมโพสต์แล้วด้วยซ้ำ — กดเข้าไปก็ไม่เหลืออะไรให้ดู
--
-- 2) 'payment_pending_review' (0101) เป็นสรุป "มีสลิปค้างตรวจ" รายวัน พอแอดมิน
--    เคลียร์สลิปหมดแล้วก็ยังค้างอยู่เหมือนกัน
--
--    ทั้งสองเรื่องเป็น "คิวรวมที่ใครทำก็จบ" การปิดจึงต้องปิดให้ทุกคนพร้อมกัน
--    ไม่ใช่ให้แอดมินไล่กดปิดของตัวเองทีละใบทั้งที่งานจบไปแล้ว
--
-- 3) ลูกค้าไม่เคยได้รับการเตือนก่อนถึงเวลาเล่นเลย — ระบบมีแต่แจ้งตอนอนุมัติ
--    สลิป (ซึ่งอาจเป็นหลายอาทิตย์ก่อนวันเล่น) แล้วเงียบไปจนกลายเป็น no_show
--    ตอน cron ปิดงาน ทั้งที่เวลาสนามถูกล็อกและจ่ายเงินไปแล้ว


-- ============================================================
-- 1. จัดการรายงานในชุมชนแล้ว = ปิดแจ้งเตือนของแอดมินทุกคน
-- ============================================================
-- ครอบทั้งตอนแอดมินกดจัดการ (admin_resolve_report เปลี่ยน status เป็น
-- resolved/rejected) และตอนใบรายงานหายไปเอง (โพสต์ถูกลบ แล้ว cascade ลบรายงาน)
-- กรณีหลังต้องมี trigger บน delete แยกอีกตัว เพราะ notifications ไม่ได้ผูก FK
-- กับ community_reports (reference_id เป็น text) จึงไม่มี cascade มาถึงเอง

create or replace function public.close_content_report_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.notifications
  set is_read = true
  where type           = 'content_reported'
    and reference_type = 'community_report'
    and reference_id   = old.id::text
    and not is_read;

  return null;
end;
$fn$;

revoke all on function public.close_content_report_notifications() from public, anon, authenticated;

drop trigger if exists trg_close_content_report_notifications on public.community_reports;

create trigger trg_close_content_report_notifications
after update of status on public.community_reports
for each row
when (old.status = 'pending' and new.status is distinct from old.status)
execute function public.close_content_report_notifications();

drop trigger if exists trg_close_deleted_report_notifications on public.community_reports;

create trigger trg_close_deleted_report_notifications
after delete on public.community_reports
for each row
execute function public.close_content_report_notifications();


-- ============================================================
-- 2. เคลียร์สลิปค้างหมดแล้ว = ปิดสรุป "มีสลิปรอตรวจสอบค้างอยู่"
-- ============================================================
-- เงื่อนไขต้องตรงกับ notify_admins_stale_slips(24) ที่ cron เรียกอยู่ ไม่งั้นจะ
-- ปิดทั้งที่ยังมีของค้าง (หรือไม่ปิดทั้งที่เคลียร์หมดแล้ว)
--
-- ยิงตอนใบชำระเงินพ้นสถานะ pending ซึ่งคือจังหวะที่แอดมินเพิ่งกดอนุมัติ/ปฏิเสธ
-- ใบหนึ่งพอดี — ใบสุดท้ายของคิวจึงปิดแจ้งเตือนให้ทั้งทีมทันที ไม่ต้องรอ cron
-- รอบถัดไป

create or replace function public.close_stale_slip_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if exists (
    select 1
    from public.payments p
    join public.bookings b on b.id = p.booking_id
    where p.status     = 'pending'
      and p.gateway    = 'manual'
      and b.status     = 'pending'
      and p.created_at < now() - interval '24 hours'
  ) then
    return null;
  end if;

  update public.notifications
  set is_read = true
  where type = 'payment_pending_review'
    and not is_read;

  return null;
end;
$fn$;

revoke all on function public.close_stale_slip_notifications() from public, anon, authenticated;

drop trigger if exists trg_close_stale_slip_notifications on public.payments;

create trigger trg_close_stale_slip_notifications
after update of status on public.payments
for each row
when (old.status = 'pending' and new.status is distinct from old.status)
execute function public.close_stale_slip_notifications();


-- ============================================================
-- 3. เตือนลูกค้าก่อนถึงเวลาใช้สนาม
-- ============================================================
-- ส่งใบเดียวต่อการจองหนึ่งครั้ง ตอนเหลือเวลาไม่เกิน p_hours ชั่วโมง — การจอง
-- ที่จองกระชั้น (จองเย็นนี้ เล่นพรุ่งนี้เช้า) จึงได้เตือนในรอบ cron ถัดไปทันที
-- ส่วนที่จองล่วงหน้าเป็นเดือนก็ได้เตือนตอนใกล้ถึงคิวจริง ไม่ใช่ตอนจอง
--
-- not exists กันส่งซ้ำ — cron รันทุกชั่วโมง ช่วง 24 ชั่วโมงก่อนเล่นจึงเข้า
-- เงื่อนไขหลายรอบโดยตั้งใจ (รอบไหนพลาดไป รอบถัดไปตามเก็บให้) แต่ต้องได้ใบเดียว
--
-- เฉพาะที่จ่ายเงินแล้วและยังไม่เช็คอิน — ใบที่ยังไม่จ่ายมีแจ้งเตือน "รอชำระเงิน"
-- ของตัวเองอยู่แล้วที่กระดิ่ง (AppHeader สังเคราะห์สดจาก bookings)

create or replace function public.notify_upcoming_bookings(p_hours integer default 24)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_now  timestamp := (now() at time zone 'Asia/Bangkok');
  v_sent integer;
begin
  with sent as (
    insert into public.notifications
      (user_id, type, title, message, reference_type, reference_id)
    select
      b.user_id,
      'booking_reminder',
      'ใกล้ถึงเวลาใช้สนามแล้ว',
      format(
        '%s%s · %s เวลา %s-%s น. — แตะเพื่อดูใบเสร็จและรหัสเช็คอิน',
        coalesce(v.name || ' · ', ''),
        coalesce(f.name, 'สนามกีฬา'),
        to_char(b.booking_date, 'DD/MM/YYYY'),
        to_char(b.start_time, 'HH24:MI'),
        to_char(b.end_time, 'HH24:MI')
      ),
      'booking',
      b.id::text
    from public.bookings b
    left join public.facilities f on f.id = b.facility_id
    left join public.venues     v on v.id = f.venue_id
    where b.status         = 'confirmed'
      and b.payment_status in ('paid', 'approved')
      and b.checked_in_at is null
      and (b.booking_date + b.start_time) >  v_now
      and (b.booking_date + b.start_time) <= v_now + make_interval(hours => p_hours)
      and not exists (
        select 1
        from public.notifications n
        where n.user_id        = b.user_id
          and n.type           = 'booking_reminder'
          and n.reference_type = 'booking'
          and n.reference_id   = b.id::text
      )
    returning 1
  )
  select count(*)::integer into v_sent from sent;

  return v_sent;
end;
$fn$;

revoke all on function public.notify_upcoming_bookings(integer) from public, anon, authenticated;
grant execute on function public.notify_upcoming_bookings(integer) to service_role;

-- นาทีที่ 22 — เลี่ยงนาทีที่ 7 (complete-past-bookings) และ 17
-- (sweep-stale-slip-bookings) ไม่ให้ไปกองกันในนาทีเดียว
select cron.schedule(
  'notify-upcoming-bookings',
  '22 * * * *',
  $cron$ select public.notify_upcoming_bookings(24) $cron$
);


-- ============================================================
-- 4. เข้าสนามแล้ว (หรือการจองพ้นสถานะยืนยัน) = ปิดใบเตือน
-- ============================================================
-- ไม่งั้นใบเตือนจะค้างเป็น unread ข้ามวันหลังเล่นจบ — ตอนนั้น review_pending
-- (0093) เข้ามาแทนที่แล้ว การเตือนให้ "อย่าลืมมา" ของเมื่อวานไม่มีประโยชน์อีก

create or replace function public.close_booking_reminder_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.notifications
  set is_read = true
  where user_id        = new.user_id
    and type           = 'booking_reminder'
    and reference_type = 'booking'
    and reference_id   = new.id::text
    and not is_read;

  return null;
end;
$fn$;

revoke all on function public.close_booking_reminder_notifications() from public, anon, authenticated;

drop trigger if exists trg_close_booking_reminder_notifications on public.bookings;

create trigger trg_close_booking_reminder_notifications
after update of status, checked_in_at on public.bookings
for each row
when (
  (old.checked_in_at is null and new.checked_in_at is not null)
  or (old.status = 'confirmed' and new.status is distinct from old.status)
)
execute function public.close_booking_reminder_notifications();


-- ============================================================
-- 5. เก็บกวาดของค้างตอนนี้
-- ============================================================
-- 5.1 แจ้งเตือนรายงานที่ถูกจัดการไปแล้ว หรือที่ใบรายงานหายไปแล้ว

update public.notifications n
set is_read = true
where n.type           = 'content_reported'
  and n.reference_type = 'community_report'
  and not n.is_read
  and not exists (
    select 1
    from public.community_reports r
    where r.id::text = n.reference_id
      and r.status   = 'pending'
  );

-- 5.2 สรุปสลิปค้างที่เคลียร์หมดแล้ว

update public.notifications n
set is_read = true
where n.type = 'payment_pending_review'
  and not n.is_read
  and not exists (
    select 1
    from public.payments p
    join public.bookings b on b.id = p.booking_id
    where p.status     = 'pending'
      and p.gateway    = 'manual'
      and b.status     = 'pending'
      and p.created_at < now() - interval '24 hours'
  );
