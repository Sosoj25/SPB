-- ============================================================
-- ตัวสำรองสำหรับยืนยันการจ่ายผ่าน PlernPay (QR)
-- ============================================================
-- ปัญหาที่เจอ: check-plernpay-payment (0023) อัปเดตสถานะได้ก็ต่อเมื่อมี
-- browser tab เปิด poll ค้างอยู่เท่านั้น เพราะ PlernPay ไม่มี webhook ยิงหา
-- เราเอง — ถ้าผู้ใช้จ่ายเงินสำเร็จจริงแต่ปิดแท็บ/สลับแอปไปก่อนที่ poll รอบ
-- ถัดไปจะทัน แถว payments จะค้าง 'pending' ตลอดไปแม้ PlernPay ฝั่งเขาจะยืนยัน
-- แล้วก็ตาม (เจอเคสจริงจาก dashboard ของ PlernPay ที่ขึ้น "สำเร็จ" แต่ระบบเรา
-- ยังค้าง pending)
--
-- จึงเพิ่มตัวเช็คสำรองฝั่งเซิร์ฟเวอร์ที่ทำงานเองโดยไม่ต้องพึ่ง browser: cron
-- เรียก edge function reconcile-plernpay-payments ทุก ~2 นาที ไล่เช็คแถวที่
-- ยัง pending เกิน 90 วินาที (กันชนกับ poll ปกติของ frontend) กับ PlernPay จริง
-- แล้วอัปเดตให้ตรง — ใช้ RPC confirm_gateway_payment/fail_gateway_payment (0023,
-- 0028) เดิม ไม่เพิ่ม path ยืนยันใหม่

-- ============================================================
-- 1. เปิด pg_net (สำหรับให้ cron ยิง HTTP ไปหา edge function ได้)
-- ============================================================
create extension if not exists pg_net;

-- ============================================================
-- 2. Secret สำหรับให้ cron คุยกับ edge function อย่างปลอดภัย
-- ============================================================
-- reconcile-plernpay-payments ไม่ผูกกับผู้ใช้คนใดคนหนึ่ง (ไม่มี user JWT ให้
-- ตรวจ) จึงกันการเรียกจากภายนอกด้วย secret สุ่มที่เก็บใน Vault แทน — สุ่มค่า
-- เองตรงนี้เลย ไม่มีใครต้องรู้ค่าจริง (แม้แต่คนเขียน migration นี้) เพราะทั้ง
-- ฝั่ง cron (อ่านจาก vault ตรง ๆ) และฝั่ง edge function (เทียบผ่าน RPC ข้อ 3)
-- ไม่เคยต้อง log หรือส่งค่านี้ออกไปที่ไหนเป็น plain text
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'project_url') then
    perform vault.create_secret(
      'https://hpqopbeeddljnhidnxym.supabase.co',
      'project_url'
    );
  end if;

  if not exists (select 1 from vault.secrets where name = 'plernpay_cron_secret') then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'plernpay_cron_secret'
    );
  end if;
end;
$$;

-- ============================================================
-- 3. RPC เทียบ secret ให้ edge function เรียกใช้ (ไม่คืนค่า secret จริง)
-- ============================================================
create or replace function public.plernpay_cron_secret_matches(p_secret text)
returns boolean
language sql
security definer
set search_path = public, vault
as $fn$
  select exists (
    select 1
    from vault.decrypted_secrets
    where name = 'plernpay_cron_secret'
      and decrypted_secret = p_secret
  );
$fn$;

revoke all on function public.plernpay_cron_secret_matches(text) from public, anon, authenticated;
grant execute on function public.plernpay_cron_secret_matches(text) to service_role;

-- ============================================================
-- 4. ตั้ง cron ยิง reconcile-plernpay-payments ทุก 2 นาที
-- ============================================================
-- ถ้าโปรเจกต์ยังไม่ได้เปิด pg_cron ให้ข้ามบล็อกนี้ไปโดยไม่ทำให้ migration พัง
-- (แบบเดียวกับ expire_unpaid_bookings ใน 0012) เปิดได้ที่ Dashboard ->
-- Database -> Extensions -> pg_cron แล้วรันไฟล์นี้ซ้ำ
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'ยังไม่ได้เปิด pg_cron — ข้ามการตั้ง schedule';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'reconcile-plernpay-payments') then
    perform cron.unschedule('reconcile-plernpay-payments');
  end if;

  perform cron.schedule(
    'reconcile-plernpay-payments',
    '*/2 * * * *',
    $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/reconcile-plernpay-payments',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'plernpay_cron_secret')
      ),
      body := '{}'::jsonb
    ) as request_id;
    $cron$
  );
end;
$$;
