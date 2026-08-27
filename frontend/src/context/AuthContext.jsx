import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "../lib/supabase";
import { AuthContext } from "./auth-context";

async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("Profile error:", error);
    return null;
  }

  return data;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [suspended, setSuspended] = useState(false);

  // คำขอ profile ที่กำลังบินอยู่ เก็บเป็น "promise" ไม่ใช่แค่ธง "โหลดไปแล้ว"
  //
  // onAuthStateChange ยิงหลายรอบกว่าที่คิด: ตอนเปิดแอป (INITIAL_SESSION /
  // SIGNED_IN ซ้อนกับ getSession ที่เรียกเอง) และทุกครั้งที่ต่ออายุ token
  // รายชั่วโมง — ทั้งสองทางเรียก applySession() พร้อมกันได้
  //
  // เดิมที่นี่เป็น ref เก็บแค่ user id ที่โหลดไปแล้ว (loadedFor) ซึ่งกันการยิง
  // ซ้ำได้จริง แต่พังตอนสองสายชนกันพอดี:
  //
  //   สาย A (จาก getSession)  เห็นว่ายังไม่เคยโหลด -> ตั้ง loadedFor = id
  //                           ทันที แล้วค่อย await fetchProfile()
  //   สาย B (INITIAL_SESSION) มาถึงระหว่างที่ A ยัง await อยู่ เห็นว่า
  //                           loadedFor ตรงกับ id แล้ว -> ข้ามทั้งบล็อก
  //                           ไปถึง setLoading(false) เลย
  //
  // ผลคือ loading กลายเป็น false ตั้งแต่ profile ยังเป็น null อยู่ —
  // ProtectedRoute ไม่เป็นไรเพราะเช็คแค่ user แต่ RoleProtectedRoute เช็ค
  // profile.role ด้วย มันจึงอ่านได้ undefined แล้วเด้งไป /home ทุกครั้งที่
  // แอดมิน "กดรีเฟรช" บนหน้า /admin/* หรือ /superadmin/*
  //
  // เก็บเป็น promise แทน ทำให้สาย B รอ "ผลเดียวกัน" กับสาย A แทนที่จะข้ามไป
  // — ยังยิง query แค่ครั้งเดียวเหมือนเดิม แต่ไม่มีใครประกาศว่าโหลดเสร็จก่อน
  // ที่ profile จะมาถึงจริง
  const profileRequest = useRef({ userId: null, promise: null });

  useEffect(() => {
    let mounted = true;

    const applySession = async (session) => {
      if (!mounted) return;

      const nextUser = session?.user ?? null;
      setUser(nextUser);

      if (!nextUser) {
        profileRequest.current = { userId: null, promise: null };
        setProfile(null);
        setLoading(false);
        return;
      }

      if (profileRequest.current.userId !== nextUser.id) {
        profileRequest.current = {
          userId: nextUser.id,
          promise: fetchProfile(nextUser.id),
        };
      }

      const data = await profileRequest.current.promise;
      if (!mounted) return;

      // บัญชีถูกระงับ (is_active = false) — ตัด session ทิ้งทันที
      //
      // ด่านตอนล็อกอินอยู่ที่ resolve_login_email() ฝั่ง server (0021) แต่
      // มันกันได้แค่ "การล็อกอินครั้งใหม่" คนที่ล็อกอินค้างอยู่ก่อนถูกระงับ
      // ยังถือ token ที่ต่ออายุตัวเองได้เรื่อย ๆ ไม่มีวันหมด ตรงนี้คือด่าน
      // ที่ทำงานทุกครั้งที่โหลด profile ใหม่ — ซึ่งรวมถึงตอน token refresh
      // รายชั่วโมงด้วย (ดู TOKEN_REFRESHED ข้างล่างที่ล้าง cache ทิ้งก่อน)
      // จึงเตะออกได้ภายในไม่เกินหนึ่งรอบ refresh
      if (data && data.is_active === false) {
        setSuspended(true);
        profileRequest.current = { userId: null, promise: null };
        setUser(null);
        setProfile(null);
        setLoading(false);
        await supabase.auth.signOut();
        return;
      }

      setProfile(data);
      setLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => applySession(data.session));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // Session ชั่วคราวจากลิงก์รีเซ็ตรหัสผ่าน ไม่ควรนับเป็น login
      // ปล่อยให้หน้า ResetPassword เป็นคนจัดการ session นี้เอง
      // ไม่งั้นแค่เปิดลิงก์อีเมลก็จะเข้าแอปได้เลยโดยไม่ต้องตั้งรหัสผ่านใหม่
      if (event === "PASSWORD_RECOVERY") return;

      // callback ตัวนี้ถูกเรียกขณะที่ supabase-js ถือ lock ของ auth อยู่
      // ถ้า await เมธอดของ supabase ข้างในตรง ๆ (เดิม await loadProfile())
      // มีโอกาสค้างกันเอง — เอกสาร supabase-js เตือนเรื่องนี้ไว้
      // setTimeout 0 คือการรอให้ callback จบและปล่อย lock ก่อนค่อยทำงานต่อ
      setTimeout(() => {
        // token ต่ออายุรายชั่วโมงคือจังหวะที่ถูกที่สุดในการถามซ้ำว่าบัญชีนี้
        // ยังใช้งานได้อยู่ไหม ทิ้ง cache เพื่อบังคับให้ยิง profile ใหม่จริง ๆ
        // ไม่งั้นการเช็ค is_active ข้างบนจะอ่านค่าที่ค้างมาตั้งแต่เปิดแอป
        if (event === "TOKEN_REFRESHED") {
          profileRequest.current = { userId: null, promise: null };
        }

        applySession(session);
      }, 0);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const logout = useCallback(async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("Logout error:", error);
      throw error;
    }

    profileRequest.current = { userId: null, promise: null };
    setUser(null);
    setProfile(null);
    setSuspended(false);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) return;

    // อัปเดต cache ด้วย ไม่ใช่แค่ setProfile — ไม่งั้นรอบ token refresh
    // ถัดไปจะ await promise เก่าแล้วเขียนทับด้วยค่าก่อนแก้ไข
    const promise = fetchProfile(user.id);
    profileRequest.current = { userId: user.id, promise };

    const data = await promise;
    setProfile(data);
  }, [user]);

  // ถ้าไม่ memo ค่านี้จะเป็น object ใหม่ทุกรอบ render ทำให้ทุกหน้าที่เรียก
  // useAuth() re-render ตามไปด้วยแม้ไม่มีอะไรเปลี่ยนจริง
  const value = useMemo(
    () => ({ user, profile, loading, suspended, logout, refreshProfile }),
    [user, profile, loading, suspended, logout, refreshProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
