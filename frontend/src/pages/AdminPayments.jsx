// คิวตรวจสอบการชำระเงินของแอดมิน — ดูสลิป อนุมัติ หรือปฏิเสธพร้อมเหตุผล
import { useState } from "react";
import { Check, Search, X } from "lucide-react";
import DashboardLayout from "../components/DashboardLayout";
import { Badge, Pagination, Pill, StatCard } from "../components/DashboardWidgets";
import { useAdminPaymentStats, useAdminPayments } from "../hooks/useAdmin";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  approvePayment,
  describeGateway,
  describeMethod,
  describePaymentStatus,
  fetchSlipSignedUrl,
  formatDateTime,
  rejectPayment,
} from "../lib/payments";
import {
  formatBaht,
  formatBookingDate,
  formatTimeRange,
} from "../lib/bookings";
import { errorMessage } from "../lib/errors";
import "./AdminPayments.css";

// หน้านี้ทำอย่างเดียว: คิวรอตรวจสอบการชำระเงิน + อนุมัติ/ปฏิเสธ
//
// รอบการโอนเงินออก (payout) ยังไม่มีตารางรองรับ จึงยังไม่มีในหน้านี้ —
// ห้ามใส่ตัวเลขที่ไม่มีข้อมูลจริงรองรับเข้ามาให้ดูครบ
// ส่วนการตั้งค่าบัญชีรับเงินอยู่ที่ /admin/payments/settings

const FILTERS = [
  { key: "review", label: "รอตรวจสอบ" },
  { key: "approved", label: "ชำระแล้ว" },
  { key: "rejected", label: "ปฏิเสธ" },
  { key: "", label: "ทั้งหมด" },
];

const isWaiting = (payment) => payment.status === "pending" || payment.status === "paid";

function describeBooking(payment) {
  const booking = payment.bookings;
  if (!booking) return "—";

  // facilities/venues มี RLS ของตัวเอง สนามที่ปิดอยู่จะ join กลับมาเป็น null
  const facility = booking.facilities;
  const venue = facility?.venues?.name;
  const place = facility ? (venue ? `${venue} · ${facility.name}` : facility.name) : "สนามกีฬา";

  return `${place} · ${formatBookingDate(booking.booking_date)} ${formatTimeRange(
    booking.start_time,
    booking.end_time,
  )}`;
}

function customerName(payment) {
  return payment.profiles?.full_name || payment.profiles?.username || "—";
}

