-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0014).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ปัญหา: หน้า Admin/SuperAdmin ยังเป็น UI mockup ล้วน ๆ ตัวเลขทุกอย่าง
-- hardcode ไว้ในโค้ด frontend
-- ============================================================
--
-- RLS ที่มีอยู่แล้ว (profiles_admin_all, bookings_select_own ฯลฯ) พอให้
-- admin ดึงรายการ/แก้ไขทีละแถวได้ตรง ๆ ผ่าน supabase-js อยู่แล้ว แต่ตัวเลข
-- สรุป (นับ/รวมยอดข้ามผู้ใช้ทั้งระบบ) ทำฝั่ง client ไม่ได้ — client เห็นแค่
-- แถวที่ RLS ยอมให้เห็นทีละแถว จะ sum/count รวมของทุกคนต้องผ่าน
-- security definer เหมือน platform_stats() ใน 0013
--
-- 4 ฟังก์ชันนี้คืนออกไปแค่ "ตัวเลขสรุป" ไม่ใช่ข้อมูลดิบของผู้ใช้คนอื่น
-- จึงปลอดภัยที่จะให้ authenticated เรียกได้ ตัวฟังก์ชันเองเช็คสิทธิ์
-- is_admin()/is_super_admin() ซ้ำอีกชั้นก่อนคืนค่า


-- ============================================================
-- 1. ภาพรวมของ admin: จองวันนี้ / รายได้วันนี้ / อัตราใช้สนาม / รอตรวจสอบ
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
  v_total_slots  bigint;
  v_booked_slots bigint;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  select count(*) into v_total_slots
  from public.facility_time_slots s
  join public.facilities f on f.id = s.facility_id
  where s.slot_date = current_date
    and s.is_active
    and f.status = 'available';

  select count(*) into v_booked_slots
  from public.bookings
  where booking_date = current_date
    and status in ('pending', 'confirmed', 'completed');

  return query
  select
    v_booked_slots,

    (select coalesce(sum(amount), 0)
     from public.payments
     where status = 'paid'
       and created_at::date = current_date),

    case when v_total_slots = 0 then 0
         else round(v_booked_slots::numeric / v_total_slots * 100, 0)
    end,

    (select count(*) from public.payments where status = 'pending');
end;
$fn$;

revoke all on function public.admin_overview_stats() from public, anon;
grant execute on function public.admin_overview_stats() to authenticated;


-- ============================================================
-- 2. กราฟรายได้ 7 วันล่าสุดของ admin
-- ============================================================
-- ใช้ generate_series ไล่ทีละวันแล้ว left join เอา เพื่อให้วันที่ไม่มี
-- รายได้เลยยังคืนแถวมาเป็น 0 ไม่ใช่หายไปจากกราฟ

create or replace function public.admin_revenue_last_7_days()
returns table (
  day     date,
  revenue numeric
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
  select d::date, coalesce(sum(p.amount), 0)
  from generate_series(current_date - 6, current_date, interval '1 day') as d
  left join public.payments p
    on p.status = 'paid'
   and p.created_at::date = d::date
  group by d
  order by d;
end;
$fn$;

revoke all on function public.admin_revenue_last_7_days() from public, anon;
grant execute on function public.admin_revenue_last_7_days() to authenticated;


-- ============================================================
-- 3. ภาพรวมของ super_admin: จำนวน venue / ผู้ใช้ / แอดมิน / รายได้เดือนนี้
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
     where status = 'paid'
       and date_trunc('month', created_at) = date_trunc('month', current_date));
end;
$fn$;

revoke all on function public.superadmin_overview_stats() from public, anon;
grant execute on function public.superadmin_overview_stats() to authenticated;


-- ============================================================
-- 4. สรุปผลประกอบการรายสาขา (venue) ของ super_admin
-- ============================================================
-- ไม่มี concept "สาขา" แยกจาก venue ในระบบนี้ — venues แต่ละแถวคือสถานที่
-- จริงแต่ละที่อยู่แล้ว จึงสรุปตรง ๆ ตาม venue โดยไม่ผูกกับ admin คนใดคนหนึ่ง
-- (ไม่มีคอลัมน์ผูก admin เข้ากับ venue ในระบบตอนนี้)

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
        and date_trunc('month', b.booking_date) = date_trunc('month', current_date)
    ),

    coalesce(sum(p.amount) filter (
      where p.status = 'paid'
        and date_trunc('month', p.created_at) = date_trunc('month', current_date)
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
