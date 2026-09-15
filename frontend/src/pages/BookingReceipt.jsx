// ใบเสร็จ/รายละเอียดการจองหนึ่งรายการ — ปลายทางของทุกลิงก์แจ้งเตือนที่ชี้มาที่
// การจอง และเป็นที่เดียวที่ลูกค้าเขียนรีวิว ขอคืนเงิน และบันทึกใบเสร็จเป็นรูป
import { useEffect, useRef, useState } from "react";
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
import { downloadBlob, renderReceiptPng } from "../lib/receiptImage";
import { fetchBookingReview, submitReview } from "../lib/reviews";
import { useRewardSettings } from "../hooks/useRewards";
import { formatPoints } from "../lib/rewards";
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
  const { user, profile, refreshProfile } = useAuth();

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

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [showReviewPrompt, setShowReviewPrompt] = useState(false);
  // แต้มที่เพิ่งได้จากการกดส่งรีวิวรอบนี้ (ยอดจริงที่ submit_review() แจก ไม่ใช่
  // ที่หน้าเว็บคำนวณเอง — ดู 0106) มีค่าเฉพาะรอบที่ผู้ใช้กดส่งเอง เปิดใบเสร็จ
  // เก่าที่รีวิวไปแล้วจะไม่ขึ้นกล่องนี้ซ้ำ
  const [reviewReward, setReviewReward] = useState(null);
  // เปิด popup ให้เองครั้งแรกที่เจอ booking นี้อยู่ในสถานะรอรีวิว — เก็บ
  // bookingId ที่เพิ่งเปิดไปแล้วกันไม่ให้เด้งซ้ำถ้าผู้ใช้ปิดมันเองแล้ว data
  // ถูก refetch อีกรอบ (เช่นตอน useAsyncData คืนค่าเดิมซ้ำ)
  const autoOpenedReviewRef = useRef(null);

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

  const { data: review } = useAsyncData(
    () => fetchBookingReview(bookingId),
    bookingId ? `review:${bookingId}:${reloadKey}` : null
  );

  // แต้มที่จะได้จากการรีวิว — บอกก่อนกดส่ง ไม่ใช่รู้ตอนได้แล้ว อ่านจากตารางที่
  // แอดมินตั้งเอง (reward_settings) เลขในหน้านี้จึงตรงกับที่ระบบแจกจริงเสมอ
  const { settings: rewardSettings } = useRewardSettings();
  const reviewBonus =
    rewardSettings?.reviewPointsEnabled === false ? 0 : rewardSettings?.reviewPoints ?? 0;

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

  useEffect(() => {
    if (booking?.status === "awaiting_review" && autoOpenedReviewRef.current !== bookingId) {
      autoOpenedReviewRef.current = bookingId;
      setShowReviewPrompt(true);
    }
  }, [booking?.status, bookingId]);

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

  async function handleSubmitReview() {
    if (reviewRating < 1) {
      setReviewError("กรุณาเลือกจำนวนดาวก่อนส่งรีวิว");
      return;
    }

    setSubmittingReview(true);
    setReviewError("");

    let result;

    try {
      result = await submitReview({ bookingId, rating: reviewRating, comment: reviewComment });
    } catch (err) {
      console.error("submit_review failed:", err);
      setReviewError(errorMessage(err));
      setSubmittingReview(false);
      return;
    }

    // แต้มใน AuthContext เป็นยอดที่โหลดมาตอน login — รีวิวเพิ่งบวกแต้มให้ ถ้า
    // ไม่โหลดใหม่ ตัวเลขบนหัวเว็บจะยังเป็นยอดก่อนรีวิว (เหมือนหลังกดแลกรางวัล
    // ใน RewardDetail) ล้มเหลวก็ไม่เป็นไร รีวิวบันทึกไปแล้วและยอดจะตรงเองรอบหน้า
    try {
      await refreshProfile();
    } catch (err) {
      console.error("refreshProfile after review failed:", err);
    }

    // ผูก bookingId ไว้กับผลลัพธ์ด้วย — สลับไปดูใบเสร็จใบอื่นจาก ?booking= โดย
    // คอมโพเนนต์ไม่ mount ใหม่ (เช่นกดลิงก์แจ้งเตือนอีกใบ) กล่องแต้มของใบเก่า
    // จะได้ไม่ติดค้างอยู่บนใบใหม่
    setReviewReward({ ...result, bookingId });
    setShowReviewPrompt(false);
    setReloadKey((key) => key + 1);
    setSubmittingReview(false);
  }

  if (!bookingId) return <Navigate to="/home" replace />;

  const facility = booking?.facilities;
  const hours = booking ? bookingHours(booking) : 0;
  const isPaid = booking && ["paid", "approved"].includes(booking.payment_status);
  const isReviewing = booking?.payment_status === "pending";
  const isCancelled = booking?.status === "cancelled";
  // การจองที่ถูกยกเลิกไปแล้วไม่เหลืออะไรให้จ่าย ปุ่ม "ไปชำระเงิน" จึงขึ้นเฉพาะ
  // รายการที่ยังไม่จ่ายและยังไม่ถูกยกเลิก
  const canPayNow = Boolean(booking) && !isPaid && !isReviewing && !isCancelled;
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

  // ใบเสร็จที่ลูกค้าบันทึกเก็บไว้เป็นไฟล์รูป ไม่ใช่หน้าเว็บที่สั่งพิมพ์ —
  // เนื้อหาชุดเดียวกับที่เห็นบนจอเป๊ะ ๆ (rows + ตัวเงิน + QR) เพื่อไม่ให้มีคำ
  // ถามว่าไฟล์ที่เซฟไว้ตรงกับหน้าจอไหม
  async function handleSaveReceipt() {
    setSaveError("");
    setSaving(true);

    try {
      // QR ของไฟล์สร้างใหม่ ไม่ใช้ตัวที่โชว์บนจอ — บนจอเป็นสีม่วงตามธีมกว้าง
      // 260px ซึ่งพอดีกับที่แสดงผลเท่านั้น พอเอาไปขยายในไฟล์จะเบลอ ไฟล์ใช้
      // ขาวดำความละเอียดสูงกว่า สแกนติดง่ายที่สุดทั้งบนจอมือถือและบนกระดาษ
      const fileQr = await generateQrDataUrl(booking.booking_code, {
        width: 600,
        margin: 1,
        color: { dark: "#000000", light: "#ffffff" },
      });

      const blob = await renderReceiptPng({
        venueName: facility?.venues?.name || "SPORTSBOOKING",
        title: "ใบเสร็จรับเงิน",
        code: booking.booking_code,
        statusLabel: describePayment(booking),
        statusTone: isPaid ? "success" : "warning",
        rows: [
          ...rows.map((row) => [row.label, row.value]),
          ["สถานะการจอง", describeStatus(booking).label],
        ],
        sums: [
          {
            label: `ค่าสนาม ${hours} ชม. × ${formatBaht(facility?.price_per_hour)}`,
            value: formatBaht(booking.original_amount ?? booking.total_amount),
          },
          booking.discount_amount > 0 && {
            label: "ส่วนลดจากคูปอง",
            value: `-${formatBaht(booking.discount_amount)}`,
            kind: "discount",
          },
          {
            label: "ยอดชำระทั้งหมด",
            value: formatBaht(booking.total_amount),
            kind: "total",
          },
          booking.deposit_amount > 0 && {
            label: "ยอดมัดจำขั้นต่ำ (ไม่คืนเงินไม่ว่าจะยกเลิกเวลาใด)",
            value: formatBaht(booking.deposit_amount),
            kind: "hint",
          },
        ].filter(Boolean),
        qrDataUrl: fileQr,
        qrCaption: "ยื่น QR นี้ให้แอดมินสแกนที่เคาน์เตอร์เพื่อเช็คอิน",
        notes: [
          `บันทึกไฟล์เมื่อ ${paidAtFormatter.format(new Date())}`,
          "ต้องการใบเสร็จแบบกระดาษ ขอรับได้ที่เคาน์เตอร์ตอนเช็คอิน",
        ],
      });

      downloadBlob(blob, `receipt-${booking.booking_code}.png`);
    } catch (err) {
      console.error("renderReceiptPng failed:", err);
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    // booking--no-print ตัดเนื้อหาทั้งหน้าออกจากงานพิมพ์เสมอ ไม่ใช่แค่ตอนยังไม่
    // จ่ายเงิน — ใบเสร็จที่เป็นกระดาษต้องออกจากเครื่องพิมพ์ของเคาน์เตอร์ที่เดียว
    // (หน้า /admin/checkin) ฝั่งลูกค้าบันทึกเป็นไฟล์ได้อย่างเดียว
    <div className="booking booking--no-print">
      <AppHeader />

      {/* ข้อความที่ออกกระดาษแทนใบเสร็จเวลามีคนกด Ctrl+P — ต่างกันตามสถานะ
          จึงส่งเป็น attribute ให้ CSS หยิบไปใช้ (@media print ใน Booking.css)
          แทนที่จะฮาร์ดโค้ดสองก้อนไว้ในไฟล์ CSS */}
      <main
        className="booking__main booking__main--narrow"
        data-print-note={
          isPaid
            ? "ใบเสร็จนี้สั่งพิมพ์จากหน้าเว็บไม่ได้ — กดปุ่ม “บันทึกใบเสร็จ” เพื่อเก็บเป็นไฟล์ หรือขอใบเสร็จแบบกระดาษที่เคาน์เตอร์ตอนเช็คอิน"
            : "รายการนี้ยังไม่ได้รับการยืนยันการชำระเงิน จึงยังไม่มีใบเสร็จให้บันทึกหรือพิมพ์"
        }
      >
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

                {/* original_amount ถูกเก็บไว้ตอนใช้คูปอง (0049) — ถ้ามีแปลว่า
                    ยอดที่เห็นตอนนี้เป็นยอดหลังหักแล้ว ต้องโชว์ราคาเต็มกับส่วนลด
                    แยกบรรทัด ไม่งั้นใบเสร็จจะบอกแค่ยอดสุดท้ายโดยไม่มีที่มา */}
                <div className="booking-row">
                  <span className="booking-row__label">
                    ค่าสนาม {hours} ชม. × {formatBaht(facility?.price_per_hour)}
                  </span>
                  <span className="booking-row__value">
                    {formatBaht(booking.original_amount ?? booking.total_amount)}
                  </span>
                </div>

                {booking.discount_amount > 0 && (
                  <div className="booking-row">
                    <span className="booking-row__label">ส่วนลดจากคูปอง</span>
                    <span className="booking-row__value booking-row__value--success">
                      -{formatBaht(booking.discount_amount)}
                    </span>
                  </div>
                )}

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

            {booking.status === "awaiting_review" && (
              <section className="booking-panel booking-review">
                <h2 className="booking-panel__title">รีวิวสนามนี้</h2>
                <p className="booking-note">
                  เล่นจบแล้ว บอกเล่าประสบการณ์ของคุณให้คนอื่นได้รู้ก่อนตัดสินใจจอง
                </p>
                {reviewBonus > 0 && (
                  <p className="booking-review__bonus">
                    เขียนรีวิวรับเพิ่ม {formatPoints(reviewBonus)} แต้ม
                  </p>
                )}
                <button
                  type="button"
                  className="booking-btn booking-btn--block"
                  onClick={() => setShowReviewPrompt(true)}
                >
                  เขียนรีวิวตอนนี้
                </button>
              </section>
            )}

            {/* เด้งขึ้นเองทันทีที่เปิดใบเสร็จของบุ๊กกิ้งที่รอรีวิว (ดู
                useEffect ผูกกับ autoOpenedReviewRef ข้างบน) ปิดแล้วยังเปิดซ้ำ
                ได้จากปุ่ม "เขียนรีวิวตอนนี้" ในการ์ดด้านบน — ส่งสำเร็จแล้วโพสต์
                จะไปโผล่ในชุมชนหมวด "รีวิว" ให้อัตโนมัติด้วย (ดู submit_review()
                ใน 0080_review_community_category.sql) */}
            {showReviewPrompt && booking.status === "awaiting_review" && (
              <div
                className="review-popup__backdrop"
                role="presentation"
                onClick={(e) => {
                  if (e.target === e.currentTarget && !submittingReview) {
                    setShowReviewPrompt(false);
                  }
                }}
              >
                <div
                  className="review-popup"
                  role="dialog"
                  aria-modal="true"
                  aria-label="เขียนรีวิว"
                >
                  <div className="review-popup__head">
                    <h2 className="booking-panel__title">รีวิวสนามนี้</h2>
                    <button
                      type="button"
                      className="review-popup__close"
                      aria-label="ปิด"
                      disabled={submittingReview}
                      onClick={() => setShowReviewPrompt(false)}
                    >
                      ×
                    </button>
                  </div>

                  <p className="booking-note">
                    เล่นจบแล้ว บอกเล่าประสบการณ์ของคุณให้คนอื่นได้รู้ก่อนตัดสินใจจอง
                  </p>

                  {reviewBonus > 0 && (
                    <p className="booking-review__bonus">
                      ส่งรีวิวแล้วรับเพิ่ม {formatPoints(reviewBonus)} แต้มทันที
                    </p>
                  )}

                  <div className="booking-review__stars" role="radiogroup" aria-label="ให้คะแนน">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        role="radio"
                        aria-checked={reviewRating === star}
                        aria-label={`${star} ดาว`}
                        className={`booking-review__star ${
                          star <= reviewRating ? "booking-review__star--filled" : ""
                        }`}
                        onClick={() => setReviewRating(star)}
                      >
                        ★
                      </button>
                    ))}
                  </div>

                  <textarea
                    aria-label="รีวิวการใช้บริการ"
                    className="booking-refund__reason"
                    placeholder="เล่าประสบการณ์ของคุณ (ไม่บังคับ)"
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    rows={3}
                  />

                  {reviewError && (
                    <p className="booking-state booking-state--error">{reviewError}</p>
                  )}

                  <button
                    type="button"
                    className="booking-btn booking-btn--block"
                    disabled={submittingReview}
                    onClick={handleSubmitReview}
                  >
                    {submittingReview ? "กำลังส่งรีวิว..." : "ส่งรีวิว"}
                  </button>
                </div>
              </div>
            )}

            {/* ยอดแต้มที่เพิ่งได้จากการส่งรีวิวรอบนี้ — ตัวเลขมาจาก submit_review()
                โดยตรง (0106) แยกเป็นแต้มตามยอดที่จ่ายกับแต้มโบนัสของรีวิว ถ้า
                แอดมินปิดระบบแต้มไว้หรือแต้มถูกแจกไปแล้ว ยอดจะเป็น 0 แล้วกล่องนี้
                ไม่ขึ้นเลย ดีกว่าขึ้นว่าได้ 0 แต้ม */}
            {reviewReward?.bookingId === bookingId && reviewReward.pointsAwarded > 0 && (
              <section className="booking-panel booking-points">
                <h2 className="booking-panel__title">
                  ได้รับ {formatPoints(reviewReward.pointsAwarded)} แต้ม
                </h2>
                <p className="booking-note">
                  {reviewReward.servicePoints > 0 && reviewReward.bonusPoints > 0
                    ? `${formatPoints(reviewReward.servicePoints)} แต้มจากการใช้บริการ และอีก ${formatPoints(
                        reviewReward.bonusPoints,
                      )} แต้มโบนัสจากการเขียนรีวิว`
                    : reviewReward.bonusPoints > 0
                      ? "แต้มโบนัสจากการเขียนรีวิว ขอบคุณที่ช่วยรีวิวให้คนอื่นตัดสินใจ"
                      : "แต้มสะสมจากการใช้บริการสนามครั้งนี้"}
                </p>
                <Link to="/rewards" className="booking-btn booking-btn--block">
                  ดูของรางวัลที่แลกได้
                </Link>
              </section>
            )}

            {booking.status === "completed" && review && (
              <section className="booking-panel booking-review">
                <h2 className="booking-panel__title">รีวิวของคุณ</h2>
                <div className="booking-review__stars" aria-hidden="true">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <span
                      key={star}
                      className={`booking-review__star ${
                        star <= review.rating ? "booking-review__star--filled" : ""
                      }`}
                    >
                      ★
                    </span>
                  ))}
                </div>
                {review.comment && <p className="booking-note">{review.comment}</p>}
              </section>
            )}

            {booking.status === "no_show" && (
              <p className="booking-note booking-note--warn">
                ไม่พบการเช็คอินก่อนหมดเวลาการจอง ระบบจึงบันทึกรายการนี้เป็น &quot;ไม่ได้ไป&quot;
                — ไม่สามารถรีวิวสนามนี้ได้
              </p>
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
                  aria-label="เหตุผลที่ขอคืนเงิน"
                  className="booking-refund__reason"
                  placeholder="เหตุผลที่ขอคืนเงิน (ไม่บังคับ)"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  rows={3}
                />

                <div className="booking-refund__bank">
                  <p className="booking-refund__bank-title">บัญชีสำหรับรับเงินคืน</p>
                  <input
                    aria-label="ธนาคาร"
                    type="text"
                    className="booking-refund__input"
                    placeholder="ธนาคาร เช่น ธนาคารกสิกรไทย"
                    value={refundBankName}
                    onChange={(e) => setRefundBankName(e.target.value)}
                  />
                  <input
                    aria-label="ชื่อบัญชี"
                    type="text"
                    className="booking-refund__input"
                    placeholder="ชื่อบัญชี"
                    value={refundAccountName}
                    onChange={(e) => setRefundAccountName(e.target.value)}
                  />
                  <input
                    aria-label="เลขที่บัญชี"
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

            {/* ใบเสร็จบันทึกเป็นไฟล์ได้ก็ต่อเมื่อเงินเข้าจริงแล้วเท่านั้น
                — "รอชำระเงิน" กับ "รอตรวจสอบการชำระเงิน" ยังไม่มีเงินเข้าระบบ
                ไฟล์ที่เซฟออกไปตอนนั้นจะเป็นใบเสร็จของเงินที่ยังไม่ได้จ่าย
                ซึ่งลูกค้าเอาไปยืนยันสิทธิ์ที่หน้าสนามได้ทั้งที่ยังไม่ได้จ่าย
                (@media print ใน Booking.css กันทาง Ctrl+P ไว้อีกชั้น) */}
            {isReviewing && (
              <p className="booking-note booking-note--warn">
                ยังบันทึกใบเสร็จไม่ได้ — เจ้าหน้าที่กำลังตรวจสอบหลักฐานการโอนของคุณอยู่
                ใบเสร็จจะบันทึกได้ทันทีที่การชำระเงินได้รับการยืนยัน
              </p>
            )}

            {saveError && <p className="booking-state booking-state--error">{saveError}</p>}

            {/* ตอนยังไม่จ่าย ทางหลักของหน้านี้คือไปจ่ายเงิน ปุ่มออกจากหน้าจึงลด
                เป็น ghost และเปลี่ยนคำเป็น "กลับหน้าแรก" — "เสร็จสิ้น" สื่อว่าจบ
                ขั้นตอนแล้ว ทั้งที่รายการยังค้างจ่ายอยู่ */}
            <div className="booking-actions">
              {isPaid ? (
                <button
                  type="button"
                  className="booking-btn booking-btn--ghost"
                  disabled={saving}
                  onClick={handleSaveReceipt}
                >
                  {saving ? "กำลังสร้างไฟล์..." : "⤓ บันทึกใบเสร็จ (ไฟล์รูป)"}
                </button>
              ) : isReviewing ? (
                <button
                  type="button"
                  className="booking-btn booking-btn--ghost"
                  disabled
                  title="บันทึกใบเสร็จได้หลังการชำระเงินได้รับการยืนยันแล้ว"
                >
                  ⤓ บันทึกใบเสร็จ (ไฟล์รูป)
                </button>
              ) : canPayNow ? (
                <Link
                  to={`/booking/payment?booking=${booking.id}`}
                  className="booking-btn"
                >
                  ไปชำระเงิน
                </Link>
              ) : null}
              <Link
                to="/home"
                className={`booking-btn${canPayNow ? " booking-btn--ghost" : ""}`}
              >
                {isPaid ? "เสร็จสิ้น" : "กลับหน้าแรก"}
              </Link>
            </div>

            <p className="booking-note booking__footnote">
              {isPaid
                ? "ใบเสร็จแบบกระดาษขอรับได้ที่เคาน์เตอร์ตอนเช็คอิน · "
                : ""}
              ดูรายการจองทั้งหมดได้ที่หน้าโปรไฟล์ · ติดต่อสนามได้ที่{" "}
              {facility?.venues?.phone || "เคาน์เตอร์หน้าสนาม"}
            </p>
          </>
        )}
      </main>
    </div>
  );
}
