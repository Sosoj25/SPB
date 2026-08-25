import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing";
import ProtectedRoute from "./components/ProtectedRoute";

// Landing โหลดตรง ๆ เพราะเป็นหน้าแรกที่ทุกคนเห็น — ถ้า lazy จะได้จอโหลด
// คั่นก่อนเห็นอะไรเลย ส่วนที่เหลือแบ่งเป็นก้อนแยกตาม route
//
// เดิมรวมเป็นก้อนเดียว 515 kB แปลว่าคนที่แค่มาหน้า Login ต้องโหลดโค้ด
// ปฏิทิน หน้าจอง และหน้าใบเสร็จทั้งหมดไปด้วยทั้งที่ยังไม่ได้ใช้
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const ForgotPasswordStep1 = lazy(() => import("./pages/ForgotPasswordStep1"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Home = lazy(() => import("./pages/Home"));
const Profile = lazy(() => import("./pages/Profile"));
const ProfileEdit = lazy(() => import("./pages/ProfileEdit"));
const BookingSport = lazy(() => import("./pages/BookingSport"));
const BookingField = lazy(() => import("./pages/BookingField"));
const BookingSchedule = lazy(() => import("./pages/BookingSchedule"));
const BookingPayment = lazy(() => import("./pages/BookingPayment"));
const BookingReceipt = lazy(() => import("./pages/BookingReceipt"));
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

            {/* ขั้นตอนการจอง — ส่ง state ระหว่างขั้นผ่าน query string
                (?sport= ?facility= ?date= ?booking=) ไม่ใช้ state กลางทั้งแอป
                ผู้ใช้จึงกด back/forward หรือ refresh กลางคันแล้วยังอยู่ที่เดิม */}
            <Route path="/booking/sport" element={<BookingSport />} />
            <Route path="/booking/field" element={<BookingField />} />
            <Route path="/booking/schedule" element={<BookingSchedule />} />
            <Route path="/booking/payment" element={<BookingPayment />} />
            <Route path="/booking/receipt" element={<BookingReceipt />} />
          </Route>

          {/* ต้องอยู่นอก ProtectedRoute: URL ที่พิมพ์ผิดควรบอกว่าไม่มีหน้านี้
              ไม่ใช่เด้งไปหน้า login ราวกับว่าหน้านี้มีอยู่จริงแต่ยังไม่มีสิทธิ์ */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
