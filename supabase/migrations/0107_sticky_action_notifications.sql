-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0106).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- แจ้งเตือนที่ "ต้องลงมือทำ" ต้องค้างจนกว่าจะทำจริง
-- ============================================================
-- เดิมแจ้งเตือนทุกใบมีค่าเท่ากันหมด — กดเข้าไปดูหนึ่งครั้งก็ is_read = true
-- แล้วหลุดจากเลขบนกระดิ่งไปเลย ซึ่งถูกสำหรับเรื่องที่แค่ "บอกให้รู้"
-- (อนุมัติสลิป / ปฏิเสธสลิป / คืนเงิน / มีคนคอมเมนต์) แต่ผิดสำหรับสองเรื่อง
-- ที่ยังมีงานค้างอยู่ที่ตัวลูกค้า:
--
--   1. review_pending          — เล่นจบแล้ว รอเขียนรีวิว
--   2. reward_shipping ตอน delivered/pickup — ของถึงแล้ว รอกดยืนยันรับของ
--
-- ทั้งสองอย่างนี้ถ้ากดดูแล้วหายไป ลูกค้าก็ไม่มีอะไรเตือนอีกเลย รีวิวไม่ถูก
-- เขียน ใบแลกรางวัลค้างคิวแอดมินไม่จบสักที
--
-- ที่ทำที่นี่:
--   1. แยก type ใหม่ 'reward_receipt_pending' ออกจาก 'reward_shipping' —
--      หน้าเว็บจะได้รู้จาก type ตรง ๆ ว่าใบไหน "รอกดยืนยัน" โดยไม่ต้องไป
--      join reward_redemptions มาดู fulfillment_status ทุกครั้งที่วาดกระดิ่ง
--   2. trigger ปิดแจ้งเตือนสองชนิดนี้ให้เองเมื่องานที่ค้างเสร็จจริง ไม่ว่าจะ
--      เสร็จจากทางไหน (submit_review, confirm_redemption_received,
--      admin_cancel_redemption, แอดมินถอยสถานะจัดส่งกลับ, แก้มือใน SQL) —
--      ทำเป็น trigger แทนการไปแก้ RPC ทีละตัวเพราะเส้นทางที่ทำให้ "งานจบ"
--      มีหลายทางและเพิ่มได้อีก
--   3. เติมย้อนหลังให้ของที่ค้างอยู่ตอนนี้
--
-- reference_type ยังเป็น 'booking' / 'redemption' เหมือนเดิม — notificationLink()
-- ฝั่งหน้าเว็บพาไป /booking/receipt?booking= กับ /rewards/history ได้อยู่แล้ว


-- ============================================================
-- 1. รีวิวเสร็จ (หรือการจองพ้นสถานะรอรีวิว) = ปิดแจ้งเตือนรีวิว
-- ============================================================
-- submit_review() (0093) mark read ให้อยู่แล้ว แต่ครอบแค่ทางเดียว การจองที่
-- ถูกยกเลิก/ปรับสถานะจากฝั่งแอดมินจะทิ้งแจ้งเตือน "ให้คะแนนการใช้บริการ"
-- ค้างเป็น unread ตลอดกาลทั้งที่กดเข้าไปรีวิวไม่ได้แล้ว
--
-- เงื่อนไขคือ "หลุดจาก awaiting_review" ไม่ใช่ "เป็น completed" เพื่อให้ครอบ
-- cancelled/rejected/no_show ด้วย

create or replace function public.close_review_pending_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.notifications
  set is_read = true
  where user_id        = new.user_id
    and type           = 'review_pending'
    and reference_type = 'booking'
    and reference_id   = new.id::text
    and not is_read;

  return null;
end;
$fn$;

revoke all on function public.close_review_pending_notifications() from public, anon, authenticated;

drop trigger if exists trg_close_review_pending_notifications on public.bookings;

create trigger trg_close_review_pending_notifications
after update of status on public.bookings
for each row
when (old.status = 'awaiting_review' and new.status is distinct from old.status)
execute function public.close_review_pending_notifications();


