import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import BookingSteps from "../components/BookingSteps";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  BOOKING_HOLD_MINUTES,
  bookingHours,
  fetchBookingDetail,
  formatBaht,
  formatBookingDate,
  formatTimeRange,
} from "../lib/bookings";
import { PAYMENT_METHODS, payBooking } from "../lib/payments";
import { errorMessage } from "../lib/errors";
import { sportImage } from "../lib/catalog";
import "./Booking.css";

const PAYMENT_LABELS = ["เลือกกีฬา", "เลือกสนาม", "เลือกวันและเวลา", "ชำระเงิน"];

export default function BookingPayment() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const bookingId = params.get("booking");

  const [method, setMethod] = useState(PAYMENT_METHODS[0].key);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");

  const { data: booking, loading, error } = useAsyncData(
    () => fetchBookingDetail(bookingId),
    bookingId ? `booking:${bookingId}` : null
  );

  if (!bookingId) return <Navigate to="/booking/sport" replace />;

  // จ่ายไปแล้วแต่ย้อนกลับมาหน้านี้ (กด back, เปิดลิงก์เก่า) — พาไปใบเสร็จ
  if (booking && ["paid", "approved"].includes(booking.payment_status)) {
    return <Navigate to={`/booking/receipt?booking=${bookingId}`} replace />;
  }

  const facility = booking?.facilities;
  const hours = booking ? bookingHours(booking) : 0;

  async function handlePay() {
    setPaying(true);
    setPayError("");

    try {
      await payBooking(bookingId, method);
      navigate(`/booking/receipt?booking=${bookingId}`);
    } catch (err) {
      console.error("pay_booking failed:", err);
      setPayError(errorMessage(err));
      setPaying(false);
    }
  }

  return (
    <div className="booking">
      <AppHeader />

      <main className="booking__main">
        <section className="booking__intro booking__intro--plain">
          <BookingSteps
            current={4}
            labels={PAYMENT_LABELS}
            links={[
              "/booking/sport",
              facility?.sports?.id
                ? `/booking/field?sport=${facility.sports.id}`
                : null,
              facility
                ? `/booking/schedule?facility=${facility.id}&date=${booking.booking_date}`
                : null,
            ]}
          />
          <h1 className="booking__title">ชำระเงิน</h1>
          <p className="booking__lead">
            เรากันเวลานี้ไว้ให้คุณแล้ว ตรวจสอบรายละเอียดแล้วเลือกวิธีชำระเงินที่สะดวก
          </p>
        </section>

        {loading && <p className="booking-state">กำลังโหลดรายการจอง...</p>}

        {!loading && (error || !booking) && (
          <p className="booking-state booking-state--error">
            {error || "ไม่พบรายการจองนี้"}
          </p>
        )}

        {booking && booking.status === "cancelled" && (
          <p className="booking-state booking-state--error">
            รายการจองนี้ถูกยกเลิกไปแล้ว กรุณาเริ่มจองใหม่อีกครั้ง
          </p>
        )}

        {booking && booking.status !== "cancelled" && (
          <div className="booking-payment">
            <div className="booking-payment__left">
              <section className="booking-panel">
                <h2 className="booking-panel__title">รายละเอียดการจอง</h2>

                <div className="booking-detail">
                  <img
                    src={sportImage(facility?.sports?.name)}
                    alt=""
                    className="booking-detail__thumb"
                  />
                  <div className="booking-detail__body">
                    <p className="booking-detail__title">
                      {facility?.sports?.name ?? "กีฬา"} · {facility?.name ?? "สนาม"}
                    </p>
                    <p className="booking-detail__line">
                      {facility?.venues?.name ?? "สนามกีฬา"}
                      {facility?.venues?.address ? ` · ${facility.venues.address}` : ""}
                    </p>
                    <p className="booking-detail__line">
                      {formatBookingDate(booking.booking_date)} ·{" "}
                      {formatTimeRange(booking.start_time, booking.end_time)} น. ({hours} ชม.)
                    </p>
                    <p className="booking-detail__line">
                      รหัสการจอง {booking.booking_code}
                    </p>
                  </div>
                </div>
              </section>

              <section className="booking-panel">
                <h2 className="booking-panel__title">เลือกวิธีชำระเงิน</h2>

                {PAYMENT_METHODS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setMethod(item.key)}
                    className={`booking-method ${
                      method === item.key ? "booking-method--active" : ""
                    }`}
                    aria-pressed={method === item.key}
                  >
                    <span className="booking-method__radio" aria-hidden="true" />
                    <span className="booking-method__text">
                      <span className="booking-method__title">{item.title}</span>
                      <span className="booking-method__desc">{item.desc}</span>
                    </span>
                  </button>
                ))}

                {/* ยังไม่ได้ต่อ payment gateway จริง จึงไม่มีฟอร์มรับเลขบัตร:
                    ระบบที่ยังไม่ผ่าน PCI DSS ไม่ควรมีช่องให้กรอกเลขบัตรจริง
                    แม้จะไม่ได้ส่งไปไหนก็ตาม เพราะผู้ใช้แยกไม่ออกว่าอันไหนของจริง */}
                <div className="booking-simulated">
                  <p className="booking-simulated__title">🧪 โหมดทดสอบ</p>
                  <p className="booking-simulated__text">
                    ระบบชำระเงินยังเป็นการจำลอง กดยืนยันแล้วจะบันทึกว่าชำระเงินแล้ว
                    และยืนยันการจองให้ทันที <strong>โดยไม่มีการตัดเงินจริง</strong>
                  </p>
                </div>
              </section>
            </div>

            <section className="booking-panel">
              <h2 className="booking-panel__title">สรุปยอดชำระ</h2>

              <div className="booking-row">
                <span className="booking-row__label">
                  ค่าสนาม {hours} ชม. × {formatBaht(facility?.price_per_hour)}
                </span>
                <span className="booking-row__value">{formatBaht(booking.total_amount)}</span>
              </div>
              <div className="booking-row">
                <span className="booking-row__label">ค่าธรรมเนียมบริการ</span>
                <span className="booking-row__value">{formatBaht(0)}</span>
              </div>

              <hr className="booking-divider" />

              <div className="booking-row booking-row--total">
                <span className="booking-row__label">ยอดชำระทั้งหมด</span>
                <span className="booking-row__value">{formatBaht(booking.total_amount)}</span>
              </div>

              <p className="booking-note">ราคารวมภาษีมูลค่าเพิ่มแล้ว</p>

              {payError && <p className="booking-state booking-state--error">{payError}</p>}

              <button
                type="button"
                className="booking-btn booking-btn--block"
                disabled={paying}
                onClick={handlePay}
              >
                {paying ? "กำลังดำเนินการ..." : `ชำระเงิน ${formatBaht(booking.total_amount)}`}
              </button>

              <Link
                to={`/booking/schedule?facility=${facility?.id}&date=${booking.booking_date}`}
                className="booking-btn booking-btn--block booking-btn--ghost"
              >
                ‹ กลับไปเลือกเวลา
              </Link>

              <p className="booking-note">
                🔒 เวลานี้ถูกกันไว้ให้คุณแล้ว กรุณาชำระเงินภายใน {BOOKING_HOLD_MINUTES} นาที
                มิฉะนั้นระบบจะปล่อยช่วงเวลานี้ให้ผู้อื่นจองต่อ
              </p>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
