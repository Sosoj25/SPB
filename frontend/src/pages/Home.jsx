import { Link } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import { useAsyncData } from "../hooks/useAsyncData";
import { useNextBooking } from "../hooks/useBookings";
import { fetchPlatformStats } from "../lib/stats";
import {
  describeCountdown,
  describeFacility,
  describePayment,
  formatBookingDate,
  formatTimeRange,
} from "../lib/bookings";
import { bgField, playIcon } from "../assets/images";
import "./Home.css";

const numberFormat = new Intl.NumberFormat("th-TH");

// ตัวเลขทุกตัวมาจาก DB จริง
//
// ของเดิมเป็นค่าที่พิมพ์ไว้ตั้งแต่ตอนทำดีไซน์ ("120+ สนามพันธมิตร" ทั้งที่มี
// 3 สนาม, "8,400+ การจองต่อเดือน" ทั้งที่มีหลักหน่วย, "4.8 ดาว" ทั้งที่ยัง
// ไม่มีรีวิวสักอัน) ซึ่งเป็นการอ้างตัวเลขที่ไม่จริงกับผู้ใช้จริง
function statCards(stats) {
  return [
    { value: numberFormat.format(stats.facilities), label: "สนามให้เลือกจอง" },
    { value: numberFormat.format(stats.openSlots), label: "ช่วงเวลาที่เปิดจอง" },

    // ดาวเฉลี่ยโชว์ได้ต่อเมื่อมีรีวิวจริงเท่านั้น ไม่งั้นก็กลับไปเป็น
    // ตัวเลขที่แต่งขึ้นแบบเดิม — ระหว่างที่ยังไม่มี ใช้จำนวนกีฬาแทน
    stats.reviewsCount > 0
      ? { value: `${stats.avgRating}★`, label: `จาก ${numberFormat.format(stats.reviewsCount)} รีวิว` }
      : { value: numberFormat.format(stats.sports), label: "ประเภทกีฬา" },
  ];
}

function PlatformStats() {
  const { data: stats } = useAsyncData(fetchPlatformStats, "platform-stats");

  // ยังโหลดไม่เสร็จหรือโหลดไม่ได้ = ไม่ต้องโชว์อะไร ดีกว่าโชว์เลขศูนย์
  if (!stats) return null;

  return (
    <div className="home__stats">
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
        <span aria-hidden="true">🕘</span> {describeCountdown(booking.booking_date)} ·{" "}
        {describePayment(booking)}
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
              <Link to="/booking/sport" className="home__cta">
                <img src={playIcon} alt="" className="home__cta-icon" />
                จองเลยตอนนี้
              </Link>
              <Link to="/booking/sport" className="home__secondary">
                ดูสนามทั้งหมด
              </Link>
            </div>

            <PlatformStats />
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
