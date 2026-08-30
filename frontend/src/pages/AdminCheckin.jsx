import { useEffect, useMemo, useRef, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import { Badge, Pill, StatCard } from "../components/DashboardWidgets";
import { useAdminCheckins } from "../hooks/useAdmin";
import { toHhMm } from "../lib/bookings";
import {
  checkinBooking,
  checkoutBooking,
  describeCheckin,
  formatCheckinTime,
  isLate,
  resetCheckin,
} from "../lib/checkin";
import { describePaymentStatus } from "../lib/payments";
import { errorMessage } from "../lib/errors";
import "./AdminCheckin.css";

// เช็คอิน/เช็คเอาต์จริงผ่าน Supabase แล้ว (ดู 0038_booking_checkin.sql) —
// รหัสที่ใช้คือ booking_code เดิมที่ใบเสร็จ (BookingReceipt.jsx) โชว์เป็น QR
// ให้ลูกค้า เครื่องสแกน QR แบบฮาร์ดแวร์ (USB/บลูทูธ) ทำงานเป็น keyboard
// wedge — พิมพ์ค่าที่สแกนได้ตามด้วย Enter ใส่ input ที่ focus อยู่ตรง ๆ
// ไม่มี stream กล้องอะไรให้ต่อ จึงโฟกัสช่องค้นหาไว้ตลอดแทน

const FILTERS = [
  { key: "all", label: "ทั้งหมด" },
  { key: "waiting", label: "ยังไม่มา" },
  { key: "late", label: "เลยเวลา" },
];

// รีเฟรชรายการเองทุก 30 วิ — หน้านี้เปิดค้างไว้ทั้งวันที่เคาน์เตอร์ ถ้าไม่
// auto-refresh การจองใหม่หรือการเช็คอินจากเครื่องอื่นจะไม่ขึ้นจนกว่าจะกด
// รีเฟรชเอง
const AUTO_REFRESH_MS = 30000;

function playFeedbackTone(ok) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.2;

    const duration = ok ? 0.12 : 0.28;
    osc.start();
    osc.stop(ctx.currentTime + duration);
    osc.onended = () => ctx.close();
  } catch {
    // เบราว์เซอร์/โหมดที่ไม่รองรับ Web Audio — ไม่ใช่ฟีเจอร์หลัก ปล่อยเงียบไปได้
  }
}

const todayLabelFormatter = new Intl.DateTimeFormat("th-TH", {
  weekday: "long",
  day: "numeric",
  month: "short",
  year: "numeric",
  calendar: "gregory",
});

