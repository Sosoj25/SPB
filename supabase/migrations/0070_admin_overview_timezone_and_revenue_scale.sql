-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0069).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ปัญหา 0 (สำคัญที่สุด): ทุก RPC รายได้ (admin_overview_stats,
-- admin_revenue_last_7_days เดิม, superadmin_overview_stats,
-- superadmin_venue_breakdown) กรอง payments ด้วย status = 'paid' มาตั้งแต่
-- 0015 — แต่ไม่มีที่ไหนใน schema เคยเซ็ต payments.status เป็น 'paid' เลย
-- ฟังก์ชันยืนยันการชำระเงินของแอดมิน (0021/0023/0028/0037/0054) เซ็ตเป็น
-- 'approved' เสมอ ('paid' มีอยู่ใน enum payment_status แต่ใช้เฉพาะคอลัมน์
-- bookings.payment_status ของ flow เก่าใน 0009 เท่านั้น) ผลคือยอดรายได้บน
-- แดชบอร์ดเป็น 0 บาทเสมอไม่ว่าจะมีการชำระเงินที่แอดมินอนุมัติแล้วจริงเท่าไหร่
-- ก็ตาม — แก้โดยเปลี่ยนทุกจุดเป็น status = 'approved'
--
-- ปัญหา 1: admin_overview_stats/superadmin_overview_stats/superadmin_venue_
-- breakdown (0015) ใช้ current_date และ created_at::date ตรง ๆ ซึ่งตัดวันตาม
-- timezone ของฐานข้อมูล (UTC) ไม่ใช่เวลาไทย (UTC+7) — ทำให้ "รายได้วันนี้"/
-- กราฟรายวันคลาดกับสิ่งที่แอดมินเห็นจริงตอนกลางคืน/เช้ามืด (เช่น payment เวลา
-- 00:30 น. ไทย จะโดนนับเป็นเมื่อวานใน UTC เพราะยังเป็น 17:30 ของเมื่อวาน)
--
-- แก้ด้วย pattern เดียวกับ _booking_window_days/enforce_booking_window (0056):
-- ใช้ (now() at time zone 'Asia/Bangkok')::date แทน current_date และ
-- (created_at at time zone 'Asia/Bangkok')::date แทน created_at::date
-- ============================================================

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
    and status in ('pending', 'confirmed', 'completed');

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


-- ============================================================
-- ปัญหา 2: กราฟรายได้บนหน้า Admin Overview ปรับสเกลไม่ได้ ตายตัวแค่ 7 วัน
-- ล่าสุด — แทนที่ admin_revenue_last_7_days() ด้วย admin_revenue_series(p_scale)
-- ที่รับ 'today' | 'week' | 'month' | 'year'
--
-- คืน bucket เป็น timestamp (ไม่มี tz) ตามเวลาไทยตรง ๆ ให้ฝั่งหน้าเว็บอ่านเป็น
-- เวลาท้องถิ่นได้เลยโดยไม่ต้องแปลง tz ซ้ำ เหมือน pattern เดิมของ dayLabel ใน
-- AdminOverview.jsx (ต่อ "YYYY-MM-DDT00:00:00" ตรง ๆ แล้ว new Date อ่านเป็น
-- เวลาท้องถิ่นของเบราว์เซอร์)
-- ============================================================

drop function if exists public.admin_revenue_last_7_days();

create or replace function public.admin_revenue_series(p_scale text)
returns table (
  bucket  timestamp,
  revenue numeric
)
language plpgsql
security definer
set search_path = public
stable
as $fn$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  if p_scale = 'today' then
    -- รายชั่วโมงของวันนี้ (00:00–23:00) — ชั่วโมงที่ยังไม่ถึงจะได้ 0 ไปก่อน
    -- เหมือนวันในอนาคตของกราฟรายสัปดาห์/เดือน
    return query
    select h, coalesce(sum(p.amount), 0)
    from generate_series(
           v_today::timestamp,
           v_today::timestamp + interval '23 hour',
           interval '1 hour'
         ) as h
    left join public.payments p
      on p.status = 'approved'
     and date_trunc('hour', p.created_at at time zone 'Asia/Bangkok') = h
    group by h
    order by h;

  elsif p_scale = 'week' then
    return query
    select d, coalesce(sum(p.amount), 0)
    from generate_series((v_today - 6)::timestamp, v_today::timestamp, interval '1 day') as d
    left join public.payments p
      on p.status = 'approved'
     and (p.created_at at time zone 'Asia/Bangkok')::date = d::date
    group by d
    order by d;

  elsif p_scale = 'month' then
    -- ตั้งแต่วันที่ 1 ของเดือนนี้ถึงวันนี้ (ไม่ใช่ 30 วันล่าสุด) ให้ตรงกับ
    -- ความหมาย "เดือนนี้" ที่แอดมินคุ้นเคยจากหน้า superadmin
    return query
    select d, coalesce(sum(p.amount), 0)
    from generate_series(date_trunc('month', v_today)::timestamp, v_today::timestamp, interval '1 day') as d
    left join public.payments p
      on p.status = 'approved'
     and (p.created_at at time zone 'Asia/Bangkok')::date = d::date
    group by d
    order by d;

  elsif p_scale = 'year' then
    -- รายเดือนตั้งแต่ ม.ค. ถึงเดือนปัจจุบันของปีนี้
    return query
    select m, coalesce(sum(p.amount), 0)
    from generate_series(date_trunc('year', v_today), date_trunc('month', v_today), interval '1 month') as m
    left join public.payments p
      on p.status = 'approved'
     and date_trunc('month', p.created_at at time zone 'Asia/Bangkok') = m
    group by m
    order by m;

  else
    raise exception 'ช่วงเวลาไม่ถูกต้อง: %', p_scale;
  end if;
end;
$fn$;

revoke all on function public.admin_revenue_series(text) from public, anon;
grant execute on function public.admin_revenue_series(text) to authenticated;


-- ============================================================
-- ปัญหา 1 (ต่อ): superadmin_overview_stats/superadmin_venue_breakdown มีบั๊ก
-- timezone เดียวกัน (date_trunc('month', current_date) เทียบกับ created_at
-- แบบ UTC เดิม)
-- ============================================================

create or replace function public.superadmin_overview_stats()
returns table (
  venues_count       bigint,
  users_count        bigint,
  admins_count       bigint,
  revenue_this_month numeric
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
    (select count(*) from public.venues),
    (select count(*) from public.profiles),
    (select count(*) from public.profiles where role in ('admin', 'super_admin')),
    (select coalesce(sum(amount), 0)
     from public.payments
     where status = 'approved'
       and date_trunc('month', created_at at time zone 'Asia/Bangkok') = v_month_start);
end;
$fn$;

revoke all on function public.superadmin_overview_stats() from public, anon;
grant execute on function public.superadmin_overview_stats() to authenticated;


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
      where b.status in ('confirmed', 'completed')
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
