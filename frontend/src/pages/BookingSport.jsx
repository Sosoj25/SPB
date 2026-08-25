import { Link } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import BookingSteps from "../components/BookingSteps";
import { useAsyncData } from "../hooks/useAsyncData";
import { fetchSportCatalog } from "../lib/catalog";
import { formatBaht, todayISO } from "../lib/bookings";
import { heroSports } from "../assets/images";
import "./Booking.css";

const EMPTY = [];

export default function BookingSport() {
  const { data: sports, loading, error } = useAsyncData(
    fetchSportCatalog,
    "sport-catalog",
    EMPTY
  );

  // วันที่ตั้งต้นเดินทางไปกับ URL ตลอดทั้ง flow ผู้ใช้จะได้กด back/forward
  // หรือแชร์ลิงก์แล้วยังเห็นหน้าจอเดิม โดยไม่ต้องมี state กลางทั้งแอป
  const today = todayISO();

  return (
    <div className="booking">
      <div
        className="booking__band"
        style={{ backgroundImage: `url(${heroSports})` }}
        aria-hidden="true"
      />

      <AppHeader />

      <main className="booking__main">
        <section className="booking__intro">
          <BookingSteps current={1} />
          <h1 className="booking__title">เลือกกีฬาที่คุณต้องการจอง</h1>
          <p className="booking__lead">
            เลือกประเภทกีฬา แล้วเราจะแสดงสนามที่ว่างพร้อมราคาให้คุณเปรียบเทียบ
          </p>
        </section>

        {loading && <p className="booking-state">กำลังโหลดรายการกีฬา...</p>}

        {!loading && error && <p className="booking-state booking-state--error">{error}</p>}

        {!loading && !error && sports.length === 0 && (
          <p className="booking-state">ยังไม่มีสนามเปิดให้จองในขณะนี้</p>
        )}

        {sports.length > 0 && (
          <div className="booking__grid">
            {sports.map((sport) => (
              <article key={sport.id} className="booking-card">
                <div className="booking-card__media">
                  <img src={sport.image} alt="" className="booking-card__img" />
                </div>

                <div className="booking-card__body">
                  <div className="booking-card__head">
                    <h2 className="booking-card__name">{sport.name}</h2>
                    <span className="booking-chip">{sport.courtCount} สนาม</span>
                  </div>

                  <p className="booking-card__desc">{sport.description}</p>

                  <div className="booking-card__foot">
                    <p className="booking-card__price">
                      เริ่ม {formatBaht(sport.minPrice)}/ชม.
                    </p>
                    <Link
                      to={`/booking/field?sport=${sport.id}&date=${today}`}
                      className="booking-btn"
                    >
                      เลือก
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
