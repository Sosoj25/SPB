// ขั้นที่ 4 ของการจอง — ชำระเงินด้วยพร้อมเพย์ QR หรือโอนแล้วแนบสลิป
//
// การจองถูกกันสิทธิ์ไว้ชั่วคราวเท่านั้น (BOOKING_HOLD_MINUTES) หน้านี้จึงมี
// นาฬิกานับถอยหลังทั้งของ QR และของตัวการจองเอง
import { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import BookingSteps from "../components/BookingSteps";
import { Badge } from "../components/DashboardWidgets";
import { useAuth } from "../context/useAuth";
import CouponPicker from "../components/CouponPicker";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  BOOKING_HOLD_MINUTES,
  bookingHours,
  fetchBookingDetail,
  formatBaht,
  formatBookingDate,
  formatTimeRange,
} from "../lib/bookings";
import { fetchFacilityPricePreview } from "../lib/pricing";
import { fetchPaymentChannelSettings, fetchPrimaryPaymentAccount } from "../lib/paymentSettings";
import {
  PAYMENT_METHODS,
  checkPlernpayPayment,
  confirmZeroAmountBooking,
  createPlernpayCharge,
  submitBankTransferPayment,
  uploadPaymentSlip,
} from "../lib/payments";
import { fetchRefundPolicy } from "../lib/refundPolicy";
import { errorMessage } from "../lib/errors";
import { assertImageFile } from "../lib/uploads";
import { sportImage } from "../lib/catalog";
import "./Booking.css";

const PAYMENT_LABELS = ["เลือกกีฬา", "เลือกสนาม", "เลือกวันและเวลา", "ชำระเงิน"];

// ทุกกี่มิลลิวินาทีถึงถามสถานะการจ่ายเงินอีกครั้ง
//
// PlernPay จำกัด 30 requests/นาทีต่อ API key "รวมทั้งระบบ" ไม่ใช่ต่อการจอง
// เดียว และเกินแล้วแอปทั้งตัวจะถูก deactivate ทันที (ดูคอมเมนต์ใน
// check-plernpay-payment) — ค่านี้เป็นค่าที่เจ้าของระบบเลือกเองโดยรับความเสี่ยง
// ไว้แล้ว เพื่อให้ลูกค้าไม่ต้องรอนาน: 1 คนที่ poll ต่อเนื่อง = 15 req/min
// เหลือที่ให้จ่ายพร้อมกันได้อีกราวคนเดียวก่อนชนเพดาน
//
// ถ้ามีคนจ่ายพร้อมกันเยอะขึ้น ให้ติดต่อขอเพิ่ม limit ไม่ใช่ลดค่านี้ลงอีก
const POLL_MS = 4000;

