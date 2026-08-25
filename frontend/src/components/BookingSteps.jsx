import { Link } from "react-router-dom";
import "./BookingSteps.css";

const STEP_LABELS = ["เลือกกีฬา", "เลือกสนาม", "เลือกวันและเวลา", "ยืนยันการจอง"];

// links[i] คือปลายทางของขั้นที่ i+1 — ส่ง null มาได้ถ้าขั้นนั้นยังกลับไปไม่ได้
//
// เดิม default เป็น /booking/field และ /booking/schedule แบบไม่มี query string
// ซึ่งกดแล้วเด้งกลับหน้าเลือกกีฬาเสมอ เพราะสองหน้านั้นต้องรู้ว่า sport/facility
// ไหน แต่ breadcrumb ไม่ได้ส่งไปให้ ตอนนี้หน้าที่รู้ค่าเท่านั้นที่ส่ง URL มา
// ขั้นที่ยังไม่รู้ context จะเป็นป้ายเฉย ๆ ที่กดไม่ได้ ไม่ใช่ลิงก์ที่พาไปผิดที่
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

            {to ? (
              <Link to={to} className={className} aria-current={ariaCurrent}>
                {i + 1} {label}
              </Link>
            ) : (
              <span className={className} aria-current={ariaCurrent}>
                {i + 1} {label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
