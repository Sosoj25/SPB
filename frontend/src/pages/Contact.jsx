// หน้าติดต่อเรา — ช่องทางติดต่อ คำถามที่พบบ่อย และเธรดส่งเรื่องถึงเจ้าหน้าที่
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import { useAuth } from "../context/useAuth";
import { useUserBookings } from "../hooks/useBookings";
import { useRefundPolicy } from "../hooks/useRefundPolicy";
import {
  useMySupportTickets,
  useSupportContactSettings,
  useUnreadSupportReplies,
} from "../hooks/useSupport";
import {
  SUPPORT_CATEGORIES,
  buildContactChannels,
  buildMapUrl,
  describeSupportStatus,
  formatRelativeTime,
  formatSupportTime,
  markSupportTicketNotificationsRead,
  replySupportTicket,
  submitSupportTicket,
} from "../lib/support";
import { describeFacility, formatBookingDate, formatTimeRange } from "../lib/bookings";
import { errorMessage } from "../lib/errors";
import "./Contact.css";

// ช่องทางติดต่อด่วนกับที่ตั้งสำนักงานอ่านจากตาราง support_contact_settings
// (0098) แอดมินแก้เองได้ที่หน้า /admin/support — ห้ามฮาร์ดโค้ดเบอร์/ที่อยู่
// ไว้ตรงนี้ ไม่งั้นวันที่สนามเปลี่ยนเบอร์ต้องรอ deploy ใหม่ลูกค้าถึงจะโทรติด

// คำถามที่พบบ่อย — คำตอบข้อแรกประกอบจากนโยบายคืนเงินจริงในฐานข้อมูล
// (refund_policy_settings, 0033) ไม่ใช่ตัวเลขฮาร์ดโค้ด เพราะถ้าแอดมินแก้
// นโยบายแล้วหน้านี้ยังตอบเลขเก่า ลูกค้าจะยกมาอ้างตอนขอคืนเงินได้
function buildFaq(policy) {
  const refundAnswer = policy
    ? `ยกเลิกได้ตลอดก่อนถึงเวลาเล่น ส่วนการคืนเงินขึ้นกับระยะเวลาที่เหลือ: ยกเลิกก่อนเวลาเล่นเกิน ${policy.fullRefundHours} ชม. คืนเต็มจำนวน, ก่อน ${policy.partialRefundHours}–${policy.fullRefundHours} ชม. คืน ${policy.partialRefundPercent}% และน้อยกว่า ${policy.partialRefundHours} ชม. ไม่คืนเงิน — กดยกเลิกได้เองที่หน้าใบเสร็จของการจองนั้น`
    : "ยกเลิกได้ตลอดก่อนถึงเวลาเล่น ส่วนยอดเงินที่ได้คืนขึ้นกับระยะเวลาที่เหลือก่อนเวลาเล่น ดูเงื่อนไขล่าสุดได้ที่หน้าใบเสร็จของการจอง";

  return [
    { q: "ยกเลิกการจองได้เมื่อไหร่?", a: refundAnswer },
    {
      q: "แต้มสะสมหมดอายุไหม?",
      a: "แต้มสะสมไม่มีวันหมดอายุ ใช้แลกของรางวัลได้ตลอดที่เมนู “แลกรางวัล” ถ้าเห็นแต้มหายไปโดยไม่ได้แลกอะไร ให้ส่งเรื่องมาทางฟอร์มนี้พร้อมวันที่ที่สังเกตเห็น ทีมงานจะตรวจประวัติแต้มให้",
    },
    {
      q: "ชำระเงินผ่านช่องทางไหนได้บ้าง?",
      a: "ชำระผ่านพร้อมเพย์ QR (ตัดยอดอัตโนมัติ) หรือโอนเข้าบัญชีธนาคารแล้วแนบสลิปให้เจ้าหน้าที่ตรวจสอบ ทั้งสองแบบเลือกได้ในขั้นตอนชำระเงิน โดยต้องชำระให้ทันเวลาที่ระบบกันสิทธิ์ไว้ ไม่งั้นการจองจะถูกปล่อยคืนอัตโนมัติ",
    },
  ];
}

