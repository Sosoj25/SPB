-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0092).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- แจ้งเตือน "รายการที่รอรีวิว"
-- ============================================================
-- cron complete-past-bookings (ทุกชั่วโมง นาทีที่ 7 ดู 0013) เลื่อนการจองที่
-- เช็คอินแล้วและเลยเวลาเล่นไปเป็น awaiting_review เงียบ ๆ (0076/0079) — ลูกค้า
-- ไม่มีทางรู้เลยว่าถึงคิวเขียนรีวิวแล้ว ต้องบังเอิญเปิดใบเสร็จเองถึงจะเจอ
-- ป๊อปอัปรีวิวที่ BookingReceipt.jsx เด้งให้
--
-- ที่ทำที่นี่:
--   1. complete_past_bookings() เขียนแถว notifications type 'review_pending'
--      ให้ทุกการจองที่เพิ่งเข้า awaiting_review ในรอบนั้น (no_show ไม่ต้อง —
--      รีวิวไม่ได้อยู่แล้ว ดู submit_review ใน 0076)
--   2. submit_review() ปิดแจ้งเตือนใบนั้นให้เองตอนรีวิวสำเร็จ — คนที่เข้าไป
--      รีวิวจากหน้าใบเสร็จตรง ๆ ไม่ได้กดผ่านกระดิ่ง แถวนั้นจะค้างเป็น unread
--      ตลอดไปถ้าไม่ mark ให้ (mark read ไม่ลบทิ้งแบบ 0067 เพราะยังอยากให้กด
--      ย้อนดูใบเสร็จได้เหมือนแจ้งเตือนอนุมัติ/ปฏิเสธการชำระเงิน)
--   3. เติมย้อนหลังให้การจองที่ค้างสถานะ awaiting_review อยู่แล้ว ณ ตอน apply
--
-- reference_type = 'booking' เหมือน 0037 — notificationLink() ฝั่งหน้าเว็บพาไป
-- /booking/receipt?booking=<id> ซึ่งเด้งฟอร์มรีวิวให้เองอยู่แล้ว ไม่ต้องเพิ่ม
-- route ใหม่


-- ============================================================
-- 1. ปิดงานที่เลยเวลา + แจ้งเตือนรายการที่รอรีวิวในธุรกรรมเดียวกัน
-- ============================================================
-- ตัว update เหมือน 0079 ทุกอย่าง (รวม cast เป็น booking_status ทั้งสองขาของ
-- case ที่ 0079 แก้บั๊กไว้) เพิ่มแค่ CTE ที่ยิง insert ต่อจาก returning
--
-- get diagnostics ใช้กับ statement ที่มี CTE ไม่ได้ตามที่ตั้งใจ — row_count
-- จะกลายเป็นจำนวนแถวของ query นอกสุด ไม่ใช่จำนวนแถวที่ update จริง เลยนับจาก
-- moved เองผ่าน count(*) แทน ค่าที่คืนออกไปจึงยังหมายถึง "จำนวนการจองที่ปิดงาน
-- ในรอบนี้" (ทั้ง no_show และ awaiting_review) เท่าเดิม
--
-- CTE ที่เป็น data-modifying statement ถูกรันเสมอแม้ query นอกสุดไม่ได้อ่านผล
-- ของมัน (Postgres รับประกันไว้) notified จึงไม่ต้องถูก join เข้ามา

create or replace function public.complete_past_bookings()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_done integer;
begin
  perform set_config('app.booking_engine', 'on', true);

  with moved as (
    update public.bookings
    set status = case
      when checked_in_at is null then 'no_show'::public.booking_status
      else 'awaiting_review'::public.booking_status
    end
    where status = 'confirmed'
      and payment_status in ('paid', 'approved')
      and (booking_date + end_time) <= (now() at time zone 'Asia/Bangkok')
    returning id, user_id, facility_id, status
  ),
  notified as (
    insert into public.notifications (user_id, type, title, message, reference_type, reference_id)
    select
      m.user_id,
      'review_pending',
      'ให้คะแนนการใช้บริการ',
      coalesce(v.name || ' · ', '') || coalesce(f.name, 'สนามกีฬา')
        || ' เล่นจบแล้ว แตะเพื่อให้คะแนนและเขียนรีวิว',
      'booking',
      m.id::text
    from moved m
    left join public.facilities f on f.id = m.facility_id
    left join public.venues     v on v.id = f.venue_id
    where m.status = 'awaiting_review'
    returning 1
  )
  select count(*)::integer into v_done from moved;

  perform set_config('app.booking_engine', 'off', true);

  return v_done;
