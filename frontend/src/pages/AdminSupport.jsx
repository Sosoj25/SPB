// หน้าตอบเรื่องที่ลูกค้าติดต่อเข้ามา — คิวด้านซ้าย เธรดสนทนาด้านขวา
import { useEffect, useRef, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import { Badge, Pagination, Pill, SearchBox } from "../components/DashboardWidgets";
import {
  useAdminSupportStats,
  useAdminSupportTickets,
  useSupportContactSettings,
} from "../hooks/useSupport";
import {
  ADMIN_SUPPORT_PAGE_SIZE,
  SUPPORT_FILTERS,
  adminReplySupportTicket,
  adminSetSupportTicketStatus,
  describeSupportStatus,
  formatRelativeTime,
  formatSupportTime,
  updateSupportContactSettings,
} from "../lib/support";
import { formatBookingDate, formatTimeRange } from "../lib/bookings";
import { errorMessage } from "../lib/errors";
import "./AdminSupport.css";

function displayName(ticket) {
  return ticket.full_name || ticket.profile?.full_name || ticket.profile?.username || "ผู้ใช้งาน";
}

function Avatar({ ticket, size = "md" }) {
  const url = ticket.profile?.avatar_url;
  const name = displayName(ticket);

  if (url) {
    return <img src={url} alt="" className={`admin-support__avatar admin-support__avatar--${size}`} />;
  }

  return (
    <span className={`admin-support__avatar admin-support__avatar--${size}`} aria-hidden="true">
      {name.charAt(0)}
    </span>
  );
}

// แผงขวา — เธรดของเรื่องที่เลือกอยู่ พร้อมช่องตอบกลับและปุ่มปิดงาน
// key ของ component นี้ถูกผูกกับ ticket.id ที่ตัวเรียก เพื่อให้ร่างคำตอบที่
// พิมพ์ค้างไว้ถูกล้างเมื่อสลับไปเรื่องอื่น — ไม่งั้นข้อความที่ตั้งใจตอบคนหนึ่ง
// จะติดไปอยู่ในช่องตอบของอีกคนโดยไม่รู้ตัว
function ReplyPanel({ ticket, onChanged }) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const threadEndRef = useRef(null);

  const status = describeSupportStatus(ticket.status);
  const closed = ticket.status === "closed";
  const replyCount = ticket.replies.length;

  // เธรดยาว ๆ เลื่อนอยู่ในแผงตัวเอง ข้อความใหม่ที่เข้ามาทาง Realtime จึงไปโผล่
  // ใต้ขอบล่างที่มองไม่เห็น — เลื่อนตามให้เองทุกครั้งที่จำนวนข้อความเปลี่ยน
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [replyCount]);

  async function handleReply(event) {
    event.preventDefault();
    setError("");
    setSending(true);

    try {
      await adminReplySupportTicket(ticket.id, body.trim());
      setBody("");
      onChanged();
    } catch (err) {
      console.error("adminReplySupportTicket failed:", err);
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  async function handleStatus(next) {
    setError("");
    setUpdating(true);

    try {
      await adminSetSupportTicketStatus(ticket.id, next);
      onChanged();
    } catch (err) {
      console.error("adminSetSupportTicketStatus failed:", err);
      setError(errorMessage(err));
    } finally {
      setUpdating(false);
    }
  }

  return (
    <aside className="admin-support__panel">
      <header className="admin-support__panel-head">
        <Avatar ticket={ticket} size="lg" />
        <div className="admin-support__panel-who">
          <p className="admin-support__panel-name">{displayName(ticket)}</p>
          <p className="admin-support__panel-contact">
            {ticket.email}
            {ticket.phone ? ` · ${ticket.phone}` : ""}
          </p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </header>

      <div className="admin-support__panel-body">
        <div className="admin-support__panel-meta">
          <Badge tone="tint">{ticket.category}</Badge>
          <span className="admin-support__muted">{formatRelativeTime(ticket.created_at)}</span>
        </div>

        <div className="admin-support__thread">
          <div className="admin-support__msg admin-support__msg--customer">
            <p className="admin-support__msg-text">{ticket.message}</p>
            <p className="admin-support__msg-meta">
              {displayName(ticket)} · {formatSupportTime(ticket.created_at)}
            </p>
          </div>

          {ticket.replies.map((reply) => (
            <div
              key={reply.id}
              className={`admin-support__msg ${
                reply.is_staff ? "admin-support__msg--staff" : "admin-support__msg--customer"
              }`}
            >
              <p className="admin-support__msg-text">{reply.body}</p>
              <p className="admin-support__msg-meta">
                {reply.is_staff ? "ทีมงาน" : displayName(ticket)} ·{" "}
                {formatSupportTime(reply.created_at)}
              </p>
            </div>
          ))}
          <div ref={threadEndRef} />
        </div>

        {ticket.booking && (
          <div className="admin-support__booking">
            <span className="admin-support__muted">การจองที่เกี่ยวข้อง:</span>
            <a
              className="dash-btn"
              href={`/admin/bookings?q=${ticket.booking.booking_code}`}
              target="_blank"
              rel="noreferrer"
            >
              {ticket.booking.booking_code}
            </a>
            <span className="admin-support__muted">
              {formatBookingDate(ticket.booking.booking_date)}{" "}
              {formatTimeRange(ticket.booking.start_time, ticket.booking.end_time)}
            </span>
          </div>
        )}

        <hr className="admin-support__divider" />

        {closed ? (
          <>
            <p className="admin-support__closed">
              เรื่องนี้ปิดแล้วเมื่อ {formatSupportTime(ticket.closed_at)} — ลูกค้าตอบกลับในเธรดนี้
              ไม่ได้อีก หากยังต้องคุยต่อให้เปิดเรื่องใหม่ก่อน
            </p>
            <button
              type="button"
              className="dash-btn"
              disabled={updating}
              onClick={() => handleStatus("pending")}
            >
              {updating ? "กำลังบันทึก..." : "เปิดเรื่องนี้อีกครั้ง"}
            </button>
          </>
        ) : (
          <form className="admin-support__reply" onSubmit={handleReply}>
            <p className="dash-field__label">ตอบกลับลูกค้า</p>
            <textarea
              aria-label="ข้อความตอบกลับ"
              className="dash-textarea"
              rows={4}
              value={body}
              placeholder="พิมพ์ข้อความตอบกลับ..."
              onChange={(e) => setBody(e.target.value)}
            />
            <button
              type="submit"
              className="admin-support__send"
              disabled={sending || !body.trim()}
            >
              {sending ? "กำลังส่ง..." : "ส่งคำตอบ"}
            </button>
            <button
              type="button"
              className="dash-btn admin-support__resolve"
              disabled={updating}
              onClick={() => handleStatus("closed")}
            >
              {updating ? "กำลังบันทึก..." : "ทำเครื่องหมายว่าแก้ไขแล้ว"}
            </button>
          </form>
        )}

        {error && <div className="dash-message dash-message--error">{error}</div>}
      </div>
    </aside>
  );
}

// ช่องกรอกของกล่องแก้ไขข้อมูลติดต่อ — เรียงตามที่ลูกค้าเห็นบนหน้าติดต่อเรา
// (สามช่องทางด่วน แล้วค่อยที่ตั้งสำนักงาน) จะได้เทียบกับหน้าจริงได้ทีละบรรทัด
const CONTACT_FIELDS = [
  { key: "phone", label: "เบอร์โทรศัพท์", placeholder: "099-191-5489" },
  { key: "phoneHint", label: "เวลาให้บริการทางโทรศัพท์", placeholder: "09:00 – 21:00 น. ทุกวัน" },
  { key: "email", label: "อีเมล", placeholder: "support@sportsbooking.co.th" },
  { key: "emailHint", label: "คำอธิบายใต้อีเมล", placeholder: "ตอบกลับภายใน 24 ชม." },
  { key: "lineId", label: "LINE Official ID", placeholder: "@sportsbooking" },
  { key: "lineHint", label: "คำอธิบายใต้ LINE", placeholder: "แชทสดในเวลาทำการ" },
  {
    key: "lineUrl",
    label: "ลิงก์เปิดแชท LINE",
    placeholder: "https://line.me/R/ti/p/@sportsbooking",
    hint: "เว้นว่างได้ ระบบจะสร้างลิงก์จากไอดีให้เอง",
  },
  { key: "officeAddress", label: "ที่ตั้งสำนักงาน", placeholder: "ที่อยู่ที่ลูกค้าเดินทางไปได้จริง", area: true },
  {
    key: "mapUrl",
    label: "ลิงก์แผนที่",
    placeholder: "https://maps.app.goo.gl/...",
    hint: "เว้นว่างได้ ระบบจะค้น Google Maps จากที่อยู่ด้านบนแทน",
  },
];

// กล่องแก้ไขข้อมูลติดต่อที่แสดงบนหน้า /contact ของลูกค้า (0098) — อยู่ในหน้านี้
// เพราะเป็นหน้าเดียวกับที่แอดมินมาอ่านเรื่องที่ลูกค้าส่งเข้ามา ไม่ต้องไปตามหา
// ในหน้าตั้งค่าอื่นที่ไม่เกี่ยวกัน
//
// ช่องไหนเว้นว่าง การ์ดช่องทางนั้นจะหายไปจากหน้าลูกค้าทั้งอัน (buildContactChannels)
function ContactSettingsDialog({ settings, onClose, onSaved }) {
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSaving(true);

    try {
      await updateSupportContactSettings(form);
      onSaved();
    } catch (err) {
      console.error("updateSupportContactSettings failed:", err);
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dash-modal-overlay" role="dialog" aria-modal="true">
      <div className="dash-modal">
        <div className="dash-modal__header">
          <h2>ข้อมูลติดต่อบนหน้าติดต่อเรา</h2>
          <button type="button" className="dash-modal__close" aria-label="ปิด" onClick={onClose}>
            ✕
          </button>
        </div>

        <form className="admin-support__settings" onSubmit={handleSubmit}>
          {CONTACT_FIELDS.map((field) => (
            <label className="dash-field" key={field.key}>
              <span className="dash-field__label">{field.label}</span>
              {field.area ? (
                <textarea
                  className="dash-textarea"
                  rows={3}
                  value={form[field.key]}
                  placeholder={field.placeholder}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                />
              ) : (
                <input
                  className="dash-input"
                  type="text"
                  value={form[field.key]}
                  placeholder={field.placeholder}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                />
              )}
              {field.hint && <span className="dash-field__hint">{field.hint}</span>}
            </label>
          ))}

          {error && <div className="dash-message dash-message--error">{error}</div>}

          <div className="admin-support__settings-actions">
            <button type="button" className="dash-btn" onClick={onClose}>
              ยกเลิก
            </button>
            <button type="submit" className="dash-btn dash-btn--add" disabled={saving}>
              {saving ? "กำลังบันทึก..." : "บันทึกข้อมูลติดต่อ"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AdminSupport() {
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsKey, setSettingsKey] = useState(0);

  const { settings: contactSettings, loading: settingsLoading } =
    useSupportContactSettings(settingsKey);

  const { tickets, hasMore, loading, error } = useAdminSupportTickets({
    status: status || undefined,
    query: query || undefined,
    page,
    reloadKey,
  });
  const { stats } = useAdminSupportStats(reloadKey);

  // เรื่องที่เลือกอยู่อาจหลุดออกจากหน้า/ฟิลเตอร์ปัจจุบันได้ (เช่น เพิ่งกดปิด
  // แล้วฟิลเตอร์ "ใหม่" ค้างอยู่) — ตกกลับไปที่เรื่องบนสุดของรายการแทนการ
  // ปล่อยแผงขวาว่างเปล่าโดยไม่มีคำอธิบาย
  const selected = tickets.find((ticket) => ticket.id === selectedId) ?? tickets[0] ?? null;

  const refresh = () => setReloadKey((key) => key + 1);

  function selectFilter(key) {
    setStatus(key);
    setPage(1);
  }

  const avgResponse =
    stats.avgResponseHours == null ? "—" : `${stats.avgResponseHours.toFixed(1)} ชม.`;

  return (
    <DashboardLayout
      variant="admin"
      title="ข้อความติดต่อจากลูกค้า"
      subtitle="ตอบกลับคำถามและปัญหาที่ลูกค้าส่งเข้ามาจากหน้าติดต่อเรา"
      headerExtra={
        <div className="dash-actions">
          {/* ปิดปุ่มไว้ระหว่างที่ค่ายังโหลดไม่เสร็จ — เปิดกล่องด้วยฟอร์มเปล่า
              แล้วกดบันทึกจะกลายเป็นการล้างข้อมูลติดต่อทิ้งทั้งหมด */}
          <button
            type="button"
            className="dash-btn"
            disabled={settingsLoading}
            onClick={() => setSettingsOpen(true)}
          >
            ⚙ ข้อมูลติดต่อ
          </button>
          <button type="button" className="dash-btn" onClick={refresh}>
            ↻ รีเฟรชรายการ
          </button>
        </div>
      }
    >
      {settingsOpen && (
        <ContactSettingsDialog
          settings={contactSettings}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => {
            setSettingsKey((key) => key + 1);
            setSettingsOpen(false);
          }}
        />
      )}

      <section className="dash-kpi">
        <div className="stat-card">
          <p className="stat-card__value admin-support__kpi--primary">{stats.new}</p>
          <p className="stat-card__label">ข้อความใหม่</p>
        </div>
        <div className="stat-card">
          <p className="stat-card__value stat-card__value--warning">{stats.pending}</p>
          <p className="stat-card__label">รอดำเนินการ</p>
        </div>
        <div className="stat-card">
          <p className="stat-card__value stat-card__value--success">{stats.repliedToday}</p>
          <p className="stat-card__label">ตอบแล้ววันนี้</p>
        </div>
        <div className="stat-card">
          <p className="stat-card__value">{avgResponse}</p>
          <p className="stat-card__label">เวลาตอบเฉลี่ย (30 วัน)</p>
        </div>
      </section>

      <div className="dash-filters">
        {SUPPORT_FILTERS.map((filter) => (
          <Pill
            key={filter.key || "all"}
            active={status === filter.key}
            onClick={() => selectFilter(filter.key)}
          >
            {filter.label} ({stats[filter.countKey]})
          </Pill>
        ))}
        <div className="dash-filters__spacer" />
        <SearchBox
          placeholder="ค้นหาข้อความ"
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(1);
          }}
        />
      </div>

      <div className="admin-support__layout">
        <div className="dash-card dash-table-card admin-support__list">
          <header className="admin-support__list-head">
            <p className="admin-support__list-title">กล่องข้อความ</p>
            <span className="admin-support__count">{stats.total} ข้อความ</span>
          </header>

          {loading && <p className="dash-empty">กำลังโหลดข้อมูล...</p>}

          {!loading && error && <div className="dash-message dash-message--error">{error}</div>}

          {!loading && !error && tickets.length === 0 && (
            <p className="dash-empty">ไม่มีข้อความในหมวดนี้</p>
          )}

          {!loading &&
            !error &&
            tickets.map((ticket) => {
              const ticketStatus = describeSupportStatus(ticket.status);

              return (
                <button
                  type="button"
                  key={ticket.id}
                  className={`admin-support__row ${
                    selected?.id === ticket.id ? "admin-support__row--active" : ""
                  } ${ticket.status === "new" ? "admin-support__row--new" : ""}`}
                  onClick={() => setSelectedId(ticket.id)}
                >
                  <Avatar ticket={ticket} />
                  <span className="admin-support__row-main">
                    <span className="admin-support__row-top">
                      <span className="admin-support__row-name">{displayName(ticket)}</span>
                      <span className="admin-support__row-time">
                        {formatRelativeTime(ticket.last_reply_at ?? ticket.created_at)}
                      </span>
                    </span>
                    <span className="admin-support__row-category">{ticket.category}</span>
                    <span className="admin-support__row-preview">{ticket.message}</span>
                  </span>
                  <span className="admin-support__row-status">
                    <Badge tone={ticketStatus.tone}>{ticketStatus.label}</Badge>
                  </span>
                </button>
              );
            })}

          {!loading && !error && tickets.length > 0 && (
            <div className="dash-table-footer">
              <p>
                แสดง {tickets.length} รายการ · หน้า {page}
                {stats.total > ADMIN_SUPPORT_PAGE_SIZE && ` จากทั้งหมด ${stats.total} ข้อความ`}
              </p>
              <Pagination page={page} hasMore={hasMore} onChange={setPage} />
            </div>
          )}
        </div>

        {selected ? (
          <ReplyPanel key={selected.id} ticket={selected} onChanged={refresh} />
        ) : (
          <aside className="admin-support__panel admin-support__panel--empty">
            <p className="dash-empty">เลือกข้อความทางซ้ายเพื่ออ่านและตอบกลับ</p>
          </aside>
        )}
      </div>
    </DashboardLayout>
  );
}
