// ผังเส้นทางทั้งแอป — ใครเข้าหน้าไหนได้กำหนดที่นี่ผ่าน ProtectedRoute /
// RoleProtectedRoute (ด่านจริงคือ RLS ฝั่งฐานข้อมูล ตรงนี้กันแค่ชั้นหน้าจอ)
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Landing from "./pages/Landing";
import ResetPassword from "./pages/ResetPassword";
import ProtectedRoute from "./components/ProtectedRoute";
import RoleProtectedRoute from "./components/RoleProtectedRoute";

// ทุกหน้าแบ่งเป็นก้อนแยกตาม route (lazy) ไม่งั้นคนที่แค่มาหน้า Login ต้อง
// โหลดโค้ดปฏิทิน หน้าจอง และหน้าใบเสร็จไปด้วยทั้งที่ยังไม่ได้ใช้
//
// ยกเว้นสองหน้านี้ที่โหลดตรง ๆ: Landing เพราะเป็นหน้าแรกที่ทุกคนเห็น ถ้า lazy
// จะได้จอโหลดคั่นก่อนเห็นอะไรเลย
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
const NewsDetail = lazy(() => import("./pages/NewsDetail"));
const Contact = lazy(() => import("./pages/Contact"));
const Community = lazy(() => import("./pages/Community"));
const CommunityPost = lazy(() => import("./pages/CommunityPost"));
const CommunityReviews = lazy(() => import("./pages/CommunityReviews"));
const CommunityProfile = lazy(() => import("./pages/CommunityProfile"));
const Messages = lazy(() => import("./pages/Messages"));
const Rewards = lazy(() => import("./pages/Rewards"));
const RewardDetail = lazy(() => import("./pages/RewardDetail"));
const RewardHistory = lazy(() => import("./pages/RewardHistory"));
const AdminOverview = lazy(() => import("./pages/AdminOverview"));
const AdminBookings = lazy(() => import("./pages/AdminBookings"));
const AdminFacilities = lazy(() => import("./pages/AdminFacilities"));
const AdminFacilityPricing = lazy(() => import("./pages/AdminFacilityPricing"));
const AdminSchedule = lazy(() => import("./pages/AdminSchedule"));
const AdminCheckin = lazy(() => import("./pages/AdminCheckin"));
const AdminRewardScan = lazy(() => import("./pages/AdminRewardScan"));
const AdminWalkIn = lazy(() => import("./pages/AdminWalkIn"));
const AdminPayments = lazy(() => import("./pages/AdminPayments"));
const AdminRefunds = lazy(() => import("./pages/AdminRefunds"));
const AdminPaymentSettings = lazy(() => import("./pages/AdminPaymentSettings"));
const AdminNews = lazy(() => import("./pages/AdminNews"));
const AdminCommunity = lazy(() => import("./pages/AdminCommunity"));
const AdminRewards = lazy(() => import("./pages/AdminRewards"));
const AdminRewardRequests = lazy(() => import("./pages/AdminRewardRequests"));
const AdminRedemptionHistory = lazy(() => import("./pages/AdminRedemptionHistory"));
const AdminNewsEditor = lazy(() => import("./pages/AdminNewsEditor"));
const AdminSupport = lazy(() => import("./pages/AdminSupport"));
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
            <Route path="/news/:id" element={<NewsDetail />} />
            <Route path="/contact" element={<Contact />} />

            <Route path="/community" element={<Community />} />
            <Route path="/community/reviews" element={<CommunityReviews />} />
            <Route path="/community/post/:id" element={<CommunityPost />} />
            <Route path="/community/profile/:handle" element={<CommunityProfile />} />
            <Route path="/messages" element={<Messages />} />

            {/* แลกรางวัล — /rewards/history ต้องมาก่อน /rewards/:id ไม่งั้น
                "history" จะถูกจับเป็น id แล้วยิงคิวรีหาของรางวัลที่ไม่มีอยู่ */}
            <Route path="/rewards" element={<Rewards />} />
            <Route path="/rewards/history" element={<RewardHistory />} />
            <Route path="/rewards/:id" element={<RewardDetail />} />

            {/* ขั้นตอนการจอง — ส่ง state ระหว่างขั้นผ่าน query string
                (?sport= ?facility= ?date= ?booking=) ไม่ใช้ state กลางทั้งแอป
                ผู้ใช้จึงกด back/forward หรือ refresh กลางคันแล้วยังอยู่ที่เดิม */}
            <Route path="/booking/sport" element={<BookingSport />} />
            <Route path="/booking/field" element={<BookingField />} />
            <Route path="/booking/schedule" element={<BookingSchedule />} />
            <Route path="/booking/payment" element={<BookingPayment />} />
            <Route path="/booking/receipt" element={<BookingReceipt />} />
          </Route>

          {/* หน้า admin/superadmin ต่อกับ Supabase RPC จริงแล้ว (0015/0016)
              route ถูกจำกัดสิทธิ์ผ่าน RoleProtectedRoute (client-side)
              และฝั่ง server มี RLS + security definer RPC เช็คสิทธิ์ซ้ำอีกชั้น */}
          <Route element={<RoleProtectedRoute allow={["admin", "super_admin"]} />}>
            <Route path="/admin/overview" element={<AdminOverview />} />
            <Route path="/admin/bookings" element={<AdminBookings />} />
            <Route path="/admin/facilities" element={<AdminFacilities />} />
            <Route path="/admin/pricing" element={<AdminFacilityPricing />} />
            {/* รวมเข้ากับหน้าราคาแล้ว (ชื่อ ที่ตั้ง ราคา รูปภาพ อยู่หน้าเดียวกัน)
                คงลิงก์เดิมไว้กันบุ๊กมาร์ก/ลิงก์เก่าพัง */}
            <Route path="/admin/photos" element={<Navigate to="/admin/pricing" replace />} />
            <Route path="/admin/schedule" element={<AdminSchedule />} />
            <Route path="/admin/checkin" element={<AdminCheckin />} />
            <Route path="/admin/walk-in" element={<AdminWalkIn />} />
            <Route path="/admin/payments" element={<AdminPayments />} />
            <Route path="/admin/refunds"  element={<AdminRefunds />} />
            <Route path="/admin/payments/settings" element={<AdminPaymentSettings />} />
            <Route path="/admin/community" element={<AdminCommunity />} />
            <Route path="/admin/rewards" element={<AdminRewards />} />
            <Route path="/admin/reward-requests" element={<AdminRewardRequests />} />
            <Route path="/admin/reward-history" element={<AdminRedemptionHistory />} />
            <Route path="/admin/reward-scan" element={<AdminRewardScan />} />
            <Route path="/admin/support" element={<AdminSupport />} />
            <Route path="/admin/news" element={<AdminNews />} />
            <Route path="/admin/news/editor" element={<AdminNewsEditor />} />
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