// พร้อมเพย์ (PlernPay) ไม่มีสลิปให้ดูเหมือนโอนบัญชี เพราะยืนยันอัตโนมัติผ่าน
// API ตรง — สิ่งที่แทนสลิปได้คือเลขอ้างอิงฝั่ง PlernPay (gateway_charge_id)
// กับเวลาที่ระบบยืนยันจริง (verified_at) ไว้ให้แอดมินอ้างอิงย้อนหลังได้
function PaymentReferenceModal({ payment, onClose }) {
  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div className="dash-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dash-modal__header">
          <h2>อ้างอิงพร้อมเพย์ {payment.bookings?.booking_code ?? ""}</h2>
          <button type="button" className="dash-modal__close" onClick={onClose} aria-label="ปิด">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <dl className="dash-modal__facts">
          <div>
            <dt>เลขอ้างอิง PlernPay</dt>
            <dd>{payment.gateway_charge_id ?? "ยังไม่ได้รับ (สร้าง QR ไม่สำเร็จ)"}</dd>
          </div>
          <div>
            <dt>ยอดชำระ</dt>
            <dd>{formatBaht(payment.amount)}</dd>
          </div>
          <div>
            <dt>สถานะ</dt>
            <dd>{describePaymentStatus(payment.status).label}</dd>
          </div>
          <div>
            <dt>เวลาที่ยืนยัน</dt>
            <dd>{payment.verified_at ? formatDateTime(payment.verified_at) : "ยังไม่ยืนยัน"}</dd>
          </div>
          {payment.status === "rejected" && payment.rejection_reason && (
            <div>
              <dt>เหตุผล</dt>
              <dd>{payment.rejection_reason}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}

// เดิมปุ่ม "ดูสลิป" แค่เปิดสลิปในแท็บใหม่ แล้วปล่อยให้กดอนุมัติจากในตารางได้
// เลยไม่ว่าจะเปิดดูหรือไม่ — เป็นจุดพลาดที่แพงที่สุดของช่องทางโอน+แนบสลิป
// เพราะการกดอนุมัติเท่ากับยืนยันการจองและรับรู้ยอดทันที (admin_approve_payment)
// ย้อนกลับยากกว่าการกดปฏิเสธมาก
//
// โมดัลนี้เอาสลิปมาวางคู่กับตัวเลขที่ต้องเทียบ (ยอด/เวลาที่แจ้งชำระ/ชื่อผู้ชำระ)
// และปุ่มอนุมัติจะปลดล็อกก็ต่อเมื่อรูปสลิปขึ้นจอสำเร็จจริง ๆ (onLoad) ไม่ใช่
// แค่ตอนกดเปิดโมดัล — เปิดแล้วโหลดไม่ขึ้นถือว่ายังไม่ได้ดู
function SlipReviewModal({
  payment,
  reviewed,
  busy,
  onReviewed,
  onApprove,
  onReject,
  onClose,
}) {
  const [imageError, setImageError] = useState("");
  const [zoomed, setZoomed] = useState(false);

  // bucket payment-slips เป็น private (สลิปมีเลขบัญชี/ชื่อบัญชีของลูกค้าติดมา)
  // — ขอ signed URL ตอนเปิดดูจริงเท่านั้น ไม่เก็บ URL สาธารณะไว้ล่วงหน้า
  const { data: url, loading, error } = useAsyncData(
    () => fetchSlipSignedUrl(payment.slip_url),
    `payment-slip:${payment.id}`,
    "",
  );

  const problem = error || imageError;
  const waiting = isWaiting(payment);

  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div
        className="dash-modal admin-payments__slip-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dash-modal__header">
          <h2>ตรวจสลิป {payment.bookings?.booking_code ?? ""}</h2>
          <button type="button" className="dash-modal__close" onClick={onClose} aria-label="ปิด">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <dl className="admin-payments__slip-facts">
          <div>
            <dt>ผู้ชำระ</dt>
            <dd>{customerName(payment)}</dd>
          </div>
          <div>
            <dt>ยอดที่ต้องได้รับ</dt>
            <dd>{formatBaht(payment.amount)}</dd>
          </div>
          <div>
            <dt>แจ้งชำระเมื่อ</dt>
            <dd>{formatDateTime(payment.created_at)}</dd>
          </div>
        </dl>

        <div className="admin-payments__slip-frame">
          {problem && <p className="dash-message dash-message--error">{problem}</p>}
          {!problem && loading && (
            <p className="admin-payments__slip-status">กำลังโหลดสลิป...</p>
          )}
          {!problem && url && (
            <img
              src={url}
              alt={`สลิปการชำระเงินของ ${payment.bookings?.booking_code ?? "การจองนี้"}`}
              className={`admin-payments__slip-image${
                zoomed ? " admin-payments__slip-image--zoomed" : ""
              }`}
              onClick={() => setZoomed((z) => !z)}
              onLoad={onReviewed}
              onError={() => setImageError("เปิดสลิปไม่สำเร็จ ลิงก์อาจหมดอายุ ลองปิดแล้วเปิดใหม่")}
            />
          )}
        </div>

        <p className="admin-payments__slip-note">
          เทียบยอดและเวลาบนสลิปกับรายการด้านบนก่อนอนุมัติ — กดที่รูปเพื่อซูมในหน้านี้
          {waiting && !reviewed && " (ปุ่มอนุมัติจะกดได้เมื่อสลิปขึ้นจอแล้ว)"}
        </p>

        <div
          className={`admin-payments__slip-actions${
            waiting ? "" : " admin-payments__slip-actions--end"
          }`}
        >
          {url && !problem && (
            <a
              className="dash-btn admin-payments__slip-open"
              href={url}
              target="_blank"
              rel="noreferrer"
              title="เปิดรูปสลิปขนาดเต็มในแท็บใหม่"
              onClick={onReviewed}
            >
              <Search size={15} aria-hidden="true" /> ขยายรูปเต็มขนาด
            </a>
          )}
          {waiting && (
            <>
              <button
                type="button"
                className="dash-btn dash-btn--add"
                disabled={busy || !reviewed}
                title={reviewed ? undefined : "ต้องเปิดดูสลิปก่อนจึงจะอนุมัติได้"}
                onClick={() => onApprove(payment)}
              >
                {busy ? "กำลังบันทึก..." : "อนุมัติ"}
              </button>
              <button
                type="button"
                className="dash-btn dash-btn--cancel"
                disabled={busy}
                onClick={() => onReject(payment)}
              >
                ปฏิเสธ
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminPayments() {
  const [filter, setFilter] = useState("review");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState("");
  const [viewingPayment, setViewingPayment] = useState(null);
  const [viewingSlip, setViewingSlip] = useState(null);
  // id ของรายการที่แอดมิน "เห็นสลิปแล้ว" ในเซสชันนี้ — เก็บไว้ที่หน้าจอ ไม่ใช่
  // ที่แถว payments เพราะมันคือสถานะของคนกด ไม่ใช่ของการชำระเงิน แอดมินอีกคน
  // ที่เปิดคิวเดียวกันก็ต้องเปิดดูสลิปเองก่อนอนุมัติอยู่ดี
  const [reviewedSlips, setReviewedSlips] = useState(() => new Set());

  const { payments, hasMore, loading, error } = useAdminPayments({
    status: filter || undefined,
    page,
    reloadKey,
  });
  const { stats } = useAdminPaymentStats(reloadKey);

  function selectFilter(key) {
    setFilter(key);
    setPage(1);
  }

  // ล็อกปุ่มอนุมัติเฉพาะรายการที่มีสลิปให้ดูจริง (โอนเข้าบัญชี gateway='manual')
  // — พร้อมเพย์ยืนยันอัตโนมัติและไม่เคยมีสลิป ถ้าล็อกด้วยจะกลายเป็นอนุมัติเคส
  // ที่ค้าง pending ไม่ได้เลยตลอดกาล
  const slipLocked = (payment) => Boolean(payment.slip_url) && !reviewedSlips.has(payment.id);

  function markSlipReviewed(paymentId) {
    setReviewedSlips((prev) => {
      if (prev.has(paymentId)) return prev;
      const next = new Set(prev);
      next.add(paymentId);
      return next;
    });
  }

  async function handleApprove(payment) {
    // กันไว้อีกชั้นเผื่อกดถึงปุ่มนี้ได้ทั้งที่ยังไม่ได้เปิดดูสลิป
    if (slipLocked(payment)) {
      setActionError("ต้องเปิดดูสลิปของรายการนี้ก่อน จึงจะกดอนุมัติได้");
      setViewingSlip(payment);
      return;
    }

    const ok = window.confirm(
      `ยืนยันว่าได้รับเงิน ${formatBaht(payment.amount)} สำหรับการจอง ${
        payment.bookings?.booking_code ?? ""
      } แล้วใช่ไหม?`,
    );
    if (!ok) return;

    setActionError("");
    setBusyId(payment.id);

    try {
      await approvePayment(payment.id);
      setViewingSlip(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("approvePayment failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(payment) {
    // เหตุผลไม่บังคับ แต่กด "ยกเลิก" บน prompt = ไม่ทำอะไรต่อ (คนละความหมาย
    // กับกด OK ทั้งที่ช่องว่าง ซึ่งแปลว่าปฏิเสธโดยไม่ระบุเหตุผล)
    const reason = window.prompt(
      `เหตุผลที่ปฏิเสธการชำระเงินของ ${payment.bookings?.booking_code ?? ""} (ไม่บังคับ)`,
      "",
    );
    if (reason === null) return;

    setActionError("");
    setBusyId(payment.id);

    try {
      await rejectPayment(payment.id, reason);
      setViewingSlip(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("rejectPayment failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  function openSlip(payment) {
    setActionError("");
    setViewingSlip(payment);
  }

  return (
    <DashboardLayout
      variant="admin"
      title="รายการชำระเงิน"
      subtitle="ตรวจสอบและอนุมัติการชำระเงินของลูกค้า"
    >
      <section className="dash-kpi">
        <StatCard
          label="รอตรวจสอบ"
          value={stats ? stats.pendingCount : "—"}
          hint={stats ? formatBaht(stats.pendingAmount) : undefined}
        />
        <StatCard label="ชำระวันนี้" value={stats ? stats.approvedToday : "—"} />
        <StatCard
          label="ยอดรับชำระเดือนนี้"
          value={stats ? formatBaht(stats.revenueMonth) : "—"}
        />
        <StatCard label="ปฏิเสธเดือนนี้" value={stats ? stats.rejectedMonth : "—"} />
      </section>

      <div className="dash-filters">
        {FILTERS.map((item) => (
          <Pill
            key={item.key}
            active={item.key === filter}
            onClick={() => selectFilter(item.key)}
          >
            {item.label}
          </Pill>
        ))}
      </div>

      {actionError && <div className="dash-message dash-message--error">{actionError}</div>}

      <div className="dash-card dash-table-card">
        {loading && <p className="dash-empty">กำลังโหลดข้อมูล...</p>}

        {!loading && error && <div className="dash-message dash-message--error">{error}</div>}

        {!loading && !error && payments.length === 0 && (
          <p className="dash-empty">
            {filter === "review" ? "ไม่มีรายการรอตรวจสอบ" : "ยังไม่มีรายการชำระเงิน"}
          </p>
        )}

        {!loading && !error && payments.length > 0 && (
          <>
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>รหัสการจอง</th>
                    <th>ผู้ชำระ</th>
                    <th>รายละเอียด</th>
                    <th>ช่องทาง</th>
                    <th>ยอด</th>
                    <th>สถานะ</th>
                    <th aria-hidden="true"></th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => {
                    const status = describePaymentStatus(payment.status);
                    const waiting = isWaiting(payment);
                    const busy = busyId === payment.id;
                    const locked = slipLocked(payment);

                    return (
                      <tr key={payment.id}>
                        <td>{payment.bookings?.booking_code ?? "—"}</td>
                        <td>{customerName(payment)}</td>
                        <td>{describeBooking(payment)}</td>
                        <td>
                          {describeMethod(payment.payment_method)}
                          <p className="dash-field__hint">{describeGateway(payment.gateway)}</p>
                        </td>
                        <td>{formatBaht(payment.amount)}</td>
                        <td>
                          <Badge tone={status.tone}>{status.label}</Badge>
                          {payment.status === "rejected" && payment.rejection_reason && (
                            <p className="dash-field__hint">{payment.rejection_reason}</p>
                          )}
                        </td>
                        <td>
                          <div className="dash-actions">
                            {payment.slip_url && (
                              <button
                                type="button"
                                className={`dash-btn admin-payments__slip-open${
                                  locked ? "" : " admin-payments__slip-open--done"
                                }`}
                                onClick={() => openSlip(payment)}
                              >
                                {locked ? (
                                  <>
                                    <Search size={14} aria-hidden="true" /> ดูสลิป
                                  </>
                                ) : (
                                  <>
                                    <Check size={14} aria-hidden="true" /> ดูสลิปแล้ว
                                  </>
                                )}
                              </button>
                            )}
                            {payment.gateway === "plernpay" && (
                              <button
                                type="button"
                                className="dash-btn"
                                onClick={() => setViewingPayment(payment)}
                              >
                                ดูอ้างอิง
                              </button>
                            )}
                            {waiting && (
                              <>
                                <button
                                  type="button"
                                  className="dash-btn dash-btn--add"
                                  disabled={busy || locked}
                                  title={locked ? "ต้องเปิดดูสลิปก่อนจึงจะอนุมัติได้" : undefined}
                                  onClick={() => handleApprove(payment)}
                                >
                                  {busy ? "กำลังบันทึก..." : "อนุมัติ"}
                                </button>
                                <button
                                  type="button"
                                  className="dash-btn dash-btn--cancel"
                                  disabled={busy}
                                  onClick={() => handleReject(payment)}
                                >
                                  ปฏิเสธ
                                </button>
                              </>
                            )}
                          </div>
                          {waiting && locked && (
                            <p className="admin-payments__lock-hint">ดูสลิปก่อนจึงจะอนุมัติได้</p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="dash-table-footer">
              <p>หน้า {page}</p>
              <Pagination page={page} hasMore={hasMore} onChange={setPage} />
            </div>
          </>
        )}
      </div>

      {viewingSlip && (
        <SlipReviewModal
          payment={viewingSlip}
          reviewed={reviewedSlips.has(viewingSlip.id)}
          busy={busyId === viewingSlip.id}
          onReviewed={() => markSlipReviewed(viewingSlip.id)}
          onApprove={handleApprove}
          onReject={handleReject}
          onClose={() => setViewingSlip(null)}
        />
      )}

      {viewingPayment && (
        <PaymentReferenceModal
          payment={viewingPayment}
          onClose={() => setViewingPayment(null)}
        />
      )}
    </DashboardLayout>
  );
}
