import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/useAuth";

// เหมือน ProtectedRoute แต่เช็ค profile.role เพิ่ม — ต้อง login ผ่านมาก่อน
// (loading ของ useAuth ครอบคลุมถึงตอนโหลด profile เสร็จด้วย ดู AuthContext.jsx)
export default function RoleProtectedRoute({ allow }) {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="route-fallback">กำลังตรวจสอบสิทธิ์...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!allow.includes(profile?.role)) {
    return <Navigate to="/home" replace />;
  }

  return <Outlet />;
}
