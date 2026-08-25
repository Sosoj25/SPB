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

  // จำว่าโหลด profile ของใครไปแล้ว เพื่อไม่ยิงซ้ำ
  //
  // onAuthStateChange ยิงหลายรอบกว่าที่คิด: ตอนเปิดแอป (INITIAL_SESSION /
  // SIGNED_IN ซ้อนกับ getSession ที่เรียกเอง) และทุกครั้งที่ต่ออายุ token
  // รายชั่วโมง ซึ่งไม่มีรอบไหนเลยที่ profile เปลี่ยน
  const loadedFor = useRef(null);

  useEffect(() => {
    let mounted = true;

    const applySession = async (session) => {
      if (!mounted) return;

      const nextUser = session?.user ?? null;
      setUser(nextUser);

      if (!nextUser) {
        loadedFor.current = null;
        setProfile(null);
      } else if (loadedFor.current !== nextUser.id) {
        loadedFor.current = nextUser.id;
        const data = await fetchProfile(nextUser.id);
        if (mounted) setProfile(data);
      }

      if (mounted) setLoading(false);
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

    loadedFor.current = null;
    setUser(null);
    setProfile(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) return;

    const data = await fetchProfile(user.id);
    setProfile(data);
  }, [user]);

  // ถ้าไม่ memo ค่านี้จะเป็น object ใหม่ทุกรอบ render ทำให้ทุกหน้าที่เรียก
  // useAuth() re-render ตามไปด้วยแม้ไม่มีอะไรเปลี่ยนจริง
  const value = useMemo(
    () => ({ user, profile, loading, logout, refreshProfile }),
    [user, profile, loading, logout, refreshProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
