import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing";
import ResetPassword from "./pages/ResetPassword";
import ProtectedRoute from "./components/ProtectedRoute";
import RoleProtectedRoute from "./components/RoleProtectedRoute";

// Landing โหลดตรง ๆ เพราะเป็นหน้าแรกที่ทุกคนเห็น — ถ้า lazy จะได้จอโหลด
// คั่นก่อนเห็นอะไรเลย ส่วนที่เหลือแบ่งเป็นก้อนแยกตาม route
//
// เดิมรวมเป็นก้อนเดียว 515 kB แปลว่าคนที่แค่มาหน้า Login ต้องโหลดโค้ด
// ปฏิทิน หน้าจอง และหน้าใบเสร็จทั้งหมดไปด้วยทั้งที่ยังไม่ได้ใช้
//
// ResetPassword ก็โหลดตรง ๆ เหมือนกัน (ไม่ lazy) ด้วยเหตุผลคนละแบบ: หน้านี้
// ต้องอ่าน token จาก URL hash ให้ทันก่อนที่ Supabase client จะประมวลผลแล้ว
// เคลียร์ hash ทิ้งไปเอง ถ้า lazy อยู่ ตัว import() ที่ต้องโหลดโค้ดแยกก้อนจะ
// ช้ากว่า Supabase เกือบทุกครั้ง พอ component มาถึงจริง ๆ hash ก็ว่างไปแล้ว
// ทำให้ลิงก์ที่ยังไม่หมดอายุกลับขึ้นว่า "หมดอายุ" ทุกครั้งที่คลิกครั้งแรก
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const ForgotPasswordStep1 = lazy(() => import("./pages/ForgotPasswordStep1"));
const Home = lazy(() => import("./pages/Home"));
const Profile = lazy(() => import("./pages/Profile"));
const ProfileEdit = lazy(() => import("./pages/ProfileEdit"));
const BookingSport = lazy(() => import("./pages/BookingSport"));
const BookingField = lazy(() => import("./pages/BookingField"));
const BookingSchedule = lazy(() => import("./pages/BookingSchedule"));
const BookingPayment = lazy(() => import("./pages/BookingPayment"));
const BookingReceipt = lazy(() => import("./pages/BookingReceipt"));
const Facilities = lazy(() => import("./pages/Facilities"));
const News = lazy(() => import("./pages/News"));
const AdminOverview = lazy(() => import("./pages/AdminOverview"));
const AdminBookings = lazy(() => import("./pages/AdminBookings"));
const SuperAdminOverview = lazy(() => import("./pages/SuperAdminOverview"));
const SuperAdminUsers = lazy(() => import("./pages/SuperAdminUsers"));
const NotFound = lazy(() => import("./pages/NotFound"));

function RouteFallback() {
  return <div className="route-fallback">กำลังโหลด...</div>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPasswordStep1 />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          <Route element={<ProtectedRoute />}>
            <Route path="/home" element={<Home />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/profile/edit" element={<ProfileEdit />} />
            <Route path="/facilities" element={<Facilities />} />
            <Route path="/news" element={<News />} />

            {/* ขั้นตอนการจอง — ส่ง state ระหว่างขั้นผ่าน query string
                (?sport= ?facility= ?date= ?booking=) ไม่ใช้ state กลางทั้งแอป
                ผู้ใช้จึงกด back/forward หรือ refresh กลางคันแล้วยังอยู่ที่เดิม */}
            <Route path="/booking/sport" element={<BookingSport />} />
            <Route path="/booking/field" element={<BookingField />} />
            <Route path="/booking/schedule" element={<BookingSchedule />} />
            <Route path="/booking/payment" element={<BookingPayment />} />
            <Route path="/booking/receipt" element={<BookingReceipt />} />
          </Route>

          {/* ข้อมูลในหน้า admin/superadmin ยังเป็น mock อยู่ (รอต่อ Supabase จริง)
              แต่ route ถูกจำกัดสิทธิ์แล้วผ่าน RoleProtectedRoute */}
          <Route element={<RoleProtectedRoute allow={["admin", "super_admin"]} />}>
            <Route path="/admin/overview" element={<AdminOverview />} />
            <Route path="/admin/bookings" element={<AdminBookings />} />
          </Route>

          <Route element={<RoleProtectedRoute allow={["super_admin"]} />}>
            <Route path="/superadmin/overview" element={<SuperAdminOverview />} />
            <Route path="/superadmin/users" element={<SuperAdminUsers />} />
          </Route>

          {/* ต้องอยู่นอก ProtectedRoute: URL ที่พิมพ์ผิดควรบอกว่าไม่มีหน้านี้
              ไม่ใช่เด้งไปหน้า login ราวกับว่าหน้านี้มีอยู่จริงแต่ยังไม่มีสิทธิ์ */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
