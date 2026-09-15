-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0063, including 0063
-- which must already be committed — this file uses the 'cash'/'card' enum values
-- it added, and Postgres forbids using a new enum value in the same transaction
-- that created it).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- หน้า Admin "รับลูกค้า Walk-in" — จองแทนลูกค้าที่มาถึงหน้าเคาน์เตอร์เอง
-- ============================================================
-- ทุก booking ที่มีอยู่ตอนนี้ผูกกับ user_id ที่ต้อง auth.uid() = ตัวเอง
-- (bookings_insert_own, 0022) และมาจาก create_booking() ที่ผู้ใช้กดจองเอง
-- ผ่านแอป ไม่มีทางให้แอดมินจองแทนคนที่ "ไม่มีบัญชี" ได้เลย เพราะ
-- bookings.user_id / payments.user_id เป็น not null อ้างอิง profiles(id)
-- ซึ่งต้องมี auth.users แถวคู่กันเสมอ (สมัครสมาชิกอย่างเดียว สร้างจาก
-- ฝั่งแอดมินตรง ๆ ไม่ได้)
--
-- ทางเลือกที่ใช้: ให้ลูกค้า walk-in ที่ไม่มีบัญชีผูกกับ user_id ของแอดมินที่
-- กดสร้างรายการ (เจ้าของบัญชีที่รับผิดชอบรายการนี้จริง ๆ) แล้วเก็บชื่อ/เบอร์
-- ลูกค้าไว้ในคอลัมน์ walk_in_name / walk_in_phone แยกต่างหากสำหรับแสดงผล —
-- ถ้าลูกค้าเป็นสมาชิกเดิมอยู่แล้ว (แอดมินค้นด้วยเบอร์โทรเจอ) จะผูก user_id
-- เป็นของลูกค้าคนนั้นตรง ๆ แทน และไม่ต้องเก็บ walk_in_name/phone ซ้ำ
--
-- รายการ walk-in ถือว่าจ่ายเงินที่เคาน์เตอร์เสร็จสิ้นทันที (ตรงข้ามกับ
-- create_booking ปกติที่ status='pending'/payment_status='unpaid' รอจ่ายทีหลัง)
-- จึงตั้ง status='confirmed', payment_status='approved' เหมือนผลลัพธ์ของ
-- admin_approve_payment (0021) ตั้งแต่ insert เลย ไม่ต้องรอแอดมินมากดอนุมัติซ้ำ


-- ============================================================
-- 1. คอลัมน์ทำเครื่องหมาย walk-in บน bookings
-- ============================================================

alter table public.bookings
  add column if not exists is_walk_in boolean not null default false;

alter table public.bookings
  add column if not exists walk_in_name varchar(150);

alter table public.bookings
  add column if not exists walk_in_phone varchar(30);


-- ============================================================
-- 2. admin_create_walk_in_booking()
-- ============================================================
-- โครงตรวจสอบช่วงเวลา (สนามเดียว/วันเดียว/ต่อกันสนิท) เหมือน create_booking
-- (0035) ทุกประการ — ต่างกันแค่ที่มาของ user_id และสถานะที่ insert

