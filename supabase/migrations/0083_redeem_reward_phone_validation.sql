-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0082).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ตรวจเบอร์โทรจัดส่งของรางวัลที่ฝั่งเซิร์ฟเวอร์
-- ============================================================
-- เดิม redeem_reward() เช็คแค่ว่าเบอร์ "ไม่ว่าง" — ค่าอย่าง "โทรหาแฟนผมนะ"
-- หรือ "081-234-5678 ต่อ 2" ผ่านเข้าไปนอนอยู่ในคิวจัดส่ง แล้วแอดมินเพิ่งมารู้
-- ตอนโทรตามของไม่ได้ หน้าเว็บกรองให้เหลือตัวเลข 10 หลักตั้งแต่ตอนพิมพ์แล้ว
-- (RewardDetail.jsx) แต่ RPC ยิงตรงได้ ด่านจริงจึงต้องอยู่ตรงนี้
--
-- เกณฑ์เดียวกับหน้าเว็บเป๊ะ ๆ (ตัวเลขล้วน 10 หลัก) ไม่เข้มกว่า — ไม่งั้นจะมี
-- เคสที่กรอกผ่านฟอร์มได้แต่โดนเซิร์ฟเวอร์ปฏิเสธ ซึ่งผู้ใช้แก้เองไม่ถูก
--
-- เก็บลงตารางเป็นตัวเลขล้วนด้วย (v_phone) แถวจัดส่งจะได้อยู่ในรูปแบบเดียวกัน
-- ทั้งตาราง กด "โทรออก" จากมือถือได้เลยโดยไม่ต้องมาไล่ลบขีดคั่นทีหลัง
--
-- แถวเก่าที่บันทึกไว้ก่อนหน้านี้ไม่ถูกแตะต้อง — ของที่ส่งไปแล้วหรือกำลังจะส่ง
-- ไม่ควรเปลี่ยนค่าที่แอดมินเห็นกลางคัน

create or replace function public.redeem_reward(
  p_reward_id       bigint,
  p_option          text default null,
  p_delivery_method text default null,
  p_recipient_name  text default null,
  p_phone           text default null,
  p_address         text default null
)
returns public.reward_redemptions
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user       uuid := auth.uid();
  v_reward     public.rewards;
  v_remaining  integer;
  v_limit_type text;
  v_mine       integer;
  v_option     text := nullif(btrim(coalesce(p_option, '')), '');
  v_method     text := nullif(btrim(coalesce(p_delivery_method, '')), '');
  -- ตัดทุกอย่างที่ไม่ใช่ตัวเลขทิ้งก่อนตรวจ เพื่อให้เบอร์ที่ผู้ใช้พิมพ์มาแบบมี
  -- ขีด/เว้นวรรค ("081-234-5678") ยังใช้ได้ตามปกติ
  v_phone      text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_code       text;
  v_row        public.reward_redemptions;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนแลกรางวัล';
  end if;

  select * into v_reward
  from public.rewards
  where id = p_reward_id
  for update;

  if not found then
    raise exception 'ไม่พบของรางวัลนี้';
  end if;

  if not v_reward.is_active then
    raise exception 'ของรางวัลนี้ปิดการแลกอยู่';
  end if;

  select remaining, limit_type into v_remaining, v_limit_type
  from public.reward_catalog
  where id = p_reward_id;

  if v_remaining is not null and v_remaining <= 0 then
    if v_limit_type = 'quota' then
      raise exception 'ของรางวัลนี้เต็มโควตาของเดือนนี้แล้ว ลองใหม่เดือนหน้า';
    else
      raise exception 'ของรางวัลนี้หมดสต๊อกแล้ว';
    end if;
  end if;

  if v_reward.per_user_limit is not null then
    select count(*) into v_mine
    from public.reward_redemptions
    where user_id = v_user
      and reward_id = p_reward_id
      and status <> 'cancelled';

    if v_mine >= v_reward.per_user_limit then
      raise exception 'ของรางวัลนี้จำกัด % ชิ้นต่อคน คุณแลกครบแล้ว',
        v_reward.per_user_limit;
    end if;
  end if;

  if array_length(v_reward.options, 1) is not null then
    if v_option is null then
      raise exception 'กรุณาเลือกตัวเลือกของรางวัลก่อน';
    end if;

    if not (v_option = any (v_reward.options)) then
      raise exception 'ตัวเลือก "%" ไม่มีให้เลือกสำหรับของรางวัลนี้', v_option;
    end if;
  else
    v_option := null;
  end if;

  if v_reward.requires_shipping then
    if v_method is null or v_method not in ('ship', 'pickup') then
      raise exception 'กรุณาเลือกวิธีรับของรางวัล';
    end if;

    if v_method = 'ship' then
      if nullif(btrim(coalesce(p_recipient_name, '')), '') is null
         or v_phone = ''
         or nullif(btrim(coalesce(p_address, '')), '') is null
      then
        raise exception 'กรุณากรอกชื่อผู้รับ เบอร์โทร และที่อยู่จัดส่งให้ครบ';
      end if;

      if v_phone !~ '^[0-9]{10}$' then
        raise exception 'เบอร์โทรจัดส่งต้องเป็นตัวเลข 10 หลัก (เช่น 0812345678)';
      end if;
    end if;
  else
    v_method := null;
  end if;

  loop
    v_code := 'SPB-RW-' || lpad((floor(random() * 100000))::int::text, 5, '0');
    exit when not exists (
      select 1 from public.reward_redemptions where redemption_code = v_code
    );
  end loop;

  perform public.apply_point_change(
    v_user,
    -v_reward.points_required,
    'spent',
    'reward',
    p_reward_id::text,
    format('แลก %s', v_reward.name)
  );

  insert into public.reward_redemptions (
    user_id, reward_id, points_used, status, redemption_code,
    expires_at, option_label, fulfillment_status,
    recipient_name, shipping_phone, shipping_address
  )
  values (
    v_user,
    p_reward_id,
    v_reward.points_required,
    'pending',
    v_code,
    now() + make_interval(days => v_reward.valid_days),
    v_option,
    case
      when not v_reward.requires_shipping then null
      when v_method = 'pickup'            then 'pickup'::public.reward_fulfillment_status
      else                                     'pending'::public.reward_fulfillment_status
    end,
    case when v_method = 'ship' then btrim(p_recipient_name) end,
    case when v_method = 'ship' then v_phone end,
    case when v_method = 'ship' then btrim(p_address) end
  )
  returning * into v_row;

  if v_reward.track_stock then
    update public.rewards
    set stock = greatest(stock - 1, 0)
    where id = p_reward_id;
  end if;

  insert into public.notifications
    (user_id, type, title, message, reference_type, reference_id)
  values (
    v_user,
    'reward_redeemed',
    'แลกรางวัลสำเร็จ',
    format(
      'คุณแลก "%s" ด้วย %s แต้มเรียบร้อยแล้ว รหัสคูปอง %s',
      v_reward.name,
      to_char(v_reward.points_required, 'FM999,999,990'),
      v_code
    ),
    'redemption',
    v_row.id::text
  );

  return v_row;
end;
$fn$;

revoke all on function public.redeem_reward(bigint, text, text, text, text, text)
  from public, anon;
grant execute on function public.redeem_reward(bigint, text, text, text, text, text)
  to authenticated, service_role;
