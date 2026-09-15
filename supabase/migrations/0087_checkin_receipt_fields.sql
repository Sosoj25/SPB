-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0086).
-- Safe to re-run: every step is idempotent.
--
-- แอดมินพิมพ์ "ใบเสร็จรับเงิน" ให้ลูกค้าที่เคาน์เตอร์ตอนเช็คอินได้แล้ว
-- (ฝั่งเว็บอยู่ที่ frontend/src/lib/entryCard.js + EntryCardDialog.jsx)
-- ใบเสร็จต้องมีตัวเงินครบ — ราคาเต็ม ส่วนลดคูปอง ยอดสุทธิ มัดจำ พร้อม
-- ช่องทางและเวลาที่ชำระจริง — แต่ admin_today_checkins เดิมคืนมาแค่ข้อมูล
-- ที่พอใช้เช็คอิน (ชื่อ/เวลา/สถานะ) ไม่มีตัวเงินเลย
--
-- ดึงค่าจาก bookings ตรง ๆ ไม่คำนวณใหม่ฝั่งนี้ — ยอดบนใบเสร็จที่พิมพ์ต้อง
-- เป็นยอดเดียวกับที่ลูกค้าเห็นในแอป (BookingReceipt.jsx อ่านคอลัมน์ชุดเดียวกัน)
--
-- เปลี่ยน "ชนิดของผลลัพธ์" ของฟังก์ชัน create or replace ทำไม่ได้
-- (cannot change return type of existing function) ต้อง drop ทิ้งก่อน

drop function if exists public.admin_today_checkins();

create or replace function public.admin_today_checkins()
returns table (
  id              uuid,
  booking_code    varchar,
  start_time      time,
  end_time        time,
  customer_name   text,
  customer_phone  varchar,
  sport_name      text,
  facility_name   text,
  venue_name      text,
  payment_status  public.payment_status,
  status          public.booking_status,
  checked_in_at   timestamptz,
  checked_out_at  timestamptz,
  booking_date    date,
  total_amount    numeric,
  original_amount numeric,
  discount_amount numeric,
  deposit_amount  numeric,
  price_per_hour  numeric,
  payment_method  public.payment_method,
  paid_at         timestamptz
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
    b.checked_out_at,
    b.booking_date,
    b.total_amount,
    b.original_amount,
    b.discount_amount,
    b.deposit_amount,
    f.price_per_hour,
    pay.payment_method,
    pay.paid_at
  from public.bookings b
  left join public.profiles p on p.id = b.user_id
  left join public.facilities f on f.id = b.facility_id
  left join public.sports s on s.id = f.sport_id
  left join public.venues v on v.id = f.venue_id
  -- การจองหนึ่งใบมีแถว payments ได้หลายแถว (จ่ายไม่สำเร็จแล้วลองใหม่) —
  -- ใบเสร็จต้องอ้างการจ่ายที่ผ่านจริงใบล่าสุด ไม่ใช่ความพยายามที่ล้มเหลว
  left join lateral (
    select
      pm.payment_method,
      coalesce(pm.verified_at, pm.created_at) as paid_at
    from public.payments pm
    where pm.booking_id = b.id
      and pm.status in ('paid', 'approved')
    order by coalesce(pm.verified_at, pm.created_at) desc
    limit 1
  ) pay on true
  where b.booking_date = (now() at time zone 'Asia/Bangkok')::date
    and b.status in ('confirmed', 'awaiting_review', 'no_show', 'completed')
  order by b.start_time asc, b.booking_code asc;
end;
$fn$;

revoke all on function public.admin_today_checkins() from public, anon;
grant execute on function public.admin_today_checkins() to authenticated, service_role;
