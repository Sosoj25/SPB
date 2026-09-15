// กล่องรายละเอียดของแท่งเดียวในกราฟรายได้ — แยกยอดตามสนามในช่วงเวลานั้น
import { useEffect } from "react";
import { useAdminRevenueBucketDetail } from "../hooks/useAdmin";
import { formatBaht } from "../lib/bookings";
import "./TextPromptDialog.css";
import "./RevenueDetailDialog.css";

// bucket ที่ RPC คืนมาเป็นสตริงไม่มี tz (เวลาไทยตรง ๆ) — new Date() อ่านเป็น
// เวลาท้องถิ่นของเบราว์เซอร์ ตรงกับที่กราฟใช้อยู่ ไม่ต้องแปลง tz ซ้ำ
const dayFormat = new Intl.DateTimeFormat("th-TH", {
  weekday: "long",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const dateFormat = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" });
const shortDateFormat = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short" });
const monthFormat = new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric" });
const yearFormat = new Intl.DateTimeFormat("th-TH", { year: "numeric" });

function describePeriod(scaleKey, bucket) {
  const start = new Date(bucket);

  if (scaleKey === "week") {
    // bucket เป็นวันจันทร์ต้นสัปดาห์ — ปิดท้ายที่วันอาทิตย์ให้ครบ 7 วัน
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return `${shortDateFormat.format(start)} – ${dateFormat.format(end)}`;
  }

  if (scaleKey === "month") return monthFormat.format(start);
  if (scaleKey === "year") return yearFormat.format(start);

  return dayFormat.format(start);
}

// กล่องรายละเอียดของ "หนึ่งแท่ง" ในกราฟรายได้ — กางว่ายอดก้อนนั้นมาจากสนามไหน
// เปิดได้เฉพาะช่วงที่สิ้นสุดแล้ว (หน้า AdminOverview เป็นคนคุมว่าแท่งไหนกดได้)
// ปุ่ม ‹ › เดินไปช่วงก่อนหน้า/ถัดไปในสเกลเดียวกันได้โดยไม่ต้องปิดกล่องก่อน
export default function RevenueDetailDialog({
  scale,
  bucket,
  onStep,
  canStepBack,
  canStepForward,
  onClose,
}) {
  const { rows, loading, error } = useAdminRevenueBucketDetail(scale.key, bucket);

  const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const totalBookings = rows.reduce((sum, row) => sum + row.bookingsCount, 0);
  const totalPayments = rows.reduce((sum, row) => sum + row.paymentsCount, 0);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && canStepBack) onStep(-1);
      if (event.key === "ArrowRight" && canStepForward) onStep(1);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, onStep, canStepBack, canStepForward]);

  // คืนโฟกัสให้แท่ง/ปุ่มที่เปิดกล่อง — ไม่งั้นโฟกัสตกไปที่ body หลังกล่องหายไป
  useEffect(() => {
    const opener = document.activeElement;
    return () => opener?.focus?.();
  }, []);

  return (
    <div
      className="prompt-dialog__backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="prompt-dialog revenue-detail" role="dialog" aria-modal="true" aria-label="รายละเอียดย้อนหลัง">
        <div className="revenue-detail__head">
          <div>
            <p className="revenue-detail__scale">รายละเอียดย้อนหลัง · {scale.label}</p>
            <h2 className="prompt-dialog__title revenue-detail__title">{describePeriod(scale.key, bucket)}</h2>
          </div>

          <div className="revenue-detail__nav">
            <button
              type="button"
              className="revenue-detail__step"
              disabled={!canStepBack}
              aria-label="ช่วงก่อนหน้า"
              onClick={() => onStep(-1)}
            >
              ‹
            </button>
            <button
              type="button"
              className="revenue-detail__step"
              disabled={!canStepForward}
              aria-label="ช่วงถัดไป"
              onClick={() => onStep(1)}
            >
              ›
            </button>
          </div>
        </div>

        <dl className="revenue-detail__summary">
          <div>
            <dt>รายได้รวม</dt>
            <dd>{formatBaht(totalRevenue)}</dd>
          </div>
          <div>
            <dt>การจอง</dt>
            <dd>{totalBookings} รายการ</dd>
          </div>
          <div>
            <dt>การชำระเงิน</dt>
            <dd>{totalPayments} ครั้ง</dd>
          </div>
        </dl>

        {loading && <p className="dash-empty">กำลังโหลดข้อมูล...</p>}

        {!loading && error && <div className="dash-message dash-message--error">{error}</div>}

        {!loading && !error && rows.length === 0 && <p className="dash-empty">ช่วงนี้ยังไม่มีรายได้เข้า</p>}

        {!loading && !error && rows.length > 0 && (
          <div className="revenue-detail__table">
            <div className="revenue-detail__row revenue-detail__row--head">
              <span>สนาม</span>
              <span>จอง</span>
              <span>รายได้</span>
            </div>

            {rows.map((row) => (
              <div key={row.facilityId ?? "unknown"} className="revenue-detail__row">
                <span>
                  {row.facilityName ?? "ไม่ระบุสนาม"}
                  {row.sportName && <small>{row.sportName}</small>}
                </span>
                <span>{row.bookingsCount}</span>
                <span className="revenue-detail__amount">{formatBaht(row.revenue)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="prompt-dialog__actions">
          <button type="button" className="prompt-dialog__submit" autoFocus onClick={onClose}>
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}