export default function AdminCheckin() {
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState("");
  const [searchHint, setSearchHint] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [now, setNow] = useState(() => new Date());

  const searchRef = useRef(null);

  const { entries, loading, error } = useAdminCheckins(reloadKey);

  // อัปเดตทุก 30 วิ ให้ป้าย "เลยเวลา" ขยับเองตามเวลาจริงโดยไม่ต้องกดรีเฟรช
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  // ดึงรายการใหม่เองเป็นระยะ — หน้าเช็คอินเปิดค้างไว้หน้าเคาน์เตอร์ทั้งวัน
  useEffect(() => {
    const timer = setInterval(() => setReloadKey((k) => k + 1), AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!actionMessage) return undefined;
    const timer = setTimeout(() => setActionMessage(""), 3000);
    return () => clearTimeout(timer);
  }, [actionMessage]);

  const inVenueCount = entries.filter((e) => e.checkedInAt && !e.checkedOutAt).length;
  const checkedOutCount = entries.filter((e) => e.checkedOutAt).length;
  const lateCount = entries.filter((e) => isLate(e, now)).length;
  const waitingCount = entries.length - inVenueCount - checkedOutCount - lateCount;

  const visibleEntries = useMemo(() => {
    if (filter === "waiting") return entries.filter((e) => !e.checkedInAt);
    if (filter === "late") return entries.filter((e) => isLate(e, now));
    return entries;
  }, [entries, filter, now]);

  const recent = useMemo(
    () =>
      entries
        .filter((e) => e.checkedInAt)
        .sort((a, b) => new Date(b.checkedInAt) - new Date(a.checkedInAt))
        .slice(0, 5),
    [entries],
  );

  const lateEntries = useMemo(
    () => entries.filter((e) => isLate(e, now)),
    [entries, now],
  );

  const selectedEntry = entries.find((e) => e.id === selectedId) ?? null;

  function runSearch() {
    const q = query.trim().toLowerCase();
    if (!q) return;

    // รหัสจองตรงเป๊ะ (มาจากสแกน QR หรือพิมพ์เอง) ไม่กำกวมเหมือนค้นด้วยชื่อ/
    // เบอร์ — เช็คอินให้ทันทีโดยไม่ต้องกดยืนยันซ้ำอีกที RPC เป็น idempotent
    // อยู่แล้วเรียกซ้ำกับรายการที่เช็คอินไปแล้วก็ปลอดภัย
    const exactCodeMatch = entries.find((entry) => entry.bookingCode.toLowerCase() === q);
    if (exactCodeMatch) {
      setSearchHint("");
      performCheckin(exactCodeMatch);
      return;
    }

    const digits = q.replace(/-/g, "");
    const match = entries.find(
      (entry) =>
        entry.customerName?.toLowerCase().includes(q) ||
        entry.customerPhone?.replace(/-/g, "").includes(digits),
    );

    if (match) {
      setSelectedId(match.id);
      setSearchHint("");
    } else {
      setSearchHint(`ไม่พบรายการที่ตรงกับ "${query}" ในรายการวันนี้`);
    }

    searchRef.current?.focus();
  }

  function selectEntry(entry) {
    setSelectedId(entry.id);
    setSearchHint("");
  }

  async function performCheckin(entry) {
    setActionError("");
    setActionMessage("");
    setBusyId(entry.id);

    try {
      await checkinBooking(entry.bookingCode);
      playFeedbackTone(true);
      setActionMessage(`เช็คอิน ${entry.customerName} แล้ว`);
      setReloadKey((k) => k + 1);
      setSelectedId(entry.id);
      setQuery("");
    } catch (err) {
      console.error("admin_checkin_booking failed:", err);
      playFeedbackTone(false);
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
      searchRef.current?.focus();
    }
  }

  async function handleConfirmCheckin() {
    if (!selectedEntry) return;
    await performCheckin(selectedEntry);
  }

  async function handleCheckout(entry) {
    setActionError("");
    setActionMessage("");
    setBusyId(entry.id);

    try {
      await checkoutBooking(entry.id);
      playFeedbackTone(true);
      setActionMessage(`เช็คเอาต์ ${entry.customerName} แล้ว`);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("admin_checkout_booking failed:", err);
      playFeedbackTone(false);
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleReset(entry) {
    if (!window.confirm(`ยกเลิกสถานะเช็คอิน/เช็คเอาต์ของ ${entry.customerName} ใช่ไหม?`)) return;

    setActionError("");
    setActionMessage("");
    setBusyId(entry.id);

    try {
      await resetCheckin(entry.id);
      playFeedbackTone(true);
      setReloadKey((k) => k + 1);
      if (selectedId === entry.id) setSelectedId(null);
    } catch (err) {
      console.error("admin_reset_checkin failed:", err);
      playFeedbackTone(false);
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  function handleRefresh() {
    setActionError("");
    setSearchHint("");
    setReloadKey((k) => k + 1);
    searchRef.current?.focus();
  }

  return (
    <DashboardLayout
      variant="admin"
      title="เช็คอินลูกค้า"
      subtitle="สแกน QR หรือค้นหาด้วยชื่อ/เบอร์โทร เพื่อเช็คอินลูกค้าที่มาถึงสนาม"
      headerExtra={
        <div className="admin-checkin__header-actions">
          <Pill onClick={handleRefresh}>↻ รีเฟรชรายการ</Pill>
        </div>
      }
    >
      {error && <div className="dash-message dash-message--error">{error}</div>}
      {actionError && <div className="dash-message dash-message--error">{actionError}</div>}
      {actionMessage && <div className="dash-message dash-message--success">{actionMessage}</div>}

      <section className="dash-kpi">
        <StatCard label="การจองวันนี้" value={entries.length} />
        <StatCard label="อยู่ในสนามตอนนี้" value={inVenueCount} tone="success" />
        <StatCard label="เช็คเอาต์แล้ว" value={checkedOutCount} />
        <StatCard label="ยังไม่มา" value={waitingCount} tone="warning" />
        <StatCard label="เลยเวลา / ไม่มา" value={lateCount} tone="danger" />
      </section>

      <div className="admin-checkin">
        <div className="admin-checkin__main">
          <section className="dash-card admin-checkin__scanner">
            <div className="admin-checkin__scanner-head">
              <h2>สแกน QR เช็คอิน</h2>
              <Badge tone="success">● พร้อมรับสัญญาณจากเครื่องสแกน</Badge>
            </div>

            <div className="admin-checkin__viewfinder">
              <div className="admin-checkin__viewfinder-frame">
                <span className="admin-checkin__viewfinder-scanline" />
              </div>
              <p>
                สแกนโค้ดบนใบเสร็จของลูกค้าด้วยเครื่องสแกน QR
                <br />
                ระบบจะรับค่าเข้าช่องค้นหาด้านล่างให้อัตโนมัติ
              </p>
            </div>

            <div className="admin-checkin__divider">
              <span />
              <p>หรือค้นหาด้วยตนเอง</p>
              <span />
            </div>

            <div className="admin-checkin__search">
              <label className="admin-checkin__search-field">
                <span aria-hidden="true">⌕</span>
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="ชื่อ, เบอร์โทร หรือรหัสการจอง เช่น SPB-20260830-4821"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runSearch()}
                />
              </label>
              <button type="button" className="admin-checkin__search-btn" onClick={runSearch}>
                ค้นหา
              </button>
            </div>
            {searchHint && <p className="admin-checkin__search-hint">{searchHint}</p>}
          </section>

          <section className="dash-card dash-table-card admin-checkin__list">
            <div className="admin-checkin__list-head">
              <div>
                <h2>การจองวันนี้ — {todayLabelFormatter.format(new Date())}</h2>
                <p>เรียงตามเวลาที่ใกล้ถึงที่สุด</p>
              </div>
              <div className="admin-checkin__list-filters">
                {FILTERS.map((item) => (
                  <Pill
                    key={item.key}
                    active={item.key === filter}
                    onClick={() => setFilter(item.key)}
                  >
                    {item.label}
                  </Pill>
                ))}
              </div>
            </div>

            {loading && <p className="dash-empty">กำลังโหลดข้อมูล...</p>}
            {!loading && visibleEntries.length === 0 && (
              <p className="dash-empty">ไม่มีรายการในหมวดนี้</p>
            )}

            {!loading &&
              visibleEntries.map((entry) => {
                const meta = describeCheckin(entry, now);
                const busy = busyId === entry.id;

                return (
                  <div
                    key={entry.id}
                    className={`admin-checkin__row ${
                      entry.id === selectedId ? "admin-checkin__row--selected" : ""
                    }`}
                  >
                    <span className="admin-checkin__row-time">{toHhMm(entry.startTime)}</span>
                    <span className="admin-checkin__row-avatar" aria-hidden="true">
                      {entry.customerName?.charAt(0) ?? "?"}
                    </span>
                    <div className="admin-checkin__row-info">
                      <p className="admin-checkin__row-name">{entry.customerName}</p>
                      <p className="admin-checkin__row-sub">
                        {entry.sportName} · {entry.facilityName} · {toHhMm(entry.startTime)}–
                        {toHhMm(entry.endTime)}
                      </p>
                    </div>
                    <Badge tone={meta.tone}>{meta.label}</Badge>

                    {!entry.checkedInAt && (
                      <Pill tone="solid" onClick={() => selectEntry(entry)}>
                        เช็คอิน
                      </Pill>
                    )}
                    {entry.checkedInAt && !entry.checkedOutAt && (
                      <>
                        <Pill tone="solid" onClick={() => handleCheckout(entry)} disabled={busy}>
                          {busy ? "..." : "เช็คเอาต์"}
                        </Pill>
                        <Pill tone="ghost" onClick={() => handleReset(entry)} disabled={busy}>
                          ยกเลิก
                        </Pill>
                      </>
                    )}
                    {entry.checkedOutAt && (
                      <Pill tone="ghost" onClick={() => handleReset(entry)} disabled={busy}>
                        ยกเลิก
                      </Pill>
                    )}
                  </div>
                );
              })}

            <div className="dash-table-footer">
              <p>ทั้งหมด {entries.length} รายการวันนี้</p>
              <Pill onClick={() => setFilter("all")}>ดูทั้งหมด</Pill>
            </div>
          </section>
        </div>

        <div className="admin-checkin__side">
          <section className="dash-card admin-checkin__confirm">
            {selectedEntry ? (
              <>
                <div className="admin-checkin__confirm-head">
                  <h2>{selectedEntry.checkedInAt ? "รายละเอียดการจอง" : "ยืนยันเช็คอิน"}</h2>
                  <span className="admin-checkin__confirm-tag">
                    นัดเวลา {toHhMm(selectedEntry.startTime)}
                  </span>
                </div>

                <div className="admin-checkin__confirm-person">
                  <span className="admin-checkin__confirm-avatar" aria-hidden="true">
                    {selectedEntry.customerName?.charAt(0) ?? "?"}
                  </span>
                  <div>
                    <p className="admin-checkin__confirm-name">{selectedEntry.customerName}</p>
                    <p className="admin-checkin__confirm-phone">
                      {selectedEntry.customerPhone || "ไม่มีเบอร์โทรในระบบ"}
                    </p>
                  </div>
                </div>

                <hr className="admin-checkin__confirm-divider" />

                <dl className="admin-checkin__confirm-facts">
                  <div>
                    <dt>กีฬา / สนาม</dt>
                    <dd>
                      {selectedEntry.sportName} · {selectedEntry.facilityName}
                    </dd>
                  </div>
                  <div>
                    <dt>เวลา</dt>
                    <dd>
                      {toHhMm(selectedEntry.startTime)} – {toHhMm(selectedEntry.endTime)} น.
                    </dd>
                  </div>
                  <div>
                    <dt>รหัสการจอง</dt>
                    <dd>{selectedEntry.bookingCode}</dd>
                  </div>
                  <div>
                    <dt>สถานะชำระเงิน</dt>
                    <dd>{describePaymentStatus(selectedEntry.paymentStatus).label}</dd>
                  </div>
                  {selectedEntry.checkedInAt && (
                    <div>
                      <dt>เช็คอินเมื่อ</dt>
                      <dd>{formatCheckinTime(selectedEntry.checkedInAt)}</dd>
                    </div>
                  )}
                  {selectedEntry.checkedOutAt && (
                    <div>
                      <dt>เช็คเอาต์เมื่อ</dt>
                      <dd>{formatCheckinTime(selectedEntry.checkedOutAt)}</dd>
                    </div>
                  )}
                </dl>

                {!selectedEntry.checkedInAt && (
                  <button
                    type="button"
                    className="admin-checkin__confirm-btn"
                    disabled={busyId === selectedEntry.id}
                    onClick={handleConfirmCheckin}
                  >
                    {busyId === selectedEntry.id ? "กำลังเช็คอิน..." : "✓ ยืนยันเช็คอิน"}
                  </button>
                )}
                {selectedEntry.checkedInAt && !selectedEntry.checkedOutAt && (
                  <button
                    type="button"
                    className="admin-checkin__confirm-btn"
                    disabled={busyId === selectedEntry.id}
                    onClick={() => handleCheckout(selectedEntry)}
                  >
                    {busyId === selectedEntry.id ? "กำลังบันทึก..." : "เช็คเอาต์"}
                  </button>
                )}
                <button
                  type="button"
                  className="admin-checkin__confirm-cancel"
                  onClick={() => setSelectedId(null)}
                >
                  ไม่ใช่รายการนี้ / ค้นหาใหม่
                </button>
              </>
            ) : (
              <p className="dash-empty">สแกน QR หรือเลือกรายการจากลิสต์เพื่อเช็คอิน</p>
            )}
          </section>

          <section className="dash-card admin-checkin__recent">
            <h2>เช็คอินล่าสุด</h2>
            {recent.length === 0 && <p className="dash-empty">ยังไม่มีใครเช็คอินวันนี้</p>}
            {recent.map((entry) => (
              <div key={entry.id} className="admin-checkin__recent-row">
                <span>{formatCheckinTime(entry.checkedInAt)}</span>
                <div>
                  <p className="admin-checkin__recent-name">{entry.customerName}</p>
                  <p className="admin-checkin__recent-detail">
                    {entry.sportName} · {entry.facilityName}
                  </p>
                </div>
                <Badge tone="success">✓</Badge>
              </div>
            ))}
          </section>

          {lateEntries.length > 0 && (
            <section className="admin-checkin__alert">
              <p className="admin-checkin__alert-title">⚠ เลยเวลานัด {lateEntries.length} รายการ</p>
              <p className="admin-checkin__alert-body">
                {lateEntries[0].customerName} ({lateEntries[0].sportName}{" "}
                {toHhMm(lateEntries[0].startTime)})
                {lateEntries.length > 1 ? ` และอีก ${lateEntries.length - 1} รายการ` : ""} ยังไม่เช็คอิน
                เกินเวลานัดไปแล้ว
              </p>
              <button
                type="button"
                className="admin-checkin__alert-btn"
                onClick={() => setFilter("late")}
              >
                ดูรายการที่เลยเวลา
              </button>
            </section>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
