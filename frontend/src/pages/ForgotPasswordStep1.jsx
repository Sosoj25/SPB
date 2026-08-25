import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthLayout from "../components/AuthLayout";
import FormField from "../components/FormField";
import Button from "../components/Button";
import { requestPasswordReset } from "../lib/auth";

export default function ForgotPasswordStep1() {
  const [identifier, setIdentifier] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();

    setError("");
    setMessage("");

    const value = identifier.trim();

    if (!value) {
      setError("กรุณากรอกชื่อผู้ใช้หรืออีเมล");
      return;
    }

    try {
      setLoading(true);

      // ทั้งการหาอีเมลและการส่งอีเมลเกิดที่ฝั่ง server (Edge Function
      // forgot-password-by-username) และตอบผลเหมือนกันเสมอ
      //
      // หน้าจอนี้ระวังเรื่อง user enumeration ไว้ดีอยู่แล้ว แต่ RPC ที่มัน
      // เรียกระหว่างทางต่างหากที่คืนอีเมลจริงออกไปให้ใครก็ได้
      await requestPasswordReset(
        value,
        `${window.location.origin}/reset-password`
      );

      setMessage(
        "หากมีบัญชีที่ตรงกับข้อมูลนี้ เราได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปยังอีเมลของคุณแล้ว"
      );

    } catch (error) {
      console.error(
        "Forgot password error:",
        error
      );

      setError(
        error.message ||
          "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="ลืมรหัสผ่าน"
      subtitle="ลืมรหัสใช่หรือไม่?"
      footer={
        <>
          คุณต้องการเข้าสู่ระบบไหม?{" "}
          <Link to="/login" className="link">
            เข้าสู่ระบบ
          </Link>
        </>
      }
    >
      <form
        className="auth-card__body"
        onSubmit={handleSubmit}
      >
        {message && (
          <>
            <div className="auth-message auth-message--success">
              {message}
            </div>

            {/* บอกใบ้ให้ผู้ใช้ตรวจสอบตัวสะกดเอง โดยไม่เปิดเผยว่าบัญชีนี้มีอยู่จริงหรือไม่ */}
            <p className="auth-hint">
              หากไม่ได้รับอีเมลภายใน 2-3 นาที กรุณาตรวจสอบกล่องจดหมายขยะ (Spam)
              และตรวจสอบว่าพิมพ์ชื่อผู้ใช้หรืออีเมลถูกต้องแล้ว
            </p>
          </>
        )}

        {error && (
          <div className="auth-message auth-message--error">
            {error}
          </div>
        )}

        {!message && (
          <>
            <FormField
              label="ชื่อผู้ใช้/อีเมล"
              name="identifier"
              value={identifier}
              onChange={(e) =>
                setIdentifier(e.target.value)
              }
            />

            <Button
              type="submit"
              variant="primary"
              disabled={loading}
            >
              {loading
                ? "กำลังส่ง..."
                : "ส่งลิงก์รีเซ็ตรหัสผ่าน"}
            </Button>
          </>
        )}

        {message && (
          <>
            <Button
              type="button"
              variant="primary"
              onClick={() => navigate("/login")}
            >
              กลับไปเข้าสู่ระบบ
            </Button>

            {/* เผื่อผู้ใช้พิมพ์ผิด ให้กลับไปแก้แล้วส่งใหม่ได้โดยไม่ต้องออกจากหน้านี้ */}
            <button
              type="button"
              className="link auth-retry"
              onClick={() => setMessage("")}
            >
              กรอกชื่อผู้ใช้หรืออีเมลใหม่อีกครั้ง
            </button>
          </>
        )}
      </form>
    </AuthLayout>
  );
}