function formatQrCountdown(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const HOLD_WARNING_SECONDS = 120;

export default function BookingPayment() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const bookingId = params.get("booking");

  // เริ่มเป็น null แล้วค่อยหาช่องทางที่เปิดใช้งานจริงมาเป็นค่าเริ่มต้นตอน
  // render (ดู effectiveMethod ด้านล่าง) แทนการเดา PAYMENT_METHODS[0] ตรง ๆ
  // เพราะแอดมินอาจปิดช่องทางนั้นไว้ที่หน้า /admin/payments/settings
  const [method, setMethod] = useState(null);

  // ---------- พร้อมเพย์ (PlernPay) ----------
  const [qr, setQr] = useState(null); // { paymentId, qrImage, uniqueAmount, expiresAt }
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState("");
  const [qrNowTick, setQrNowTick] = useState(() => Date.now());
  const pollRef = useRef(null);

  // ---------- โอนผ่านบัญชี + สลิป ----------
  const [slipFile, setSlipFile] = useState(null);
  const [slipError, setSlipError] = useState("");
  const [submittingSlip, setSubmittingSlip] = useState(false);

  // ---------- ยอดสุทธิ 0 บาท ----------
  const [confirmingFree, setConfirmingFree] = useState(false);
  const [freeError, setFreeError] = useState("");

  // ใช้/ถอดคูปองแล้ว booking.total_amount เปลี่ยน — ต้องโหลดการจองใหม่ ไม่ใช่
  // แก้ตัวเลขในหน้าเอง เพราะยอดจริงคำนวณฝั่งเซิร์ฟเวอร์ (apply_booking_coupon)
  const [bookingReloadKey, setBookingReloadKey] = useState(0);

  const { data: booking, loading, error } = useAsyncData(
    () => fetchBookingDetail(bookingId),
    bookingId ? `booking:${bookingId}:${bookingReloadKey}` : null
  );

  // สรุปยอดแบบแยกรายการ (ราคาช่วงเวลา + ส่วนลด) มาจากฟังก์ชันเดียวกับที่
  // create_booking ใช้จริง (compute_facility_price, 0024) — แค่แสดงผล
  // ไม่ใช่ตัวกำหนดยอดที่เก็บจริง ยอดที่เก็บจริงคือ booking.total_amount เสมอ
  const { data: priceBreakdown } = useAsyncData(
    () =>
      fetchFacilityPricePreview(
        booking.facilities.id,
        booking.booking_date,
        booking.start_time,
        booking.end_time,
      ),
    booking?.facilities
      ? `price-breakdown:${booking.facilities.id}:${booking.booking_date}:${booking.start_time}:${booking.end_time}`
      : null,
  );

  // เปิด/ปิดช่องทางมาจาก /admin/payments/settings — ยังไม่โหลดเสร็จให้ถือว่า
  // "เปิด" ไว้ก่อน (ไม่งั้นช่องทางกระพริบหายแล้วโผล่กลับมาตอนโหลดเสร็จ)
  const { data: channelSettings } = useAsyncData(
    fetchPaymentChannelSettings,
    "payment-channel-settings",
    {},
  );
  const enabledMethods = PAYMENT_METHODS.filter((m) => channelSettings[m.key] !== false);

  // บัญชีหลักที่แอดมินตั้งไว้ — เป็น null ได้ถ้ายังไม่มีบัญชีรับเงินเลย
  const { data: primaryAccount } = useAsyncData(
    fetchPrimaryPaymentAccount,
    "primary-payment-account",
  );

  // นโยบายคืนเงินที่แอดมินตั้งไว้ (/admin/refunds, 0033) — แสดงให้ลูกค้าเห็น
  // ก่อนตัดสินใจจ่ายเงิน
  const { data: refundPolicy } = useAsyncData(fetchRefundPolicy, "refund-policy");

  // ถ้าช่องทางที่เลือกไว้ถูกแอดมินปิดไปแล้ว (หรือยังไม่เคยเลือก) ใช้ช่องทาง
  // แรกที่ยังเปิดอยู่แทน — คำนวณตอน render เลย ไม่ต้องมี effect ตั้ง state
  const effectiveMethod = enabledMethods.some((m) => m.key === method)
    ? method
    : (enabledMethods[0]?.key ?? null);

  // เปลี่ยนช่องทางแล้วเลิก poll ของ QR เดิม ไม่งั้นสร้าง QR ใหม่ทับ แต่ตัว poll
  // เก่ายังวิ่งอยู่เบื้องหลัง — ทำตอนคลิกโดยตรง ไม่ใช้ effect เพราะ setState
  // ในนี้ไม่ได้ sync กับระบบภายนอกอะไร แค่ล้างสถานะของหน้าจอเอง
  function selectMethod(key) {
    if (key !== effectiveMethod) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      setQr(null);
      setQrError("");
      setMethod(key);
    }
  }

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // นับถอยหลังเวลาหมดอายุของ QR ให้ลูกค้าเห็นชัด ๆ — เดิมหน้านี้ไม่เคยบอกเลย
  // ว่า QR มีเวลาจำกัดแค่ไหน (PlernPay หมดอายุ QR ที่ ~5 นาที) ลูกค้าจึงไม่รู้
  // ว่าต้องรีบโอน สแกนแล้วเดินไปทำอย่างอื่นก่อนอาจโอนไม่ทันแล้วโดน "QR หมดอายุ"
  // ทั้งที่คิดว่าโอนสำเร็จแล้ว — คำนวณเป็นค่า derived จาก qrNowTick แทนการยิง
  // setState ตรง ๆ ใน effect (react-hooks/set-state-in-effect)
  useEffect(() => {
    if (!qr) return undefined;

    const id = setInterval(() => setQrNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [qr]);

  const qrSecondsLeft = qr
    ? Math.max(
        0,
        Math.round(
          ((qr.expiresAt ? new Date(qr.expiresAt).getTime() : qr.generatedAt + (qr.expiresIn ?? 300) * 1000) -
            qrNowTick) /
            1000,
        ),
      )
    : null;

  // นับถอยหลังเวลาที่ระบบกันช่วงเวลาไว้ให้ (BOOKING_HOLD_MINUTES) — เดิมหน้านี้
  // บอกแค่ตัวเลขนาทีเฉย ๆ ไม่มีนาฬิกาจริงให้ดู ลูกค้าจึงไม่รู้ตัวว่าเหลือเวลา
  // เท่าไหร่แล้ว คำนวณจาก booking.created_at (เวลาที่ create_booking กันไว้จริง
  // ฝั่งเซิร์ฟเวอร์) ไม่ใช่เวลาที่หน้านี้โหลดเสร็จ เพื่อให้ตรงกับเวลาที่
  // expire_unpaid_bookings ใช้จริง
  const [holdNowTick, setHoldNowTick] = useState(() => Date.now());
  const isPendingUnpaid = booking?.status === "pending" && booking?.payment_status === "unpaid";

  useEffect(() => {
    if (!isPendingUnpaid) return undefined;

    const id = setInterval(() => setHoldNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isPendingUnpaid]);

  const holdSecondsLeft = isPendingUnpaid
    ? Math.max(
        0,
        Math.round(
          (new Date(booking.created_at).getTime() + BOOKING_HOLD_MINUTES * 60 * 1000 - holdNowTick) / 1000,
        ),
      )
    : null;

  const isHoldExpired = holdSecondsLeft === 0;

  // poll สถานะการจ่ายเป็นระยะจนกว่าจะ approved/rejected หรือออกจากหน้านี้ —
  // เรียกผ่าน Edge Function เสมอ (ไม่อ่านตาราง payments ตรง ๆ) เพราะ
  // check-plernpay-payment เป็นคนไปถาม PlernPay จริงและอัปเดตสถานะให้ในตัว
  useEffect(() => {
    if (!qr?.paymentId) return undefined;

    async function poll() {
      try {
        const { status } = await checkPlernpayPayment(qr.paymentId);

        if (status === "approved") {
          clearInterval(pollRef.current);
          navigate(`/booking/receipt?booking=${bookingId}`);
        } else if (status === "rejected") {
          clearInterval(pollRef.current);
          setQrError("การชำระเงินไม่สำเร็จหรือ QR หมดอายุ กรุณาสร้าง QR ใหม่อีกครั้ง");
          setQr(null);
        }
      } catch {
        // เช็คพลาดรอบเดียวไม่เป็นไร รอบถัดไป poll ใหม่เอง
      }
    }

    pollRef.current = setInterval(poll, POLL_MS);

    // แท็บถูกซ่อนตอนผู้ใช้สลับไปแอปธนาคารเพื่อสแกน/ยืนยันจ่ายเงิน — เบราว์เซอร์
    // หน่วง setInterval ของแท็บที่ไม่ได้โฟกัสได้หลายสิบวินาที พอกลับมาที่แท็บนี้
    // จึงเช็คทันทีหนึ่งครั้ง ไม่ต้องรอรอบ interval เดิมที่อาจถูกหน่วงไว้
    function handleVisibility() {
      if (document.visibilityState === "visible") poll();
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(pollRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qr?.paymentId]);

  if (!bookingId) return <Navigate to="/booking/sport" replace />;

  // จ่ายไปแล้วแต่ย้อนกลับมาหน้านี้ (กด back, เปิดลิงก์เก่า) — พาไปใบเสร็จ
  if (booking && ["paid", "approved"].includes(booking.payment_status)) {
    return <Navigate to={`/booking/receipt?booking=${bookingId}`} replace />;
  }

  const facility = booking?.facilities;
  const hours = booking ? bookingHours(booking) : 0;
  // ยอดสุทธิ 0 เกิดได้จากโปรโมชั่นของสนามที่ลดจนหมด หรือคูปองที่คลุมค่าสนาม
  // พอดี — ทั้งสองช่องทางที่มีอยู่ใช้กับยอด 0 ไม่ได้ (PlernPay ไม่รับ charge
  // 0 บาท ส่วนการโอนก็ไม่มีสลิปให้แนบ) จึงต้องมีปุ่มยืนยันของตัวเอง
  const isFree = booking ? Number(booking.total_amount) === 0 : false;

  async function handleConfirmFree() {
    setConfirmingFree(true);
    setFreeError("");

    try {
      await confirmZeroAmountBooking(bookingId);
      navigate(`/booking/receipt?booking=${bookingId}`);
    } catch (err) {
      console.error("confirmZeroAmountBooking failed:", err);
      setFreeError(errorMessage(err));
      setConfirmingFree(false);
    }
  }

  async function handleGenerateQr() {
    setQrLoading(true);
    setQrError("");

    try {
      const result = await createPlernpayCharge(bookingId);
      setQr({ ...result, generatedAt: Date.now() });
      setQrNowTick(Date.now());
    } catch (err) {
      console.error("createPlernpayCharge failed:", err);
      setQrError(errorMessage(err));
    } finally {
      setQrLoading(false);
    }
  }

  function handleSlipChange(e) {
    const file = e.target.files?.[0] ?? null;
    setSlipError("");

    if (file) {
      try {
        assertImageFile(file);
      } catch (err) {
        setSlipError(err.message);
        e.target.value = "";
        setSlipFile(null);
        return;
      }
    }

    setSlipFile(file);
  }

  async function handleSubmitSlip() {
    if (!slipFile) {
      setSlipError("กรุณาเลือกไฟล์สลิปการโอนเงินก่อน");
      return;
    }

    setSubmittingSlip(true);
    setSlipError("");

    try {
      const path = await uploadPaymentSlip(slipFile, user.id, bookingId);
      await submitBankTransferPayment(bookingId, path);
      navigate(`/booking/receipt?booking=${bookingId}`);
    } catch (err) {
      console.error("submitBankTransferPayment failed:", err);
      setSlipError(errorMessage(err));
      setSubmittingSlip(false);
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
            เราเก็บสิทธ์ช่วงเวลาเวลานี้ไว้ให้คุณแล้ว ตรวจสอบรายละเอียดแล้วเลือกวิธีชำระเงินที่สะดวก
          </p>
        </section>

        {loading && <p className="booking-state">กำลังโหลดรายการจอง...</p>}

        {!loading && (error || !booking) && (
          <p className="booking-state booking-state--error">
            {error || "ไม่พบรายการจองนี้"}
          </p>
        )}

        {booking && isPendingUnpaid && !isHoldExpired && (
          <p
            className={`booking-note--warn booking-hold-banner ${
              holdSecondsLeft <= HOLD_WARNING_SECONDS ? "booking-hold-banner--urgent" : ""
            }`}
          >
            <Lock size={15} aria-hidden="true" /> เราเก็บช่วงเวลานี้ไว้ให้คุณแล้ว
            กรุณาชำระเงินภายใน {BOOKING_HOLD_MINUTES} นาที
            (เหลือเวลา {formatQrCountdown(holdSecondsLeft)} นาที)
          </p>
        )}

        {booking && (booking.status === "cancelled" || isHoldExpired) && (
          <p className="booking-state booking-state--error">
            {isHoldExpired
              ? "หมดเวลาที่ระบบกันช่วงเวลานี้ไว้ให้แล้ว กรุณาเริ่มจองใหม่อีกครั้ง"
              : "รายการจองนี้ถูกยกเลิกไปแล้ว กรุณาเริ่มจองใหม่อีกครั้ง"}
          </p>
        )}

        {booking && booking.status !== "cancelled" && !isHoldExpired && (
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

              {/* ยอด 0 บาทยังต้องผ่านขั้นตอนยืนยันคำสั่งซื้อเหมือนรายการที่จ่าย
                  เงินจริง — ระบบออกแถว payments ยืนยันการจอง ตัดคูปอง และออก
                  ใบเสร็จให้ครบ (confirm_zero_amount_booking, 0054) ไม่ใช่ยืนยัน
                  ให้เองเงียบ ๆ ตั้งแต่ตอนกดจอง */}
              {isFree ? (
                <section className="booking-panel">
                  <h2 className="booking-panel__title">ยืนยันคำสั่งซื้อ</h2>

                  <div className="booking-simulated booking-simulated--neutral">
                    <p className="booking-simulated__title">ไม่มียอดที่ต้องชำระ</p>
                    <p className="booking-simulated__text">
                      ส่วนลดและคูปองที่ใช้ครอบคลุมค่าสนามทั้งหมดแล้ว
                      กดยืนยันเพื่อปิดคำสั่งซื้อและรับใบเสร็จ
                      คุณยังต้องกดยืนยันภายในเวลาที่กันไว้ให้ มิฉะนั้นช่วงเวลานี้จะถูกปล่อยคืน
                    </p>
                  </div>

                  {freeError && <p className="booking-state booking-state--error">{freeError}</p>}

                  <button
                    type="button"
                    className="booking-btn booking-btn--block"
                    disabled={confirmingFree}
                    onClick={handleConfirmFree}
                  >
                    {confirmingFree ? "กำลังยืนยัน..." : "ยืนยันคำสั่งซื้อ (0 บาท)"}
                  </button>

                  <p className="booking-note">
                    ต้องการเปลี่ยนคูปอง? นำคูปองออกจากสรุปยอดทางขวาก่อน
                    แล้วเลือกวิธีชำระเงินตามปกติ
                  </p>
                </section>
              ) : (
              <section className="booking-panel">
                <h2 className="booking-panel__title">เลือกวิธีชำระเงิน</h2>

                {enabledMethods.length === 0 && (
                  <p className="booking-state booking-state--error">
                    ยังไม่มีช่องทางชำระเงินที่เปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ
                  </p>
                )}

                {enabledMethods.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => selectMethod(item.key)}
                    className={`booking-method ${
                      effectiveMethod === item.key ? "booking-method--active" : ""
                    }`}
                    aria-pressed={effectiveMethod === item.key}
                  >
                    <span className="booking-method__radio" aria-hidden="true" />
                    <span className="booking-method__text">
                      <span className="booking-method__title">{item.title}</span>
                      <span className="booking-method__desc">{item.desc}</span>
                    </span>
                  </button>
                ))}

                {effectiveMethod === "qr" && (
                  <>
                    {!qr && (
                      <button
                        type="button"
                        className="booking-btn booking-btn--block"
                        disabled={qrLoading}
                        onClick={handleGenerateQr}
                      >
                        {qrLoading ? "กำลังสร้าง QR..." : "สร้าง QR พร้อมเพย์"}
                      </button>
                    )}

                    {qr && (
                      <div className="booking-qr">
                        {qr.qrImage ? (
                          <img src={qr.qrImage} alt="QR พร้อมเพย์" className="booking-qr__image" />
                        ) : (
                          <p className="booking-qr__waiting">ไม่พบรูป QR กรุณาลองสร้างใหม่</p>
                        )}
                        {/* PlernPay แยกรายการโดยเติมสตางค์สุ่มต่อท้ายยอด — ต้องโอนตรง
                            เป๊ะตามยอดนี้ ไม่ใช่ยอดเต็มของ booking ไม่งั้นระบบจะจับคู่
                            รายการไม่เจอ */}
                        <p className="booking-qr__amount">
                          โอนยอด {formatBaht(qr.uniqueAmount ?? booking.total_amount)}
                        </p>
                        {qrSecondsLeft > 0 ? (
                          <p className="booking-qr__countdown">
                            QR หมดอายุใน {formatQrCountdown(qrSecondsLeft)} นาที กรุณาโอนก่อนหมดเวลา
                          </p>
                        ) : (
                          qrSecondsLeft === 0 && (
                            <p className="booking-qr__countdown booking-qr__countdown--expiring">
                              QR อาจหมดอายุแล้ว ถ้าคุณโอนเงินไปแล้วกำลังตรวจสอบขั้นสุดท้ายให้อยู่
                              ถ้าไม่สำเร็จภายในไม่กี่วินาที กรุณากด &quot;สร้าง QR ใหม่&quot;
                            </p>
                          )
                        )}
                        <p className="booking-qr__waiting">
                          สแกนด้วยแอปธนาคารเพื่อชำระ
                          <br />
                          กำลังรอตรวจสอบการชำระเงิน...
                        </p>
                        <button
                          type="button"
                          className="booking-btn booking-btn--ghost"
                          onClick={handleGenerateQr}
                          disabled={qrLoading}
                        >
                          {qrLoading ? "กำลังสร้าง QR..." : "สร้าง QR ใหม่"}
                        </button>
                      </div>
                    )}

                    {qrError && <p className="booking-state booking-state--error">{qrError}</p>}
                  </>
                )}

                {effectiveMethod === "bank_transfer" && (
                  <div className="booking-form">
                    <p className="booking-form__label">โอนเงินไปที่บัญชี</p>
                    {primaryAccount ? (
                      <div className="booking-simulated booking-simulated--neutral">
                        <p className="booking-simulated__title">
                          {primaryAccount.bankName} · {primaryAccount.accountNumber}
                        </p>
                        <p className="booking-simulated__text">
                          ชื่อบัญชี {primaryAccount.accountName}
                          <br />
                          โอนยอด {formatBaht(booking.total_amount)} แล้วแนบสลิปด้านล่าง
                        </p>
                      </div>
                    ) : (
                      <p className="booking-state booking-state--error">
                        ยังไม่มีบัญชีรับเงิน กรุณาติดต่อผู้ดูแลระบบ
                      </p>
                    )}

                    <div className="booking-form__field">
                      <label className="booking-form__label" htmlFor="slip-upload">
                        แนบสลิปการโอนเงิน
                      </label>
                      <input
                        id="slip-upload"
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="booking-file"
                        onChange={handleSlipChange}
                      />
                    </div>

                    {slipError && (
                      <p className="booking-state booking-state--error">{slipError}</p>
                    )}

                    <button
                      type="button"
                      className="booking-btn booking-btn--block"
                      disabled={submittingSlip || !primaryAccount}
                      onClick={handleSubmitSlip}
                    >
                      {submittingSlip ? "กำลังส่ง..." : "ส่งหลักฐานการโอนเงิน"}
                    </button>
                  </div>
                )}
              </section>
              )}

              {refundPolicy && (
                <section className="booking-panel">
                  <h2 className="booking-panel__title">นโยบายคืนเงิน</h2>

                  <div className="booking-row">
                    <span className="booking-row__label">
                      ยกเลิกก่อน {refundPolicy.fullRefundHours} ชม.
                    </span>
                    <span className="booking-row__value booking-row__value--success">
                      คืนเต็มจำนวน
                    </span>
                  </div>
                  <div className="booking-row">
                    <span className="booking-row__label">
                      ยกเลิกก่อน {refundPolicy.partialRefundHours} ชม.
                    </span>
                    <span className="booking-row__value booking-row__value--warning">
                      คืน {refundPolicy.partialRefundPercent}%
                    </span>
                  </div>
                  <div className="booking-row">
                    <span className="booking-row__label">
                      ยกเลิกน้อยกว่า {refundPolicy.partialRefundHours} ชม.
                    </span>
                    <span className="booking-row__value booking-row__value--danger">
                      ไม่คืนเงิน
                    </span>
                  </div>

                  <p className="booking-note">
                    กรณีสนามไม่พร้อมใช้งานจากฝ่ายสนาม คืนเต็มจำนวนเสมอ ไม่ขึ้นกับเวลายกเลิก
                  </p>
                  <p className="booking-note">
                    ยอดมัดจำ (ถ้ามี) ไม่คืนเสมอ ไม่ว่าจะยกเลิกก่อนเวลากี่ชั่วโมงก็ตาม
                  </p>
                </section>
              )}
            </div>

            <section className="booking-panel">
              <h2 className="booking-panel__title">สรุปยอดชำระ</h2>

              <div className="booking-row">
                <span className="booking-row__label">
                  ค่าสนาม {hours} ชม. × {formatBaht(priceBreakdown?.baseRate ?? facility?.price_per_hour)}
                </span>
                <span className="booking-row__value">
                  {formatBaht(priceBreakdown?.subtotal ?? booking.total_amount)}
                </span>
              </div>

              {priceBreakdown?.discountLines.map((line, i) => (
                <div className="booking-row" key={i}>
                  <span className="booking-row__label">{line.label}</span>
                  <span className="booking-row__value">-{formatBaht(line.amount)}</span>
                </div>
              ))}

              {priceBreakdown?.isPeak && <Badge tone="warning">ราคาพีค</Badge>}

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

              <CouponPicker
                booking={booking}
                userId={user?.id}
                onChanged={async () => setBookingReloadKey((key) => key + 1)}
              />

              {booking.discount_amount > 0 && (
                <div className="booking-row">
                  <span className="booking-row__label">ส่วนลดจากคูปอง</span>
                  <span className="booking-row__value booking-row__value--success">
                    -{formatBaht(booking.discount_amount)}
                  </span>
                </div>
              )}

              <hr className="booking-divider" />

              <div className="booking-row booking-row--total">
                <span className="booking-row__label">ยอดชำระทั้งหมด</span>
                <span className="booking-row__value">{formatBaht(booking.total_amount)}</span>
              </div>

              <p className="booking-note">ราคารวมภาษีมูลค่าเพิ่มแล้ว</p>

              <Link
                to={`/booking/schedule?facility=${facility?.id}&date=${booking.booking_date}`}
                className="booking-btn booking-btn--block booking-btn--ghost"
              >
                ‹ กลับไปเลือกเวลา
              </Link>

              {isPendingUnpaid && (
                <p className="booking-note">
                  <Lock size={15} aria-hidden="true" /> เหลือเวลาชำระเงินอีก{" "}
                  {formatQrCountdown(holdSecondsLeft)} นาที
                  มิฉะนั้นระบบจะปล่อยช่วงเวลานี้ให้ผู้อื่นจองต่อ
                </p>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
