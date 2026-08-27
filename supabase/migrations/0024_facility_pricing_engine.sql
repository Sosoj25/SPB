-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0023).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- เติมส่วนที่ 0019 ตั้งใจเลื่อนไว้: ราคาตามช่วงเวลา + ส่วนลด + ประวัติราคา
-- ============================================================
-- 0019_schedule_admin_extras.sql บอกไว้ตรง ๆ ว่า "ราคาต่อช่วงเวลาที่แก้ไข
-- ได้จริงต้องแก้ RPC จองเงินจริงด้วย" แล้วเลื่อนออกไปก่อน — ไฟล์นี้คืองานนั้น
--
-- create_booking() (0012) เป็นจุดเดียวในระบบที่คำนวณ total_amount จริง ๆ
-- ทุกอย่างหลังจากนั้น (BookingPayment, ใบเสร็จ, Omise charge, สลิปโอนเงิน)
-- อ่าน bookings.total_amount เฉยๆ ไม่มีที่ไหนคำนวณราคาซ้ำอีก — เพราะงั้น
-- ฟังก์ชันคำนวณราคาตัวใหม่ (compute_facility_price) ต้องถูกเรียกจาก
-- create_booking โดยตรง ไม่ใช่แค่ไว้โชว์ในหน้า admin เฉยๆ
--
-- ฟังก์ชันเดียวกันนี้ยัง grant ให้ authenticated เรียกตรงได้ (READ-ONLY,
-- stable) เพื่อให้หน้า BookingSchedule/BookingPayment และหน้าตัวอย่างราคา
-- ของแอดมินเรียกดูตัวเลขเดียวกันกับที่ create_booking จะใช้จริง ไม่มีทาง
-- ราคาที่โชว์ก่อนจ่ายเงินกับราคาที่เก็บจริงไม่ตรงกัน
--
-- ขอบเขตที่ตั้งใจไม่ทำในไฟล์นี้ (ดูรายละเอียดในแผนงาน):
--   - ไม่ seed กฎส่วนลดให้สนามที่มีอยู่แล้วอัตโนมัติ (จะกระทบยอดเงินจริงทันที)
--   - min_booking_hours บันทึก/แสดงผลได้ แต่ไม่ได้บังคับ (ระบบจองเป็นสล็อต
--     ความยาวคงที่อยู่แล้ว ไม่มีทางเลือกช่วงเวลาอิสระให้บังคับขั้นต่ำ)
--   - deposit_percent คำนวณเก็บไว้โชว์เฉยๆ ไม่ได้เปลี่ยนยอดที่เรียกเก็บจริง
--     ผ่าน gateway (ต้องแก้ 0023 เพิ่มถ้าจะทำจ่ายมัดจำจริง)


-- ============================================================
-- 1. คอลัมน์ใหม่บนตารางเดิม
-- ============================================================

alter table public.facilities
  add column if not exists min_booking_hours integer not null default 1,
  add column if not exists deposit_percent numeric(5,2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'facilities_min_booking_hours_check'
  ) then
    alter table public.facilities
      add constraint facilities_min_booking_hours_check check (min_booking_hours >= 1);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'facilities_deposit_percent_check'
  ) then
    alter table public.facilities
      add constraint facilities_deposit_percent_check
      check (deposit_percent >= 0 and deposit_percent <= 100);
  end if;
end;
$$;

-- นักเรียน/นักศึกษา — ยังไม่มีหน้าไหนตั้งค่าให้ผู้ใช้เองได้ในรอบนี้ เป็นแค่
-- คอลัมน์เตรียมไว้ให้กฎส่วนลด "นักเรียน/นักศึกษา" มีที่มาจริง (ค่าเริ่มต้น
-- false ทุกคน แปลว่ากฎนี้จะไม่มีผลจนกว่าจะมีกลไกยืนยันสถานะนักเรียนในอนาคต)
alter table public.profiles
  add column if not exists is_student boolean not null default false;