// ชื่อ/เบอร์/อีเมลตั้งต้นเป็น null แปลว่า "ผู้ใช้ยังไม่ได้แตะช่องนี้" แล้วค่อย
// เอาค่าจากโปรไฟล์มาเติมให้ตอน render (ดู formValues ใน Contact) — เก็บเป็น
// สตริงว่างแล้วไปเติมใน useEffect ไม่ได้ เพราะ setState ใน effect ทำให้เกิด
// render ซ้อนโดยไม่จำเป็น (react-hooks/set-state-in-effect)
const EMPTY_FORM = {
  category: "",
  fullName: null,
  phone: null,
  email: null,
  message: "",
  bookingId: "",
};

function FaqItem({ item }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`contact-faq__item ${open ? "contact-faq__item--open" : ""}`}>
      <button
        type="button"
        className="contact-faq__q"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{item.q}</span>
        <span className="contact-faq__chevron" aria-hidden="true">
          ›
        </span>
      </button>
      {open && <p className="contact-faq__a">{item.a}</p>}
    </div>
  );
}

// เธรดเรื่องที่ส่งไปแล้ว — ดีไซน์ฝั่งลูกค้ามีแค่ฟอร์ม แต่ถ้าไม่มีที่ให้อ่าน
// คำตอบ แจ้งเตือน "ทีมงานตอบกลับแล้ว" (0096) ก็จะไม่มีปลายทางให้กดเข้าไปดู
// และลูกค้าต้องรอทางอีเมล/โทรศัพท์อย่างเดียวเหมือนก่อนมีระบบนี้
function TicketThread({ ticket, userId, unreadCount = 0, defaultOpen = false, onReplied }) {
  const [open, setOpen] = useState(defaultOpen);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const status = describeSupportStatus(ticket.status);
  const closed = ticket.status === "closed";
  const staffReplyCount = ticket.replies.filter((reply) => reply.is_staff).length;

  // เธรดที่กางอยู่ = อ่านแล้วจริง ๆ จึงติ๊กแจ้งเตือนของเรื่องนี้ให้หายไป ทั้ง
  // จุดแดงข้างเมนูและรายการในกระดิ่ง — ต้องทำซ้ำเมื่อมีคำตอบใหม่เข้ามาระหว่างที่
  // เธรดยังกางค้างอยู่ด้วย (staffReplyCount อยู่ใน deps) ไม่ใช่แค่ตอนกดเปิดครั้งแรก
  useEffect(() => {
    if (!open || !userId || staffReplyCount === 0) return;
    markSupportTicketNotificationsRead(userId, ticket.id);
  }, [open, userId, ticket.id, staffReplyCount]);

  async function handleReply(event) {
    event.preventDefault();
    setError("");
    setSending(true);

    try {
      await replySupportTicket(ticket.id, body.trim());
      setBody("");
      onReplied();
    } catch (err) {
      console.error("replySupportTicket failed:", err);
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <article
      className={`contact-ticket ${open ? "contact-ticket--open" : ""} ${
        unreadCount > 0 ? "contact-ticket--unread" : ""
      }`}
    >
      <button
        type="button"
        className="contact-ticket__head"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="contact-ticket__headline">
          <span className="contact-ticket__category">{ticket.category}</span>
          <span className={`contact-ticket__status contact-ticket__status--${status.tone}`}>
            {status.label}
          </span>
          {/* ป้ายนี้คือคำตอบของคำถาม "เลขบนเมนูมาจากเรื่องไหน" เวลามีหลายเรื่อง
              ค้างพร้อมกัน — หายไปเองเมื่อกางเธรดนี้อ่าน */}
          {unreadCount > 0 && (
            <span className="contact-ticket__new">ตอบกลับใหม่ {unreadCount}</span>
          )}
        </span>
        <span className="contact-ticket__preview">{ticket.message}</span>
        <span className="contact-ticket__time">
          ส่งเมื่อ {formatRelativeTime(ticket.created_at)}
          {ticket.replyCount > 0 && ` · ตอบกลับ ${ticket.replyCount} ข้อความ`}
        </span>
      </button>

      {open && (
        <div className="contact-ticket__body">
          <div className="contact-thread">
            <div className="contact-thread__msg contact-thread__msg--mine">
              <p className="contact-thread__text">{ticket.message}</p>
              <p className="contact-thread__meta">คุณ · {formatSupportTime(ticket.created_at)}</p>
            </div>

            {ticket.replies.map((reply) => (
              <div
                key={reply.id}
                className={`contact-thread__msg ${
                  reply.is_staff ? "contact-thread__msg--staff" : "contact-thread__msg--mine"
                }`}
              >
                <p className="contact-thread__text">{reply.body}</p>
                <p className="contact-thread__meta">
                  {reply.is_staff ? "ทีมงาน SPORTSBOOKING" : "คุณ"} ·{" "}
                  {formatSupportTime(reply.created_at)}
                </p>
              </div>
            ))}
          </div>

          {ticket.booking && (
            <p className="contact-ticket__booking">
              การจองที่เกี่ยวข้อง: <strong>{ticket.booking.booking_code}</strong> ·{" "}
              {formatBookingDate(ticket.booking.booking_date)}{" "}
              {formatTimeRange(ticket.booking.start_time, ticket.booking.end_time)}
            </p>
          )}

          {closed ? (
            <p className="contact-ticket__closed">
              เรื่องนี้ปิดแล้ว หากยังต้องการความช่วยเหลือ กรุณาส่งเรื่องใหม่จากฟอร์มด้านบน
            </p>
          ) : (
            <form className="contact-ticket__reply" onSubmit={handleReply}>
              <textarea
                aria-label="ข้อความเพิ่มเติม"
                className="contact-field__input contact-field__input--area"
                rows={3}
                value={body}
                placeholder="พิมพ์ข้อความเพิ่มเติมถึงทีมงาน..."
                onChange={(e) => setBody(e.target.value)}
              />
              {error && <p className="contact-form__error">{error}</p>}
              <button
                type="submit"
                className="contact-btn contact-btn--small"
                disabled={sending || !body.trim()}
              >
                {sending ? "กำลังส่ง..." : "ส่งข้อความเพิ่มเติม"}
              </button>
            </form>
          )}
        </div>
      )}
    </article>
  );
}

export default function Contact() {
  const { user, profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const { policy } = useRefundPolicy();
  const { tickets, loading: ticketsLoading } = useMySupportTickets(reloadKey);
  // คำตอบที่ยังไม่ได้อ่าน แยกรายเรื่อง — ใช้ไฮไลต์ว่าเลขบนเมนู "ติดต่อเรา"
  // มาจากเธรดไหนบ้าง
  const supportUnread = useUnreadSupportReplies(user?.id);
  // ข้อมูลติดต่อที่แอดมินตั้งไว้ (0098)
  const { settings: contactSettings } = useSupportContactSettings();
  const channels = buildContactChannels(contactSettings);
  const mapUrl = buildMapUrl(contactSettings);
  // การจองล่าสุดไว้ให้เลือกผูกกับเรื่องที่ส่ง — เอาแค่ 10 รายการหลังสุดก็พอ
  // ปัญหาที่ต้องติดต่อเข้ามาแทบทั้งหมดเป็นของการจองที่เพิ่งเกิดขึ้น
  const { bookings } = useUserBookings(10);

  // เติมชื่อ/อีเมล/เบอร์จากโปรไฟล์ให้อัตโนมัติ แต่ยังแก้ได้ — ลูกค้าที่อยาก
  // ให้ติดต่อกลับเบอร์อื่น (เช่น เบอร์ที่ทำงาน) พิมพ์ทับได้เลย ช่องที่ผู้ใช้
  // แตะแล้วจะไม่ถูกค่าจากโปรไฟล์ทับ เพราะค่าใน state เลิกเป็น null ไปแล้ว
  const formValues = {
    ...form,
    fullName: form.fullName ?? (profile?.full_name || profile?.username || ""),
    phone: form.phone ?? (profile?.phone || ""),
    email: form.email ?? (user?.email || ""),
  };

  const focusTicketId = searchParams.get("ticket");

  // มาจากลิงก์ในกระดิ่งแจ้งเตือน (reference_type "support_ticket") — เลื่อนไป
  // ที่เรื่องนั้นให้เลย ไม่ปล่อยให้ผู้ใช้ไล่หาเองในรายการ
  useEffect(() => {
    if (!focusTicketId || ticketsLoading) return;

    const element = document.getElementById(`ticket-${focusTicketId}`);
    if (element) element.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusTicketId, ticketsLoading]);

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setSent(false);
  };

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (!formValues.category) {
      setError("กรุณาเลือกหัวข้อที่ต้องการติดต่อ");
      return;
    }

    setSubmitting(true);

    try {
      await submitSupportTicket(formValues);
      // คงชื่อ/เบอร์/อีเมลไว้ให้ส่งเรื่องถัดไปได้เลย ล้างเฉพาะเนื้อเรื่อง
      setForm((current) => ({ ...current, category: "", message: "", bookingId: "" }));
      setSent(true);
      setReloadKey((key) => key + 1);
      // เคลียร์ ?ticket= ที่อาจค้างจากการกดแจ้งเตือน ไม่งั้นพอรายการโหลดใหม่
      // หน้าจะเด้งไปที่เรื่องเก่าแทนที่จะอยู่กับเรื่องที่เพิ่งส่ง
      if (focusTicketId) setSearchParams({}, { replace: true });
    } catch (err) {
      console.error("submitSupportTicket failed:", err);
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="contact">
      <AppHeader />

      <main className="contact__main">
        <header className="contact__masthead">
          <h1 className="contact__title">ติดต่อเรา</h1>
          <p className="contact__intro">มีคำถามหรือพบปัญหา? ทีมงานของเราพร้อมช่วยเหลือคุณ</p>
        </header>

        <div className="contact__grid">
          <div className="contact__col">
            <section className="contact-card contact-form">
              <h2 className="contact-card__title">ส่งข้อความถึงเรา</h2>

              <form className="contact-form__body" onSubmit={handleSubmit}>
                <label className="contact-field">
                  <span className="contact-field__label">หัวข้อ</span>
                  <select
                    className="contact-field__input contact-field__input--select"
                    value={formValues.category}
                    onChange={update("category")}
                    required
                  >
                    <option value="">เลือกหัวข้อที่ต้องการติดต่อ</option>
                    {SUPPORT_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="contact-form__row">
                  <label className="contact-field">
                    <span className="contact-field__label">ชื่อ-นามสกุล</span>
                    <input
                      className="contact-field__input"
                      type="text"
                      value={formValues.fullName}
                      onChange={update("fullName")}
                      placeholder="กรอกชื่อของคุณ"
                      required
                    />
                  </label>

                  <label className="contact-field">
                    <span className="contact-field__label">เบอร์โทรศัพท์</span>
                    <input
                      className="contact-field__input"
                      type="tel"
                      inputMode="tel"
                      value={formValues.phone}
                      onChange={update("phone")}
                      placeholder="0XX-XXX-XXXX"
                    />
                  </label>
                </div>

                <label className="contact-field">
                  <span className="contact-field__label">อีเมล</span>
                  <input
                    className="contact-field__input"
                    type="email"
                    value={formValues.email}
                    onChange={update("email")}
                    placeholder="email@example.com"
                    required
                  />
                </label>

                {/* ผูกเรื่องกับใบจองได้เลยถ้าปัญหาเกิดกับการจองใดการจองหนึ่ง —
                    แอดมินจะได้ไม่ต้องถามรหัสการจองกลับไปอีกรอบก่อนเริ่มตรวจสอบ */}
                {bookings.length > 0 && (
                  <label className="contact-field">
                    <span className="contact-field__label">
                      การจองที่เกี่ยวข้อง <span className="contact-field__optional">(ถ้ามี)</span>
                    </span>
                    <select
                      className="contact-field__input contact-field__input--select"
                      value={formValues.bookingId}
                      onChange={update("bookingId")}
                    >
                      <option value="">ไม่ระบุ</option>
                      {bookings.map((booking) => (
                        <option key={booking.id} value={booking.id}>
                          {booking.booking_code} · {describeFacility(booking)} ·{" "}
                          {formatBookingDate(booking.booking_date)}{" "}
                          {formatTimeRange(booking.start_time, booking.end_time)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <label className="contact-field">
                  <span className="contact-field__label">ข้อความ</span>
                  <textarea
                    className="contact-field__input contact-field__input--area"
                    rows={5}
                    value={formValues.message}
                    onChange={update("message")}
                    placeholder="อธิบายรายละเอียดปัญหาหรือคำถามของคุณ..."
                    required
                  />
                </label>

                {error && <p className="contact-form__error">{error}</p>}
                {sent && !error && (
                  <p className="contact-form__success">
                    ส่งข้อความเรียบร้อยแล้ว ทีมงานจะติดต่อกลับโดยเร็วที่สุด — ติดตามคำตอบได้ที่
                    “เรื่องที่คุณส่งมา” ด้านล่าง
                  </p>
                )}

                <button type="submit" className="contact-btn" disabled={submitting}>
                  {submitting ? "กำลังส่ง..." : "ส่งข้อความ"}
                </button>
              </form>
            </section>

            <section className="contact-card contact-history">
              <h2 className="contact-card__title">เรื่องที่คุณส่งมา</h2>

              {ticketsLoading && <p className="contact-history__empty">กำลังโหลด...</p>}

              {!ticketsLoading && tickets.length === 0 && (
                <p className="contact-history__empty">
                  ยังไม่มีเรื่องที่ส่งเข้ามา — เรื่องที่ส่งแล้วจะแสดงที่นี่พร้อมคำตอบจากทีมงาน
                </p>
              )}

              {!ticketsLoading &&
                tickets.map((ticket) => (
                  <div key={ticket.id} id={`ticket-${ticket.id}`}>
                    {/* เรื่องที่มาจากลิงก์ในกระดิ่ง (?ticket=) กางให้เลย — ผู้ใช้
                        กดแจ้งเตือนมาเพื่ออ่านคำตอบ ไม่ใช่มาหาว่าเรื่องอยู่ตรงไหน */}
                    <TicketThread
                      ticket={ticket}
                      userId={user?.id}
                      unreadCount={supportUnread.byTicket.get(ticket.id) ?? 0}
                      defaultOpen={ticket.id === focusTicketId}
                      onReplied={() => setReloadKey((k) => k + 1)}
                    />
                  </div>
                ))}
            </section>
          </div>

          <aside className="contact__col contact__col--side">
            {/* ทั้งการ์ดหายไปเลยถ้าแอดมินลบข้อมูลติดต่อออกหมด — หัวข้อเปล่า ๆ
                ที่ไม่มีช่องทางอยู่ข้างใต้ไม่ได้ช่วยอะไรผู้ใช้ */}
            {channels.length > 0 && (
            <section className="contact-card contact-channels">
              <h2 className="contact-card__title contact-card__title--sm">ช่องทางติดต่อด่วน</h2>

              {channels.map((channel) => (
                <a
                  key={channel.label}
                  className="contact-channel"
                  href={channel.href}
                  target={channel.href.startsWith("http") ? "_blank" : undefined}
                  rel="noreferrer"
                >
                  <span className="contact-channel__icon" aria-hidden="true">
                    {channel.icon}
                  </span>
                  <span className="contact-channel__text">
                    <span className="contact-channel__label">{channel.label}</span>
                    <span className="contact-channel__value">{channel.value}</span>
                    <span className="contact-channel__hint">{channel.hint}</span>
                  </span>
                </a>
              ))}
            </section>
            )}

            {contactSettings.officeAddress && (
              <section className="contact-card">
                <h2 className="contact-card__title contact-card__title--sm">ที่ตั้งสำนักงาน</h2>
                {mapUrl && (
                  <a
                    className="contact-map"
                    href={mapUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="เปิดที่ตั้งสำนักงานในแผนที่"
                  >
                    <span className="contact-map__pin" aria-hidden="true">
                      📍
                    </span>
                    <span className="contact-map__cta">เปิดในแผนที่</span>
                  </a>
                )}
                <p className="contact-address">{contactSettings.officeAddress}</p>
              </section>
            )}

            <section className="contact-card contact-faq">
              <h2 className="contact-card__title contact-card__title--sm">คำถามที่พบบ่อย</h2>
              {buildFaq(policy).map((item) => (
                <FaqItem key={item.q} item={item} />
              ))}
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
