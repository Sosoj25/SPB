import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import BookingSteps from "../components/BookingSteps";
import { Badge } from "../components/DashboardWidgets";
import { useAuth } from "../context/useAuth";
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
  createPlernpayCharge,
  submitBankTransferPayment,
  uploadPaymentSlip,
} from "../lib/payments";
import { errorMessage } from "../lib/errors";
import { assertImageFile } from "../lib/uploads";
import { sportImage } from "../lib/catalog";
import "./Booking.css";

const PAYMENT_LABELS = ["เลือกกีฬา", "เลือกสนาม", "เลือกวันและเวลา", "ชำระเงิน"];

// PlernPay จำกัด 30 requests/นาทีต่อ API key "รวมทั้งระบบ" ไม่ใช่ต่อการจอง
// เดียว และเกินแล้วแอปทั้งตัวจะถูก deactivate ทันที (ดูคอมเมนต์ใน
// check-plernpay-payment) — เว้นช่วง poll ให้กว้างกว่าปกติไว้ก่อนตั้งใจ ถ้า
// มีคนจ่ายพร้อมกันเยอะขึ้นในอนาคต ควรติดต่อขอเพิ่ม limit ไม่ใช่ลดค่านี้ลง
const POLL_MS = 8000;

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
  const pollRef = useRef(null);

  // ---------- โอนผ่านบัญชี + สลิป ----------
  const [slipFile, setSlipFile] = useState(null);
  const [slipError, setSlipError] = useState("");
  const [submittingSlip, setSubmittingSlip] = useState(false);

  const { data: booking, loading, error } = useAsyncData(
    () => fetchBookingDetail(bookingId),
    bookingId ? `booking:${bookingId}` : null
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

  async function handleGenerateQr() {
    setQrLoading(true);
    setQrError("");

    try {
      const result = await createPlernpayCharge(bookingId);
      setQr(result);
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
                          โอนยอด {formatBaht(qr.uniqueAmount ?? booking.total_amount)} เป๊ะ ๆ
                        </p>
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
                  <span className="booking-row__label">ยอดมัดจำขั้นต่ำ</span>
                  <span className="booking-row__value">{formatBaht(booking.deposit_amount)}</span>
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
