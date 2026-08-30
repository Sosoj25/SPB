-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0034).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ให้ลูกค้าจองหลายช่วงเวลาต่อกันในครั้งเดียว (1 booking = ช่วงเวลารวม)
-- ============================================================
-- เดิม create_booking (0024) รับ slot เดียวต่อครั้ง อยากเล่นต่อ 2-3 ชม.
-- ต้องกดจองทีละรายการ เสี่ยงมีคนแทรกจองคั่นกลางระหว่างที่กดแยกกัน
--
-- ออกแบบให้ผู้ใช้เลือกได้หลาย slot_id พร้อมกัน แต่บังคับว่าต้อง:
--   1. อยู่สนามเดียว วันเดียวกันทั้งหมด
--   2. เรียงต่อกันสนิท ไม่มีช่องว่างคั่น (end_time ของอันหนึ่ง = start_time ของถัดไป)
-- แล้ว insert เป็น "1 แถวเดียว" ใน bookings ที่ start_time/end_time ครอบคลุม
-- ทั้งช่วง — เหมือนเดิมทุกอย่างสำหรับฝั่งที่กันเวลาชนกัน (bookings_no_overlap
-- เทียบช่วงเวลารวมอยู่แล้ว ไม่ต้องแก้)
--
-- bookings.slot_id (0011) เก็บ id ของ slot แรกไว้เหมือนเดิมเพื่อความเข้ากันได้
-- ย้อนหลัง (booking ที่จองแค่ 1 ช่วงจะพฤติกรรมเป๊ะเหมือนก่อนแก้ทุกอย่าง) แต่
-- ช่วงเวลาที่ 2 เป็นต้นไปไม่มีทางอ้างอิงผ่านคอลัมน์นี้ได้ ต้องมีตารางเชื่อม
-- ใหม่ (booking_slots) เก็บว่า booking หนึ่งประกอบด้วย slot ไหนบ้าง —
-- ไม่งั้นหน้า Admin/ตารางเวลา (fetchDaySlots) จะไม่รู้ว่า slot ที่ 2,3,... ถูก
-- จองไปแล้ว (เห็นว่าง ทั้งที่จริงมีคนจองผ่านช่วงรวมอยู่)


-- ============================================================
-- 1. ตารางเชื่อม booking <-> slot (many-to-many จริง ๆ แล้วคือ 1 booking
--    ผูกได้หลาย slot แต่ 1 slot ผูกได้ booking เดียวเพราะกันชนกันไว้แล้ว)
-- ============================================================

create table if not exists public.booking_slots (

    booking_id uuid not null
        references public.bookings(id)
        on delete cascade,

    slot_id bigint not null
        references public.facility_time_slots(id)
        on delete cascade,

    primary key (booking_id, slot_id)

);

create index if not exists idx_booking_slots_slot
on public.booking_slots(slot_id);

-- ย้อนข้อมูลเดิม: booking ทุกแถวที่เคยผูก slot_id เดียวไว้แล้ว (0011-0024)
insert into public.booking_slots (booking_id, slot_id)
select b.id, b.slot_id
from public.bookings b
where b.slot_id is not null
on conflict do nothing;


-- ============================================================
-- 2. RLS — อ่านได้เฉพาะแถวของ booking ตัวเอง หรือแอดมิน
-- ============================================================
-- ไม่มี insert/update/delete policy ให้ authenticated ตรง ๆ โดยตั้งใจ:
-- ทางเดียวที่เขียนตารางนี้ได้คือ create_booking() (security definer,
-- เจ้าของฟังก์ชันคือ postgres จึงไม่ติด RLS) เหมือน payments ที่ปิด insert
-- ของผู้ใช้ไปแล้วใน 0011

alter table public.booking_slots enable row level security;

drop policy if exists "booking_slots_select_own" on public.booking_slots;

create policy "booking_slots_select_own"
on public.booking_slots for select
to authenticated
using (
    exists (
        select 1 from public.bookings b
        where b.id = booking_id
          and (b.user_id = (select auth.uid()) or (select public.is_admin()))
    )
);


-- ============================================================
-- 3. create_booking() — รับหลาย slot_id ที่ต่อกัน แทนที่ slot เดียว
-- ============================================================
-- signature เปลี่ยนจาก (bigint, text) เป็น (bigint[], text) — drop ตัวเก่าทิ้ง
-- ก่อน create ใหม่ ฝั่ง client ต้องส่ง array เสมอ (แม้จองแค่ 1 ช่วงก็ส่ง
-- array 1 ตัว) ไม่มี overload คู่ขนานให้สับสน
--
-- ราคาคิดจาก compute_facility_price (0024) ด้วยช่วงเวลารวม (เริ่มของ slot
-- แรก ถึง จบของ slot สุดท้าย) เหมือนที่เคยทำกับ slot เดียว — ข้อจำกัดเดิมที่
-- 0024 บันทึกไว้ว่า "ไม่แบ่งสัดส่วนราคากลางสล็อต" ยังคงอยู่ ถ้าช่วงที่เลือก
-- คาบเกี่ยวสองช่วงราคา จะใช้ราคาของช่วงที่ slot แรกเริ่มคูณกับจำนวนชั่วโมง
-- รวมทั้งหมด (เป็นพฤติกรรมเดียวกับตอนจองสล็อตเดียวที่ยาวคาบเกี่ยว ไม่ใช่
-- บั๊กใหม่ที่เกิดจากการจองหลายช่วง)

