import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import { useAuth } from "../context/useAuth";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  bookingHours,
  canCancel,
  cancelBooking,
  describePayment,
  describeStatus,
  fetchBookingDetail,
  formatBaht,
  formatBookingDate,
  formatTimeRange,
} from "../lib/bookings";
import { describeMethod, fetchBookingPayment } from "../lib/payments";
import { errorMessage } from "../lib/errors";
import "./Booking.css";

const paidAtFormatter = new Intl.DateTimeFormat("th-TH", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default function BookingReceipt() {
  const [params] = useSearchParams();
  const { user, profile } = useAuth();

  const bookingId = params.get("booking");

  // reloadKey ดันให้ useAsyncData ถามใหม่หลังยกเลิก — ข้อมูลบนจอตอนนั้น
  // เป็นของก่อนยกเลิกไปแล้ว
  const [reloadKey, setReloadKey] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");

  const { data: booking, loading, error } = useAsyncData(
    () => fetchBookingDetail(bookingId),
    bookingId ? `booking:${bookingId}:${reloadKey}` : null
  );

  const { data: payment } = useAsyncData(
    () => fetchBookingPayment(bookingId),
    bookingId ? `payment:${bookingId}:${reloadKey}` : null
  );

  async function handleCancel() {
    setCancelling(true);
    setCancelError("");

    try {
      await cancelBooking(bookingId);
      setReloadKey((key) => key + 1);
    } catch (err) {
      console.error("cancel_booking failed:", err);
      setCancelError(errorMessage(err));
    } finally {
      setCancelling(false);
    }
  }

  if (!bookingId) return <Navigate to="/home" replace />;

  const facility = booking?.facilities;
  const hours = booking ? bookingHours(booking) : 0;
  const isPaid = booking && ["paid", "approved"].includes(booking.payment_status);
  const isReviewing = booking?.payment_status === "pending";
  const isCancelled = booking?.status === "cancelled";
  const bookerName =
    profile?.full_name || profile?.username || user?.email?.split("@")[0] || "ผู้ใช้งาน";

  const rows = booking
    ? [
        { label: "ผู้จอง", value: bookerName },
        {
          label: "กีฬา / สนาม",
          value: `${facility?.sports?.name ?? "กีฬา"} · ${facility?.name ?? "สนาม"}`,
        },
        {
          label: "สถานที่",
          value: facility?.venues?.address || facility?.venues?.name || "—",
        },
        { label: "วันที่", value: formatBookingDate(booking.booking_date) },
        {
          label: "เวลา",
          value: `${formatTimeRange(booking.start_time, booking.end_time)} น. (${hours} ชั่วโมง)`,
        },
        {
          label: "วิธีชำระเงิน",
          value: payment ? describeMethod(payment.payment_method) : "—",
        },
        {
          label: "วันที่ชำระ",
          value: payment?.created_at
            ? paidAtFormatter.format(new Date(payment.created_at))
            : "—",
        },
      ]
    : [];

  return (
    <div className="booking">
      <AppHeader />

      <main className="booking__main booking__main--narrow">
        {loading && <p className="booking-state">กำลังโหลดใบเสร็จ...</p>}

        {!loading && (error || !booking) && (
          <p className="booking-state booking-state--error">
            {error || "ไม่พบรายการจองนี้"}
          </p>
        )}

        {booking && (
          <>
            <section className="booking-success">
              <div
                className={`booking-success__mark ${
                  isCancelled || !isPaid ? "booking-success__mark--muted" : ""
                }`}
                aria-hidden="true"
              >
                {isCancelled ? "✕" : isPaid ? "✓" : "!"}
              </div>
              <h1 className="booking__title">
                {isCancelled
                  ? "การจองถูกยกเลิกแล้ว"
                  : isPaid
                    ? "ชำระเงินสำเร็จ"
                    : isReviewing
                      ? "รอตรวจสอบการชำระเงิน"
                      : "ยังไม่ได้ชำระเงิน"}
              </h1>
              <p className="booking__lead">
                {isCancelled
                  ? "ช่วงเวลานี้ถูกปล่อยคืนให้ผู้อื่นจองต่อแล้ว"
                  : isPaid
                    ? `การจองของคุณได้รับการยืนยันแล้ว ใบเสร็จนี้ผูกกับบัญชี ${user?.email ?? ""}`
                    : isReviewing
                      ? "เราได้รับหลักฐานการโอนเงินแล้ว เจ้าหน้าที่จะตรวจสอบและยืนยันให้ภายใน 24 ชั่วโมง"
                      : "รายการนี้ถูกกันเวลาไว้ให้แล้ว แต่ยังรอการชำระเงิน"}
              </p>
            </section>

            <section className="booking-panel booking-receipt">
              <div className="booking-receipt__head">
                <div>
                  <h2 className="booking-panel__title">ใบเสร็จรับเงิน</h2>
                  <p className="booking-receipt__no">เลขที่ {booking.booking_code}</p>
                </div>
                <span
                  className={`booking-chip ${isPaid ? "booking-chip--success" : "booking-chip--warning"}`}
                >
                  {describePayment(booking)}
                </span>
              </div>

              <div className="booking-receipt__body">
                {rows.map((row) => (
                  <div key={row.label} className="booking-row">
                    <span className="booking-row__label">{row.label}</span>
                    <span className="booking-row__value">{row.value}</span>
                  </div>
                ))}

                <hr className="booking-divider" />

                <div className="booking-row">
                  <span className="booking-row__label">
                    ค่าสนาม {hours} ชม. × {formatBaht(facility?.price_per_hour)}
                  </span>
                  <span className="booking-row__value">
                    {formatBaht(booking.total_amount)}
                  </span>
                </div>

                <div className="booking-total">
                  <span className="booking-total__label">ยอดชำระทั้งหมด</span>
                  <span className="booking-total__value">
                    {formatBaht(booking.total_amount)}
                  </span>
                </div>

                {booking.deposit_amount > 0 && (
                  <div className="booking-row">
                    <span className="booking-row__label">ยอดมัดจำขั้นต่ำ</span>
                    <span className="booking-row__value">{formatBaht(booking.deposit_amount)}</span>
                  </div>
                )}

                <div className="booking-row">
                  <span className="booking-row__label">สถานะการจอง</span>
                  <span className="booking-row__value">{describeStatus(booking).label}</span>
                </div>
              </div>
            </section>

            <section className="booking-panel booking-pass">
              <div className="booking-pass__qr" aria-hidden="true" />
              <div className="booking-pass__body">
                <h2 className="booking-detail__title">บัตรเข้าใช้สนาม</h2>
                <p className="booking-detail__line">
                  แจ้งรหัสนี้ที่เคาน์เตอร์หน้าสนามเพื่อเช็กอิน เข้าใช้ได้ตั้งแต่ 15
                  นาทีก่อนเวลาจอง
                </p>
                <p className="booking-pass__code">รหัสเช็กอิน: {booking.booking_code}</p>
              </div>
            </section>

            {cancelError && (
              <p className="booking-state booking-state--error">{cancelError}</p>
            )}

            {/* จ่ายแล้วยกเลิกได้ แต่ระบบยังไม่มีการคืนเงินอัตโนมัติ
                (enum payment_status ไม่มีค่า refunded) จึงต้องบอกให้ชัด
                ก่อนกด ไม่ใช่ปล่อยให้เข้าใจเองว่าเงินจะคืนมา */}
            {booking && canCancel(booking) && (
              <div className="booking-actions">
                <button
                  type="button"
                  className="booking-btn booking-btn--block booking-btn--quiet"
                  disabled={cancelling}
                  onClick={handleCancel}
                >
                  {cancelling ? "กำลังยกเลิก..." : "ยกเลิกการจองนี้"}
                </button>
              </div>
            )}

            {booking && canCancel(booking) && isPaid && (
              <p className="booking-note">
                รายการนี้ชำระเงินแล้ว หากยกเลิก ช่วงเวลาจะถูกปล่อยคืนทันที
                แต่การคืนเงินต้องติดต่อเจ้าหน้าที่สนามโดยตรง
              </p>
            )}

            <div className="booking-actions">
              {isPaid || isReviewing ? (
                <button
                  type="button"
                  className="booking-btn booking-btn--ghost"
                  onClick={() => window.print()}
                >
                  ⤓ พิมพ์ / บันทึกใบเสร็จ
                </button>
              ) : (
                <Link
                  to={`/booking/payment?booking=${booking.id}`}
                  className="booking-btn booking-btn--ghost"
                >
                  ไปชำระเงิน
                </Link>
              )}
              <Link to="/home" className="booking-btn">
                เสร็จสิ้น
              </Link>
            </div>

            <p className="booking-note booking__footnote">
              ดูรายการจองทั้งหมดได้ที่หน้าโปรไฟล์ · ติดต่อสนามได้ที่{" "}
              {facility?.venues?.phone || "เคาน์เตอร์หน้าสนาม"}
            </p>
          </>
        )}
      </main>
    </div>
  );
}
