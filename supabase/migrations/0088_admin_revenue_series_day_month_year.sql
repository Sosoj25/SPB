-- ============================================================
-- ปรับความหมายของสเกลกราฟรายได้หน้า Admin Overview
--
--   'day'   → รายวันของเดือนนี้ (ย้ายมาจาก 'month' เดิม แทนกราฟรายชั่วโมง 'today'
--              ที่เลิกใช้ เพราะแอดมินดูยอดรายวันบ่อยกว่ารายชั่วโมง)
--   'week'  → 7 วันล่าสุด (เหมือนเดิม)
--   'month' → 12 เดือนล่าสุด (เดิมเป็นรายวันของเดือนนี้) ให้ป้ายกำกับเป็นชื่อเดือน
--   'year'  → รายปี ตั้งแต่ปีที่มีการชำระเงินสำเร็จครั้งแรก (เดิมเป็นรายเดือนของ
--              ปีนี้ ซึ่งซ้ำกับสเกล 'month' ใหม่)
--
-- bucket ยังคืนเป็น timestamp ไม่มี tz ตามเวลาไทยตรง ๆ เหมือน 0070
-- ============================================================

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
  v_today      date := (now() at time zone 'Asia/Bangkok')::date;
  v_this_year  timestamp := date_trunc('year', v_today::timestamp);
  v_first_year timestamp;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  -- 'today' เป็นคีย์ของหน้าเว็บรุ่นก่อน — รับไว้ด้วยไม่ให้เบราว์เซอร์ที่ยังแคช
  -- bundle เก่าอยู่เจอ exception ระหว่างที่ยังไม่ได้โหลดเวอร์ชันใหม่
  if p_scale in ('day', 'today') then
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
    -- 12 เดือนล่าสุดรวมเดือนปัจจุบัน — เดือนที่ยังไม่มียอดได้ 0 ไปก่อน
    return query
    select m, coalesce(sum(p.amount), 0)
    from generate_series(
           date_trunc('month', v_today::timestamp) - interval '11 months',
           date_trunc('month', v_today::timestamp),
           interval '1 month'
         ) as m
    left join public.payments p
      on p.status = 'approved'
     and date_trunc('month', p.created_at at time zone 'Asia/Bangkok') = m
    group by m
    order by m;

  elsif p_scale = 'year' then
    -- เริ่มที่ปีของการชำระเงินสำเร็จครั้งแรก จะได้ไม่มีแท่งเปล่า ๆ นำหน้า
    -- จำกัดไม่เกิน 10 ปีล่าสุดกันกราฟยาวเกินจอ และถ้ายังไม่มีข้อมูลเลยก็
    -- แสดงปีนี้ปีเดียว
    select date_trunc('year', p.created_at at time zone 'Asia/Bangkok')
      into v_first_year
    from public.payments p
    where p.status = 'approved'
    order by p.created_at
    limit 1;

    if v_first_year is null then
      v_first_year := v_this_year;
    else
      v_first_year := greatest(v_first_year, v_this_year - interval '9 years');
    end if;

    return query
    select y, coalesce(sum(p.amount), 0)
    from generate_series(v_first_year, v_this_year, interval '1 year') as y
    left join public.payments p
      on p.status = 'approved'
     and date_trunc('year', p.created_at at time zone 'Asia/Bangkok') = y
    group by y
    order by y;

  else
    raise exception 'ช่วงเวลาไม่ถูกต้อง: %', p_scale;
  end if;
end;
$fn$;

revoke all on function public.admin_revenue_series(text) from public, anon;
grant execute on function public.admin_revenue_series(text) to authenticated;