create or replace function public.admin_create_walk_in_booking(
  p_facility_id       bigint,
  p_slot_ids          bigint[],
  p_customer_user_id  uuid    default null,
  p_customer_name     text    default null,
  p_customer_phone    text    default null,
  p_note              text    default null,
  p_payment_method    text    default 'cash'
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_admin        uuid := auth.uid();
  v_user         uuid;
  v_walk_in_name varchar(150);
  v_walk_in_phone varchar(30);
  v_ids          bigint[];
  v_found        integer;
  v_facility     bigint;
  v_date         date;
  v_start        time;
  v_end          time;
  v_prev_end     time;
  v_price        record;
  v_code         text;
  v_booking      public.bookings;
  r              record;
begin
  if v_admin is null or not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้นจึงจะสร้างรายการนี้ได้';
  end if;

  if p_payment_method not in ('cash', 'card', 'qr', 'bank_transfer') then
    raise exception 'วิธีชำระเงินไม่ถูกต้อง';
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
    and s.facility_id = p_facility_id
    and s.is_active
    and f.status = 'available'
    and v.status = 'active';

  if v_found <> array_length(v_ids, 1) then
    raise exception 'ไม่พบช่วงเวลานี้ หรือช่วงเวลานี้ถูกปิดไปแล้ว';
  end if;

  -- ไล่ตามลำดับเวลาเช็คว่า: สนามเดียว วันเดียวกัน และต่อกันสนิททุกคู่
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

  -- ลูกค้าเดิม (ค้นเจอจากเบอร์โทร) ผูก user_id ตรง ๆ — ลูกค้าใหม่ไม่มีบัญชี
  -- ผูกไว้กับแอดมินที่สร้างรายการแทน แล้วเก็บชื่อ/เบอร์ไว้แสดงผลแทนของแอดมิน
  if p_customer_user_id is not null then
    if not exists (select 1 from public.profiles where id = p_customer_user_id) then
      raise exception 'ไม่พบบัญชีลูกค้านี้ในระบบ';
    end if;

    v_user          := p_customer_user_id;
    v_walk_in_name  := null;
    v_walk_in_phone := null;
  else
    v_walk_in_name  := nullif(btrim(coalesce(p_customer_name, '')), '');
    v_walk_in_phone := nullif(btrim(coalesce(p_customer_phone, '')), '');

    if v_walk_in_name is null or v_walk_in_phone is null then
      raise exception 'กรุณาระบุชื่อและเบอร์โทรของลูกค้า หรือค้นหาสมาชิกเดิมด้วยเบอร์โทร';
    end if;

    v_user := v_admin;
  end if;

  perform public.expire_unpaid_bookings(30, v_facility, v_date);

  select * into v_price
  from public.compute_facility_price(v_facility, v_date, v_start, v_end);

  -- booking_code เป็น unique — สุ่มชนก็สุ่มใหม่ ไม่ใช่โยน error ใส่แอดมิน
  for i in 1..10 loop
    v_code := 'SPB-' || to_char(v_date, 'YYYYMMDD') || '-'
              || lpad(floor(random() * 10000)::int::text, 4, '0');

    begin
      insert into public.bookings (
        booking_code, user_id, facility_id, slot_id,
        booking_date, start_time, end_time,
        total_amount, deposit_amount, status, payment_status, note,
        is_walk_in, walk_in_name, walk_in_phone
      )
      values (
        v_code, v_user, v_facility, v_ids[1],
        v_date, v_start, v_end,
        v_price.total_amount, v_price.deposit_amount, 'confirmed', 'approved',
        nullif(btrim(coalesce(p_note, '')), ''),
        true, v_walk_in_name, v_walk_in_phone
      )
      returning * into v_booking;

      insert into public.booking_slots (booking_id, slot_id)
      select v_booking.id, x from unnest(v_ids) as x;

      insert into public.payments (
        booking_id, user_id, amount, payment_method, status, verified_by, verified_at
      )
      values (
        v_booking.id, v_user, v_price.total_amount, p_payment_method::public.payment_method,
        'approved', v_admin, now()
      );

      return v_booking;

    exception
      when unique_violation then
        continue;
      when exclusion_violation then
        raise exception 'ช่วงเวลานี้เพิ่งถูกจองไปแล้ว กรุณาเลือกช่วงอื่น';
    end;
  end loop;

  raise exception 'ไม่สามารถสร้างรหัสการจองได้ กรุณาลองใหม่อีกครั้ง';
end;
$fn$;

revoke all on function public.admin_create_walk_in_booking(
  bigint, bigint[], uuid, text, text, text, text
) from public, anon;

grant execute on function public.admin_create_walk_in_booking(
  bigint, bigint[], uuid, text, text, text, text
) to authenticated;
