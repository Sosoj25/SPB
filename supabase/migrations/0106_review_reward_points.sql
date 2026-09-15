-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0105).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- รีวิวแล้วได้แต้ม + แอดมินตั้งจำนวนแต้มของการรีวิวเองได้
-- ============================================================
-- สองเรื่องอยู่ในไฟล์เดียวกันเพราะอยู่ในฟังก์ชันเดียวกัน:
--
-- 1) แต้มโบนัสจากการเขียนรีวิว (ของใหม่) — จำนวนคงที่ต่อหนึ่งรีวิว อ่านจาก
--    reward_settings.review_points ที่แอดมินแก้ได้จากหน้าจัดการรางวัล เหมือน
--    baht_per_point (0049) ไม่ใช่เลขฝังในโค้ดที่แก้ทีต้องเขียน migration ใหม่
--
-- 2) แต้มจากยอดที่จ่ายจริงกลับมาทำงานอีกครั้ง (ของเดิมที่พังเงียบ) — 0049 แจก
--    แต้มก้อนนี้ไว้ใน complete_past_bookings() ตอนดันบุ๊กกิ้งเป็น 'completed'
--    แต่ 0074 เขียนฟังก์ชันนั้นทับให้หยุดที่ 'awaiting_review' แทน โดยไม่ได้ยก
--    ส่วนแจกแต้มตามมาด้วย ตั้งแต่วันที่ apply 0074 จึงไม่มีใครได้แต้มจากการ
--    ใช้บริการอีกเลย (point_transactions แถว earned ล่าสุดคือ 2026-09-04)
--    ทั้งที่หน้า "วิธีสะสมแต้ม" ยังบอกลูกค้าว่าได้อยู่
--
-- ทางเดียวที่บุ๊กกิ้งจะถึง 'completed' ตอนนี้คือผ่าน submit_review() แต้มทั้ง
-- สองก้อนจึงมาจ่ายที่นี่พร้อมกัน = รีวิวเสร็จทีเดียวได้ทั้งแต้มการใช้บริการ
-- และแต้มโบนัสของรีวิว
--
-- แต้มพังต้องไม่ทำให้รีวิวพัง — ส่วนแจกแต้มอยู่ใน exception block แยกก้อน
-- (subtransaction) เหมือนที่ 0049 ทำกับ cron ปิดงานการจอง รีวิวและการเลื่อน
-- สถานะที่เขียนไปก่อนหน้าจึงไม่ถูก rollback ตามแต้มที่พลาด


-- ============================================================
-- 1. ตั้งค่าแต้มของการรีวิว (แอดมินแก้ได้)
-- ============================================================
-- อยู่แถวเดียวกับ baht_per_point / earning_enabled (0049) ไม่ตั้งตารางใหม่
--
-- แยก toggle ออกจากจำนวนแต้ม เพื่อให้ "ปิดชั่วคราว" ไม่ต้องทิ้งค่าที่ตั้งไว้
-- (ตั้ง 0 แล้วเปิดใหม่ทีหลังต้องมานั่งนึกว่าเดิมให้กี่แต้ม) — ชุดเดียวกับที่
-- earning_enabled ทำกับ baht_per_point อยู่แล้ว
--
-- เพดาน 100000 กันพิมพ์ผิดแล้วแจกแต้มมหาศาล ส่วน 0 ปล่อยผ่านได้ (ต่างจาก
-- baht_per_point ที่ต่ำสุด 1 เพราะเป็นตัวหาร) = เปิดระบบไว้แต่ยังไม่ให้แต้ม

alter table public.reward_settings
  add column if not exists review_points integer not null default 20;

alter table public.reward_settings
  add column if not exists review_points_enabled boolean not null default true;

alter table public.reward_settings
  drop constraint if exists reward_settings_review_points_check;

alter table public.reward_settings
  add constraint reward_settings_review_points_check
  check (review_points between 0 and 100000);


-- ============================================================
-- 2. submit_review() แจกแต้มในทรานแซกชันเดียวกับรีวิว
-- ============================================================
-- ฐานมาจาก 0093 (บันทึกรีวิว + เลื่อนสถานะ + โพสต์ลงชุมชนหมวด "รีวิว" ของ 0080
-- + ปิดแจ้งเตือน review_pending ของใบนั้น) เพิ่มส่วนแต้มต่อท้าย —
-- ห้ามหยิบ 0080 มาเป็นฐาน เพราะจะทำให้ update notifications ของ 0093 หายไป
-- แล้วกระดิ่งจะค้างเป็นยังไม่อ่านตลอดไปหลังลูกค้ารีวิวเสร็จ
--
-- เปลี่ยน return type จาก public.reviews เป็น table เพื่อ
-- บอกหน้าเว็บได้ว่ารีวิวใบนี้ได้แต้มไปเท่าไร แยกเป็นก้อนไหนบ้าง — หน้าใบเสร็จ
-- ต้องขึ้นตัวเลขจริงที่แจกไป ไม่ใช่คำนวณเดาเองจากอัตราแล้วคลาดกับของจริงเมื่อ
-- แต้มพลาดหรือเคยแจกไปแล้ว
--
-- เปลี่ยน return type ต้อง drop ก่อน create (postgres ไม่ยอม replace ข้าม
-- signature ผลลัพธ์) grant จึงต้องให้ใหม่ท้ายไฟล์ด้วย
--
-- ชื่อ OUT param ตั้งไม่ให้ชนกับคอลัมน์ที่ query ข้างในอ่าน (review_points ของ
-- reward_settings, id/rating/comment ของ reviews) ไม่งั้น plpgsql ตีความเป็น
-- ตัวแปรแล้วพังด้วย "column reference is ambiguous"

