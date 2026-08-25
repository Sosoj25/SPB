// เข้าสู่ระบบด้วย "ชื่อผู้ใช้ + รหัสผ่าน" โดยไม่ให้อีเมลหลุดออกไปฝั่ง client
//
// ============================================================
// ทำไมต้องมีไฟล์นี้
// ============================================================
// เดิมหน้า Login เรียก get_email_by_username() ตรง ๆ จากเบราว์เซอร์ เพื่อแปลง
// ชื่อผู้ใช้เป็นอีเมลก่อนค่อย signInWithPassword() แปลว่าใครก็ตามที่มี
// anon key (ซึ่งอยู่ในโค้ดหน้าเว็บ เปิดดูได้) ยิง RPC ตัวนั้นแล้วได้อีเมลจริง
// ของบัญชีนั้นกลับมา โดยไม่ต้องรู้รหัสผ่านและไม่ต้องล็อกอินเลย
//
//     POST /rest/v1/rpc/get_email_by_username  {"p_username":"Test1"}
//     -> "somebody@gmail.com"
//
// คอมเมนต์ใน 0004_get_email_by_username.sql เขียนข้อแลกเปลี่ยนนี้ไว้แล้ว และ
// บอกว่าทางแก้คือย้ายขั้นตอนแลกเปลี่ยนมาไว้ฝั่ง server — ไฟล์นี้คือทางแก้นั้น
// การค้นหาอีเมลเกิดขึ้นที่นี่ด้วย service role และอีเมลไม่เคยออกจาก server
//
// ============================================================
// verify_jwt = false โดยตั้งใจ
// ============================================================
// นี่คือปลายทางที่ "สร้าง" JWT ให้ผู้ใช้ ตอนเรียกจึงยังไม่มี JWT ให้ตรวจ
// ด่านที่เหลือคือ apikey ของ Supabase gateway และ rate limit ของ Auth เอง

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ข้อความเดียวสำหรับทุกกรณีที่ล็อกอินไม่ผ่าน — ไม่ว่าจะเป็นชื่อผู้ใช้ไม่มีอยู่,
// รหัสผ่านผิด หรือบัญชีถูกปิด ถ้าตอบต่างกันก็กลายเป็นเครื่องมือไล่เช็คว่า
// บัญชีไหนมีอยู่จริงแทน
const INVALID = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

async function emailForUsername(username: string): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_email_by_username`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_username: username }),
  });

  if (!res.ok) return null;

  const email = await res.json();
  return typeof email === "string" && email.length > 0 ? email : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let username = "";
  let password = "";

  try {
    const body = await req.json();
    username = String(body?.username ?? "").trim();
    password = String(body?.password ?? "");
  } catch {
    return json({ error: INVALID }, 400);
  }

  if (!username || !password) return json({ error: INVALID }, 400);

  // ผู้ใช้กรอกอีเมลมาตรง ๆ ก็ให้ผ่าน ไม่ต้องบังคับให้จำชื่อผู้ใช้
  const email = username.includes("@") ? username : await emailForUsername(username);

  // ชื่อผู้ใช้ไม่มีอยู่จริงก็ยังยิงต่อด้วยอีเมลที่ไม่มีทางมีอยู่ เพื่อให้เวลา
  // ตอบกลับใกล้เคียงกรณีรหัสผ่านผิด — ไม่งั้นเวลาที่ต่างกันจะบอกได้เองว่า
  // ชื่อผู้ใช้นั้นมีอยู่ในระบบไหม
  const target = email ?? `${crypto.randomUUID()}@invalid.local`;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: target, password }),
  });

  if (!res.ok) return json({ error: INVALID }, 400);

  const session = await res.json();

  // คืนเฉพาะสิ่งที่ client ต้องใช้เรียก supabase.auth.setSession()
  return json({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: session.token_type,
    user: session.user,
  });
});
