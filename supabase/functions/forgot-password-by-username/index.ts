// ส่งลิงก์ตั้งรหัสผ่านใหม่จาก "ชื่อผู้ใช้หรืออีเมล" โดยไม่เปิดเผยอีเมลกลับไป
//
// คู่กับ login-with-username: หน้า ForgotPassword ก็เรียก
// get_email_by_username() จากเบราว์เซอร์เหมือนกัน จึงรั่วทางเดียวกันเป๊ะ
// ต่อให้ตัวหน้าจอจะระวังเรื่อง user enumeration ไว้ดีแล้วก็ตาม
// (มันตอบข้อความเดียวกันเสมอไม่ว่าจะเจอบัญชีหรือไม่ — แต่ RPC ที่มันเรียก
//  ระหว่างทางต่างหากที่บอกคำตอบออกไปตรง ๆ)
//
// verify_jwt = false: คนที่ลืมรหัสผ่านย่อมยังไม่มี JWT

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

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

  let identifier = "";
  let redirectTo = "";

  try {
    const body = await req.json();
    identifier = String(body?.identifier ?? "").trim();
    redirectTo = String(body?.redirectTo ?? "");
  } catch {
    // ตกลงมาที่ ok: true ข้างล่างเหมือนกัน
  }

  if (identifier) {
    const email = identifier.includes("@")
      ? identifier
      : await emailForUsername(identifier);

    if (email) {
      // redirectTo มาจาก client ก็จริง แต่ Supabase Auth ตรวจกับ
      // Redirect URL allow-list ของโปรเจกต์อีกชั้นอยู่แล้ว ปลายทางแปลก ๆ
      // จะถูกปฏิเสธที่นั่น ไม่ได้เชื่อค่านี้ลอย ๆ
      const url = new URL(`${SUPABASE_URL}/auth/v1/recover`);
      if (redirectTo) url.searchParams.set("redirect_to", redirectTo);

      await fetch(url, {
        method: "POST",
        headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    }
  }

  // ตอบเหมือนกันเสมอ ไม่ว่าจะเจอบัญชีหรือไม่ ไม่ว่าจะส่งอีเมลสำเร็จหรือไม่
  // ถ้าตอบต่างกันก็กลายเป็นเครื่องมือไล่เช็คว่าบัญชีไหนมีอยู่จริง
  return json({ ok: true });
});
