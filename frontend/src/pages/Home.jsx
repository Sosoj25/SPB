import { Link } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import { useNextBooking } from "../hooks/useBookings";
import {
  describeCountdown,
  describeFacility,
  describePayment,
  formatBookingDate,
  formatTimeRange,
} from "../lib/bookings";
import { bgField, playIcon } from "../assets/images";
import "./Home.css";

const STATS = [
  { value: "120+", label: "สนามพันธมิตร" },
  { value: "8,400+", label: "การจองต่อเดือน" },
  { value: "4.8★", label: "คะแนนผู้ใช้" },
];

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
          <Link to="/home" className="home__booking-primary">
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
        <span aria-hidden="true">🕘</span> {describeCountdown(booking.booking_date)} ·{" "}
        {describePayment(booking)}
      </p>

      <div className="home__booking-actions">
        <button type="button" className="home__booking-primary">
          ดูรายละเอียด
        </button>
        <button type="button" className="home__booking-outline">
          จองใหม่
        </button>
      </div>
    </>
  );
}

export default function Home() {
  return (
    <div className="home" style={{ backgroundImage: `url(${bgField})` }}>
      <AppHeader />

      <main className="home__main">
        <div className="home__hero">
          <div className="home__copy">
            <span className="home__badge">🏟 จองสนามกีฬาออนไลน์ 24 ชม.</span>

            <h1 className="home__title">
              จองสนามกีฬาง่ายๆ
              <br />
              กับ SPORTSBOOKING
            </h1>

            <p className="home__desc">
              ค้นหาสนามใกล้คุณ เช็กเวลาว่างแบบเรียลไทม์ และจองได้ในไม่กี่คลิก
              พร้อมสะสมแต้มแลกของรางวัล
            </p>

            <div className="home__actions">
              <Link to="/home" className="home__cta">
                <img src={playIcon} alt="" className="home__cta-icon" />
                จองเลยตอนนี้
              </Link>
              <Link to="/home" className="home__secondary">
                ดูสนามทั้งหมด
              </Link>
            </div>

            <div className="home__stats">
              {STATS.map((stat) => (
                <div key={stat.label} className="home__stat">
                  <p className="home__stat-value">{stat.value}</p>
                  <p className="home__stat-label">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="home__booking">
            <div className="home__booking-header">
              <span aria-hidden="true">🗓</span>
              <h2>การจองของคุณ</h2>
            </div>

            <NextBookingCard />
          </div>
        </div>
      </main>
    </div>
  );
}