end;
$fn$;

revoke all on function public.complete_past_bookings() from public, anon, authenticated;


-- ============================================================
-- 2. รีวิวแล้ว = ปิดแจ้งเตือนใบนั้น
-- ============================================================
-- ยกมาจาก 0080 ทั้งดุ้น (เวอร์ชันที่โพสต์เข้าหมวด "รีวิว" ของชุมชนด้วย)
-- เพิ่มแค่ update notifications ท้ายสุด

create or replace function public.submit_review(
  p_booking_id uuid,
  p_rating     integer,
  p_comment    text default null
)
returns public.reviews
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user          uuid := auth.uid();
  v_booking       public.bookings;
  v_review        public.reviews;
  v_comment       text;
  v_facility_name text;
  v_venue_name    text;
  v_category_id   bigint;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนจึงจะเขียนรีวิวได้';
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'กรุณาให้คะแนน 1 ถึง 5 ดาว';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found or v_booking.user_id <> v_user then
    raise exception 'ไม่พบรายการจองนี้';
  end if;

  if v_booking.status = 'completed' then
    raise exception 'การจองนี้ถูกรีวิวไปแล้ว';
  end if;

  if v_booking.status = 'no_show' then
    raise exception 'ไม่สามารถรีวิวได้ เนื่องจากไม่ได้เข้าใช้บริการตามเวลาที่จอง';
  end if;

  if v_booking.status <> 'awaiting_review' then
    raise exception 'ยังไม่สามารถรีวิวการจองนี้ได้ ต้องรอให้ถึงเวลาเล่นก่อน';
  end if;

  v_comment := nullif(btrim(coalesce(p_comment, '')), '');

  insert into public.reviews (user_id, facility_id, booking_id, rating, comment)
  values (v_user, v_booking.facility_id, p_booking_id, p_rating, v_comment)
  returning * into v_review;

  perform set_config('app.booking_engine', 'on', true);

  update public.bookings
  set status = 'completed'
  where id = p_booking_id;

  perform set_config('app.booking_engine', 'off', true);

  select f.name, v.name
  into v_facility_name, v_venue_name
  from public.facilities f
  join public.venues v on v.id = f.venue_id
  where f.id = v_booking.facility_id;

  select id into v_category_id
  from public.community_categories
  where name = 'รีวิว';

  if v_category_id is not null then
    insert into public.community_posts (user_id, category_id, title, content, post_type)
    values (
      v_user,
      v_category_id,
      'รีวิว ' || coalesce(v_facility_name, 'สนาม'),
      repeat('★', p_rating) || repeat('☆', 5 - p_rating)
        || ' ' || coalesce(v_venue_name, '')
        || case when v_comment is not null then (E'\n' || v_comment) else '' end,
      'text'
    );
  end if;

  update public.notifications
  set is_read = true
  where user_id        = v_user
    and type           = 'review_pending'
    and reference_type = 'booking'
    and reference_id   = p_booking_id::text
    and not is_read;

  return v_review;
end;
$fn$;

revoke all on function public.submit_review(uuid, integer, text) from public, anon;
grant execute on function public.submit_review(uuid, integer, text) to authenticated;


-- ============================================================
-- 3. เติมย้อนหลังให้รายการที่ค้างรอรีวิวอยู่แล้ว
-- ============================================================
-- การจองที่ cron เลื่อนเป็น awaiting_review ไปก่อนหน้านี้ไม่เคยได้แจ้งเตือน —
-- ถ้าไม่เติมให้ เจ้าของจะไม่มีวันรู้เลยจนกว่าจะเปิดใบเสร็จเอง
-- not exists กันเขียนซ้ำเวลารันไฟล์นี้หลายรอบ

insert into public.notifications (user_id, type, title, message, reference_type, reference_id)
select
  b.user_id,
  'review_pending',
  'ให้คะแนนการใช้บริการ',
  coalesce(v.name || ' · ', '') || coalesce(f.name, 'สนามกีฬา')
    || ' เล่นจบแล้ว แตะเพื่อให้คะแนนและเขียนรีวิว',
  'booking',
  b.id::text
from public.bookings b
left join public.facilities f on f.id = b.facility_id
left join public.venues     v on v.id = f.venue_id
where b.status = 'awaiting_review'
  and not exists (
    select 1
    from public.notifications n
    where n.user_id        = b.user_id
      and n.type           = 'review_pending'
      and n.reference_type = 'booking'
      and n.reference_id   = b.id::text
  );
