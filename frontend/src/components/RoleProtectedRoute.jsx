// เหมือน ProtectedRoute แต่เช็ค profile.role เพิ่ม — ต้อง login ผ่านมาก่อน
// (loading ของ useAuth ครอบคลุมถึงตอนโหลด profile เสร็จด้วย ดู AuthContext.jsx)
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/useAuth";

export default function RoleProtectedRoute({ allow }) {
  const { user, profile, suspended, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="route-fallback">กำลังตรวจสอบสิทธิ์...</div>;
  }

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: location,
          error: suspended ? "บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ" : undefined,
        }}
      />
    );
  }

  // มี session แต่โหลด profile ไม่สำเร็จ (เน็ตหลุด, RLS ปฏิเสธ) — บอกให้รู้
  // ว่าเกิดอะไรขึ้น ดีกว่าเด้งไป /home เงียบ ๆ ราวกับว่าไม่มีสิทธิ์ ซึ่งแยก
  // ไม่ออกจากอาการ "ไม่มีสิทธิ์จริง"
  if (!profile) {
    return (
      <div className="route-fallback">
        ตรวจสอบสิทธิ์ไม่สำเร็จ กรุณาโหลดหน้าใหม่อีกครั้ง
      </div>
    );
  }

  if (!allow.includes(profile.role)) {
    return <Navigate to="/home" replace />;
  }

  return <Outlet />;
}
