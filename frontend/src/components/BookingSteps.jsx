// แถบขั้นตอนการจอง (breadcrumb) ด้านบนของทุกหน้าในโฟลว์จอง
//
// links[i] คือปลายทางของขั้นที่ i+1 — ส่ง null มาได้ถ้าขั้นนั้นยังกลับไปไม่ได้
// หน้าที่รู้ว่ากำลังจองสนาม/กีฬาไหนเท่านั้นที่ส่ง URL พร้อม query string มาให้
// ขั้นที่ยังไม่รู้ context ต้องเป็นป้ายกดไม่ได้ ไม่ใช่ลิงก์ที่พาไปผิดที่
import { Link } from "react-router-dom";
import "./BookingSteps.css";

const STEP_LABELS = ["เลือกกีฬา", "เลือกสนาม", "เลือกวันและเวลา", "ยืนยันการจอง"];

export default function BookingSteps({ current, links = [], labels = STEP_LABELS }) {
  return (
    <nav className="booking-steps" aria-label="ขั้นตอนการจอง">
      {labels.map((label, i) => {
        const isActive = i + 1 === current;
        const className = `booking-steps__item ${
          isActive ? "booking-steps__item--active" : ""
        }`;
        const ariaCurrent = isActive ? "step" : undefined;
        const to = isActive ? null : links[i];

        return (
          <span key={label} className="booking-steps__group">
            {i > 0 && (
              <span className="booking-steps__sep" aria-hidden="true">
                ›
              </span>
            )}

            {/* ชื่อขั้นตอนแยก span ของตัวเอง เพื่อให้จอมือถือเล็กซ่อนเฉพาะชื่อ
                แล้วเหลือตัวเลขเป็นวงกลมกดได้ (ดู @media ใน BookingSteps.css)
                — ซ่อนด้วย CSS ไม่ใช่ตัดออกจาก DOM ชื่อเต็มจะได้ยังถูกอ่านโดย
                โปรแกรมอ่านหน้าจอเหมือนเดิม */}
            {to ? (
              <Link to={to} className={className} aria-current={ariaCurrent}>
                {i + 1} <span className="booking-steps__label">{label}</span>
              </Link>
            ) : (
              <span className={className} aria-current={ariaCurrent}>
                {i + 1} <span className="booking-steps__label">{label}</span>
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
