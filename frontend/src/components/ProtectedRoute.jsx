import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/useAuth";

export default function ProtectedRoute() {
  const { user, loading } = useAuth();
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
        state={{ from: location }}
      />
    );
  }

  return <Outlet />;
}