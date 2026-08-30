import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import { useAuth } from "../context/useAuth";
import { useUserBookings } from "../hooks/useBookings";
import { useNotifications } from "../hooks/useNotifications";
import { supabase } from "../lib/supabase";
import {
  describeFacility,
  describeSport,
  describeStatus,
  formatBookingDate,
  formatTimeRange,
  BOOKING_PAGE_SIZE,
} from "../lib/bookings";
import {
  formatNotificationTime,
  markAllNotificationsRead,
  markNotificationRead,
  notificationLink,
} from "../lib/notifications";
import { bgField } from "../assets/images";
import "./Profile.css";

const SIDEBAR_NAV = [
  { key: "info", icon: "👤", label: "ข้อมูลส่วนตัว" },
  { key: "history", icon: "🗓", label: "ประวัติการจอง" },
  { key: "security", icon: "🔒", label: "ความปลอดภัย" },
  { key: "notifications", icon: "🔔", label: "การแจ้งเตือน" },
];

function InfoPanel({ user, profile }) {
  const fields = [
    { label: "ชื่อ-นามสกุล", value: profile?.full_name || "—" },
    { label: "ชื่อผู้ใช้", value: profile?.username || "—" },
    { label: "อีเมล", value: user?.email || "—" },
    { label: "เบอร์โทรศัพท์", value: profile?.phone || "—" },
    { label: "เกี่ยวกับฉัน", value: profile?.bio || "—" },
  ];

  return (
    <section className="profile-card">
      <div className="profile-card__header">
        <h2 className="profile-card__title">ข้อมูลส่วนตัว</h2>
        <Link to="/profile/edit" className="profile-btn profile-btn--primary">
          แก้ไขโปรไฟล์
        </Link>
      </div>

      <div className="profile-fields">
        {fields.map((field) => (
          <div key={field.label} className="profile-field">
            <span className="profile-field__label">{field.label}</span>
            <p className="profile-field__value">{field.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HistoryPanel() {
  // ขยายทีละหน้าแทนการดึงประวัติทั้งหมดตั้งแต่เปิดหน้า
  const [limit, setLimit] = useState(BOOKING_PAGE_SIZE);
  const { bookings, hasMore, loading, error } = useUserBookings(limit);

  return (
    <section className="profile-card profile-card--flush">
      <div className="profile-history__header">
        <h2 className="profile-card__title">ประวัติการจอง</h2>
        {!loading && !error && (
          <span className="profile__badge">
            {hasMore
              ? `${bookings.length} รายการล่าสุด`
              : `ทั้งหมด ${bookings.length} รายการ`}
          </span>
        )}
      </div>

      {loading && <p className="profile-empty">กำลังโหลดประวัติการจอง...</p>}

      {!loading && error && (
        <div className="profile-empty">
          <div className="profile-message profile-message--error">{error}</div>
        </div>
      )}

      {!loading && !error && bookings.length === 0 && (
        <div className="profile-empty">
          <p className="profile-empty__title">ยังไม่มีประวัติการจอง</p>
          <p className="profile-empty__desc">
            เมื่อคุณจองสนามแล้ว รายการทั้งหมดจะแสดงอยู่ที่นี่
          </p>
        </div>
      )}

      {!loading && !error && bookings.length > 0 && (
        <div className="profile-table">
          <div className="profile-table__row profile-table__row--head">
            <span className="profile-table__cell profile-table__cell--type">ประเภท</span>
            <span className="profile-table__cell profile-table__cell--court">สนาม</span>
            <span className="profile-table__cell profile-table__cell--time">เวลา</span>
            <span className="profile-table__cell profile-table__cell--status">สถานะ</span>
            <span className="profile-table__cell profile-table__cell--date">วันที่</span>
          </div>

          {bookings.map((booking, i) => {
            const status = describeStatus(booking);

            return (
              <Link
                key={booking.id}
                to={`/booking/receipt?booking=${booking.id}`}
                className={`profile-table__row profile-table__row--link ${
                  i % 2 === 1 ? "profile-table__row--tint" : ""
                }`}
              >
                <span className="profile-table__cell profile-table__cell--type">
                  {describeSport(booking)}
                </span>
                <span className="profile-table__cell profile-table__cell--court">
                  {describeFacility(booking)}
                </span>
                <span className="profile-table__cell profile-table__cell--time">
                  {formatTimeRange(booking.start_time, booking.end_time)}
                </span>
                <span className="profile-table__cell profile-table__cell--status">
                  <span className={`profile-status profile-status--${status.tone}`}>
                    {status.label}
                  </span>
                </span>
                <span className="profile-table__cell profile-table__cell--date">
                  {formatBookingDate(booking.booking_date)}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {!loading && !error && hasMore && (
        <button
          type="button"
          className="profile-more"
          onClick={() => setLimit((n) => n + BOOKING_PAGE_SIZE)}
        >
          ดูเพิ่มเติม
        </button>
      )}
    </section>
  );
}

function SecurityPanel({ user, isVerified }) {
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const handleSendResetLink = async () => {
    setFeedback(null);

    try {
      setSending(true);

      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) throw error;

      setFeedback({
        type: "success",
        text: `ส่งลิงก์เปลี่ยนรหัสผ่านไปที่ ${user.email} แล้ว กรุณาตรวจสอบกล่องจดหมาย (รวมถึง Spam)`,
      });
    } catch (err) {
      console.error("Send reset link error:", err);
      setFeedback({
        type: "error",
        text: err.message || "ไม่สามารถส่งลิงก์เปลี่ยนรหัสผ่านได้",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="profile-card">
      <div className="profile-card__header">
        <h2 className="profile-card__title">ความปลอดภัย</h2>
      </div>

      {feedback && (
        <div className={`profile-message profile-message--${feedback.type}`}>
          {feedback.text}
        </div>
      )}

      <div className="profile-setting">
        <div>
          <p className="profile-setting__title">รหัสผ่าน</p>
          <p className="profile-setting__desc">
            เราจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปที่อีเมลของคุณ เพื่อยืนยันว่าเป็นคุณจริง
          </p>
        </div>
        <button
          type="button"
          className="profile-btn profile-btn--primary"
          onClick={handleSendResetLink}
          disabled={sending}
        >
          {sending ? "กำลังส่ง..." : "เปลี่ยนรหัสผ่าน"}
        </button>
      </div>

      <div className="profile-setting">
        <div>
          <p className="profile-setting__title">อีเมล</p>
          <p className="profile-setting__desc">{user?.email}</p>
        </div>
        <span className={`profile-status profile-status--${isVerified ? "success" : "pending"}`}>
          {isVerified ? "ยืนยันแล้ว" : "ยังไม่ยืนยัน"}
        </span>
      </div>
    </section>
  );
}

function NotificationsPanel({ userId }) {
  const [reloadKey, setReloadKey] = useState(0);
  const { notifications, loading, error } = useNotifications(userId, reloadKey);
  const hasUnread = notifications.some((item) => !item.is_read);

  async function handleOpen(item) {
    if (!item.is_read) {
      try {
        await markNotificationRead(item.id);
        setReloadKey((k) => k + 1);
      } catch (err) {
        console.error("markNotificationRead failed:", err);
      }
    }
  }

  async function handleMarkAllRead() {
    try {
      await markAllNotificationsRead(userId);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("markAllNotificationsRead failed:", err);
    }
  }

  return (
    <section className="profile-card">
      <div className="profile-card__header">
        <h2 className="profile-card__title">การแจ้งเตือน</h2>
        {hasUnread && (
          <button type="button" className="profile-btn profile-btn--small" onClick={handleMarkAllRead}>
            ทำเครื่องหมายว่าอ่านแล้วทั้งหมด
          </button>
        )}
      </div>

      {loading && <p className="profile-empty">กำลังโหลดการแจ้งเตือน...</p>}

      {!loading && error && (
        <div className="profile-message profile-message--error">{error}</div>
      )}

      {!loading && !error && notifications.length === 0 && (
        <div className="profile-empty">
          <p className="profile-empty__title">ยังไม่มีการแจ้งเตือน</p>
          <p className="profile-empty__desc">
            การแจ้งเตือนเกี่ยวกับการจองและกิจกรรมต่างๆ จะแสดงอยู่ที่นี่
          </p>
        </div>
      )}

      {!loading && !error && notifications.length > 0 && (
        <ul className="profile-notifications">
          {notifications.map((item) => {
            const link = notificationLink(item);
            const content = (
              <>
                <div className="profile-notification__head">
                  <p className="profile-notification__title">{item.title}</p>
                  <span className="profile-notification__time">
                    {formatNotificationTime(item.created_at)}
                  </span>
                </div>
                <p className="profile-notification__message">{item.message}</p>
              </>
            );

            const className = `profile-notification ${
              item.is_read ? "" : "profile-notification--unread"
            } ${link ? "profile-notification--link" : ""}`;

            return (
              <li key={item.id} className={className}>
                {link ? (
                  <Link to={link} className="profile-notification__body" onClick={() => handleOpen(item)}>
                    {content}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="profile-notification__body"
                    onClick={() => handleOpen(item)}
                  >
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function Profile() {
  const { user, profile } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState(
    SIDEBAR_NAV.some((item) => item.key === requestedTab) ? requestedTab : "info",
  );
  const [message] = useState(location.state?.message || "");

  const displayName =
    profile?.full_name || profile?.username || user?.email?.split("@")[0] || "ผู้ใช้งาน";
  const points = profile?.points ?? 0;
  const isVerified = Boolean(user?.email_confirmed_at);

  return (
    <div className="profile" style={{ backgroundImage: `url(${bgField})` }}>
      <AppHeader />

      <main className="profile__main">
        <div className="profile__layout">
          <aside className="profile__sidebar">
            <div className="profile__sidebar-banner" />
            <div className="profile__sidebar-body">
              <div className="profile__avatar" aria-hidden="true">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="profile__avatar-img" />
                ) : (
                  "👤"
                )}
              </div>
              <h2 className="profile__name">{displayName}</h2>
              <p className="profile__email">{user?.email}</p>

              <div className="profile__badges">
                <span className="profile__badge">🏆 {points.toLocaleString()} แต้ม</span>
                <span className="profile__badge">
                  {isVerified ? "✓ ยืนยันแล้ว" : "ยังไม่ยืนยันอีเมล"}
                </span>
              </div>

              <nav className="profile__nav">
                {SIDEBAR_NAV.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`profile__nav-item ${
                      activeTab === item.key ? "profile__nav-item--active" : ""
                    }`}
                    onClick={() => setActiveTab(item.key)}
                  >
                    <span aria-hidden="true">{item.icon}</span>
                    {item.label}
                  </button>
                ))}
              </nav>
            </div>
          </aside>

          <div className="profile__content">
            {message && <div className="profile-message profile-message--success">{message}</div>}

            {activeTab === "info" && <InfoPanel user={user} profile={profile} />}
            {activeTab === "history" && <HistoryPanel />}
            {activeTab === "security" && (
              <SecurityPanel user={user} isVerified={isVerified} />
            )}
            {activeTab === "notifications" && <NotificationsPanel userId={user?.id} />}
          </div>
        </div>
      </main>
    </div>
  );
}
