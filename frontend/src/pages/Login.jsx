import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import AuthLayout from "../components/AuthLayout";
import FormField from "../components/FormField";
import Button from "../components/Button";
import { supabase } from "../lib/supabase";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState({
    username: "",
    password: "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState(location.state?.message || "");

  const handleChange = (e) => {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    });

    setError("");
    setMessage("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    setError("");
    setMessage("");

    if (!form.username.trim()) {
      setError("กรุณากรอกชื่อผู้ใช้");
      return;
    }

    if (!form.password) {
      setError("กรุณากรอกรหัสผ่าน");
      return;
    }

    try {
      setLoading(true);

      // 1. ค้นหา Email จาก Username
      const { data: email, error: usernameError } =
        await supabase.rpc("get_email_by_username", {
          p_username: form.username.trim(),
        });

      if (usernameError) {
        console.error("Username lookup error:", usernameError);
        throw new Error("ไม่สามารถตรวจสอบชื่อผู้ใช้ได้");
      }

      if (!email) {
        throw new Error("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
      }

      // 2. Login ด้วย Email + Password
      const { error: loginError } =
        await supabase.auth.signInWithPassword({
          email,
          password: form.password,
        });

      if (loginError) {
        console.error("Login error:", loginError);

        throw new Error("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
      }

      // 3. Login สำเร็จ
      navigate("/home", { replace: true });
    } catch (error) {
      console.error("Login failed:", error);

      setError(
        error.message || "เกิดข้อผิดพลาดในการเข้าสู่ระบบ"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="เข้าสู่ระบบ"
      subtitle="กรุณาลงชื่อเข้าใช้บัญชีของคุณ"
      footer={
        <>
          คุณลืมรหัสผ่านใช่ไหม?{" "}
          <Link to="/forgot-password" className="link">
            ลืมรหัสผ่าน
          </Link>
        </>
      }
    >
      <form
        className="auth-card__body"
        onSubmit={handleSubmit}
      >
        {message && (
          <div className="auth-message auth-message--success">
            {message}
          </div>
        )}

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

        <Button
          type="submit"
          variant="primary"
          disabled={loading}
        >
          {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
        </Button>

        <Link to="/register">
          <Button type="button" variant="success">
            สร้างบัญชี
          </Button>
        </Link>
      </form>
    </AuthLayout>
  );
}