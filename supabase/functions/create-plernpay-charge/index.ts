// สร้าง QR พร้อมเพย์จริงผ่าน PlernPay สำหรับการจองหนึ่งรายการ
//
// ============================================================
// ทำไมต้องเป็น Edge Function ไม่ใช่เรียก PlernPay ตรงจากเบราว์เซอร์
// ============================================================
// การสร้าง QR ต้องใช้ X-Client-Secret ของ PlernPay ซึ่งห้ามหลุดไปฝั่ง client
// เด็ดขาด (ต่างจาก Client ID ที่ PlernPay ออกแบบให้ฝังฝั่งหน้าเว็บได้)
//
// ============================================================
// ลำดับการทำงาน
// ============================================================
// 1. เรียก RPC create_gateway_payment ด้วย JWT ของผู้ใช้เอง (ไม่ใช่ service
//    role) เพื่อให้ RLS/ownership check ทำงานเหมือนเดิมทุกประการ — insert
//    แถว payments สถานะ pending ไว้ก่อน ยังไม่แตะ bookings เลย
// 2. เรียก POST /v1/topup/create ที่ PlernPay ได้ ref + qr_code (payload ดิบ
//    ตามมาตรฐาน EMV ไม่ใช่รูปภาพ) + unique_amount (ยอดจริงที่ต้องโอน มี
//    สตางค์สุ่มต่อท้ายเพื่อให้ PlernPay แยกแยะรายการได้)
// 3. render qr_code เป็นรูปภาพจริงด้วย npm:qrcode (ฝั่งเซิร์ฟเวอร์ ไม่ต้อง
//    เพิ่ม dependency ฝั่ง frontend)
// 4. บันทึก ref ลงแถว payments (ด้วย service role) ไว้เป็นกุญแจให้
//    check-plernpay-payment ค้นหาแถวนี้เจอตอนเช็คสถานะ

import QRCode from "npm:qrcode@1.5.4";

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

// รหัส error ของ PlernPay ที่ผู้ใช้ปลายทางเจอได้จริง — ที่เหลือ (เช่น
// 1000/1001 credentials ผิด, 1011 configuration required) เป็นความผิดฝั่ง
// เราเอง ไม่ใช่สิ่งที่ผู้ใช้แก้ไขได้ จึงตอบข้อความกลางแทน
const PLERNPAY_ERROR_MESSAGES: Record<number, string> = {
  1012: "ระบบรับชำระเงินไม่พร้อมใช้งานชั่วคราว กรุณาชำระผ่านการโอนเงินแทน",
  1013: "ระบบรับชำระเงินไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง",
  1022: "ระบบรับชำระเงินไม่พร้อมใช้งานชั่วคราว กรุณาชำระผ่านการโอนเงินแทน",
  1030: "ระบบรับชำระเงินไม่พร้อมใช้งานชั่วคราว กรุณาชำระผ่านการโอนเงินแทน",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // ยังไม่ได้ตั้งค่า PlernPay — ตอบข้อความไทยชัดเจนแทนที่จะปล่อยให้ fetch พัง
  // กลางทางแล้วโยน error ดิบ ๆ กลับไปหาผู้ใช้
  if (!PLERNPAY_CLIENT_ID || !PLERNPAY_CLIENT_SECRET) {
    return json(
      { error: "ระบบชำระเงินผ่านพร้อมเพย์ยังไม่พร้อมใช้งาน กรุณาชำระผ่านการโอนเงินแทน" },
      503
    );
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "ต้องเข้าสู่ระบบก่อนจึงจะชำระเงินได้" }, 401);

  let bookingId = "";
  try {
    const body = await req.json();
    bookingId = String(body?.bookingId ?? "");
  } catch {
    return json({ error: "คำขอไม่ถูกต้อง" }, 400);
  }

  if (!bookingId) return json({ error: "ไม่พบรายการจองนี้" }, 400);

  // ขั้นที่ 1: สร้างแถว payments แบบ pending — เรียกด้วย JWT ของผู้ใช้เอง
  // (ผ่าน anon key + Authorization header ที่ forward มา) เพื่อให้
  // _assert_payable_booking เช็คความเป็นเจ้าของ/สถานะการจองแบบเดียวกับที่
  // client เรียกตรงทุกประการ
  const createRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_gateway_payment`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_booking_id: bookingId, p_method: "qr" }),
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => null);
    return json({ error: err?.message ?? "ไม่สามารถเริ่มการชำระเงินได้" }, 400);
  }

  const payment = await createRes.json();

  // ขั้นที่ 2: สร้าง QR ที่ PlernPay — amount เป็นหน่วยบาท (ไม่ใช่สตางค์)
  // ตามตัวอย่างในเอกสาร
  const topupRes = await fetch("https://api.plernpay.com/v1/topup/create", {
    method: "POST",
    headers: {
      "X-Client-ID": PLERNPAY_CLIENT_ID,
      "X-Client-Secret": PLERNPAY_CLIENT_SECRET,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: Number(payment.amount),
      memo: `payment:${payment.id}`,
    }),
  });

  const topup = await topupRes.json().catch(() => null);

  if (!topupRes.ok || !topup?.ref) {
    // log ค่าดิบที่ PlernPay ตอบกลับไว้เสมอ — ผู้ใช้เห็นแค่ข้อความไทยกลาง ๆ
    // แต่เวลาไล่ debug ต้องรู้ code/error จริงจาก PlernPay ว่าเคสไหน
    console.error("PlernPay /v1/topup/create failed:", topupRes.status, JSON.stringify(topup));
    const message = PLERNPAY_ERROR_MESSAGES[topup?.code] ??
      "สร้าง QR พร้อมเพย์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
    return json({ error: message }, 502);
  }

  // ขั้นที่ 3: render payload ดิบให้เป็นรูป QR จริง — PlernPay คืนมาแค่สตริง
  // qr_code (มาตรฐาน EMV) ไม่ใช่รูปภาพเหมือน gateway บางเจ้า
  let qrImage: string;
  try {
    qrImage = await QRCode.toDataURL(topup.qr_code, { margin: 1, width: 320 });
  } catch (err) {
    console.error("QR render failed:", err);
    return json({ error: "สร้างรูป QR ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }, 500);
  }

  // ขั้นที่ 4: บันทึก ref ไว้ที่แถว payments ด้วย service role (ข้าม RLS ได้
  // ตรง ๆ เพราะเป็นแค่การผูก metadata ไม่ใช่การเปลี่ยนสถานะการเงิน — การ
  // เปลี่ยนสถานะยังคงต้องผ่าน confirm_gateway_payment/fail_gateway_payment
  // เท่านั้น ดู check-plernpay-payment)
  await fetch(`${SUPABASE_URL}/rest/v1/payments?id=eq.${payment.id}`, {
    method: "PATCH",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ gateway_charge_id: topup.ref }),
  });

  return json({
    paymentId: payment.id,
    amount: payment.amount,
    uniqueAmount: topup.unique_amount,
    qrImage,
    expiresAt: topup.expires_at,
    expiresIn: topup.expires_in,
  });
});
