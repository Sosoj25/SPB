// หน้าตั้งรหัสผ่านใหม่จากลิงก์ในอีเมล
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthLayout from "../components/AuthLayout";
import FormField from "../components/FormField";
import Button from "../components/Button";
import { supabase } from "../lib/supabase";
import { PASSWORD_HINT, validatePassword } from "../lib/password";

// Supabase ส่งข้อมูลกลับมาทาง URL hash เสมอ (ต้องอ่านตั้งแต่ render แรกสุด
// ก่อนที่ Supabase client จะประมวลผล token แล้วเคลียร์ hash ทิ้งไปแบบ async)
// - error/error_code: ลิงก์หมดอายุหรือถูกใช้ไปแล้ว
// - type=recovery: ยืนยันว่าเข้าหน้านี้มาจากลิงก์รีเซ็ตรหัสผ่านจริงๆ
function readLinkInfo() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const hashError = params.get("error");
  const isRecoveryLink = params.get("type") === "recovery";

  if (!hashError) {
    return { error: "", isRecoveryLink };
  }

  return {
    error:
      params.get("error_code") === "otp_expired"
        ? "ลิงก์รีเซ็ตรหัสผ่านหมดอายุหรือถูกใช้ไปแล้ว กรุณาขอลิงก์ใหม่อีกครั้ง"
        : "ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้อง กรุณาขอลิงก์ใหม่อีกครั้ง",
    isRecoveryLink,
  };
}

const INVALID_SESSION_MESSAGE =
  "ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้องหรือหมดอายุ กรุณาขอลิงก์ใหม่อีกครั้ง";

export default function ResetPassword() {
  const [form, setForm] = useState({
    password: "",
    confirmPassword: "",
  });

  const [loading, setLoading] = useState(false);
  const [linkInfo] = useState(readLinkInfo);
  const linkError = linkInfo.error;
  // ไม่ใช่ทั้งลิงก์ error และไม่ใช่ลิงก์รีเซ็ตรหัสผ่านเลย
  // (เช่น เข้าหน้านี้ตรงๆ ทั้งที่ไม่มี session จากอีเมล) ให้ถือว่าใช้ไม่ได้ทันที
  const notAResetLink = !linkError && !linkInfo.isRecoveryLink;
  const [checkingSession, setCheckingSession] = useState(
    !linkError && !notAResetLink
  );
  const [sessionValid, setSessionValid] = useState(false);
  const [error, setError] = useState(
    linkError || (notAResetLink ? INVALID_SESSION_MESSAGE : "")
  );
  const [message, setMessage] = useState("");

  const navigate = useNavigate();

  // ลิงก์รีเซ็ตที่ถูกต้องจะทำให้ Supabase สร้าง session ให้อัตโนมัติ
  // (จาก token ใน URL) ถ้าเข้าหน้านี้ผ่านลิงก์รีเซ็ตแต่ไม่มี session ก็แปลว่าลิงก์ใช้ไม่ได้
  useEffect(() => {
    if (linkError || notAResetLink) return;

    let mounted = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      if (event === "PASSWORD_RECOVERY" || session) {
        setSessionValid(true);
        setCheckingSession(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;

      if (session) {
        setSessionValid(true);
      } else {
        setError(INVALID_SESSION_MESSAGE);
      }

      setCheckingSession(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [linkError, notAResetLink]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    const nextForm = { ...form, [name]: value };
    setForm(nextForm);
    setMessage("");

    // แจ้งเตือนทันทีระหว่างพิมพ์ ไม่ต้องรอกดยืนยัน
    if (name === "password") {
      const passwordError = value && validatePassword(value);
      if (passwordError) {
        setError(passwordError);
        return;
      }

      if (nextForm.confirmPassword && value !== nextForm.confirmPassword) {
        setError("รหัสผ่านไม่ตรงกัน");
        return;
      }
    }

    if (name === "confirmPassword") {
      if (nextForm.password && value && nextForm.password !== value) {
        setError("รหัสผ่านไม่ตรงกัน");
        return;
      }
    }

    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    setError("");
    setMessage("");

    if (!form.password) {
      setError("กรุณากรอกรหัสผ่านใหม่");
      return;
    }

    const passwordError = validatePassword(form.password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (!form.confirmPassword) {
      setError("กรุณายืนยันรหัสผ่าน");
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError("รหัสผ่านไม่ตรงกัน");
      return;
    }

    try {
      setLoading(true);

      const { error } = await supabase.auth.updateUser({
        password: form.password,
      });

      if (error) {
        console.error("Update password error:", error);
        throw error;
      }

      setMessage(
        "เปลี่ยนรหัสผ่านเรียบร้อยแล้ว"
      );

      // เคลียร์ session ที่ได้จากลิงก์รีเซ็ต บังคับให้ผู้ใช้ล็อกอินด้วยรหัสผ่านใหม่เอง
      await supabase.auth.signOut();

      setTimeout(() => {
        navigate("/login", {
          replace: true,
          state: {
            message:
              "เปลี่ยนรหัสผ่านเรียบร้อยแล้ว กรุณาเข้าสู่ระบบ",
          },
        });
      }, 1500);

    } catch (error) {
      console.error(
        "Reset password error:",
        error
      );

      setError(
        error.message ||
          "ไม่สามารถเปลี่ยนรหัสผ่านได้"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="ตั้งรหัสผ่านใหม่"
      subtitle="ตั้งรหัสผ่านใหม่สำหรับบัญชีของคุณ"
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
          <div className="auth-message auth-message--success">
            {message}
          </div>
        )}

        {error && (
          <div className="auth-message auth-message--error">
            {error}
          </div>
        )}

        {checkingSession ? null : linkError || !sessionValid ? (
          <Button
            type="button"
            variant="primary"
            onClick={() => navigate("/forgot-password")}
          >
            ขอลิงก์ใหม่
          </Button>
        ) : (
          <>
            <FormField
              label="รหัสผ่านใหม่"
              name="password"
              type="password"
              placeholder={PASSWORD_HINT}
              value={form.password}
              onChange={handleChange}
            />

            <FormField
              label="ยืนยันรหัสผ่านใหม่"
              name="confirmPassword"
              type="password"
              value={form.confirmPassword}
              onChange={handleChange}
            />

            <Button
              type="submit"
              variant="primary"
              disabled={loading}
            >
              {loading ? "กำลังเปลี่ยนรหัสผ่าน..." : "ยืนยัน"}
            </Button>
          </>
        )}
      </form>
    </AuthLayout>
  );
}
