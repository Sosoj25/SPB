import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { useNotifications, useUnreadNotificationCount } from "../hooks/useNotifications";
import { formatNotificationTime, markNotificationRead, notificationLink } from "../lib/notifications";
import { logoShield } from "../assets/images";
import "./AppHeader.css";

function UserAvatarIcon({ className }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <defs>
        <clipPath id="user-avatar-circle">
          <circle cx="24" cy="24" r="24" />
        </clipPath>
      </defs>
      <circle cx="24" cy="24" r="24" fill="#fff" />
      <g clipPath="url(#user-avatar-circle)">
        <circle cx="24" cy="19" r="8" fill="var(--color-primary)" />
        <ellipse cx="24" cy="46" rx="17" ry="14" fill="var(--color-primary)" />
      </g>
    </svg>
  );
}

const LEFT_LINKS = [
  { label: "Home", to: "/home" },
  { label: "About", to: "/facilities" },
  { label: "NEWS", to: "/news" },
];

const RIGHT_LINKS = [
  { label: "จองสนามกีฬา", to: "/booking/sport" },
  { label: "ชุมชน", to: "/home" },
];

// กระดิ่งฝั่งลูกค้า — ต่างจาก dash__bell ของแอดมิน (DashboardLayout.jsx) ตรง
// ที่นี่ดึงแถวแจ้งเตือนของผู้ใช้เองจากตาราง notifications จริง (เขียนเข้ามา
// จาก 5 RPC ฝั่งแอดมิน ดู 0037_wire_notifications.sql) ไม่ใช่ตัวเลขสรุปคิว
function NotificationBell({ userId }) {
  const [open, setOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const rootRef = useRef(null);

  const unreadCount = useUnreadNotificationCount(userId, reloadKey);
  const { notifications, loading } = useNotifications(userId, reloadKey, 8);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  async function handleItemClick(item) {
    setOpen(false);

    if (!item.is_read) {
      try {
        await markNotificationRead(item.id);
        setReloadKey((k) => k + 1);
      } catch (err) {
        console.error("markNotificationRead failed:", err);
      }
    }
  }

  if (!userId) return null;

  return (
    <div className="app-header__bell" ref={rootRef}>
      <button
        type="button"
        className="app-header__bell-trigger"
        aria-label={`การแจ้งเตือน ${unreadCount} รายการที่ยังไม่ได้อ่าน`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        🔔
        {unreadCount > 0 && <span className="app-header__bell-badge">{unreadCount}</span>}
      </button>

      {open && (
        <div className="app-header__bell-panel" role="menu">
          <p className="app-header__bell-title">การแจ้งเตือน</p>

          {loading && <p className="app-header__bell-empty">กำลังโหลด...</p>}

          {!loading && notifications.length === 0 && (
            <p className="app-header__bell-empty">ยังไม่มีการแจ้งเตือน</p>
          )}

          {!loading &&
            notifications.map((item) => (
              <Link
                key={item.id}
                to={notificationLink(item) ?? "/profile?tab=notifications"}
                role="menuitem"
                className={`app-header__bell-item ${
                  item.is_read ? "" : "app-header__bell-item--unread"
                }`}
                onClick={() => handleItemClick(item)}
              >
                <span className="app-header__bell-item-title">{item.title}</span>
                <span className="app-header__bell-item-message">{item.message}</span>
                <span className="app-header__bell-item-time">
                  {formatNotificationTime(item.created_at)}
                </span>
              </Link>
            ))}

          <Link
            to="/profile?tab=notifications"
            className="app-header__bell-viewall"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            ดูการแจ้งเตือนทั้งหมด
          </Link>
        </div>
      )}
    </div>
  );
}

const MENU_ITEMS = [
  { label: "โปรไฟล์ของฉัน", desc: "ข้อมูลส่วนตัว และการตั้งค่า", to: "/profile" },
  { label: "ประวัติการจอง", desc: "ดูรายการจองทั้งหมด", to: "/profile" },
  { label: "ชุมชน", desc: "พูดคุย นัดทีม กิจกรรม", to: "/home", tint: true },
  { label: "แลกรางวัล", desc: "ใช้แต้มแลกของรางวัล", to: "/home", tint: true },
];

export default function AppHeader() {
  const { user, profile, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    setMenuOpen(false);

    // ถ้า signOut ล้มเหลว (เช่น เน็ตหลุด) ก็ยังพากลับหน้าแรก
    // ไม่ปล่อยให้ผู้ใช้ค้างอยู่โดยไม่มีอะไรเกิดขึ้น
    try {
      await logout();
    } catch {
      // error ถูก log ไว้ใน AuthContext แล้ว
    }

    navigate("/");
  };

  const displayName =
    profile?.full_name || profile?.username || user?.email?.split("@")[0] || "ผู้ใช้งาน";
  const points = profile?.points ?? 0;
  const avatarUrl = profile?.avatar_url || "";

  return (
    <header className="app-header">
      <div className="app-header__user" ref={menuRef}>
        <button
          type="button"
          className="app-header__avatar-btn"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-haspopup="true"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="app-header__avatar" />
          ) : (
            <UserAvatarIcon className="app-header__avatar" />
          )}
          <span className="app-header__caret" aria-hidden="true">▾</span>
        </button>

        {menuOpen && (
          <div className="app-menu" role="menu">
            <div className="app-menu__profile">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="app-menu__avatar" />
              ) : (
                <UserAvatarIcon className="app-menu__avatar" />
              )}
              <div>
                <p className="app-menu__name">{displayName}</p>
                <p className="app-menu__points">🏆 คะแนนสะสม {points.toLocaleString()}</p>
              </div>
            </div>

            {MENU_ITEMS.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                className={`app-menu__item ${item.tint ? "app-menu__item--tint" : ""}`}
                onClick={() => setMenuOpen(false)}
              >
                <span className="app-menu__item-title">{item.label}</span>
                <span className="app-menu__item-desc">{item.desc}</span>
              </Link>
            ))}

            <hr className="app-menu__divider" />

            <button type="button" className="app-menu__logout" onClick={handleLogout}>
              <span aria-hidden="true">⎋</span> ออกจากระบบ
            </button>
          </div>
        )}

        <NotificationBell userId={user?.id} />
      </div>

      <nav className="app-header__links">
        {LEFT_LINKS.map((link) => (
          <Link key={link.label} to={link.to} className="app-header__link">
            {link.label}
          </Link>
        ))}
      </nav>

      <Link to="/home">
        <img src={logoShield} alt="SPORTSBOOKING" className="app-header__logo" />
      </Link>

      <nav className="app-header__links">
        {RIGHT_LINKS.map((link) => (
          <Link key={link.label} to={link.to} className="app-header__link">
            {link.label}
          </Link>
        ))}
      </nav>

      <button type="button" className="app-header__logout-btn" onClick={handleLogout}>
        ออกจากระบบ
      </button>
    </header>
  );
}