-- ============================================================
-- 2. ยืนยันรับของแล้ว (หรือใบนั้นไม่ต้องยืนยันอีกแล้ว) = ปิดแจ้งเตือน
-- ============================================================
-- ครอบสามกรณี: ลูกค้ากดยืนยันเอง (received), แอดมินยกเลิกใบนั้น (cancelled)
-- และแอดมินถอยสถานะกลับไปต่ำกว่า step 4 เพราะกดผิด — กรณีหลังนี้ของยังไม่ถึง
-- มือลูกค้า การให้ "รอกดยืนยัน" ค้างอยู่ก็ผิดพอกัน
--
-- reward_fulfillment_step() คืน 0 ให้ค่า null อยู่แล้ว (else 0 ใน 0055) จึงไม่
-- ต้องแยกเช็ค null ก่อน — และห้ามพึ่ง short-circuit ของ or ใน Postgres

create or replace function public.close_reward_receipt_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.status = 'cancelled'
     or new.fulfillment_status = 'received'
     or public.reward_fulfillment_step(new.fulfillment_status) < 4
  then
    update public.notifications
    set is_read = true
    where user_id        = new.user_id
      and type           = 'reward_receipt_pending'
      and reference_type = 'redemption'
      and reference_id   = new.id::text
      and not is_read;
  end if;

  return null;
end;
$fn$;

revoke all on function public.close_reward_receipt_notifications() from public, anon, authenticated;

drop trigger if exists trg_close_reward_receipt_notifications on public.reward_redemptions;

create trigger trg_close_reward_receipt_notifications
after update of status, fulfillment_status on public.reward_redemptions
for each row
when (
  old.status is distinct from new.status
  or old.fulfillment_status is distinct from new.fulfillment_status
)
execute function public.close_reward_receipt_notifications();


-- ============================================================
-- 3. แจ้งเตือนตอนของถึงปลายทาง ใช้ type ของตัวเอง
-- ============================================================
-- โครงทั้งหมดยกมาจาก 0086 เปลี่ยนสามจุด:
--   - type เป็น 'reward_receipt_pending' เมื่อสถานะใหม่คือ step 4
--     (delivered = ขนส่งส่งถึงแล้ว / pickup = ให้มารับที่สนาม) ที่เหลือคง
--     'reward_shipping' เพราะเป็นความคืบหน้าเฉย ๆ ไม่มีงานให้ลูกค้าทำ
--   - ปิดใบ "รอกดยืนยัน" ใบเก่าของ redemption เดียวกันก่อนออกใบใหม่ —
--     pickup -> delivered ทั้งคู่เป็น step 4 trigger ข้อ 2 จึงไม่ปิดให้
--     ถ้าไม่ปิดเองตรงนี้ลูกค้าจะได้ "รอกดยืนยัน" ค้างสองใบของชิ้นเดียวกัน
--   - ข้อความท้ายใบ step 4 ชี้ปุ่มให้ชัดขึ้นว่าอยู่ตรงไหน

