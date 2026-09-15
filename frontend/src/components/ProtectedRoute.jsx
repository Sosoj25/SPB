// ด่านหน้าจอสำหรับทุกเส้นทางที่ต้องล็อกอิน — และเป็นที่แขวน ChatDock ไว้
// ให้หน้าต่างแชทลอยตามผู้ใช้ไปทุกหน้าหลังล็อกอิน
import { lazy, Suspense } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { ChatPopupProvider } from "../context/ChatPopupProvider";
import { useAuth } from "../context/useAuth";

// lazy กันไม่ให้โค้ดแชท (hooks/lib/ChatPopup ฯลฯ) ไปพองก้อน bundle หลักที่โหลด
// ตั้งแต่หน้า login/landing ทั้งที่หน้าเหล่านั้นไม่มีทางเห็น ChatDock เลย —
// fallback เป็น null เพราะป๊อปอัปโผล่ช้าไปเสี้ยววินาทีไม่กระทบใคร ต่างจากตัว
// เนื้อหาเพจที่ต้องมีจอ "กำลังโหลด" คั่นไว้
const ChatDock = lazy(() => import("./ChatDock"));

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

  return (
    // ChatPopupProvider เป็น context เบา ๆ (แค่ useState) ครอบทั้งคู่ไว้ เพื่อให้
    // ปุ่มแชทบน AppHeader (อยู่ลึกเข้าไปใน <Outlet/>) สั่งเปิดหน้าต่างแชทลอยใน
    // ChatDock (พี่น้องกันคนละก้อนใน tree) ได้ — ตัว provider เองไม่แตะ
    // hooks/lib ของแชทเลย จึงอยู่ eager ตรงนี้ได้โดยไม่พองก้อน bundle หลัก
    <ChatPopupProvider>
      <Outlet />
      <Suspense fallback={null}>
        <ChatDock />
      </Suspense>
    </ChatPopupProvider>
  );
}
