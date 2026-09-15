-- ============================================================
-- เลื่อนกราฟรายได้หน้า Admin Overview ย้อนหลังได้ทีละหน้า
--
-- เดิมแต่ละสเกลเห็นได้แค่หน้าล่าสุดหน้าเดียว (7 วัน / 8 สัปดาห์ / 12 เดือน)
-- ย้อนไกลกว่านั้นไม่ได้เลย — เพิ่ม p_offset: 0 = หน้าล่าสุด, 1 = ถอยหลังไป
-- อีกหนึ่งหน้าเต็ม ๆ, 2 = สองหน้า ไปเรื่อย ๆ
--
-- คืน has_older มาด้วย (ค่าเดียวกันทุกแถว) = ยังมีเงินเข้าก่อนหน้าแท่งแรกของ
-- หน้านี้อีกไหม ให้หน้าเว็บปิดปุ่ม "ย้อนกลับ" ได้ตอนสุดข้อมูลจริง ๆ โดยไม่ต้อง
-- เดาขอบเขตเอาเอง
--
-- สเกล 'year' ไม่ถอยก่อนปีที่มีเงินเข้าครั้งแรก (ไม่งั้นได้แท่งเปล่ายาวเป็นพืด)
-- has_older จึงเป็น false เสมอจนกว่าจะมีข้อมูลเกิน 10 ปี
-- ============================================================

drop function if exists public.admin_revenue_series(text);

create or replace function public.admin_revenue_series(
  p_scale  text,
  p_offset int default 0
)
returns table (
  bucket    timestamp,
  revenue   numeric,
  has_older boolean
)
language plpgsql
security definer
set search_path = public
stable
as $fn$
declare
  v_today     date := (now() at time zone 'Asia/Bangkok')::date;
  v_unit      text;
  v_step      interval;
  v_count     int;
  v_page      int := greatest(coalesce(p_offset, 0), 0);
  v_latest    timestamp;
  v_last      timestamp;
  v_start     timestamp;
  v_first     timestamp;
  v_has_older boolean;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  -- 'today' เป็นคีย์ของหน้าเว็บรุ่นก่อน — รับไว้ด้วยไม่ให้เบราว์เซอร์ที่ยังแคช
  -- bundle เก่าอยู่เจอ exception ระหว่างที่ยังไม่ได้โหลดเวอร์ชันใหม่
  if p_scale in ('day', 'today') then
    v_unit := 'day';
    v_step := interval '1 day';
    v_count := 7;
  elsif p_scale = 'week' then
    v_unit := 'week';
    v_step := interval '1 week';
    v_count := 8;
  elsif p_scale = 'month' then
    v_unit := 'month';
    v_step := interval '1 month';
    v_count := 12;
  elsif p_scale = 'year' then
    v_unit := 'year';
    v_step := interval '1 year';
    v_count := 10;
  else
    raise exception 'ช่วงเวลาไม่ถูกต้อง: %', p_scale;
  end if;

  v_latest := date_trunc(v_unit, v_today::timestamp);
  v_last   := v_latest - (v_step * v_count * v_page);
  v_start  := v_last - (v_step * (v_count - 1));

  if p_scale = 'year' then
    select date_trunc('year', p.created_at at time zone 'Asia/Bangkok')
      into v_first
    from public.payments p
    where p.status = 'approved'
    order by p.created_at
    limit 1;

    if v_first is not null and v_first > v_start then
      v_start := least(v_first, v_last);
    end if;
  end if;

  -- กันกรณี offset เกินขอบจนช่วงกลับหัว (ไม่ควรเกิดเพราะหน้าเว็บดู has_older
  -- อยู่แล้ว แต่ RPC ถูกเรียกตรง ๆ ได้)
  if v_start > v_last then
    v_start := v_last;
  end if;

  select exists (
    select 1
    from public.payments p
    where p.status = 'approved'
      and (p.created_at at time zone 'Asia/Bangkok') < v_start
  )
  into v_has_older;

  return query
  select b, coalesce(sum(p.amount), 0), v_has_older
  from generate_series(v_start, v_last, v_step) as b
  left join public.payments p
    on p.status = 'approved'
   and date_trunc(v_unit, p.created_at at time zone 'Asia/Bangkok') = b
  group by b
  order by b;
end;
$fn$;

revoke all on function public.admin_revenue_series(text, int) from public, anon;
grant execute on function public.admin_revenue_series(text, int) to authenticated;
