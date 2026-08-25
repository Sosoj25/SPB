import { supabase } from "./supabase";

const INVALID = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
const GENERIC = "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";

// supabase-js ไม่ได้เอา body ของ response ที่ status ไม่ใช่ 2xx มาให้ตรง ๆ
// มันแนบ Response ดิบไว้ที่ error.context ต้องแกะเองถึงจะได้ข้อความจริง
async function messageFrom(error, fallback) {
  try {
    const body = await error?.context?.json?.();
    return body?.error || fallback;
  } catch {
    return fallback;
  }
}

// เข้าสู่ระบบด้วยชื่อผู้ใช้ (หรืออีเมล) ผ่าน Edge Function
//
// เดิมหน้า Login ทำสองขั้นเองจากเบราว์เซอร์: แปลง username เป็น email ด้วย
// get_email_by_username() แล้วค่อย signInWithPassword() ซึ่งแปลว่าใครก็ตาม
// ที่มี anon key ยิง RPC ตัวนั้นแล้วได้อีเมลจริงของบัญชีคนอื่นกลับมาได้เลย
// โดยไม่ต้องรู้รหัสผ่าน — ตอนนี้การแปลงเกิดที่ฝั่ง server ทั้งหมด
export async function loginWithUsername(username, password) {
  const { data, error } = await supabase.functions.invoke("login-with-username", {
    body: { username, password },
  });

  if (error) throw new Error(await messageFrom(error, INVALID));
  if (!data?.access_token) throw new Error(INVALID);

  // Edge Function คืน token มาเฉย ๆ ต้องยัดเข้า client เองเพื่อให้
  // onAuthStateChange ทำงานต่อเหมือนล็อกอินปกติทุกประการ
  const { error: sessionError } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });

  if (sessionError) throw new Error(GENERIC);

  return data.user;
}

// ขอลิงก์ตั้งรหัสผ่านใหม่
//
// ตอบสำเร็จเสมอไม่ว่าจะเจอบัญชีหรือไม่ (ฝั่ง server ก็ตอบแบบเดียวกัน)
// เพราะการบอกว่า "ไม่พบบัญชีนี้" คือการยืนยันให้คนสุ่มว่าชื่อไหนมีอยู่จริง
export async function requestPasswordReset(identifier, redirectTo) {
  const { error } = await supabase.functions.invoke("forgot-password-by-username", {
    body: { identifier, redirectTo },
  });

  if (error) throw new Error(await messageFrom(error, GENERIC));
}
