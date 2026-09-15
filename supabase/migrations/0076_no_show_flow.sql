-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0075).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- เลยเวลาเล่นไปแล้ว: เช็คอินแล้ว -> รอรีวิว, ไม่เช็คอิน -> ไม่ได้ไป
-- ============================================================
-- 0075 เพิ่มค่า enum 'no_show' ไว้แล้ว งานที่เหลือ:
--   1. complete_past_bookings() แยกทางตาม checked_in_at แทนที่จะส่งทุกแถวไป
--      awaiting_review เหมือนเดิม
--   2. submit_review() ตอบข้อความเฉพาะเมื่อพยายามรีวิวรายการ no_show — ข้อความ
--      เดิม ("ต้องรอให้ถึงเวลาเล่นก่อน") ใช้ไม่ได้กับเคสนี้เพราะเวลาผ่านไปแล้วจริง
--   3. จุดที่กรอง status in (..., 'awaiting_review', 'completed') เพื่อนับ
--      "การจองที่จ่ายเงินและเกิดขึ้นจริง" ต้องรวม no_show ด้วย — ไม่มาเล่นก็ยัง
--      เป็นการจอง+รายได้จริงที่เกิดขึ้น ไม่ใช่ถูกยกเลิก


-- ============================================================
-- 1. ปิดงานที่เลยเวลาไปแล้ว แยกตามว่าเช็คอินจริงหรือไม่
-- ============================================================

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

  update public.bookings
  set status = case when checked_in_at is null then 'no_show' else 'awaiting_review' end
  where status = 'confirmed'
    and payment_status in ('paid', 'approved')
    and (booking_date + end_time) <= (now() at time zone 'Asia/Bangkok');

  get diagnostics v_done = row_count;

  perform set_config('app.booking_engine', 'off', true);

  return v_done;
end;
$fn$;

revoke all on function public.complete_past_bookings() from public, anon, authenticated;


-- ============================================================
-- 2. รีวิวรายการ "ไม่ได้ไป" ไม่ได้ — ตอบข้อความให้ตรงเหตุผล
-- ============================================================

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
  v_user    uuid := auth.uid();
  v_booking public.bookings;
  v_review  public.reviews;
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

  insert into public.reviews (user_id, facility_id, booking_id, rating, comment)
  values (
    v_user,
    v_booking.facility_id,
    p_booking_id,
    p_rating,
    nullif(btrim(coalesce(p_comment, '')), '')
  )
  returning * into v_review;

  perform set_config('app.booking_engine', 'on', true);

  update public.bookings
  set status = 'completed'
  where id = p_booking_id;

  perform set_config('app.booking_engine', 'off', true);

  return v_review;
end;
$fn$;

revoke all on function public.submit_review(uuid, integer, text) from public, anon;
grant execute on function public.submit_review(uuid, integer, text) to authenticated;


-- ============================================================
-- 3. รวม no_show เข้ากับที่นับ confirmed/awaiting_review/completed เดิม
-- ============================================================
-- ไม่มาเล่นก็ยังเป็นการจอง+รายได้ที่เกิดขึ้นจริง ต่างจาก cancelled/rejected
-- ที่ไม่มีเงินเข้าจริง

create or replace function public.platform_stats()
returns table (
  venues              integer,
  facilities          integer,
  sports              integer,
  open_slots          integer,
  bookings_total      integer,
  bookings_this_month integer,
  reviews_count       integer,
  avg_rating          numeric
)
language sql
security definer
set search_path = public
stable
as $fn$
  select
    (select count(*) from public.venues where status = 'active')::integer,

    (select count(*)
     from public.facilities f
     join public.venues v on v.id = f.venue_id
     where f.status = 'available' and v.status = 'active')::integer,

    (select count(distinct f.sport_id)
     from public.facilities f
     join public.venues v on v.id = f.venue_id
     where f.status = 'available' and v.status = 'active')::integer,

    (select count(*)
     from public.facility_time_slots s
     join public.facilities f on f.id = s.facility_id
     where s.is_active
       and s.slot_date >= current_date
       and f.status = 'available')::integer,

    (select count(*) from public.bookings
     where status in ('confirmed', 'awaiting_review', 'no_show', 'completed'))::integer,

    (select count(*) from public.bookings
     where status in ('confirmed', 'awaiting_review', 'no_show', 'completed')
       and booking_date >= date_trunc('month', current_date)::date)::integer,

    (select count(*) from public.reviews where status = 'published')::integer,

    (select round(avg(rating), 1) from public.reviews where status = 'published');
