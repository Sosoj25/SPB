import { Link } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { logoShield } from "../assets/images";
import "./NotFound.css";

// เดิมไม่มี route "*" เลย พิมพ์ URL ผิดแล้วได้จอขาวเปล่า ๆ ไม่มีอะไรบอก
// และกลับหน้าแรกไม่ได้นอกจากแก้ URL เอง
export default function NotFound() {
  const { user } = useAuth();

  return (
    <main className="notfound">
      <img src={logoShield} alt="SPORTSBOOKING" className="notfound__logo" />

      <p className="notfound__code">404</p>
      <h1 className="notfound__title">ไม่พบหน้าที่คุณกำลังหา</h1>
      <p className="notfound__desc">
        หน้านี้อาจถูกย้าย ถูกลบ หรือลิงก์ที่กดมาพิมพ์ผิดไปตัวหนึ่ง
      </p>

      <div className="notfound__actions">
        {/* ยังไม่ล็อกอินแล้วส่งไป /home จะโดน ProtectedRoute เด้งไปหน้า login
            ซึ่งงงกว่าเดิม — ส่งไปหน้าแรกที่เปิดดูได้จริงแทน */}
        <Link to={user ? "/home" : "/"} className="notfound__primary">
          {user ? "กลับหน้าหลัก" : "กลับหน้าแรก"}
        </Link>

        {user && (
          <Link to="/booking/sport" className="notfound__secondary">
            ไปหน้าจองสนาม
          </Link>
        )}
      </div>
    </main>
  );
}