create or replace function public.admin_update_redemption_fulfillment(
  p_id       uuid,
  p_status   public.reward_fulfillment_status,
  p_tracking text default null,
  p_carrier  text default null,
  p_note     text default null
)
returns public.reward_redemptions
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row      public.reward_redemptions;
  v_reward   public.rewards;
  v_label    text;
  v_step     integer := public.reward_fulfillment_step(p_status);
  v_tracking text;
  v_carrier  text;
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;

  if p_status = 'received' then
    raise exception 'สถานะ "ลูกค้ายืนยันได้รับแล้ว" ต้องให้ลูกค้าเป็นคนกดยืนยันเอง';
  end if;

  select * into v_row
  from public.reward_redemptions
  where id = p_id
  for update;

  if not found then
    raise exception 'ไม่พบคำขอแลกรางวัลนี้';
  end if;

  if v_row.status = 'cancelled' then
    raise exception 'คำขอนี้ถูกยกเลิกไปแล้ว';
  end if;

  if v_row.fulfillment_status is null then
    raise exception 'ของรางวัลนี้ไม่ต้องจัดส่ง จึงอัปเดตสถานะจัดส่งไม่ได้';
  end if;

  if v_row.fulfillment_status = 'received' then
    raise exception 'ลูกค้ายืนยันรับของแล้ว ไม่สามารถเปลี่ยนสถานะย้อนกลับได้';
  end if;

  v_tracking := coalesce(nullif(btrim(coalesce(p_tracking, '')), ''), v_row.tracking_number);
  v_carrier  := coalesce(nullif(btrim(coalesce(p_carrier, '')), ''), v_row.shipping_carrier);

  if v_step >= 2
     and p_status <> 'pickup'
     and nullif(btrim(coalesce(v_row.shipping_address, '')), '') is not null
  then
    if nullif(btrim(coalesce(v_carrier, '')), '') is null
       or nullif(btrim(coalesce(v_tracking, '')), '') is null
    then
      raise exception 'กรุณากรอกบริษัทขนส่งและเลขพัสดุก่อนอัปเดตเป็นสถานะนี้';
    end if;
  end if;

  select * into v_reward from public.rewards where id = v_row.reward_id;

  update public.reward_redemptions
  set fulfillment_status = p_status,
      tracking_number    = coalesce(nullif(btrim(coalesce(p_tracking, '')), ''), tracking_number),
      shipping_carrier   = coalesce(nullif(btrim(coalesce(p_carrier, '')), ''), shipping_carrier),
      shipping_note      = coalesce(nullif(btrim(coalesce(p_note, '')), ''), shipping_note),

      shipped_at = case
        when p_status = 'shipped' then coalesce(shipped_at, now())
        when v_step < 2           then null
        else shipped_at
      end,

      delivered_at = case
        when p_status = 'delivered' then coalesce(delivered_at, now())
        when v_step < 4             then null
        else delivered_at
      end,

      status = case
        when p_status = 'delivered' then 'completed'::public.redemption_status
        when v_step < 4
             and v_row.received_at is null
             and v_row.delivered_at is not null
             and status = 'completed'
          then 'pending'::public.redemption_status
        else status
      end,

      used_at = case
        when p_status = 'delivered' then coalesce(used_at, now())
        when v_step < 4
             and v_row.received_at is null
             and v_row.delivered_at is not null
          then null
        else used_at
      end
  where id = p_id
  returning * into v_row;

  insert into public.reward_shipment_events
    (redemption_id, status, note, tracking_number, carrier, created_by)
  values (
    p_id,
    p_status,
    nullif(btrim(coalesce(p_note, '')), ''),
    v_row.tracking_number,
    v_row.shipping_carrier,
    (select auth.uid())
  );

  update public.notifications
  set is_read = true
  where user_id        = v_row.user_id
    and type           = 'reward_receipt_pending'
    and reference_type = 'redemption'
    and reference_id   = v_row.id::text
    and not is_read;

  v_label := case p_status
    when 'preparing'  then 'กำลังเตรียมสินค้า'
    when 'shipped'    then 'จัดส่งแล้ว'
    when 'in_transit' then 'อยู่ระหว่างขนส่ง'
    when 'delivered'  then 'จัดส่งสำเร็จ'
    when 'pickup'     then 'พร้อมให้รับที่สนาม'
    else 'รอดำเนินการ'
  end;

  if p_status <> 'pending' then
    insert into public.notifications
      (user_id, type, title, message, reference_type, reference_id)
    values (
      v_row.user_id,
      case when v_step >= 4 then 'reward_receipt_pending' else 'reward_shipping' end,
      case when v_step >= 4
           then 'รอยืนยันรับของรางวัล'
           else format('ของรางวัล: %s', v_label) end,
      format(
        '"%s" %s%s%s',
        v_reward.name,
        v_label,
        coalesce(' · เลขพัสดุ ' || v_row.tracking_number, ''),
        case when v_step >= 4
             then ' — แตะเพื่อกดยืนยันว่าได้รับของแล้ว (แนบรูปของที่ได้รับด้วยก็ได้) แจ้งเตือนนี้จะอยู่จนกว่าจะกดยืนยัน'
             else '' end
      ),
      'redemption',
      v_row.id::text
    );
  end if;

  return v_row;
end;
$fn$;

alter function public.admin_update_redemption_fulfillment(
  uuid, public.reward_fulfillment_status, text, text, text
) set search_path = public;

revoke all on function public.admin_update_redemption_fulfillment(
  uuid, public.reward_fulfillment_status, text, text, text
) from public, anon;

grant execute on function public.admin_update_redemption_fulfillment(
  uuid, public.reward_fulfillment_status, text, text, text
) to authenticated, service_role;


