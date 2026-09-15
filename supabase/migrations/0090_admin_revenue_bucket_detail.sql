-- ============================================================
-- รายละเอียดย้อนหลังของแท่งกราฟรายได้หน้า Admin Overview
--
-- หน้าเว็บให้กดแท่งที่ "ผ่านไปแล้ว" (ช่วงที่สิ้นสุดแล้วเท่านั้น) เพื่อดูว่า
-- รายได้ก้อนนั้นมาจากสนามไหนบ้าง — ฟังก์ชันนี้รับ bucket ตัวเดียวกับที่
-- admin_revenue_series() คืนมา แล้วกางยอดตามสนาม
--
-- นับจาก payments.created_at เหมือนกราฟ (ไม่ใช่วันที่เข้าใช้สนาม) ผลรวมของ
-- ทุกแถวจึงเท่ากับความสูงของแท่งนั้นเป๊ะ
-- ============================================================

create or replace function public.admin_revenue_bucket_detail(
  p_scale  text,
  p_bucket timestamp
)
returns table (
  facility_id    bigint,
  facility_name  text,
  sport_name     text,
  bookings_count bigint,
  payments_count bigint,
  revenue        numeric
)
language plpgsql
security definer
set search_path = public
stable
as $fn$
declare
  v_span interval;
  v_end  timestamp;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  -- 'today' เป็นคีย์ของหน้าเว็บรุ่นก่อน รับไว้เหมือน admin_revenue_series()
  v_span := case
    when p_scale in ('day', 'today') then interval '1 day'
    when p_scale = 'week'            then interval '7 days'
    when p_scale = 'month'           then interval '1 month'
    when p_scale = 'year'            then interval '1 year'
  end;

  if v_span is null then
    raise exception 'ช่วงเวลาไม่ถูกต้อง: %', p_scale;
  end if;

  v_end := p_bucket + v_span;

  -- left join ไล่ลงไปถึง sports เผื่อการชำระเงินที่การจอง/สนามถูกลบทิ้งไปแล้ว
  -- ยอดจะได้ไม่หายไปจากตาราง (โผล่เป็นแถว "ไม่ระบุสนาม" ให้หน้าเว็บแทน)
  return query
  select f.id,
         f.name::text,
         s.name::text,
         count(distinct p.booking_id),
         count(*),
         coalesce(sum(p.amount), 0)
  from public.payments p
  left join public.bookings b   on b.id = p.booking_id
  left join public.facilities f on f.id = b.facility_id
  left join public.sports s     on s.id = f.sport_id
  where p.status = 'approved'
    and (p.created_at at time zone 'Asia/Bangkok') >= p_bucket
    and (p.created_at at time zone 'Asia/Bangkok') <  v_end
  group by f.id, f.name, s.name
  order by coalesce(sum(p.amount), 0) desc, f.name;
end;
$fn$;

revoke all on function public.admin_revenue_bucket_detail(text, timestamp) from public, anon;
grant execute on function public.admin_revenue_bucket_detail(text, timestamp) to authenticated;