alter table public.bookings
  add column if not exists deposit_amount numeric(12,2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_deposit_amount_check'
  ) then
    alter table public.bookings
      add constraint bookings_deposit_amount_check check (deposit_amount >= 0);
  end if;
end;
$$;


-- ============================================================
-- 2. วันหยุดนักขัตฤกษ์ — ตารางเปล่าๆ ไม่มีมาก่อนในระบบ
-- ============================================================
-- seed ด้วยวันหยุดราชการไทยปี 2026 เพื่อให้ราคาช่อง "วันหยุดนักขัตฤกษ์"
-- ใช้งานได้จริงตั้งแต่วันแรก — วันหยุดตามจันทรคติ (มาฆบูชา/วิสาขบูชา/
-- อาสาฬหบูชา/เข้าพรรษา) เป็นวันที่ประมาณการ แอดมินควรตรวจสอบ/แก้ไขให้ตรง
-- ประกาศทางการภายหลัง ยังไม่มีหน้า admin จัดการตารางนี้ในรอบนี้ แก้ผ่าน
-- SQL ไปก่อน

create table if not exists public.holidays (
    date date primary key,
    name text not null default ''
);

insert into public.holidays (date, name) values
    ('2026-01-01', 'วันขึ้นปีใหม่'),
    ('2026-03-03', 'วันมาฆบูชา (ประมาณการ)'),
    ('2026-04-06', 'วันจักรี'),
    ('2026-04-13', 'วันสงกรานต์'),
    ('2026-04-14', 'วันสงกรานต์'),
    ('2026-04-15', 'วันสงกรานต์'),
    ('2026-05-01', 'วันแรงงานแห่งชาติ'),
    ('2026-05-04', 'วันฉัตรมงคล'),
    ('2026-05-31', 'วันวิสาขบูชา (ประมาณการ)'),
    ('2026-07-28', 'วันเฉลิมพระชนมพรรษา ร.10'),
    ('2026-07-29', 'วันอาสาฬหบูชา (ประมาณการ)'),
    ('2026-07-30', 'วันเข้าพรรษา (ประมาณการ)'),
    ('2026-08-12', 'วันแม่แห่งชาติ'),
    ('2026-10-13', 'วันคล้ายวันสวรรคต ร.9'),
    ('2026-10-23', 'วันปิยมหาราช'),
    ('2026-12-05', 'วันพ่อแห่งชาติ'),
    ('2026-12-10', 'วันรัฐธรรมนูญ'),
    ('2026-12-31', 'วันสิ้นปี')
on conflict (date) do nothing;

alter table public.holidays enable row level security;

drop policy if exists "holidays_admin_manage" on public.holidays;
create policy "holidays_admin_manage"
on public.holidays for all to authenticated
using ( (select public.is_admin()) )
with check ( (select public.is_admin()) );


-- ============================================================
-- 3. ราคาตามช่วงเวลา (ต่อสนาม)
-- ============================================================
-- อ้างอิงด้วย "เวลาเริ่มของสล็อต" อยู่ในช่วงไหน ไม่ได้แบ่งสัดส่วนราคากลาง
-- สล็อต เพราะการจองทั้งระบบเป็นสล็อตความยาวคงที่อยู่แล้ว (จองสล็อตเดียว
-- ราคาเดียว ไม่มีการจองข้ามช่วงราคาในสล็อตเดียวกัน)
--
-- ต้องกรอกราคาทั้งสามช่อง (จ-ศ / ส-อา / วันหยุดนักขัตฤกษ์) เสมอ ไม่ปล่อย
-- ว่างได้ — กันเคสราคา null แล้วปนกับ "ไม่มีกฎช่วงนี้เลย" (fallback ไปใช้
-- ราคาพื้นฐาน) ของ compute_facility_price ด้านล่างสับสนกัน

