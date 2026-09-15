// Supabase client ตัวเดียวของทั้งแอป — ทุกไฟล์ใน lib/ import ตัวนี้
//
// ห้ามสร้าง createClient ซ้ำที่อื่น เพราะ client แต่ละตัวถือ session/
// onAuthStateChange ของตัวเอง ถ้ามีหลายตัวสถานะล็อกอินจะไม่ตรงกัน
import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
    import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey =
    import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(
    supabaseUrl,
    supabaseAnonKey
);