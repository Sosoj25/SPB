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
import { errorMessage } from "../lib/errors";

const FILTERS = [
  { key: "", label: "ทั้งหมด" },
  { key: "pending", label: "รอชำระเงิน" },
  { key: "confirmed", label: "จองแล้ว" },
  { key: "completed", label: "สำเร็จ" },
  { key: "cancelled", label: "ยกเลิก" },
];

function BookingDetailModal({ booking, onClose }) {
  const status = describeStatus(booking);

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
            <dd>{booking.profiles?.full_name || booking.profiles?.username || "—"}</dd>
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
            <dd>{describePayment(booking)}</dd>
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

  async function handleCancel(bookingId) {
    setActionError("");
    setCancellingId(bookingId);

    try {
      await cancelBooking(bookingId);
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
      title="จัดการการจอง"
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

                    return (
                      <tr key={booking.id}>
                        <td>{booking.booking_code}</td>
                        <td>{describeSport(booking)}</td>
                        <td>{describeFacility(booking)}</td>
                        <td>{formatTimeRange(booking.start_time, booking.end_time)}</td>
                        <td>{booking.profiles?.full_name || booking.profiles?.username || "—"}</td>
                        <td>
                          <Badge tone={status.tone}>{status.label}</Badge>
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
                                onClick={() => handleCancel(booking.id)}
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
