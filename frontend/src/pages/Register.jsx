import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthLayout from "../components/AuthLayout";
import FormField from "../components/FormField";
import Button from "../components/Button";
import { supabase } from "../lib/supabase";

export default function Register() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    username: "",
    password: "",
    confirmPassword: "",
    email: "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleChange = (e) => {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    });

    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    setError("");

    // ตรวจข้อมูล
    if (!form.username.trim()) {
      setError("กรุณากรอกชื่อผู้ใช้");
      return;
    }

    // ต้องตรงกับ constraint profiles_username_length ในฐานข้อมูล
    // ไม่งั้น trigger สร้าง profile จะล้มและสมัครไม่สำเร็จทั้งชุด
    if (form.username.trim().length < 3) {
      setError("ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร");
      return;
    }

    if (!form.email.trim()) {
      setError("กรุณากรอกอีเมล");
      return;
    }

    if (!form.password) {
      setError("กรุณากรอกรหัสผ่าน");
      return;
    }

    // 6 ตัวสั้นเกินไปสำหรับบัญชีที่ผูกกับการชำระเงิน
    if (form.password.length < 8) {
      setError("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร");
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError("รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน");
      return;
    }

    try {
      setLoading(true);

      // profiles.username เป็น unique ถ้าชนกันจะไปล้มที่ trigger สร้าง profile
      // ซึ่ง Supabase คืนกลับมาเป็น "Database error saving new user" ที่ผู้ใช้อ่านไม่รู้เรื่อง
      // เช็คก่อนเพื่อให้บอกสาเหตุที่แท้จริงได้
      const { data: usernameAvailable, error: usernameError } =
        await supabase.rpc("is_username_available", {
          p_username: form.username.trim(),
        });

      if (usernameError) {
        // ถ้า RPC ยังไม่ถูก deploy ก็ปล่อยให้สมัครต่อไป
        // ฝั่งฐานข้อมูลมีตัวกันชนที่แก้ชื่อซ้ำให้อัตโนมัติอยู่แล้ว (migration 0006)
        console.error("Username availability check error:", usernameError);
      } else if (usernameAvailable === false) {
        throw new Error("ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว กรุณาเลือกชื่ออื่น");
      }

      const { data, error } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,

        options: {
          data: {
            username: form.username.trim(),
          },
          emailRedirectTo: `${window.location.origin}/login`,
        },
      });

      if (error) {
        throw error;
      }

      // อีเมลนี้มีบัญชีที่ยืนยันแล้วอยู่ก่อนแล้ว: Supabase จะตอบ 200 พร้อม user
      // ปลอมที่ identities เป็น [] และ "ไม่ส่งอีเมล" ใดๆ ทั้งสิ้น (กันคนสุ่มเดาอีเมลผู้อื่น)
      // ถ้าไม่เช็คตรงนี้ ผู้ใช้ที่สมัครซ้ำจะเห็นข้อความ "เช็คอีเมล" ทั้งที่ไม่มีอีเมลถูกส่งจริง
      const emailAlreadyRegistered = data.user?.identities?.length === 0;

      // ถ้า Supabase ไม่เปิด Email Confirmation จะได้ session มาทันที
      // ให้ออกจากระบบก่อน เพื่อบังคับให้ผู้ใช้ล็อกอินเองอีกครั้ง
      const needsEmailConfirmation = !data.session && !emailAlreadyRegistered;

      if (data.session) {
        await supabase.auth.signOut();
      }

      setForm({
        username: "",
        password: "",
        confirmPassword: "",
        email: "",
      });

      navigate("/login", {
        replace: true,
        state: {
          message: emailAlreadyRegistered
            ? "อีเมลนี้มีบัญชีอยู่แล้ว หากลืมรหัสผ่านกรุณากดลืมรหัสผ่าน"
            : needsEmailConfirmation
            ? "สมัครสมาชิกสำเร็จ กรุณาตรวจสอบอีเมลเพื่อยืนยันบัญชีก่อนเข้าสู่ระบบ"
            : "สมัครสมาชิกสำเร็จ กรุณาเข้าสู่ระบบ",
        },
      });
    } catch (error) {
  console.error("Register error:", error);

  if (error.message?.toLowerCase().includes("rate limit")) {
    setError(
      "มีการส่งคำขอมากเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง"
    );
  } else {
    setError(
      error.message || "เกิดข้อผิดพลาดในการสมัครสมาชิก"
    );
  }
} finally {
  setLoading(false);
}
  };

  return (
    <AuthLayout
      title="สร้างบัญชีผู้ใช้"
      subtitle="กรุณาสร้างบัญชีของคุณ"
      footer={
        <>
          คุณต้องการเข้าสู่ระบบไหม?{" "}
          <Link to="/login" className="link">
            เข้าสู่ระบบ
          </Link>
        </>
      }
    >
      <form className="auth-card__body" onSubmit={handleSubmit}>
        {error && (
          <div className="auth-message auth-message--error">
            {error}
          </div>
        )}

        <FormField
          label="ชื่อผู้ใช้"
          name="username"
          value={form.username}
          onChange={handleChange}
        />

        <FormField
          label="รหัสผ่าน"
          name="password"
          type="password"
          value={form.password}
          onChange={handleChange}
        />

        <FormField
          label="ยืนยันรหัสผ่าน"
          name="confirmPassword"
          type="password"
          value={form.confirmPassword}
          onChange={handleChange}
        />

        <FormField
          label="อีเมล"
          name="email"
          type="email"
          value={form.email}
          onChange={handleChange}
        />

        <Button type="submit" variant="success" disabled={loading}>
          {loading ? "กำลังสร้างบัญชี..." : "สร้างบัญชี"}
        </Button>
      </form>
    </AuthLayout>
  );
}