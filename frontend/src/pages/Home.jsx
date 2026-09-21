// หน้าแรกหลังล็อกอิน — การ์ดการจองรายการถัดไป ตัวเลขสถิติ และทางลัดไปจองสนาม
import { Link } from "react-router-dom";
import { Building2, CalendarDays, Clock, Star } from "lucide-react";
import AppHeader from "../components/AppHeader";
import { useNextBooking } from "../hooks/useBookings";
import { usePlatformStats } from "../hooks/useStats";
import {
  describeCountdown,
  describeFacility,
  describePayment,
  describePaymentTone,
  formatBookingDate,
  formatTimeRange,
} from "../lib/bookings";
import { bgField, playIcon } from "../assets/images";
import useReveal from "../hooks/useReveal";
import "./Home.css";

const numberFormat = new Intl.NumberFormat("th-TH");

// ตัวเลขอวดสถิติบนหน้าแรก — ทุกตัวต้องมาจาก DB จริงเท่านั้น
// ห้ามใส่ตัวเลขที่พิมพ์ไว้เองให้ดูดี เพราะเป็นการอ้างตัวเลขที่ไม่จริงกับผู้ใช้
function statCards(stats) {
  return [
    { value: numberFormat.format(stats.facilities), label: "สนามให้เลือกจอง" },

    // จำนวนช่องเวลาที่เปิดจองเป็นเลขจริงก็จริง แต่มันคือผลคูณของ "สนาม ×
    // ช่องเวลาต่อวัน × จำนวนวันที่เปิดล่วงหน้า" เลขเลยโตเป็นหลักหมื่นโดยที่ไม่ได้แปลว่า
    // ระบบใหญ่จริง จึงสลับมาโชว์ยอดจองของเดือนปัจจุบันแทน (นับเฉพาะ confirmed /
    // awaiting_review / no_show / completed — ที่ยกเลิกกับที่ถูกปฏิเสธไม่ถูกนับ)
    { value: numberFormat.format(stats.bookingsThisMonth), label: "การจองต่อเดือน" },

    // ดาวเฉลี่ยโชว์ได้ต่อเมื่อมีรีวิวจริงเท่านั้น ไม่งั้นก็กลับไปเป็น
    // ตัวเลขที่แต่งขึ้นแบบเดิม — ระหว่างที่ยังไม่มี ใช้จำนวนกีฬาแทน
    stats.reviewsCount > 0
      ? {
          value: (
            <>
              {stats.avgRating.toFixed(1)}
              <Star size={20} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            </>
          ),
          label: `จาก ${numberFormat.format(stats.reviewsCount)} รีวิว`,
        }
      : { value: numberFormat.format(stats.sports), label: "ประเภทกีฬา" },
  ];
}

function PlatformStats() {
  const { stats } = usePlatformStats();

  // ยังโหลดไม่เสร็จหรือโหลดไม่ได้ = ไม่ต้องโชว์อะไร ดีกว่าโชว์เลขศูนย์
  if (!stats) return null;

  return (
    <div className="home__stats" data-reveal data-reveal-delay="4">
      {statCards(stats).map((stat) => (
        <div key={stat.label} className="home__stat">
          <p className="home__stat-value">{stat.value}</p>
          <p className="home__stat-label">{stat.label}</p>
        </div>
      ))}
    </div>
  );
}

function NextBookingCard() {
  const { booking, loading, error } = useNextBooking();

  if (loading) {
    return <p className="home__booking-empty">กำลังโหลดการจองของคุณ...</p>;
  }

  if (error) {
    return <p className="home__booking-empty">{error}</p>;
  }

  if (!booking) {
    return (
      <>
        <div className="home__booking-card">
          <p className="home__booking-label">รายการถัดไป</p>
          <p className="home__booking-title">ยังไม่มีการจอง</p>
          <p className="home__booking-meta">
            เลือกสนามที่คุณชอบ แล้วเริ่มจองครั้งแรกได้เลย
          </p>
        </div>

        <div className="home__booking-actions">
          <Link to="/booking/sport" className="home__booking-primary">
            เลือกสนาม
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="home__booking-card">
        <p className="home__booking-label">รายการถัดไป</p>
        <p className="home__booking-title">{describeFacility(booking)}</p>
        <p className="home__booking-meta">
          {formatBookingDate(booking.booking_date)} ·{" "}
          {formatTimeRange(booking.start_time, booking.end_time)} น.
        </p>
      </div>

      <p className="home__booking-status">
        <span className="home__booking-countdown">
          <Clock size={16} aria-hidden="true" /> {describeCountdown(booking.booking_date)}
        </span>
        <span
          className={`home__payment-badge home__payment-badge--${describePaymentTone(booking)}`}
        >
          {describePayment(booking)}
        </span>
      </p>

      <div className="home__booking-actions">
        <Link to={`/booking/receipt?booking=${booking.id}`} className="home__booking-primary">
          ดูรายละเอียด
        </Link>
        <Link to="/booking/sport" className="home__booking-outline">
          จองใหม่
        </Link>
      </div>
    </>
  );
}

export default function Home() {
  const revealRef = useReveal();

  return (
    <div className="home" style={{ backgroundImage: `url(${bgField})` }}>
      <AppHeader />

      <main className="home__main" ref={revealRef}>
        <div className="home__hero">
          <div className="home__copy">
            <span className="home__badge" data-reveal>
              <Building2 size={16} aria-hidden="true" /> จองสนามกีฬาออนไลน์ 24 ชม.
            </span>

            <h1 className="home__title" data-reveal data-reveal-delay="1">
              จองสนามกีฬาง่ายๆ
              <br />
              กับ SPORTSBOOKING
            </h1>

            <p className="home__desc" data-reveal data-reveal-delay="2">
              ค้นหาสนามใกล้คุณ เช็กเวลาว่างแบบเรียลไทม์ และจองได้ในไม่กี่คลิก
              พร้อมสะสมแต้มแลกของรางวัล
            </p>

            <div className="home__actions" data-reveal data-reveal-delay="3">
              <Link to="/booking/sport" className="home__cta">
                จองเลยตอนนี้
                <img src={playIcon} alt="" className="home__cta-icon" />
              </Link>
              <Link to="/booking/sport" className="home__secondary">
                ดูสนามทั้งหมด
              </Link>
            </div>

            <PlatformStats />
          </div>

          <div className="home__booking" data-reveal data-reveal-delay="1">
            <div className="home__booking-header">
              <CalendarDays size={22} aria-hidden="true" />
              <h2>การจองของคุณ</h2>
            </div>

            <NextBookingCard />
          </div>
        </div>
      </main>
    </div>
  );
}
