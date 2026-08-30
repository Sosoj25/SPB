import { useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import { Badge, Pagination, Pill, StatCard } from "../components/DashboardWidgets";
import { useAdminPaymentStats, useAdminPayments } from "../hooks/useAdmin";
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

// หน้านี้เคยเป็น mock ล้วน — บัญชีธนาคาร ยอดรอโอน ช่องทางชำระเงิน และปุ่ม
// "โอนเงินทันที" ทั้งหมดฮาร์ดโค้ดไว้ในไฟล์ ไม่แตะ Supabase เลยสักบรรทัด
// ทั้งที่ตาราง payments มี status / verified_by / verified_at /
// rejection_reason รอไว้ตั้งแต่ 0000 และ RLS ก็เปิดให้แอดมิน update อยู่แล้ว
// แปลว่าจริง ๆ แล้วแอดมิน "ไม่มีที่ตรวจสอบการชำระเงิน" เลยทั้งระบบ
//
// ตอนนี้หน้านี้ทำหน้าที่เดียวที่ระบบต้องการจริงและมีข้อมูลรองรับ: คิวรอ
// ตรวจสอบ + อนุมัติ/ปฏิเสธ ส่วนการตั้งค่าบัญชีรับเงินและรอบการโอน (payout)
// ยังไม่มีตารางรองรับ จึงยังไม่ทำ ดีกว่าโชว์ตัวเลขปลอมให้เข้าใจผิด

const FILTERS = [
  { key: "review", label: "รอตรวจสอบ" },
  { key: "approved", label: "ชำระแล้ว" },
  { key: "rejected", label: "ปฏิเสธ" },
  { key: "", label: "ทั้งหมด" },
];

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
            ✕
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

export default function AdminPayments() {
  const [filter, setFilter] = useState("review");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState("");
  const [slipBusyId, setSlipBusyId] = useState(null);
  const [viewingPayment, setViewingPayment] = useState(null);

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

  async function handleApprove(payment) {
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
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("rejectPayment failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  // bucket payment-slips เป็น private (เก็บเลขบัญชี/ชื่อบัญชีของลูกค้า) —
  // ต้องขอ signed URL ตอนกดดูจริง ๆ เท่านั้น ไม่เก็บ URL สาธารณะไว้ล่วงหน้า
  async function handleViewSlip(payment) {
    setActionError("");
    setSlipBusyId(payment.id);

    try {
      const url = await fetchSlipSignedUrl(payment.slip_url);
      window.open(url, "_blank", "noreferrer");
    } catch (err) {
      console.error("fetchSlipSignedUrl failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setSlipBusyId(null);
    }
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
                    const waiting = payment.status === "pending" || payment.status === "paid";
                    const busy = busyId === payment.id;

                    return (
                      <tr key={payment.id}>
                        <td>{payment.bookings?.booking_code ?? "—"}</td>
                        <td>
                          {payment.profiles?.full_name || payment.profiles?.username || "—"}
                        </td>
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
                                className="dash-btn"
                                disabled={slipBusyId === payment.id}
                                onClick={() => handleViewSlip(payment)}
                              >
                                {slipBusyId === payment.id ? "กำลังเปิด..." : "ดูสลิป"}
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
                                  disabled={busy}
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

      {viewingPayment && (
        <PaymentReferenceModal
          payment={viewingPayment}
          onClose={() => setViewingPayment(null)}
        />
      )}
    </DashboardLayout>
  );
}
