-- ============================================================
-- เช็คอิน / เช็คเอาต์ลูกค้าหน้าเคาน์เตอร์
-- ============================================================
-- ก่อนหน้านี้หน้า /admin/checkin เป็น mockup ล้วน (mock state ในไฟล์
-- AdminCheckin.jsx) ยังไม่มีที่เก็บสถานะเช็คอินจริงเลยทั้งระบบ
--
-- เพิ่มคอลัมน์ลง bookings ตรง ๆ (ไม่แยกตาราง check_ins) เพราะเป็นความสัมพันธ์
-- 1:1 กับการจองเสมอ — จองหนึ่งใบเช็คอิน/เช็คเอาต์ได้ครั้งเดียวต่อรอบ เหมือน
-- payments.verified_by/verified_at ที่มีอยู่แล้ว
--
-- รหัสที่ใช้เช็คอินคือ booking_code เดิม (รูปแบบ SPB-YYYYMMDD-NNNN จาก
-- create_booking ใน 0009) ที่ใบเสร็จโชว์อยู่แล้วว่า "แจ้งรหัสนี้ที่เคาน์เตอร์" —
-- เครื่องสแกน QR ฮาร์ดแวร์ (โหมด keyboard-wedge) พิมพ์ค่านี้ตรง ๆ ตามด้วย
-- Enter จึงไม่ต้องมีระบบ token แยกต่างหาก

alter table public.bookings
  add column if not exists checked_in_at timestamptz,
  add column if not exists checked_in_by uuid
    references public.profiles(id)
    on delete set null,
  add column if not exists checked_out_at timestamptz,
  add column if not exists checked_out_by uuid
    references public.profiles(id)
    on delete set null;

alter table public.bookings
  drop constraint if exists bookings_checkout_requires_checkin;

alter table public.bookings
  add constraint bookings_checkout_requires_checkin
    check (checked_out_at is null or checked_in_at is not null);

-- ใช้กรองรายการวันนี้บ่อยที่สุด (admin_today_checkins เรียกทุกครั้งที่เปิด
-- หน้าเช็คอินและทุกครั้งที่ reload หลังกดเช็คอิน/เช็คเอาต์)
create index if not exists idx_bookings_checkin_lookup
on public.bookings(booking_date, status);


-- ============================================================
-- รายการจองของวันนี้ (สำหรับหน้าเช็คอิน)
-- ============================================================
-- คืนเฉพาะ confirmed/completed — pending (ยังไม่จ่ายเงิน) กับ
-- cancelled/rejected ไม่ควรเช็คอินได้อยู่แล้ว ไม่ต้องโชว์ในลิสต์เลย

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
    coalesce(p.full_name, p.username, 'ลูกค้า') as customer_name,
    p.phone as customer_phone,
    coalesce(s.name, 'กีฬา') as sport_name,
    coalesce(f.name, 'สนาม') as facility_name,
    v.name as venue_name,
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


-- ============================================================
-- เช็คอินด้วย booking_code (มาจากเครื่องสแกน QR หรือพิมพ์ค้นหาเอง)
-- ============================================================
-- idempotent ถ้าเช็คอินไปแล้ว — สแกนซ้ำ (เช่นมือสั่นสแกนสองที) ไม่ควร error

create or replace function public.admin_checkin_booking(p_booking_code text)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_booking public.bookings;
  v_today   date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  select * into v_booking
  from public.bookings
  where upper(booking_code) = upper(btrim(coalesce(p_booking_code, '')))
  for update;

  if not found then
    raise exception 'ไม่พบรหัสการจองนี้';
  end if;

  if v_booking.booking_date <> v_today then
    raise exception 'รหัสนี้ไม่ใช่การจองของวันนี้ (%)', to_char(v_booking.booking_date, 'DD/MM/YYYY');
  end if;

  if v_booking.status in ('cancelled', 'rejected') then
    raise exception 'การจองนี้ถูกยกเลิกไปแล้ว ไม่สามารถเช็คอินได้';
  end if;

  if v_booking.status = 'pending' then
    raise exception 'การจองนี้ยังไม่ได้ชำระเงิน ไม่สามารถเช็คอินได้';
  end if;

  if v_booking.checked_out_at is not null then
    raise exception 'รายการนี้เช็คเอาต์ไปแล้ว';
  end if;

  if v_booking.checked_in_at is not null then
    return v_booking;
  end if;

  update public.bookings
  set checked_in_at = now(),
      checked_in_by = auth.uid()
  where id = v_booking.id
  returning * into v_booking;

  return v_booking;
end;
$fn$;


-- ============================================================
-- เช็คเอาต์ (ลูกค้าเล่นเสร็จ ออกจากสนามแล้ว)
-- ============================================================

create or replace function public.admin_checkout_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_booking public.bookings;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'ไม่พบรายการจองนี้';
  end if;

  if v_booking.checked_out_at is not null then
    return v_booking;
  end if;

  if v_booking.checked_in_at is null then
    raise exception 'ยังไม่ได้เช็คอิน จึงเช็คเอาต์ไม่ได้';
  end if;

  update public.bookings
  set checked_out_at = now(),
      checked_out_by = auth.uid()
  where id = v_booking.id
  returning * into v_booking;

  return v_booking;
end;
$fn$;


-- ============================================================
-- ยกเลิกเช็คอิน/เช็คเอาต์ (แก้ไขกรณีสแกน/กดผิด)
-- ============================================================
-- รีเซ็ตกลับเป็น "ยังไม่มา" ทีเดียวไม่ว่าจะอยู่สถานะเช็คอินแล้วหรือ
-- เช็คเอาต์แล้ว — เป็นปุ่มแก้ไขความผิดพลาดของแอดมิน ไม่ใช่ flow ปกติ

create or replace function public.admin_reset_checkin(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_booking public.bookings;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  update public.bookings
  set checked_in_at  = null,
      checked_in_by  = null,
      checked_out_at = null,
      checked_out_by = null
  where id = p_booking_id
  returning * into v_booking;

  if not found then
    raise exception 'ไม่พบรายการจองนี้';
  end if;

  return v_booking;
end;
$fn$;


revoke execute on function public.admin_today_checkins() from public, anon;
revoke execute on function public.admin_checkin_booking(text) from public, anon;
revoke execute on function public.admin_checkout_booking(uuid) from public, anon;
revoke execute on function public.admin_reset_checkin(uuid) from public, anon;

grant execute on function public.admin_today_checkins() to authenticated, service_role;
grant execute on function public.admin_checkin_booking(text) to authenticated, service_role;
grant execute on function public.admin_checkout_booking(uuid) to authenticated, service_role;
grant execute on function public.admin_reset_checkin(uuid) to authenticated, service_role;