create table if not exists public.facility_pricing_rules (

    id bigint generated by default as identity primary key,

    facility_id bigint not null
        references public.facilities(id)
        on delete cascade,

    label varchar(100) not null default '',

    start_time time not null,

    end_time time not null,

    weekday_price numeric(12,2) not null,

    weekend_price numeric(12,2) not null,

    holiday_price numeric(12,2) not null,

    is_peak boolean not null default false,

    sort_order integer not null default 0,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    constraint facility_pricing_rules_time_check check (end_time > start_time),
    constraint facility_pricing_rules_weekday_check check (weekday_price >= 0),
    constraint facility_pricing_rules_weekend_check check (weekend_price >= 0),
    constraint facility_pricing_rules_holiday_check check (holiday_price >= 0)

);

create index if not exists idx_facility_pricing_rules_facility
on public.facility_pricing_rules(facility_id);

drop trigger if exists trg_facility_pricing_rules_updated_at
on public.facility_pricing_rules;

create trigger trg_facility_pricing_rules_updated_at
before update on public.facility_pricing_rules
for each row
execute function public.set_updated_at();

alter table public.facility_pricing_rules enable row level security;

drop policy if exists "facility_pricing_rules_admin_manage" on public.facility_pricing_rules;
create policy "facility_pricing_rules_admin_manage"
on public.facility_pricing_rules for all to authenticated
using ( (select public.is_admin()) )
with check ( (select public.is_admin()) );


-- ============================================================
-- 4. กฎส่วนลด (ต่อสนาม)
-- ============================================================
-- ทุกกฎที่ is_enabled คำนวณจาก subtotal เดียวกัน (ไม่ต่อเนื่องทบกัน) แล้ว
-- บวกลบรวมทีเดียว ตรงกับตัวอย่างใน Figma (ลด 10% + ลด ฿100 บนฐานเดียวกัน)

create table if not exists public.facility_discounts (

    id bigint generated by default as identity primary key,

    facility_id bigint not null
        references public.facilities(id)
        on delete cascade,

    label varchar(150) not null,

    discount_type text not null,

    value_percent numeric(5,2),

    value_flat numeric(12,2),

    threshold_days integer,

    threshold_hours numeric(6,2),

    is_enabled boolean not null default true,

    sort_order integer not null default 0,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    constraint facility_discounts_type_check check (
        discount_type in ('member', 'advance_booking', 'long_booking', 'student')
    ),
    constraint facility_discounts_value_present_check check (
        value_percent is not null or value_flat is not null
    ),
    constraint facility_discounts_value_percent_check check (
        value_percent is null or (value_percent >= 0 and value_percent <= 100)
    ),
    constraint facility_discounts_value_flat_check check (
        value_flat is null or value_flat >= 0
    ),
    constraint facility_discounts_threshold_days_check check (
        threshold_days is null or threshold_days >= 0
    ),
    constraint facility_discounts_threshold_hours_check check (
        threshold_hours is null or threshold_hours >= 0
    )

);

create index if not exists idx_facility_discounts_facility
on public.facility_discounts(facility_id);

drop trigger if exists trg_facility_discounts_updated_at
on public.facility_discounts;

create trigger trg_facility_discounts_updated_at
before update on public.facility_discounts
for each row
execute function public.set_updated_at();

alter table public.facility_discounts enable row level security;

drop policy if exists "facility_discounts_admin_manage" on public.facility_discounts;
create policy "facility_discounts_admin_manage"
on public.facility_discounts for all to authenticated
using ( (select public.is_admin()) )
with check ( (select public.is_admin()) );


-- ============================================================
-- 5. ประวัติการเปลี่ยนราคา (ต่อสนาม) — เขียนได้อย่างเดียว ไม่มีแก้/ลบ
-- ============================================================
-- แอดมินฝั่ง client เป็นคนสร้างข้อความ description เอง (เทียบค่าก่อน/หลัง
-- แล้วประกอบเป็นประโยคสั้นๆ) แล้ว insert ตรงๆ หลัง save สำเร็จ — ไม่ต้อง
-- มี RPC เพราะ RLS ผูก admin ไว้แล้วและไม่มีตรรกะที่ต้องอะตอมมิกกับตารางอื่น