drop function if exists public.submit_review(uuid, integer, text);

create function public.submit_review(
  p_booking_id uuid,
  p_rating     integer,
  p_comment    text default null
)
returns table (
  review_id         bigint,
  review_rating     integer,
  review_comment    text,
  review_created_at timestamptz,
  service_points    integer,
  bonus_points      integer,
  points_awarded    integer
)
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
  v_rate          integer;
  v_earning_on    boolean;
  v_bonus_rate    integer;
  v_bonus_on      boolean;
  v_service       integer := 0;
  v_bonus         integer := 0;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนจึงจะเขียนรีวิวได้';
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'กรุณาให้คะแนน 1 ถึง 5 ดาว';
  end if;

  select * into v_booking
  from public.bookings b
  where b.id = p_booking_id
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

  update public.bookings b
  set status = 'completed'
  where b.id = p_booking_id;

  perform set_config('app.booking_engine', 'off', true);

  select f.name, v.name
  into v_facility_name, v_venue_name
  from public.facilities f
  join public.venues v on v.id = f.venue_id
  where f.id = v_booking.facility_id;

  select c.id into v_category_id
  from public.community_categories c
  where c.name = 'รีวิว';

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

  -- ปิดแจ้งเตือน "ให้คะแนนการใช้บริการ" ของใบนี้ (ยกมาจาก 0093) — คนที่รีวิว
  -- จากหน้าใบเสร็จตรง ๆ ไม่ได้กดผ่านกระดิ่ง แถวนั้นจะค้างเป็นยังไม่อ่านตลอดไป
  update public.notifications n
  set is_read = true
  where n.user_id        = v_user
    and n.type           = 'review_pending'
    and n.reference_type = 'booking'
    and n.reference_id   = p_booking_id::text
    and not n.is_read;


  -- ---------- แต้มที่ได้จากการรีวิวครั้งนี้ ----------

  select s.baht_per_point, s.earning_enabled, s.review_points, s.review_points_enabled
  into v_rate, v_earning_on, v_bonus_rate, v_bonus_on
  from public.reward_settings s
  where s.id = 1;

  v_rate       := coalesce(v_rate, 10);
  v_earning_on := coalesce(v_earning_on, true);
  v_bonus_rate := greatest(coalesce(v_bonus_rate, 0), 0);
  v_bonus_on   := coalesce(v_bonus_on, true);

  -- ก้อนที่ 1: แต้มจากยอดที่จ่ายจริง (total_amount = หลังหักคูปองแล้ว) ปัดเศษลง
  if v_earning_on and v_rate > 0 then
    v_service := floor(coalesce(v_booking.total_amount, 0) / v_rate)::integer;
  end if;

  -- กันแจกซ้ำให้บุ๊กกิ้งใบเดิม เผื่อ complete_past_bookings() รุ่น 0049 เคย
  -- แจกก้อนนี้ไปแล้วก่อนวันที่ apply 0074
  if v_service > 0 and exists (
    select 1 from public.point_transactions t
    where t.user_id        = v_user
      and t.type           = 'earned'
      and t.reference_type = 'booking'
      and t.reference_id   = p_booking_id::text
  ) then
    v_service := 0;
  end if;

  -- ก้อนที่ 2: โบนัสของการเขียนรีวิว — หนึ่งการจองรีวิวได้ครั้งเดียวอยู่แล้ว
  -- (booking_id unique บน reviews + ต้องมาจากสถานะ awaiting_review) แต่เช็ค
  -- ซ้ำไว้ให้เข้าชุดกับก้อนแรก เผื่อวันหน้ามีทางแก้ไข/ส่งรีวิวใหม่
  if v_bonus_on then
    v_bonus := v_bonus_rate;
  end if;

  if v_bonus > 0 and exists (
    select 1 from public.point_transactions t
    where t.user_id        = v_user
      and t.type           = 'earned'
      and t.reference_type = 'review'
      and t.reference_id   = p_booking_id::text
  ) then
    v_bonus := 0;
  end if;

  if v_service > 0 then
    begin
      perform public.apply_point_change(
        v_user, v_service, 'earned', 'booking', p_booking_id::text,
        'แต้มสะสมจากการใช้บริการสนาม'
      );
    exception
      when others then
        -- ไม่ re-raise: รีวิวที่บันทึกไปแล้วต้องรอด แต้มก้อนนี้ถือว่าไม่ได้แจก
        raise warning 'แจกแต้มการใช้บริการให้การจอง % ไม่สำเร็จ: %', p_booking_id, sqlerrm;
        v_service := 0;
    end;
  end if;

  if v_bonus > 0 then
    begin
      perform public.apply_point_change(
        v_user, v_bonus, 'earned', 'review', p_booking_id::text,
        'แต้มโบนัสจากการเขียนรีวิว'
      );
    exception
      when others then
        raise warning 'แจกแต้มโบนัสรีวิวให้การจอง % ไม่สำเร็จ: %', p_booking_id, sqlerrm;
        v_bonus := 0;
    end;
  end if;

  -- แจ้งเตือนใบเดียวรวมทั้งสองก้อน — reference_type 'booking' พากลับไปหน้า
  -- ใบเสร็จของการจองนี้ (notificationLink ใน lib/notifications.js)
  if v_service + v_bonus > 0 then
    begin
      insert into public.notifications
        (user_id, type, title, message, reference_type, reference_id)
      values (
        v_user,
        'points_earned',
        format('ได้รับ %s แต้ม', to_char(v_service + v_bonus, 'FM999,999,990')),
        case
          when v_service > 0 and v_bonus > 0 then format(
            'ขอบคุณสำหรับรีวิว! คุณได้รับ %s แต้มจากการใช้บริการ และอีก %s แต้มโบนัสจากการเขียนรีวิว รวม %s แต้ม นำไปแลกของรางวัลได้เลย',
            to_char(v_service, 'FM999,999,990'),
            to_char(v_bonus, 'FM999,999,990'),
            to_char(v_service + v_bonus, 'FM999,999,990')
          )
          when v_bonus > 0 then format(
            'ขอบคุณสำหรับรีวิว! คุณได้รับ %s แต้มโบนัสจากการเขียนรีวิว นำไปแลกของรางวัลได้เลย',
            to_char(v_bonus, 'FM999,999,990')
          )
          else format(
            'ขอบคุณที่ใช้บริการ คุณได้รับ %s แต้มสะสมจากการจองนี้ นำไปแลกของรางวัลได้เลย',
            to_char(v_service, 'FM999,999,990')
          )
        end,
        'booking',
        p_booking_id::text
      );
    exception
      when others then
        raise warning 'สร้างแจ้งเตือนแต้มของการจอง % ไม่สำเร็จ: %', p_booking_id, sqlerrm;
    end;
  end if;

  return query
  select
    v_review.id,
    v_review.rating,
    v_review.comment,
    v_review.created_at,
    v_service,
    v_bonus,
    v_service + v_bonus;