drop function if exists public.create_booking(bigint, text);

create or replace function public.create_booking(
  p_slot_ids bigint[],
  p_note     text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user      uuid := auth.uid();
  v_ids       bigint[];
  v_found     integer;
  v_facility  bigint;
  v_date      date;
  v_start     time;
  v_end       time;
  v_prev_end  time;
  v_price     record;
  v_code      text;
  v_booking   public.bookings;
  r           record;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนจึงจะจองสนามได้';
  end if;

  select array_agg(distinct x) into v_ids
  from unnest(coalesce(p_slot_ids, '{}')) as x;

  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'กรุณาเลือกอย่างน้อยหนึ่งช่วงเวลา';
  end if;

  select count(*) into v_found
  from public.facility_time_slots s
  join public.facilities f on f.id = s.facility_id
  join public.venues     v on v.id = f.venue_id
  where s.id = any(v_ids)
    and s.is_active
    and f.status = 'available'
    and v.status = 'active';

  if v_found <> array_length(v_ids, 1) then
    raise exception 'ไม่พบช่วงเวลานี้ หรือช่วงเวลานี้ถูกปิดไปแล้ว';
  end if;

  -- ไล่ตามลำดับเวลาเช็คว่า: สนามเดียว วันเดียวกัน และต่อกันสนิททุกคู่
  -- (end ของอันก่อนหน้า = start ของอันถัดไป ไม่งั้นถือว่ามีช่องว่างคั่น)
  for r in
    select s.facility_id, s.slot_date, s.start_time, s.end_time
    from public.facility_time_slots s
    where s.id = any(v_ids)
    order by s.start_time
  loop
    if v_facility is null then
      v_facility := r.facility_id;
      v_date     := r.slot_date;
      v_start    := r.start_time;
    elsif r.facility_id <> v_facility or r.slot_date <> v_date then
      raise exception 'เลือกได้เฉพาะช่วงเวลาของสนามและวันเดียวกันเท่านั้น';
    elsif r.start_time <> v_prev_end then
      raise exception 'เลือกได้เฉพาะช่วงเวลาที่ต่อเนื่องกันเท่านั้น ห้ามมีช่วงว่างคั่นกลาง';
    end if;

    v_prev_end := r.end_time;
  end loop;

  v_end := v_prev_end;

  if (v_date + v_start) <= (now() at time zone 'Asia/Bangkok') then
    raise exception 'ช่วงเวลานี้ผ่านมาแล้ว ไม่สามารถจองได้';
  end if;

  perform public.expire_unpaid_bookings(30, v_facility, v_date);

  select * into v_price
  from public.compute_facility_price(v_facility, v_date, v_start, v_end);

  -- booking_code เป็น unique — สุ่มชนก็สุ่มใหม่ ไม่ใช่โยน error ใส่ผู้ใช้
  for i in 1..10 loop
    v_code := 'SPB-' || to_char(v_date, 'YYYYMMDD') || '-'
              || lpad(floor(random() * 10000)::int::text, 4, '0');

    begin
      insert into public.bookings (
        booking_code, user_id, facility_id, slot_id,
        booking_date, start_time, end_time,
        total_amount, deposit_amount, status, payment_status, note
      )
      values (
        v_code, v_user, v_facility, v_ids[1],
        v_date, v_start, v_end,
        v_price.total_amount, v_price.deposit_amount, 'pending', 'unpaid',
        nullif(btrim(coalesce(p_note, '')), '')
      )
      returning * into v_booking;

      insert into public.booking_slots (booking_id, slot_id)
      select v_booking.id, x from unnest(v_ids) as x;

      return v_booking;

    exception
      when unique_violation then
        continue;
      when exclusion_violation then
        -- bookings_no_overlap ยังเป็นด่านสุดท้ายเหมือนเดิม เพราะเป็นด่านเดียว
        -- ที่กันสองคนกดพร้อมกันได้จริง
        raise exception 'ช่วงเวลานี้เพิ่งถูกจองไปแล้ว กรุณาเลือกช่วงอื่น';
    end;
  end loop;

  raise exception 'ไม่สามารถสร้างรหัสการจองได้ กรุณาลองใหม่อีกครั้ง';
end;
$fn$;


revoke all on function public.create_booking(bigint[], text) from public, anon;
grant execute on function public.create_booking(bigint[], text) to authenticated;