-- ============================================================
-- 4. เก็บกวาดของที่ค้างอยู่ตอนนี้
-- ============================================================
-- 4.1 ใบ "จัดส่งสำเร็จ / พร้อมให้รับ" ที่ยังรอลูกค้ากดยืนยัน — ย้ายมาเป็น type
--     ใหม่ เอาเฉพาะใบล่าสุดของแต่ละ redemption (distinct on) ใบเก่ากว่านั้น
--     เป็นความคืบหน้าระหว่างทาง ปล่อยให้เคลียร์แบบแจ้งเตือนทั่วไปได้
--
-- id in (...) แทน update ... from เพราะต้องการ "แถวล่าสุดต่อกลุ่ม" ซึ่ง
-- distinct on ทำให้อ่านง่ายกว่า window function ในที่นี้

update public.notifications n
set type = 'reward_receipt_pending'
where n.id in (
  select distinct on (r.id) n2.id
  from public.notifications n2
  join public.reward_redemptions r on r.id::text = n2.reference_id
  where n2.type           = 'reward_shipping'
    and n2.reference_type = 'redemption'
    and not n2.is_read
    and r.status <> 'cancelled'
    and r.fulfillment_status in ('delivered', 'pickup')
  order by r.id, n2.created_at desc
);

-- 4.2 ใบ "รอกดยืนยัน" ที่งานจบไปแล้ว (ยืนยัน/ยกเลิก/ถอยสถานะ) — trigger ข้อ 2
--     ดูแลของใหม่ ส่วนนี้ตามเก็บของที่เปลี่ยนสถานะไปก่อนหน้านี้

update public.notifications n
set is_read = true
from public.reward_redemptions r
where r.id::text        = n.reference_id
  and n.type            = 'reward_receipt_pending'
  and n.reference_type  = 'redemption'
  and not n.is_read
  and (
    r.status = 'cancelled'
    or r.fulfillment_status = 'received'
    or public.reward_fulfillment_step(r.fulfillment_status) < 4
  );

-- 4.3 ใบ "ให้คะแนนการใช้บริการ" ของการจองที่พ้นสถานะรอรีวิวไปแล้ว

update public.notifications n
set is_read = true
from public.bookings b
where b.id::text       = n.reference_id
  and n.type           = 'review_pending'
  and n.reference_type = 'booking'
  and not n.is_read
  and b.status <> 'awaiting_review';

-- 4.4 ใบที่รอกดยืนยันอยู่แต่ไม่มีแจ้งเตือนเหลือให้ย้ายใน 4.1 เลย — อ่านไปแล้ว
--     ตั้งแต่ก่อนมี type นี้ หรือแอดมินตั้ง 'pickup' ให้ตั้งแต่ตอนอนุมัติจน
--     ไม่เคยมีใบแจ้งเตือนของตัวเอง ป้ายเลขบนเมนู "แลกรางวัล"
--     (fetchPendingReceiptCount) นับใบพวกนี้อยู่แล้ว กระดิ่งจึงต้องนับด้วย
--     ไม่งั้นสองที่บอกไม่ตรงกัน
--
-- created_at ใช้เวลาที่ของถึงจริง ไม่ใช่ now() — กระดิ่งเรียงใบที่ยังไม่อ่าน
-- ขึ้นก่อนอยู่แล้ว ใบเก่าจึงไม่ตกหล่นแม้วันที่ย้อนหลัง

insert into public.notifications (user_id, type, title, message, reference_type, reference_id, created_at)
select
  r.user_id,
  'reward_receipt_pending',
  'รอยืนยันรับของรางวัล',
  format(
    '"%s" %s%s — แตะเพื่อกดยืนยันว่าได้รับของแล้ว (แนบรูปของที่ได้รับด้วยก็ได้) แจ้งเตือนนี้จะอยู่จนกว่าจะกดยืนยัน',
    coalesce(w.name, 'ของรางวัล'),
    case r.fulfillment_status when 'pickup' then 'พร้อมให้รับที่สนาม' else 'จัดส่งสำเร็จ' end,
    coalesce(' · เลขพัสดุ ' || r.tracking_number, '')
  ),
  'redemption',
  r.id::text,
  coalesce(r.delivered_at, r.created_at, now())
from public.reward_redemptions r
left join public.rewards w on w.id = r.reward_id
where r.status <> 'cancelled'
  and r.fulfillment_status in ('delivered', 'pickup')
  and not exists (
    select 1
    from public.notifications n
    where n.reference_type = 'redemption'
      and n.reference_id   = r.id::text
      and n.type           = 'reward_receipt_pending'
      and not n.is_read
  );
