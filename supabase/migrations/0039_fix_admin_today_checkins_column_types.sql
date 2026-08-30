-- 0038 ประกาศ customer_name/sport_name/facility_name/venue_name เป็น text
-- แต่ profiles.full_name / sports.name / facilities.name / venues.name เป็น
-- varchar ทั้งหมด — coalesce(varchar, varchar, text literal) ได้ผลลัพธ์เป็น
-- varchar ไม่ใช่ text ตาม signature ที่ประกาศไว้ ทำให้ error
-- "structure of query does not match function result type" ทุกครั้งที่เรียก
-- (เจอตอนทดสอบจริงผ่านหน้า /admin/checkin) แคสต์ ::text ให้ตรงกับที่ประกาศไว้

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
    and b.status in ('confirmed', 'completed')
  order by b.start_time asc, b.booking_code asc;
end;
$fn$;
