// ตัวสำรองของ check-plernpay-payment — เรียกจาก pg_cron ทุก 30 วินาที (ดู
// migration 0030) ไม่ใช่จาก frontend
//
// ============================================================
// ทำไมต้องมีตัวนี้แยกจาก check-plernpay-payment
// ============================================================
// check-plernpay-payment อัปเดตสถานะได้ก็ต่อเมื่อ browser tab เปิด poll ค้าง
// อยู่เท่านั้น (ดูคอมเมนต์ในไฟล์นั้น) ถ้าผู้ใช้จ่ายเงินสำเร็จจริงแต่ปิดแท็บ/
// สลับแอปไปก่อน poll รอบถัดไปจะทัน แถว payments จะค้าง 'pending' ตลอดไปแม้
// PlernPay ฝั่งเขายืนยันแล้วก็ตาม — endpoint นี้จึงไล่เช็คแถวที่ค้างเองโดยไม่
// ต้องพึ่ง browser เลย
//
// ============================================================
// ทำไมต้องเช็ค x-cron-secret เอง (ไม่ใช้ verify_jwt ของแพลตฟอร์ม)
// ============================================================
// endpoint นี้ไม่ผูกกับผู้ใช้คนใดคนหนึ่ง ไม่มี user JWT ให้ตรวจ และโปรเจกต์นี้
// ใช้ publishable/secret key รุ่นใหม่ (sb_publishable_.../sb_secret_...) ซึ่ง
// ไม่ใช่ JWT — ส่งใน Authorization header ไม่ได้ (แพลตฟอร์มจะปฏิเสธก่อนโค้ด
// เราทำงานด้วยซ้ำ) จึงปิด verify_jwt แล้วเช็คเองด้วย secret สุ่มที่เก็บใน
// Vault (migration 0030) เทียบผ่าน RPC เพื่อไม่ให้ค่า secret จริงหลุดออกมา
// นอก Postgres เลยแม้แต่ตอน log
//
// ============================================================
// ทำไมจำกัด batch แค่ 5 แถวต่อรอบ
// ============================================================
// PlernPay จำกัด 30 requests/นาทีต่อ API key รวมทั้งระบบ (ดู
// check-plernpay-payment) รอบนี้รันทุก 30 วินาที (2 รอบ/นาที) ต้องเผื่อ budget
// ให้ frontend poll ปกติด้วย จึงจำกัดไว้ไม่เกิน 5 แถวต่อรอบ (~10 req/นาที
// จาก cron เหลือ ~20 req/นาทีให้ frontend)

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PLERNPAY_CLIENT_ID = Deno.env.get("PLERNPAY_CLIENT_ID") ?? "";
const PLERNPAY_CLIENT_SECRET = Deno.env.get("PLERNPAY_CLIENT_SECRET") ?? "";

// รอบนี้เข้มขึ้นเป็นทุก 30 วิ (เดิม 2 นาที) เพราะ 2 นาทีทำให้ผู้ใช้รู้สึกว่า
// ระบบค้างนานเกินไปตอนที่ poll ปกติของ frontend พลาดจังหวะ — ลด batch ลงมา
// คุมงบ rate limit ไว้ที่ ~10 req/นาทีจาก cron (2 รอบ/นาที x 5 แถว) เหลือ
// budget ~20 req/นาทีให้ frontend poll ตามปกติ (PlernPay จำกัด 30/นาทีรวม)
const BATCH_LIMIT = 5;
const STALE_MS = 15_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const serviceHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  const cronSecret = req.headers.get("x-cron-secret") ?? "";

  const authRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/plernpay_cron_secret_matches`, {
    method: "POST",
    headers: serviceHeaders,
    body: JSON.stringify({ p_secret: cronSecret }),
  });
  const authOk = await authRes.json().catch(() => false);

  if (!authRes.ok || authOk !== true) {
    return json({ error: "unauthorized" }, 401);
  }

  if (!PLERNPAY_CLIENT_ID || !PLERNPAY_CLIENT_SECRET) {
    return json({ skipped: "no plernpay credentials" });
  }

  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  const findRes = await fetch(
    `${SUPABASE_URL}/rest/v1/payments` +
      `?status=eq.pending&gateway=eq.plernpay&gateway_charge_id=not.is.null` +
      `&created_at=lt.${encodeURIComponent(cutoff)}` +
      `&select=id,gateway_charge_id&order=created_at.asc&limit=${BATCH_LIMIT}`,
    { headers: serviceHeaders }
  );

  const rows = await findRes.json().catch(() => []);
  const payments = Array.isArray(rows) ? rows : [];

  const results: Array<{ id: string; result: string }> = [];

  for (const payment of payments) {
    try {
      const statusRes = await fetch(
        `https://api.plernpay.com/v1/topup/${payment.gateway_charge_id}`,
        {
          headers: {
            "X-Client-ID": PLERNPAY_CLIENT_ID,
            "X-Client-Secret": PLERNPAY_CLIENT_SECRET,
          },
        }
      );

      if (!statusRes.ok) {
        results.push({ id: payment.id, result: "skip" });
        continue;
      }

      const topup = await statusRes.json();

      if (topup.status === "confirmed") {
        await fetch(`${SUPABASE_URL}/rest/v1/rpc/confirm_gateway_payment`, {
          method: "POST",
          headers: serviceHeaders,
          body: JSON.stringify({
            p_payment_id: payment.id,
            p_charge_id: payment.gateway_charge_id,
          }),
        });
        results.push({ id: payment.id, result: "approved" });
      } else if (topup.status === "expired" || topup.status === "cancelled") {
        await fetch(`${SUPABASE_URL}/rest/v1/rpc/fail_gateway_payment`, {
          method: "POST",
          headers: serviceHeaders,
          body: JSON.stringify({
            p_payment_id: payment.id,
            p_charge_id: payment.gateway_charge_id,
            p_reason: topup.status === "expired" ? "QR หมดอายุ" : "ยกเลิกรายการ",
          }),
        });
        results.push({ id: payment.id, result: "rejected" });
      } else {
        results.push({ id: payment.id, result: "pending" });
      }
    } catch (err) {
      console.error("reconcile-plernpay-payments error for", payment.id, err);
      results.push({ id: payment.id, result: "error" });
    }
  }

  return json({ checked: payments.length, results });
});