$fn$;

revoke all on function public.platform_stats() from public;
grant execute on function public.platform_stats() to anon, authenticated;


create or replace function public.admin_overview_stats()
returns table (
  bookings_today   bigint,
  revenue_today    numeric,
  occupancy_rate   numeric,
  pending_payments bigint
)
language plpgsql
security definer
set search_path = public
stable
as $fn$
declare
  v_today        date := (now() at time zone 'Asia/Bangkok')::date;
  v_total_slots  bigint;
  v_booked_slots bigint;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  select count(*) into v_total_slots
  from public.facility_time_slots s
  join public.facilities f on f.id = s.facility_id
  where s.slot_date = v_today
    and s.is_active
    and f.status = 'available';

  select count(*) into v_booked_slots
  from public.bookings
  where booking_date = v_today
    and status in ('pending', 'confirmed', 'awaiting_review', 'no_show', 'completed');

  return query
  select
    v_booked_slots,

    (select coalesce(sum(amount), 0)
     from public.payments
     where status = 'approved'
       and (created_at at time zone 'Asia/Bangkok')::date = v_today),

    case when v_total_slots = 0 then 0
         else round(v_booked_slots::numeric / v_total_slots * 100, 0)
    end,

    (select count(*) from public.payments where status = 'pending');
end;
$fn$;

revoke all on function public.admin_overview_stats() from public, anon;
grant execute on function public.admin_overview_stats() to authenticated;


create or replace function public.superadmin_venue_breakdown()
returns table (
  venue_id            bigint,
  venue_name          text,
  bookings_this_month bigint,
  revenue_this_month  numeric,
  status              public.venue_status
)
language plpgsql
security definer
set search_path = public
stable
as $fn$
declare
  v_month_start date := date_trunc('month', (now() at time zone 'Asia/Bangkok'))::date;
begin
  if not public.is_super_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบสูงสุดเท่านั้น';
  end if;

  return query
  select
    v.id,
    v.name::text,

    count(b.id) filter (
      where b.status in ('confirmed', 'awaiting_review', 'no_show', 'completed')
        and date_trunc('month', b.booking_date) = v_month_start
    ),

    coalesce(sum(p.amount) filter (
      where p.status = 'approved'
        and date_trunc('month', p.created_at at time zone 'Asia/Bangkok') = v_month_start
    ), 0),

    v.status
  from public.venues v
  left join public.facilities f on f.venue_id = v.id
  left join public.bookings   b on b.facility_id = f.id
  left join public.payments   p on p.booking_id = b.id
  group by v.id, v.name, v.status
  order by v.name;
end;
$fn$;

revoke all on function public.superadmin_venue_breakdown() from public, anon;
grant execute on function public.superadmin_venue_breakdown() to authenticated;


create or replace function public.admin_today_checkins()
returns table (
  id             uuid,
  booking_code   varchar,
  start_time     time,
  end_time       time,
  customer_name  text,
  customer_phone varchar,
  sport_name     text,
  facility_name  text,
  venue_name     text,
  payment_status public.payment_status,
  status         public.booking_status,
  checked_in_at  timestamptz,
  checked_out_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $fn$
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  return query
  select
    b.id,
    b.booking_code,
    b.start_time,
    b.end_time,
    coalesce(p.full_name, p.username, 'ลูกค้า')::text as customer_name,
    p.phone as customer_phone,
    coalesce(s.name, 'กีฬา')::text as sport_name,
    coalesce(f.name, 'สนาม')::text as facility_name,
    v.name::text as venue_name,
    b.payment_status,
    b.status,
    b.checked_in_at,
    b.checked_out_at
  from public.bookings b
  left join public.profiles p on p.id = b.user_id
  left join public.facilities f on f.id = b.facility_id
  left join public.sports s on s.id = f.sport_id
  left join public.venues v on v.id = f.venue_id
  where b.booking_date = (now() at time zone 'Asia/Bangkok')::date
    and b.status in ('confirmed', 'awaiting_review', 'no_show', 'completed')
  order by b.start_time asc, b.booking_code asc;
end;
$fn$;

revoke all on function public.admin_today_checkins() from public, anon;
grant execute on function public.admin_today_checkins() to authenticated, service_role;
