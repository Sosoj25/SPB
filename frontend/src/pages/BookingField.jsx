// ขั้นที่ 2 ของการจอง — เลือกสนามของกีฬาที่เลือกไว้ พร้อมป้ายบอกความว่างของวันนี้
import { useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import BookingSteps from "../components/BookingSteps";
import { useAsyncData } from "../hooks/useAsyncData";
import { fetchFacilitiesBySport, fetchSportAvailability } from "../lib/catalog";
import { useBookingWindow } from "../hooks/useBookings";
import { formatBaht, formatBookingDate, todayISO } from "../lib/bookings";
import { heroFields } from "../assets/images";
import "./Booking.css";

const EMPTY_LIST = [];
const EMPTY_MAP = new Map();
const ALL = "ทั้งหมด";

// จำนวนช่วงที่เหลือแปลงเป็นป้ายสี: เหลือน้อยควรเร่งให้ผู้ใช้ตัดสินใจ
// แต่ต้องไม่ทำให้สนามที่เต็มแล้วดูเหมือนยังกดได้
//
// total = 0 คือแอดมินยังไม่ได้เปิดช่วงเวลาของวันนั้น ไม่ใช่ "เต็ม" —
// ถ้าเขียนรวมกันผู้ใช้จะเข้าใจว่าสนามฮิตมากทั้งที่ยังไม่มีใครจองสักคน
function availabilityBadge(availability) {
  if (!availability) return { label: "ตรวจสอบเวลา", tone: "" };
  if (availability.total === 0) return { label: "ยังไม่เปิดจอง", tone: "muted" };
  if (availability.free === 0) return { label: "เต็มทั้งวัน", tone: "muted" };
  if (availability.free <= 3) return { label: `เหลือ ${availability.free} ช่วง`, tone: "warning" };
  return { label: `ว่าง ${availability.free} ช่วง`, tone: "success" };
}

export default function BookingField() {
  const [params, setParams] = useSearchParams();
  const sportId = Number(params.get("sport"));
  const date = params.get("date") || todayISO();

  const [venueFilter, setVenueFilter] = useState(ALL);

  // เพดานจองล่วงหน้ามาจากเซิร์ฟเวอร์ (0055) ไม่ใช่ค่าคงที่ในหน้าเว็บอีกแล้ว —
  // คนที่แลกสิทธิ์จองล่วงหน้าไว้จะเลือกวันได้ไกลกว่าคนอื่นจริง ๆ
  const { window: bookingWindow } = useBookingWindow();

  const {
    data: facilities,
    loading,
    error,
  } = useAsyncData(
    () => fetchFacilitiesBySport(sportId),
    Number.isFinite(sportId) && sportId > 0 ? `facilities:${sportId}` : null,
    EMPTY_LIST
  );

  // ความว่างแยก query จากรายการสนาม เพราะเปลี่ยนวันแล้วรายการสนามไม่เปลี่ยน
  // มีแต่ป้ายว่าง/เต็มที่ต้องโหลดใหม่
  const { data: availability } = useAsyncData(
    () => fetchSportAvailability(sportId, date),
    Number.isFinite(sportId) && sportId > 0 ? `availability:${sportId}:${date}` : null,
    EMPTY_MAP
  );

  const venues = useMemo(
    () => [ALL, ...new Set(facilities.map((f) => f.venueName))],
    [facilities]
  );

  const shown = facilities.filter(
    (f) => venueFilter === ALL || f.venueName === venueFilter
  );

  if (!Number.isFinite(sportId) || sportId <= 0) {
    return <Navigate to="/booking/sport" replace />;
  }

  const sportName = facilities[0]?.sportName ?? "";

  return (
    <div className="booking">
      <div
        className="booking__band"
        style={{ backgroundImage: `url(${heroFields})` }}
        aria-hidden="true"
      />

      <AppHeader />

      <main className="booking__main">
        <section className="booking__intro">
          <BookingSteps current={2} links={["/booking/sport"]} />
          <h1 className="booking__title">
            เลือกสนาม{sportName && ` ${sportName}`}
          </h1>
          <p className="booking__lead">
            เลือกสนามที่ตรงกับความต้องการของคุณ ทุกสนามแสดงราคาและช่วงเวลาที่ยังว่างชัดเจน
          </p>

          <label className="booking-datepick">
            <span className="booking-datepick__label">
              ดูความว่างของวันที่
              {bookingWindow.bonusDays > 0 && (
                <span className="booking-datepick__bonus">
                  {" "}
                  · สิทธิ์จองล่วงหน้า +{bookingWindow.bonusDays} วัน
                </span>
              )}
            </span>
            <input
              type="date"
              className="booking-datepick__input"
              value={date}
              min={todayISO()}
              max={bookingWindow.lastDate}
              onChange={(e) => {
                // replace: เลื่อนดูวันไปมาไม่ควรถมประวัติเบราว์เซอร์
                // จนกดย้อนกลับไปหน้าเลือกกีฬาไม่ได้
                setParams(
                  { sport: String(sportId), date: e.target.value },
                  { replace: true }
                );
              }}
            />
          </label>
        </section>

        {venues.length > 2 && (
          <div className="booking-filters">
            {venues.map((venue) => (
              <button
                key={venue}
                type="button"
                className={`booking-filter ${
                  venue === venueFilter ? "booking-filter--active" : ""
                }`}
                onClick={() => setVenueFilter(venue)}
              >
                {venue}
              </button>
            ))}
          </div>
        )}

        {loading && <p className="booking-state">กำลังโหลดรายการสนาม...</p>}

        {!loading && error && <p className="booking-state booking-state--error">{error}</p>}

        {!loading && !error && shown.length === 0 && (
          <p className="booking-state">ยังไม่มีสนามของกีฬานี้เปิดให้จอง</p>
        )}

        {shown.length > 0 && (
          <div className="booking__grid">
            {shown.map((facility) => {
              const dayInfo = availability.get(facility.id);
              const badge = availabilityBadge(dayInfo);
              const isFull = dayInfo ? dayInfo.free === 0 : false;

              return (
                <article key={facility.id} className="booking-card">
                  <div className="booking-card__media">
                    <img src={facility.image} alt="" className="booking-card__img" />
                    <span
                      className={`booking-chip ${
                        badge.tone ? `booking-chip--${badge.tone}` : ""
                      } booking-card__badge`}
                    >
                      {badge.label}
                    </span>
                  </div>

                  <div className="booking-card__body">
                    <div className="booking-card__head">
                      <h2 className="booking-card__name">{facility.name}</h2>
                      <span className="booking-card__meta">{facility.venueName}</span>
                    </div>

                    <p className="booking-card__desc">{facility.description}</p>

                    <div className="booking-card__tags">
                      {facility.capacity && (
                        <span className="booking-chip">รองรับ {facility.capacity} คน</span>
                      )}
                      <span className="booking-chip">
                        เปิด {facility.openingTime} – {facility.closingTime} น.
                      </span>
                    </div>

                    <div className="booking-card__foot">
                      <p className="booking-card__price">
                        {formatBaht(facility.pricePerHour)}/ชม.
                      </p>
                      <Link
                        to={`/booking/schedule?facility=${facility.id}&date=${date}`}
                        className={`booking-btn ${isFull ? "booking-btn--quiet" : ""}`}
                      >
                        {isFull ? "ดูวันอื่น" : "เลือก"}
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <p className="booking-note booking__footnote">
          ป้ายว่าง/เต็มคำนวณจากช่วงเวลาที่เปิดจองในวันที่ {formatBookingDate(date)}
        </p>
      </main>
    </div>
  );
}
