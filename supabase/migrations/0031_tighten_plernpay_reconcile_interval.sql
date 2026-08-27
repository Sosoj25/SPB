-- ============================================================
-- ลดรอบ reconcile-plernpay-payments จาก 2 นาที เหลือ 30 วินาที
-- ============================================================
-- 2 นาทีทำให้ผู้ใช้รอนานเกินไปตอนที่ poll ปกติของ frontend พลาดจังหวะ (เช่น
-- แท็บถูกหน่วงตอนสลับไปแอปธนาคาร) ลด batch ต่อรอบลงมาพร้อมกันเพื่อคุม budget
-- rate limit ของ PlernPay ให้อยู่ในเกณฑ์เดิม (ดู reconcile-plernpay-payments)

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
    '30 seconds',
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
