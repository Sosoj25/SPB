// เช็คสถานะการจ่ายเงินจริงกับ PlernPay แล้วอัปเดตแถว payments ให้ตรง
//
// ============================================================
// ทำไมต้องเช็คซ้ำฝั่งเซิร์ฟเวอร์ ไม่เชื่อว่า frontend "เห็น" ว่าจ่ายแล้ว
// ============================================================
// PlernPay ไม่มี webhook มายิงหาเราเอง (มีแต่ SSE stream กับ GET ตรวจสถานะ)
// endpoint นี้จึงทำหน้าที่เป็นจุดตรวจสอบที่ frontend "ขอให้เช็คตอนนี้" แต่
// การตัดสินใจว่าจ่ายแล้วจริงหรือไม่ยังคงเกิดที่นี่เท่านั้น — เรียก
// GET /v1/topup/:ref ด้วย secret key ของเราเองเสมอ ไม่เชื่อสถานะที่ frontend
// อ้างว่าเห็นจาก SSE ตรง ๆ (เพราะ SSE เป็น response ที่เบราว์เซอร์แก้ไขเองได้
// ในเครื่องผู้ใช้ ต่างจาก HTTPS request ที่เรายิงตรงไป PlernPay จากเซิร์ฟเวอร์)
//
// ============================================================
// ข้อจำกัดสำคัญ: rate limit ของ PlernPay
// ============================================================
// เอกสารระบุ 30 requests/นาที ต่อ API key (ค่าเริ่มต้น) และ "เกินแล้วแอปจะถูก
// deactivate อัตโนมัติทันที" — เป็น budget รวมของทั้งระบบ ไม่ใช่ต่อการจอง
// หนึ่งรายการ ฟังก์ชันนี้จึงข้ามการยิงไป PlernPay ทันทีถ้าแถว payments ที่
// เจ้าของถามถึงมีสถานะ "จบแล้ว" (approved/rejected) อยู่ก่อนแล้ว — ไม่ยิงซ้ำ
// โดยไม่จำเป็น ฝั่ง frontend เองก็ poll ห่างพอสมควร (ดู BookingPayment.jsx)
// แต่ถ้าจำนวนคนจ่ายพร้อมกันเยอะขึ้นในอนาคต ควรติดต่อแอดมิน PlernPay ขอเพิ่ม
// limit ก่อน ไม่ใช่ลดช่วงเวลา poll ลง

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PLERNPAY_CLIENT_ID = Deno.env.get("PLERNPAY_CLIENT_ID") ?? "";
const PLERNPAY_CLIENT_SECRET = Deno.env.get("PLERNPAY_CLIENT_SECRET") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const serviceHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "ต้องเข้าสู่ระบบก่อน" }, 401);

  let paymentId = "";
  try {
    const body = await req.json();
    paymentId = String(body?.paymentId ?? "");
  } catch {
    return json({ error: "คำขอไม่ถูกต้อง" }, 400);
  }

  // คอลัมน์ payments.id เป็น uuid — บังคับรูปแบบตั้งแต่ตรงนี้เลย ค่าที่ไม่ใช่
  // uuid ไม่มีทางตรงกับแถวไหนได้อยู่แล้ว ตอบ 400 กลับไปเลยดีกว่าปล่อยให้ไป
  // ตายที่ PostgREST แล้วได้ error ภาษาอังกฤษกลับมาแทน
  //
  // และที่สำคัญกว่านั้น: ค่านี้ถูกต่อเข้า query string ของ PostgREST ข้างล่าง
  // ถ้าปล่อยผ่านดิบ ๆ ตัว & หรือ , ที่แทรกมาจะกลายเป็นพารามิเตอร์เพิ่มของ
  // query นั้น (เช่น &select=* ดึงคอลัมน์ที่ไม่ได้ตั้งใจเปิด) — RLS ยังกันเรื่อง
  // "แถวของใคร" ไว้อยู่ แต่ไม่ควรให้ผู้ใช้แต่ง query ของเราได้ตั้งแต่แรก
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!UUID_RE.test(paymentId)) {
    return json({ error: "ไม่พบรายการชำระเงินนี้" }, 400);
  }

  // อ่านแถวด้วย JWT ของผู้ใช้เอง (ผ่าน anon key) — payments_select_own (RLS)
  // กันไม่ให้เห็นแถวของคนอื่นอยู่แล้ว ถ้า query กลับมาว่างแปลว่าไม่ใช่ของเขา
  // หรือไม่มีอยู่จริง สองกรณีนี้ตอบเหมือนกัน
  //
  // encodeURIComponent อีกชั้นถึงจะผ่าน regex มาแล้วก็ตาม — กันไว้เผื่อวันหลัง
  // มีคนแก้เงื่อนไขข้างบนให้หลวมลงโดยไม่ทันนึกถึงบรรทัดนี้
  const findRes = await fetch(
    `${SUPABASE_URL}/rest/v1/payments?id=eq.${encodeURIComponent(paymentId)}` +
      `&select=id,status,gateway,gateway_charge_id`,
    { headers: { apikey: ANON_KEY, Authorization: authHeader } }
  );

  const rows = await findRes.json().catch(() => []);
  const payment = Array.isArray(rows) ? rows[0] : null;

  if (!findRes.ok || !payment) return json({ error: "ไม่พบรายการชำระเงินนี้" }, 404);

  // จบสถานะแล้ว (แอดมินอาจกดอนุมัติ/ปฏิเสธเองก็ได้) — ไม่ต้องยิงถาม PlernPay
  // ซ้ำ ประหยัด budget rate limit ที่ใช้ร่วมกันทั้งระบบ
  if (payment.status !== "pending" || payment.gateway !== "plernpay") {
    return json({ status: payment.status });
  }

  if (!PLERNPAY_CLIENT_ID || !PLERNPAY_CLIENT_SECRET || !payment.gateway_charge_id) {
    return json({ status: "pending" });
  }

  const statusRes = await fetch(
    `https://api.plernpay.com/v1/topup/${payment.gateway_charge_id}`,
    {
      headers: {
        "X-Client-ID": PLERNPAY_CLIENT_ID,
        "X-Client-Secret": PLERNPAY_CLIENT_SECRET,
      },
    }
  );

  // รวม rate limit (429/1030) ไว้ในเคสนี้ด้วยตั้งใจ — ตอบ "pending" เฉย ๆ
  // ให้ frontend รอรอบ poll ถัดไปตามจังหวะปกติ ไม่ retry ถี่ขึ้นซึ่งจะยิ่งซ้ำ
  // เติมปัญหา rate limit เดิม
  if (!statusRes.ok) return json({ status: "pending" });

  const topup = await statusRes.json();

  if (topup.status === "confirmed") {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/confirm_gateway_payment`, {
      method: "POST",
      headers: serviceHeaders,
      body: JSON.stringify({
        p_payment_id: paymentId,
        p_charge_id: payment.gateway_charge_id,
      }),
    });
    return json({ status: "approved" });
  }

  if (topup.status === "expired" || topup.status === "cancelled") {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/fail_gateway_payment`, {
      method: "POST",
      headers: serviceHeaders,
      body: JSON.stringify({
        p_payment_id: paymentId,
        p_charge_id: payment.gateway_charge_id,
        p_reason: topup.status === "expired" ? "QR หมดอายุ" : "ยกเลิกรายการ",
      }),
    });
    return json({ status: "rejected" });
  }

  return json({ status: "pending", expiresIn: topup.expires_in ?? null });
});
