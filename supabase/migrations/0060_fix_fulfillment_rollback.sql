-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0058).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- แอดมินกด "จัดส่งสำเร็จ" ผิด แล้วย้อนกลับไม่ได้
-- ============================================================
--
-- 0055 ให้ 'delivered' ปิดคูปองเป็น completed + ประทับ used_at ไปด้วย ซึ่ง
-- ถูกต้องสำหรับเส้นทางปกติ (ของถึงมือลูกค้า = จบรายการ) แต่หน้า
-- AdminRewardRequests เปิดให้กดย้อนไปขั้นก่อนหน้าได้ พอกดผิดแล้วย้อนกลับ
-- fulfillment_status ขยับกลับจริง แต่ status / used_at / delivered_at ค้าง
-- อยู่ที่เดิม — ผลคือ:
--
--   * ประวัติของลูกค้าขึ้น "ใช้แล้ว" ทั้งที่ของยังอยู่ที่คลัง
--   * ปุ่ม "ยืนยันได้รับของแล้ว" หายไป (redemptionState เห็น status=completed)
--   * admin_redemption_stats นับใบนี้เป็น "ใช้แล้ว" ตลอดไป
--
-- และไม่มีทางแก้จากหน้าเว็บเลย ต้องเข้าไปแก้ในฐานข้อมูลตรง ๆ
--
-- แก้โดยให้การถอยกลับล้างร่องรอยของขั้นที่ถอยพ้นมาแล้วด้วย โดยมีเงื่อนไข
-- กันไว้สองชั้น:
--
--   1) received_at is null — ลูกค้ายังไม่ได้กดยืนยันรับของ (ถ้ากดแล้วมี
--      guard ที่บรรทัดบนบล็อกทั้งฟังก์ชันอยู่แล้ว ตรงนี้กันซ้ำอีกชั้น)
--   2) delivered_at is not null — ยืนยันว่า completed ใบนี้มาจากเส้นทาง
--      จัดส่งจริง ไม่ใช่คูปองที่ถูกตัดไปกับการจอง (consume_booking_coupon,
--      0049) ซึ่งห้ามแตะเด็ดขาด


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
  v_row    public.reward_redemptions;
  v_reward public.rewards;
  v_label  text;
  v_step   integer := public.reward_fulfillment_step(p_status);
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

  select * into v_reward from public.rewards where id = v_row.reward_id;

  update public.reward_redemptions
  set fulfillment_status = p_status,
      tracking_number    = coalesce(nullif(btrim(coalesce(p_tracking, '')), ''), tracking_number),
      shipping_carrier   = coalesce(nullif(btrim(coalesce(p_carrier, '')), ''), shipping_carrier),
      shipping_note      = coalesce(nullif(btrim(coalesce(p_note, '')), ''), shipping_note),

      -- ถอยกลับก่อน "จัดส่งแล้ว" = ของยังไม่ได้ออกจากคลัง ล้างเวลาส่งทิ้ง
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

      -- คืนคูปองกลับเป็น "ยังไม่ได้ใช้" เฉพาะใบที่ถูกปิดด้วยการจัดส่งเท่านั้น
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

  v_label := case p_status
    when 'preparing'  then 'กำลังเตรียมสินค้า'
    when 'shipped'    then 'จัดส่งแล้ว'
    when 'in_transit' then 'อยู่ระหว่างขนส่ง'
    when 'delivered'  then 'จัดส่งสำเร็จ'
    when 'pickup'     then 'พร้อมให้รับที่สนาม'
    else 'รอดำเนินการ'
  end;

  -- ไม่แจ้งเตือนตอนถอยกลับไป 'pending' — เป็นการแก้ข้อมูลฝั่งหลังบ้าน ไม่ใช่
  -- ความคืบหน้าที่ลูกค้าต้องรู้
  if p_status <> 'pending' then
    insert into public.notifications
      (user_id, type, title, message, reference_type, reference_id)
    values (
      v_row.user_id,
      'reward_shipping',
      format('ของรางวัล: %s', v_label),
      format(
        '"%s" %s%s%s',
        v_reward.name,
        v_label,
        coalesce(' · เลขพัสดุ ' || v_row.tracking_number, ''),
        case when p_status = 'delivered'
             then ' — กรุณากดยืนยันเมื่อได้รับของแล้วที่หน้าประวัติการแลกรางวัล'
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
