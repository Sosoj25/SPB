import { useEffect, useState } from "react";
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
import {
  describeRefundStatus,
  fetchMyRefundRequest,
  fetchRefundSlipSignedUrl,
  formatDateTime,
  requestRefund,
  uploadRefundPaymentProof,
} from "../lib/refunds";
import { generateQrDataUrl } from "../lib/qr";
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

  const [refundReason, setRefundReason] = useState("");
  const [refundBankName, setRefundBankName] = useState("");
  const [refundAccountName, setRefundAccountName] = useState("");
  const [refundAccountNumber, setRefundAccountNumber] = useState("");
  const [refundProofFile, setRefundProofFile] = useState(null);
  const [requestingRefund, setRequestingRefund] = useState(false);
  const [refundError, setRefundError] = useState("");
  const [viewingSlip, setViewingSlip] = useState(false);

  const { data: booking, loading, error } = useAsyncData(
    () => fetchBookingDetail(bookingId),
    bookingId ? `booking:${bookingId}:${reloadKey}` : null
  );

  const { data: payment } = useAsyncData(
    () => fetchBookingPayment(bookingId),
    bookingId ? `payment:${bookingId}:${reloadKey}` : null
  );

  const { data: refundRequest } = useAsyncData(
    () => fetchMyRefundRequest(bookingId),
    bookingId ? `refund:${bookingId}:${reloadKey}` : null
  );

  // QR เข้ารหัส booking_code ตรง ๆ (รูปแบบเดียวกับที่พิมพ์กำกับไว้ข้างล่าง) —
  // เครื่องสแกน QR หน้าเคาน์เตอร์ (โหมด keyboard-wedge) อ่านค่านี้แล้วพิมพ์ใส่
  // ช่องค้นหาในหน้า /admin/checkin ให้แอดมินกดยืนยันเช็คอินต่อ (ดู
  // admin_checkin_booking ใน 0038_booking_checkin.sql)
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    if (!booking?.booking_code) return undefined;

    let alive = true;

    generateQrDataUrl(booking.booking_code)
      .then((url) => {
        if (alive) setQrDataUrl(url);
      })
      .catch((err) => console.error("generateQrDataUrl failed:", err));

    return () => {
      alive = false;
    };
  }, [booking?.booking_code]);

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

  async function handleRequestRefund() {
    if (!refundBankName.trim() || !refundAccountName.trim() || !refundAccountNumber.trim()) {
      setRefundError("กรุณากรอกธนาคาร ชื่อบัญชี และเลขบัญชีสำหรับรับเงินคืนให้ครบ");
      return;
    }

    // จ่ายผ่านพร้อมเพย์ QR ไม่มีสลิปการชำระเงินเดิมให้แอดมินเทียบชื่อบัญชี
    // (ระบบรู้แค่ว่า PlernPay ยืนยันว่ามีเงินเข้าจริง ไม่รู้ว่าใครโอน) ต้องให้
    // ลูกค้าแนบสลิป/ประวัติการโอนจากแอปธนาคารของตัวเองแทน (validate ซ้ำฝั่ง
    // เซิร์ฟเวอร์ใน request_refund ด้วย, 0040)
    const requiresProof = payment?.payment_method === "qr";
    if (requiresProof && !refundProofFile) {
      setRefundError(
        "กรุณาแนบสลิปหรือประวัติการโอนจากแอปธนาคาร เนื่องจากจ่ายผ่านพร้อมเพย์ QR",
      );
      return;
    }

    setRequestingRefund(true);
    setRefundError("");

    try {
      const proofPath = refundProofFile
        ? await uploadRefundPaymentProof(refundProofFile, bookingId)
        : null;

      await requestRefund(
        bookingId,
        refundReason,
        {
          bankName: refundBankName,
          accountName: refundAccountName,
          accountNumber: refundAccountNumber,
        },
        proofPath,
      );
      setReloadKey((key) => key + 1);
    } catch (err) {
      console.error("request_refund failed:", err);
      setRefundError(errorMessage(err));
    } finally {
      setRequestingRefund(false);
    }
  }

  async function handleViewRefundSlip() {
    setRefundError("");
    setViewingSlip(true);

    try {
      const url = await fetchRefundSlipSignedUrl(refundRequest.slip_path);
      window.open(url, "_blank", "noreferrer");
    } catch (err) {
      console.error("fetchRefundSlipSignedUrl failed:", err);
      setRefundError(errorMessage(err));
    } finally {
      setViewingSlip(false);
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
                    <span className="booking-row__label">
                      ยอดมัดจำขั้นต่ำ
                      <br />
                      <span className="booking-row__hint">ไม่คืนเงินไม่ว่าจะยกเลิกเวลาใด</span>
                    </span>
                    <span className="booking-row__value">{formatBaht(booking.deposit_amount)}</span>
                  </div>
                )}

                <div className="booking-row">
                  <span className="booking-row__label">สถานะการจอง</span>
                  <span className="booking-row__value">{describeStatus(booking).label}</span>
                </div>
              </div>
            </section>

            {!isCancelled && isPaid && (
              <section className="booking-panel booking-pass">
                <div className="booking-pass__qr">
                  {qrDataUrl && <img src={qrDataUrl} alt={`QR เช็คอิน ${booking.booking_code}`} />}
                </div>
                <div className="booking-pass__body">
                  <h2 className="booking-detail__title">บัตรเข้าใช้สนาม</h2>
                  <p className="booking-detail__line">
                    ยื่น QR นี้ให้แอดมินสแกนที่เคาน์เตอร์หน้าสนามเพื่อเช็คอิน หรือแจ้งรหัสด้านล่าง
                    ก็ได้ เข้าใช้ได้ตั้งแต่ 15 นาทีก่อนเวลาจอง
                  </p>
                  <p className="booking-pass__code">รหัสเช็กอิน: {booking.booking_code}</p>
                </div>
              </section>
            )}

            {cancelError && (
              <p className="booking-state booking-state--error">{cancelError}</p>
            )}

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
                คุณสามารถขอคืนเงินได้หลังยกเลิกตามนโยบายคืนเงินของสนาม
              </p>
            )}

            {isCancelled && isPaid && refundRequest && (
              <section className="booking-panel booking-refund">
                <div className="booking-receipt__head">
                  <h2 className="booking-panel__title">สถานะคำขอคืนเงิน</h2>
                  <span
                    className={`booking-chip booking-chip--${
                      describeRefundStatus(refundRequest.status).tone === "danger"
                        ? "warning"
                        : describeRefundStatus(refundRequest.status).tone
                    }`}
                  >
                    {describeRefundStatus(refundRequest.status).label}
                  </span>
                </div>
                <div className="booking-row">
                  <span className="booking-row__label">ยอดคืนเงิน</span>
                  <span className="booking-row__value">
                    {formatBaht(refundRequest.refund_amount)}
                  </span>
                </div>
                <div className="booking-row">
                  <span className="booking-row__label">ขอคืนเงินเมื่อ</span>
                  <span className="booking-row__value">
                    {formatDateTime(refundRequest.requested_at)}
                  </span>
                </div>
                <div className="booking-row">
                  <span className="booking-row__label">บัญชีที่แจ้งไว้</span>
                  <span className="booking-row__value">
                    {refundRequest.bank_name} · {refundRequest.account_name} ·{" "}
                    {refundRequest.account_number}
                  </span>
                </div>
                {refundRequest.status === "rejected" && refundRequest.rejection_reason && (
                  <p className="booking-note">เหตุผลที่ปฏิเสธ: {refundRequest.rejection_reason}</p>
                )}
                {refundRequest.status === "approved" && (
                  <p className="booking-note">
                    คำขอได้รับการอนุมัติแล้ว เจ้าหน้าที่จะโอนเงินคืนและแนบสลิปให้เร็ว ๆ นี้
                  </p>
                )}
                {refundRequest.status === "refunded" && (
                  <>
                    <p className="booking-note">
                      โอนเงินคืนสำเร็จเมื่อ {formatDateTime(refundRequest.refunded_at)}
                    </p>
                    {refundRequest.slip_path && (
                      <button
                        type="button"
                        className="booking-btn booking-btn--ghost"
                        disabled={viewingSlip}
                        onClick={handleViewRefundSlip}
                      >
                        {viewingSlip ? "กำลังเปิด..." : "📎 ดูสลิปโอนคืน"}
                      </button>
                    )}
                  </>
                )}
              </section>
            )}

            {/* ขอคืนเงินได้เฉพาะการจองที่ยกเลิกแล้วและเคยจ่ายเงินจริง — ยอด
                คำนวณจากนโยบาย (refund_policy_settings) ฝั่งเซิร์ฟเวอร์ตอนกดขอ
                ดู request_refund() ใน 0034 — ถ้าคำขอก่อนหน้าถูกปฏิเสธ ขอใหม่
                ได้อีกครั้ง (0036 เปิดให้แก้ไขข้อมูลแล้วส่งใหม่ เช่น เลขบัญชีผิด) */}
            {isCancelled && isPaid && (!refundRequest || refundRequest.status === "rejected") && (
              <section className="booking-panel booking-refund">
                <h2 className="booking-panel__title">
                  {refundRequest ? "ขอคืนเงินอีกครั้ง" : "ขอคืนเงิน"}
                </h2>
                <p className="booking-note">
                  ยอดคืนเงินคำนวณตามนโยบายยกเลิกของสนาม ณ เวลาที่คุณกดขอคืนเงิน
                </p>
                <textarea
                  className="booking-refund__reason"
                  placeholder="เหตุผลที่ขอคืนเงิน (ไม่บังคับ)"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  rows={3}
                />

                <div className="booking-refund__bank">
                  <p className="booking-refund__bank-title">บัญชีสำหรับรับเงินคืน</p>
                  <input
                    type="text"
                    className="booking-refund__input"
                    placeholder="ธนาคาร เช่น ธนาคารกสิกรไทย"
                    value={refundBankName}
                    onChange={(e) => setRefundBankName(e.target.value)}
                  />
                  <input
                    type="text"
                    className="booking-refund__input"
                    placeholder="ชื่อบัญชี"
                    value={refundAccountName}
                    onChange={(e) => setRefundAccountName(e.target.value)}
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    className="booking-refund__input"
                    placeholder="เลขที่บัญชี"
                    value={refundAccountNumber}
                    onChange={(e) => setRefundAccountNumber(e.target.value)}
                  />
                  <p className="booking-note booking-refund__bank-note">
                    ชื่อบัญชีต้องตรงกับชื่อในสลิปที่คุณโอนเงินมาชำระค่าสนาม
                    เจ้าหน้าที่จะตรวจสอบก่อนโอนเงินคืนทุกครั้ง
                  </p>
                </div>

                {payment?.payment_method === "qr" && (
                  <div className="booking-refund__bank">
                    <p className="booking-refund__bank-title">
                      แนบสลิปหรือประวัติการโอนจากแอปธนาคาร
                    </p>
                    <p className="booking-note booking-refund__bank-note">
                      คุณจ่ายค่าสนามผ่านพร้อมเพย์ QR ระบบไม่มีสลิปการชำระเงินเดิม
                      ให้เจ้าหน้าที่ตรวจสอบ กรุณาแคปหน้าจอประวัติการโอนจากแอป
                      ธนาคารของคุณแนบมาด้วย เพื่อยืนยันว่าเป็นคุณที่โอนเงินมา
                      ชำระค่าสนามจริง
                    </p>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="booking-refund__input"
                      onChange={(e) => setRefundProofFile(e.target.files?.[0] ?? null)}
                    />
                  </div>
                )}

                {refundError && (
                  <p className="booking-state booking-state--error">{refundError}</p>
                )}
                <button
                  type="button"
                  className="booking-btn booking-btn--block"
                  disabled={requestingRefund}
                  onClick={handleRequestRefund}
                >
                  {requestingRefund ? "กำลังส่งคำขอ..." : "ขอคืนเงิน"}
                </button>
              </section>
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