create table if not exists public.facility_price_history (

    id bigint generated by default as identity primary key,

    facility_id bigint not null
        references public.facilities(id)
        on delete cascade,

    description text not null,

    changed_by uuid references public.profiles(id) on delete set null,

    created_at timestamptz not null default now()

);

create index if not exists idx_facility_price_history_facility
on public.facility_price_history(facility_id, created_at desc);

alter table public.facility_price_history enable row level security;

drop policy if exists "facility_price_history_admin_manage" on public.facility_price_history;
create policy "facility_price_history_admin_manage"
on public.facility_price_history for all to authenticated
using ( (select public.is_admin()) )
with check ( (select public.is_admin()) );


-- ============================================================
-- 6. ฟังก์ชันคำนวณราคาจริง — จุดเดียวที่ทั้งระบบใช้ร่วมกัน
-- ============================================================
-- security definer เพราะต้องอ่าน facility_pricing_rules/facility_discounts
-- (admin-only RLS) และ profiles.is_student ของผู้เรียกเอง — grant ให้
-- authenticated ตรงๆ ได้เลยเพราะฟังก์ชันนี้ "อ่านอย่างเดียว" ไม่แก้อะไร
-- (stable) ใช้ได้ทั้งจากหน้าจองจริงและจาก create_booking() เอง

create or replace function public.compute_facility_price(
    p_facility_id  bigint,
    p_booking_date date,
    p_start_time   time,
    p_end_time     time
)
returns table (
    hours          numeric,
    base_rate      numeric,
    is_peak        boolean,
    subtotal       numeric,
    discount_total numeric,
    total_amount   numeric,
    deposit_amount numeric,
    discount_lines jsonb
)
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare
    v_hours        numeric;
    v_base_rate    numeric;
    v_deposit_pct  numeric;
    v_rate         numeric;
    v_is_peak      boolean;
    v_is_holiday   boolean;
    v_is_weekend   boolean;
    v_subtotal     numeric;
    v_discount     numeric := 0;
    v_lines        jsonb := '[]'::jsonb;
    v_is_student   boolean;
    v_amount       numeric;
    v_eligible     boolean;
    r              record;
begin
    if p_end_time <= p_start_time then
        raise exception 'ช่วงเวลาไม่ถูกต้อง';
    end if;

    v_hours := extract(epoch from (p_end_time - p_start_time)) / 3600;

    select f.price_per_hour, f.deposit_percent
    into v_base_rate, v_deposit_pct
    from public.facilities f
    where f.id = p_facility_id;

    if not found then
        raise exception 'ไม่พบสนามนี้';
    end if;

    v_is_holiday := exists (select 1 from public.holidays h where h.date = p_booking_date);
    v_is_weekend := extract(isodow from p_booking_date) in (6, 7);

    select
        case
            when v_is_holiday then pr.holiday_price
            when v_is_weekend then pr.weekend_price
            else pr.weekday_price
        end,
        pr.is_peak
    into v_rate, v_is_peak
    from public.facility_pricing_rules pr
    where pr.facility_id = p_facility_id
      and p_start_time >= pr.start_time
      and p_start_time <  pr.end_time
    order by pr.sort_order
    limit 1;

    if v_rate is null then
        v_rate := v_base_rate;
        v_is_peak := false;
    end if;

    v_subtotal := round(v_rate * v_hours, 2);

    select p.is_student into v_is_student
    from public.profiles p
    where p.id = auth.uid();

    for r in
        select *
        from public.facility_discounts d
        where d.facility_id = p_facility_id
          and d.is_enabled
        order by d.sort_order
    loop
        v_eligible := case r.discount_type
            when 'member' then auth.uid() is not null
            when 'advance_booking' then
                r.threshold_days is not null
                and (p_booking_date - current_date) >= r.threshold_days
            when 'long_booking' then
                r.threshold_hours is not null
                and v_hours >= r.threshold_hours
            when 'student' then coalesce(v_is_student, false)
            else false
        end;

        if v_eligible then
            v_amount := case
                when r.value_percent is not null then round(v_subtotal * r.value_percent / 100, 2)
                else coalesce(r.value_flat, 0)
            end;

            if v_amount > 0 then
                v_discount := v_discount + v_amount;
                v_lines := v_lines || jsonb_build_object('label', r.label, 'amount', v_amount);
            end if;
        end if;
    end loop;

    return query select
        v_hours,
        v_rate,
        coalesce(v_is_peak, false),
        v_subtotal,
        v_discount,
        greatest(v_subtotal - v_discount, 0),
        round(greatest(v_subtotal - v_discount, 0) * coalesce(v_deposit_pct, 0) / 100, 2),
        v_lines;
