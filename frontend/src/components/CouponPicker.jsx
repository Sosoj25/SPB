// เลือกคูปองส่วนลดมาใช้กับการจองในหน้าชำระเงิน
//
// การผูก/ถอนคูปองทำที่ฝั่ง server (applyBookingCoupon/removeBookingCoupon)
// ยอดที่โชว์จึงเป็นยอดที่คิดจริง ไม่ใช่การลบเลขฝั่งหน้าเว็บ
import { useState } from "react";
import { Link } from "react-router-dom";
import { useUsableCoupons } from "../hooks/useRewards";
import {
  applyBookingCoupon,
  describeBenefit,
  formatRewardDate,
  removeBookingCoupon,
} from "../lib/rewards";
import { formatBaht } from "../lib/bookings";
import { errorMessage } from "../lib/errors";
import "./CouponPicker.css";

// กล่องใช้คูปองในหน้าชำระเงิน
//
// ส่วนลดคำนวณฝั่งเซิร์ฟเวอร์ทั้งหมด (apply_booking_coupon, 0049) — คอมโพเนนต์นี้
// ไม่เดาเลขเอง แค่ส่งรหัสไปแล้วบอกให้หน้าแม่โหลดการจองใหม่ ยอดที่แสดงจึงมาจาก
// booking.total_amount ที่ฐานข้อมูลคำนวณให้เสมอ
//
// ใช้ได้เฉพาะตอนยังไม่ได้จ่าย เพราะถ้ามี QR ค้างอยู่ ยอดบน QR จะไม่ตรงกับยอด
// ใหม่ แล้วตัวกระทบยอดจะจับคู่เงินเข้าไม่ได้ (RPC เช็คซ้ำให้อีกชั้น)
export default function CouponPicker({ booking, userId, onChanged }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const { coupons, loading } = useUsableCoupons(userId, reloadKey);

  const applied = Boolean(booking.redemption_id);
  const locked = booking.payment_status !== "unpaid" || booking.status !== "pending";

  async function run(action) {
    setError("");
    setBusy(true);

    try {
      await action();
      setCode("");
      setReloadKey((key) => key + 1);
      await onChanged();
    } catch (err) {
      console.error("coupon action failed:", err);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // ใช้คูปองไปแล้ว — โชว์ยอดที่ลดได้จริงกับปุ่มถอดออก
  if (applied) {
    return (
      <section className="coupon">
        <div className="coupon__applied">
          <div>
            <p className="coupon__applied-title">✓ ใช้คูปองแล้ว</p>
            <p className="coupon__applied-note">
              ลดไปทั้งหมด {formatBaht(booking.discount_amount)} จากยอดเดิม{" "}
              {formatBaht(booking.original_amount)}
            </p>
          </div>

          {!locked && (
            <button
              type="button"
              className="coupon__remove"
              disabled={busy}
              onClick={() => run(() => removeBookingCoupon(booking.id))}
            >
              นำออก
            </button>
          )}
        </div>

        {error && <p className="coupon__error">{error}</p>}
      </section>
    );
  }

  if (locked) return null;

  return (
    <section className="coupon">
      <p className="coupon__title">🎟 ใช้คูปองส่วนลด</p>

      {loading && <p className="coupon__empty">กำลังโหลดคูปองของคุณ...</p>}

      {!loading && coupons.length === 0 && (
        <p className="coupon__empty">
          คุณยังไม่มีคูปองที่ใช้ได้ —{" "}
          <Link to="/rewards" className="link">
            ใช้แต้มสะสมแลกคูปอง
          </Link>
        </p>
      )}

      {!loading &&
        coupons.map((coupon) => (
          <button
            key={coupon.id}
            type="button"
            className="coupon__option"
            disabled={busy}
            onClick={() => run(() => applyBookingCoupon(booking.id, coupon.code))}
          >
            <span className="coupon__option-info">
              <span className="coupon__option-name">{coupon.rewardName}</span>
              <span className="coupon__option-meta">
                {coupon.code}
                {coupon.expiresAt ? ` · ใช้ได้ถึง ${formatRewardDate(coupon.expiresAt)}` : ""}
              </span>
            </span>
            <span className="coupon__option-benefit">{describeBenefit(coupon)}</span>
          </button>
        ))}

      {/* กรอกรหัสเองด้วย เผื่อคูปองที่ได้มาจากช่องทางอื่นหรือหน้าจอแคบจนเลื่อน
          หารายการไม่เจอ */}
      <div className="coupon__manual">
        <input
          aria-label="รหัสคูปอง"
          type="text"
          className="coupon__input"
          placeholder="หรือกรอกรหัสคูปอง เช่น SPB-RW-88213"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <button
          type="button"
          className="coupon__apply"
          disabled={busy || !code.trim()}
          onClick={() => run(() => applyBookingCoupon(booking.id, code.trim()))}
        >
          {busy ? "กำลังใช้..." : "ใช้คูปอง"}
        </button>
      </div>

      {error && <p className="coupon__error">{error}</p>}
    </section>
  );
}
