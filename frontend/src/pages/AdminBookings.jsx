// รายการจองทั้งระบบสำหรับแอดมิน — กรองตามสถานะ/วันที่ และดูรายละเอียดแต่ละรายการ
import { useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import { Badge, SearchBox, Pill, Pagination } from "../components/DashboardWidgets";
import { useAdminBookings } from "../hooks/useAdmin";
import {
  canCancel,
  cancelBooking,
  describeFacility,
  describePayment,
  describeSport,
  describeStatus,
  formatBaht,
  formatBookingDate,
  formatTimeRange,
} from "../lib/bookings";
import { formatDateTime } from "../lib/payments";
import { errorMessage } from "../lib/errors";

// ชื่อแอดมิน/ผู้ใช้ที่ join มาจาก profiles — full_name อาจว่างถ้ายังไม่ได้กรอก
const describePerson = (profile) => profile?.full_name || profile?.username || "—";

// payments เรียงล่าสุดก่อนแล้ว (order created_at desc ที่ fetchAdminBookings) —
// หยิบแถวปฏิเสธล่าสุดมาโชว์เหตุผล ถ้าลูกค้าโดนปฏิเสธแล้วจ่ายใหม่จนผ่านไปแล้ว
// ก็ยังเห็นประวัติเดิมได้ในหน้ารายละเอียด
const latestRejectedPayment = (booking) =>
  (booking.payments ?? []).find((p) => p.status === "rejected") ?? null;

const FILTERS = [
  { key: "", label: "ทั้งหมด" },
  { key: "pending", label: "รอชำระเงิน" },
  { key: "confirmed", label: "จองแล้ว" },
  { key: "awaiting_review", label: "รอรีวิว" },
  { key: "completed", label: "สำเร็จ" },
  { key: "no_show", label: "ไม่ได้ไป" },
  { key: "cancelled", label: "ยกเลิก" },
];

function BookingDetailModal({ booking, onClose }) {
  const status = describeStatus(booking);
  const rejectedPayment = latestRejectedPayment(booking);

  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div className="dash-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dash-modal__header">
          <h2>รายละเอียดการจอง {booking.booking_code}</h2>
          <button type="button" className="dash-modal__close" onClick={onClose} aria-label="ปิด">
            ✕
          </button>
        </div>

        <dl className="dash-modal__facts">
          <div>
            <dt>ผู้จอง</dt>
            <dd>
              {describePerson(booking.profiles)}
              {booking.is_walk_in && (
                <p className="dash-field__hint">
                  รับที่เคาน์เตอร์ (Walk-in)
                  {booking.walk_in_name ? ` · ${booking.walk_in_name}` : ""}
                  {booking.walk_in_phone ? ` · ${booking.walk_in_phone}` : ""}
                </p>
              )}
            </dd>
          </div>
          <div>
            <dt>สนาม</dt>
            <dd>{describeFacility(booking)}</dd>
          </div>
          <div>
            <dt>ประเภทกีฬา</dt>
            <dd>{describeSport(booking)}</dd>
          </div>
          <div>
            <dt>วันที่</dt>
            <dd>{formatBookingDate(booking.booking_date)}</dd>
          </div>
          <div>
            <dt>เวลา</dt>
            <dd>{formatTimeRange(booking.start_time, booking.end_time)}</dd>
          </div>
          <div>
            <dt>สถานะ</dt>
            <dd>
              <Badge tone={status.tone}>{status.label}</Badge>
            </dd>
          </div>
          <div>
            <dt>การชำระเงิน</dt>
            <dd>
              {describePayment(booking)}
              {rejectedPayment && (
                <p className="dash-field__hint">
                  ปฏิเสธโดย {describePerson(rejectedPayment.rejected_by_profile)}
                  {rejectedPayment.verified_at
                    ? ` · ${formatDateTime(rejectedPayment.verified_at)}`
                    : ""}
                  {rejectedPayment.rejection_reason
                    ? ` · เหตุผล: ${rejectedPayment.rejection_reason}`
                    : ""}
                </p>
              )}
            </dd>
          </div>
          <div>
            <dt>ยอดชำระ</dt>
            <dd>{formatBaht(booking.total_amount)}</dd>
          </div>
          {booking.note && (
            <div>
              <dt>หมายเหตุ</dt>
              <dd>{booking.note}</dd>
            </div>
          )}
          {booking.checked_in_at && (
            <div>
              <dt>เช็คอิน</dt>
              <dd>
                {formatDateTime(booking.checked_in_at)} · โดย{" "}
                {describePerson(booking.checked_in_by_profile)}
              </dd>
            </div>
          )}
          {booking.checked_out_at && (
            <div>
              <dt>เช็คเอาต์</dt>
              <dd>
                {formatDateTime(booking.checked_out_at)} · โดย{" "}
                {describePerson(booking.checked_out_by_profile)}
              </dd>
            </div>
          )}
          {booking.status === "cancelled" && booking.cancelled_at && (
            <div>
              <dt>ยกเลิกโดย</dt>
              <dd>
                {describePerson(booking.cancelled_by_profile)} ·{" "}
                {formatDateTime(booking.cancelled_at)}
                {booking.cancel_reason && (
                  <p className="dash-field__hint">เหตุผล: {booking.cancel_reason}</p>
                )}
              </dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}

export default function AdminBookings() {
  const [activeFilter, setActiveFilter] = useState("");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);
  const [actionError, setActionError] = useState("");

  const { bookings, hasMore, loading, error } = useAdminBookings({
    status: activeFilter || undefined,
    page,
    reloadKey,
  });

  function selectFilter(key) {
    setActiveFilter(key);
    setPage(1);
  }

  async function handleCancel(booking) {
    // เหตุผลไม่บังคับ แต่กด "ยกเลิก" บน prompt = ไม่ทำอะไรต่อ (คนละความหมาย
    // กับกด OK ทั้งที่ช่องว่าง) — เหมือน handleReject ใน AdminPayments.jsx
    const reason = window.prompt(
      `เหตุผลที่ยกเลิกการจอง ${booking.booking_code} (ไม่บังคับ)`,
      "",
    );
    if (reason === null) return;

    setActionError("");
    setCancellingId(booking.id);

    try {
      await cancelBooking(booking.id, reason);
      setReloadKey((key) => key + 1);
    } catch (err) {
      console.error("cancel_booking failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <DashboardLayout
      variant="admin"
      title="การจองทั้งหมด"
      subtitle="ตรวจสอบและยกเลิกการจองของลูกค้า"
      headerExtra={<SearchBox />}
    >
      <div className="dash-filters">
        {FILTERS.map((filter) => (
          <Pill
            key={filter.key}
            active={filter.key === activeFilter}
            onClick={() => selectFilter(filter.key)}
          >
            {filter.label}
          </Pill>
        ))}
      </div>

      {actionError && <div className="dash-message dash-message--error">{actionError}</div>}

      <div className="dash-card dash-table-card">
        {loading && <p className="dash-empty">กำลังโหลดข้อมูล...</p>}

        {!loading && error && <div className="dash-message dash-message--error">{error}</div>}

        {!loading && !error && bookings.length === 0 && (
          <p className="dash-empty">ไม่พบรายการจอง</p>
        )}

        {!loading && !error && bookings.length > 0 && (
          <>
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>รหัส</th>
                    <th>ประเภท</th>
                    <th>สนาม</th>
                    <th>เวลา</th>
                    <th>ผู้จอง</th>
                    <th>สถานะ</th>
                    <th>ยอด</th>
                    <th aria-hidden="true"></th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((booking) => {
                    const status = describeStatus(booking);
                    const rejectedPayment =
                      booking.payment_status === "rejected"
                        ? latestRejectedPayment(booking)
                        : null;

                    return (
                      <tr key={booking.id}>
                        <td>{booking.booking_code}</td>
                        <td>{describeSport(booking)}</td>
                        <td>{describeFacility(booking)}</td>
                        <td>{formatTimeRange(booking.start_time, booking.end_time)}</td>
                        <td>
                          {describePerson(booking.profiles)}
                          {booking.is_walk_in && (
                            <p className="dash-field__hint">Walk-in</p>
                          )}
                        </td>
                        <td>
                          <Badge tone={status.tone}>{status.label}</Badge>
                          {booking.status === "cancelled" &&
                            (booking.cancelled_by_profile || booking.cancel_reason) && (
                              <p className="dash-field__hint">
                                {booking.cancelled_by_profile &&
                                  `โดย ${describePerson(booking.cancelled_by_profile)}`}
                                {booking.cancel_reason ? ` · ${booking.cancel_reason}` : ""}
                              </p>
                            )}
                          {rejectedPayment && (
                            <p className="dash-field__hint">
                              ปฏิเสธชำระเงินโดย {describePerson(rejectedPayment.rejected_by_profile)}
                              {rejectedPayment.rejection_reason
                                ? ` · ${rejectedPayment.rejection_reason}`
                                : ""}
                            </p>
                          )}
                        </td>
                        <td>{formatBaht(booking.total_amount)}</td>
                        <td>
                          <div className="dash-actions">
                            <button
                              type="button"
                              className="dash-btn"
                              onClick={() => setSelected(booking)}
                            >
                              ดู
                            </button>
                            {canCancel(booking) && (
                              <button
                                type="button"
                                className="dash-btn dash-btn--cancel"
                                disabled={cancellingId === booking.id}
                                onClick={() => handleCancel(booking)}
                              >
                                {cancellingId === booking.id ? "กำลังยกเลิก..." : "ยกเลิก"}
                              </button>
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

      {selected && <BookingDetailModal booking={selected} onClose={() => setSelected(null)} />}
    </DashboardLayout>
  );
}