end;
$fn$;

revoke all on function public.compute_facility_price(bigint, date, time, time)
from public, anon;
grant execute on function public.compute_facility_price(bigint, date, time, time)
to authenticated;


-- ============================================================
-- 7. create_booking() — ใช้ compute_facility_price แทนราคาคงที่เดิม
-- ============================================================
-- โครงเดิมทั้งหมด (เก็บกวาดรายการค้าง, กันเวลาผ่านมาแล้ว, สุ่ม booking_code,
-- ดัก unique/exclusion violation) เหมือน 0012 ทุกอย่าง เปลี่ยนแค่ก้อน
-- คำนวณราคา + เพิ่ม deposit_amount ตอน insert

create or replace function public.create_booking(
  p_slot_id bigint,
  p_note    text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user    uuid := auth.uid();
  v_slot    record;
  v_price   record;
  v_code    text;
  v_booking public.bookings;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนจึงจะจองสนามได้';
  end if;

  select
    s.id, s.facility_id, s.slot_date, s.start_time, s.end_time
  into v_slot
  from public.facility_time_slots s
  join public.facilities f on f.id = s.facility_id
  join public.venues     v on v.id = f.venue_id
  where s.id = p_slot_id
    and s.is_active
    and f.status = 'available'
    and v.status = 'active';

  if not found then
    raise exception 'ไม่พบช่วงเวลานี้ หรือช่วงเวลานี้ถูกปิดไปแล้ว';
  end if;

  if (v_slot.slot_date + v_slot.start_time) <= (now() at time zone 'Asia/Bangkok') then
    raise exception 'ช่วงเวลานี้ผ่านมาแล้ว ไม่สามารถจองได้';
  end if;

  perform public.expire_unpaid_bookings(30, v_slot.facility_id, v_slot.slot_date);

  select * into v_price
  from public.compute_facility_price(
    v_slot.facility_id, v_slot.slot_date, v_slot.start_time, v_slot.end_time
  );

  -- booking_code เป็น unique — สุ่มชนก็สุ่มใหม่ ไม่ใช่โยน error ใส่ผู้ใช้
  for i in 1..10 loop
    v_code := 'SPB-' || to_char(v_slot.slot_date, 'YYYYMMDD') || '-'
              || lpad(floor(random() * 10000)::int::text, 4, '0');

    begin
      insert into public.bookings (
        booking_code, user_id, facility_id, slot_id,
        booking_date, start_time, end_time,
        total_amount, deposit_amount, status, payment_status, note
      )
      values (
        v_code, v_user, v_slot.facility_id, v_slot.id,
        v_slot.slot_date, v_slot.start_time, v_slot.end_time,
        v_price.total_amount, v_price.deposit_amount, 'pending', 'unpaid',
        nullif(btrim(coalesce(p_note, '')), '')
      )
      returning * into v_booking;

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


revoke all on function public.create_booking(bigint, text) from public, anon;
grant execute on function public.create_booking(bigint, text) to authenticated;
