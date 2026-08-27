import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/useAuth";

export default function ProtectedRoute() {
  const { user, suspended, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    // ใช้คลาสเดียวกับจอคั่นตอนโหลด route ที่แบ่งก้อน (ดู App.jsx)
    // ไม่งั้นข้อความจะลอยอยู่มุมซ้ายบนบนพื้นขาวเปล่า ๆ
    return <div className="route-fallback">กำลังตรวจสอบการเข้าสู่ระบบ...</div>;
  }

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: location,
          // AuthContext ตัด session ของบัญชีที่ถูกระงับทิ้งเอง ที่นี่แค่บอก
          // ผู้ใช้ว่าทำไมถึงหลุดออกมา ไม่งั้นจะเหมือนระบบเด้งออกมั่ว ๆ
          error: suspended ? "บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ" : undefined,
        }}
      />
    );
  }

  return <Outlet />;
}