end;
$fn$;

revoke all on function public.submit_review(uuid, integer, text) from public, anon;
grant execute on function public.submit_review(uuid, integer, text) to authenticated;


-- ============================================================
-- 3. แจ้งเตือน "รอรีวิว" บอกด้วยว่ารีวิวแล้วได้กี่แต้ม
-- ============================================================
-- ยกมาจาก 0093 ทั้งดุ้น (cron เลื่อนสถานะ + ยิงแจ้งเตือนใน CTE เดียวกัน)
-- เปลี่ยนแค่ข้อความ: ต่อท้ายด้วยจำนวนแต้มที่ตั้งไว้ตอนนั้น เพราะแจ้งเตือนใบนี้
-- คือจุดเดียวที่ลูกค้าส่วนใหญ่รู้ว่าถึงคิวรีวิวแล้ว — บอกไปเลยว่ามีแต้มรออยู่
-- ได้ผลกว่ารอให้เขาเปิดใบเสร็จเองแล้วค่อยเห็นป้ายแต้มในนั้น
--
-- อ่านค่าครั้งเดียวต่อรอบ cron ไม่ใช่ต่อการจอง — ทั้งรอบใช้ค่าเดียวกันอยู่แล้ว
-- และปิดแต้มรีวิวไว้ก็ไม่ต้องต่อท้ายอะไรเลย

create or replace function public.complete_past_bookings()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_done  integer;
  v_bonus integer;
begin
  select case when s.review_points_enabled then s.review_points else 0 end
  into v_bonus
  from public.reward_settings s
  where s.id = 1;

  v_bonus := greatest(coalesce(v_bonus, 0), 0);

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
        || ' เล่นจบแล้ว แตะเพื่อให้คะแนนและเขียนรีวิว'
        || case
             when v_bonus > 0
               then format(' รับ %s แต้ม', to_char(v_bonus, 'FM999,999,990'))
             else ''
           end,
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
