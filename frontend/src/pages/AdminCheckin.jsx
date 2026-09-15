// หน้าเคาน์เตอร์รับลูกค้าประจำวัน — เช็คอิน/เช็คเอาต์ พิมพ์ใบเสร็จ และตัดคูปอง
import { useEffect, useMemo, useRef, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import { Badge, Pill, StatCard } from "../components/DashboardWidgets";
import CouponRedeemBox from "../components/CouponRedeemBox";
import ReceiptPrintDialog from "../components/ReceiptPrintDialog";
import { useAdminCheckins } from "../hooks/useAdmin";
import { describePayment, toHhMm } from "../lib/bookings";
import { loadPrintSettings } from "../lib/receiptPrint";
import {
  checkinBooking,
  checkoutBooking,
  describeCheckin,
  formatCheckinTime,
  isLate,
  resetCheckin,
} from "../lib/checkin";
import { errorMessage } from "../lib/errors";
import { playFeedbackTone } from "../lib/feedback";
import "./AdminCheckin.css";

// รหัสที่ใช้เช็คอินคือ booking_code ตัวเดียวกับที่ใบเสร็จของลูกค้า
// (BookingReceipt.jsx) โชว์เป็น QR
// ให้ลูกค้า เครื่องสแกน QR แบบฮาร์ดแวร์ (USB/บลูทูธ) ทำงานเป็น keyboard
// wedge — พิมพ์ค่าที่สแกนได้ตามด้วย Enter ใส่ input ที่ focus อยู่ตรง ๆ
// ไม่มี stream กล้องอะไรให้ต่อ จึงโฟกัสช่องค้นหาไว้ตลอดแทน
//
// เคาน์เตอร์นี้เป็นที่เดียวที่พิมพ์ใบเสร็จออกกระดาษได้ — หน้าใบเสร็จฝั่งลูกค้า
// (BookingReceipt.jsx) ให้บันทึกเป็นไฟล์อย่างเดียว สั่งพิมพ์เองไม่ได้แล้ว
// ตัวพิมพ์อยู่ที่ lib/receiptPrint.js + ReceiptPrintDialog.jsx
//
// ใบที่พิมพ์ไม่มี QR — ใบกระดาษเป็นหลักฐานการจ่ายเงินอย่างเดียว ส่วนการสแกน
// ยังใช้ QR บนใบเสร็จในแอปของลูกค้าเหมือนเดิม

const FILTERS = [
  { key: "all", label: "ทั้งหมด" },
  { key: "waiting", label: "ยังไม่มา" },
  { key: "late", label: "เลยเวลา" },
];

// รีเฟรชรายการเองทุก 30 วิ — หน้านี้เปิดค้างไว้ทั้งวันที่เคาน์เตอร์ ถ้าไม่
// auto-refresh การจองใหม่หรือการเช็คอินจากเครื่องอื่นจะไม่ขึ้นจนกว่าจะกด
// รีเฟรชเอง
const AUTO_REFRESH_MS = 30000;

// รหัสเดียวใช้ทั้งเช็คอินและเช็คเอาต์ — ถ้าสแกนซ้ำติด ๆ กันตอนเช็คอิน
// (มือลั่น/เครื่องยิงสองที) การสแกนครั้งที่สองจะกลายเป็นเช็คเอาต์ทันที
// ทั้งที่ลูกค้าเพิ่งเข้าสนาม กันด้วยการไม่เช็คเอาต์อัตโนมัติในช่วงนี้ —
// ถ้าจะเช็คเอาต์จริงก็ยังกดปุ่มเองได้
const SCAN_CHECKOUT_GRACE_MINUTES = 3;

// ข้อมูลสมมติสำหรับ "ตั้งค่า/ทดสอบการพิมพ์" — แอดมินจูนกระดาษกับเครื่องพิมพ์
// ได้ตอนไหนก็ได้ ไม่ต้องรอให้มีลูกค้าจริงมาเช็คอินก่อน ตัวเลขเลือกให้มีครบทุก
// บรรทัดที่ใบเสร็จจะโชว์ได้ (มีทั้งส่วนลดและมัดจำ) จะได้เห็นใบที่ยาวที่สุด
function sampleEntry() {
  return {
    id: "sample",
    bookingCode: "SPB-00000000-0000",
    customerName: "ตัวอย่าง ลูกค้าใจดี",
    customerPhone: "080-000-0000",
    sportName: "แบดมินตัน",
    facilityName: "คอร์ต 1",
    venueName: "สนามกีฬาตัวอย่าง",
    startTime: "18:00",
    endTime: "20:00",
    paymentStatus: "paid",
    checkedInAt: new Date().toISOString(),
    checkedOutAt: null,
    totalAmount: 600,
    originalAmount: 700,
    discountAmount: 100,
    depositAmount: 200,
    pricePerHour: 350,
    paymentMethod: "qr",
    paidAt: new Date().toISOString(),
  };
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
  // { entry, isSample } ของใบที่กำลังจะพิมพ์ — null คือไม่มีกล่องพิมพ์เปิดอยู่
  const [printTarget, setPrintTarget] = useState(null);

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
    // เบอร์ — ลงมือให้ทันทีโดยไม่ต้องกดยืนยันซ้ำอีกที ทั้งสอง RPC เป็น
    // idempotent อยู่แล้ว เรียกซ้ำกับรายการที่ทำไปแล้วก็ปลอดภัย
    const exactCodeMatch = entries.find((entry) => entry.bookingCode.toLowerCase() === q);
    if (exactCodeMatch) {
      setSearchHint("");
      handleScannedCode(exactCodeMatch);
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

  // สแกนใบเสร็จในแอปของลูกค้าใบเดิมได้ทั้งตอนเข้าและตอนออก — แอดมินไม่ต้อง
  // เลือกโหมด ระบบดูสถานะปัจจุบันเอง
  function handleScannedCode(entry) {
    setSelectedId(entry.id);
    // เคลียร์ช่องทันทีที่จับคู่รหัสได้ — เครื่องสแกนพิมพ์ต่อท้ายค่าที่ค้างอยู่
    // การสแกนใบถัดไปจะกลายเป็นรหัสสองใบต่อกันถ้าไม่ล้างก่อน
    setQuery("");

    if (entry.checkedOutAt) {
      setSearchHint(
        `${entry.customerName} เช็คเอาต์ไปแล้วเมื่อ ${formatCheckinTime(entry.checkedOutAt)} น.`,
      );
      searchRef.current?.focus();
      return;
    }

    if (entry.checkedInAt) {
      // now เป็น state ที่ขยับทุก 30 วิ (ตัวเดียวกับที่ใช้ตัดสินป้าย "เลยเวลา")
      // คลาดจากเวลาจริงได้ไม่เกินครึ่งนาที ซึ่งไม่สำคัญกับรั้วกันสแกนซ้ำหน่วยนาที
      const minutesInVenue = (now - new Date(entry.checkedInAt)) / 60000;

      if (minutesInVenue < SCAN_CHECKOUT_GRACE_MINUTES) {
        setSearchHint(
          `${entry.customerName} เพิ่งเช็คอินไปเมื่อสักครู่ — ถ้าต้องการเช็คเอาต์จริง กดปุ่ม "เช็คเอาต์" ในกล่องด้านขวา`,
        );
        searchRef.current?.focus();
        return;
      }

      handleCheckout(entry);
      return;
    }

    performCheckin(entry);
  }

  async function performCheckin(entry) {
    setActionError("");
    setActionMessage("");
    setBusyId(entry.id);

    try {
      const booking = await checkinBooking(entry.bookingCode);
      playFeedbackTone(true);
      setActionMessage(`เช็คอิน ${entry.customerName} แล้ว`);
      setReloadKey((k) => k + 1);
      setSelectedId(entry.id);
      setQuery("");

      // เปิดกล่องพิมพ์ให้เลยถ้าเคาน์เตอร์ตั้งไว้ว่าพิมพ์ทุกใบ — entry ในมือ
      // ตอนนี้ยังเป็นข้อมูลก่อนเช็คอิน (รายการใหม่กว่าจะโหลดเสร็จก็หลังจากนี้)
      // ถ้าส่งไปตรง ๆ ใบที่พิมพ์จะบอกว่า "ยังไม่เช็คอิน" ทั้งที่เพิ่งเช็คอินไป
      // จึงเติมเวลาที่ได้กลับมาจาก RPC ทับให้ก่อน
      if (loadPrintSettings().autoPrint) {
        openPrint({ ...entry, checkedInAt: booking?.checked_in_at ?? new Date().toISOString() });
      }
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
      // คืนโฟกัสให้ช่องสแกนเสมอ เผื่อคิวถัดไปยิงบัตรเข้ามาต่อทันที
      searchRef.current?.focus();
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

  function openPrint(entry) {
    setPrintTarget({ entry, isSample: false });
  }

  function closePrint() {
    setPrintTarget(null);
    // เครื่องสแกนยิงค่าเข้า input ที่โฟกัสอยู่เท่านั้น — ปิดกล่องพิมพ์แล้วต้อง
    // คืนโฟกัสให้ช่องค้นหา ไม่งั้นคิวถัดไปสแกนแล้วไม่มีอะไรเกิดขึ้น
    searchRef.current?.focus();
  }

  return (
    <DashboardLayout
      variant="admin"
      title="เช็คอินลูกค้า"
      subtitle="สแกน QR หรือค้นหาด้วยชื่อ/เบอร์โทร เพื่อเช็คอินลูกค้าที่มาถึงสนาม"
      headerExtra={
        <div className="admin-checkin__header-actions">
          <Pill onClick={() => setPrintTarget({ entry: sampleEntry(), isSample: true })}>
            🖨 ตั้งค่าการพิมพ์
          </Pill>
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
                    {entry.checkedInAt && (
                      <Pill onClick={() => openPrint(entry)}>🖨 ใบเสร็จ</Pill>
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
          <CouponRedeemBox />

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
                    {/* ถ้อยคำระดับการจอง เหมือนที่ลูกค้าเห็นในแอปและที่พิมพ์ลง
                        ใบเสร็จ — describePaymentStatus() เป็นมุมของแถว payments
                        ที่อ่าน 'paid' ว่า "รอตรวจสอบ" ทั้งที่เงินเข้าแล้ว */}
                    <dd>{describePayment({ payment_status: selectedEntry.paymentStatus })}</dd>
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
                {/* พิมพ์ได้ตลอด ไม่ผูกกับสถานะเช็คอิน — ลูกค้าขอใบเสร็จตอนไหนก็ได้
                    (ทำหายตั้งแต่ยังไม่เข้าสนาม, ขอเพิ่มตอนกำลังจะกลับ) สถานะที่
                    พิมพ์ลงใบเป็นสถานะจริงตอนกดพิมพ์อยู่แล้ว */}
                <button
                  type="button"
                  className="admin-checkin__confirm-print"
                  onClick={() => openPrint(selectedEntry)}
                >
                  🖨 พิมพ์ใบเสร็จ
                </button>
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

      {printTarget && (
        <ReceiptPrintDialog
          entry={printTarget.entry}
          isSample={printTarget.isSample}
          onClose={closePrint}
        />
      )}
    </DashboardLayout>
  );
}
