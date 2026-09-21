// แถบหัวเว็บฝั่งลูกค้า — เมนูหลัก กระดิ่งแจ้งเตือน ปุ่มแชท และเมนูผู้ใช้
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Bell, Trophy, Volume2, VolumeX } from "lucide-react";
import ChatFlyout from "./ChatFlyout";
import { useAuth } from "../context/useAuth";
import { useAlertSoundSetting } from "../hooks/useAlertSounds";
import { useUnpaidBookingCount, useUnpaidBookings } from "../hooks/useBookings";
import { usePendingReceiptCount } from "../hooks/useRewards";
import { useHasUnseenNews, useUnreadFeaturedNews } from "../hooks/useNews";
import { useUnreadSupportReplies } from "../hooks/useSupport";
import { SUPPORT_NOTIFICATION_TYPES } from "../lib/support";
import { useNotifications, useUnreadNotificationCount } from "../hooks/useNotifications";
import { describeFacility, formatBookingDate, formatTimeRange } from "../lib/bookings";
import { markNewsRead } from "../lib/news";
import {
  formatNotificationTime,
  isActionRequiredNotification,
  markNotificationRead,
  notificationLink,
} from "../lib/notifications";
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
  { key: "home", label: "หน้าเเรก", to: "/home" },
  { key: "facilities", label: "เกี่ยวกับ", to: "/facilities" },
  { key: "news", label: "ข่าว", to: "/news" },
];

const RIGHT_LINKS = [
  // ปุ่มจองพาไปขั้นแรกเสมอ แต่ต้องค้างไฮไลต์ไว้ตลอดทุกขั้นของ /booking/*
  { key: "booking", label: "จองสนามกีฬา", to: "/booking/sport", match: "/booking" },
  { key: "community", label: "ชุมชน", to: "/community" },
  { key: "contact", label: "ติดต่อเรา", to: "/contact" },
];

// ลิ้นชักของจอแคบใช้ลิงก์ชุดเดียวกับแถบหัว แค่เรียงต่อกันเป็นแนวตั้ง —
// บนจอแคบไม่มี "สองข้างของโลโก้" ให้แยกซ้าย/ขวาอีกแล้ว
const NAV_LINKS = [...LEFT_LINKS, ...RIGHT_LINKS];

// ไฮไลต์เมนูของหน้าที่เปิดอยู่ — เทียบแบบ prefix ให้หน้าลูกที่ไม่มีเมนูของ
// ตัวเอง (เช่น /news/:id, /community/post/:id) ไฮไลต์เมนูแม่ได้ด้วย และเทียบ
// จาก match แทน to เมื่อเมนูพาไปหน้าแรกของเส้นทางที่ยาวกว่าตัวมันเอง
function isActiveLink(pathname, link) {
  const base = link.match ?? link.to;
  return pathname === base || pathname.startsWith(`${base}/`);
}

// การจองที่รอชำระเงินไม่มีแถวจริงในตาราง notifications (ไม่มี event ฝั่ง
// แอดมินให้เขียนเข้ามา) จึงประกอบเป็นรายการแจ้งเตือน "ปลอม" สดจาก bookings
// แล้วปนเข้าไปในรายการจริงของ NotificationBell แทน — ไม่ต้อง mark read
// เพราะมันจะหายเองเมื่อจ่ายเงินสำเร็จหรือหมดเวลากันสิทธิ์ (ดู useUnpaidBookings)
function unpaidBookingToNotificationItem(booking) {
  return {
    id: `unpaid-${booking.id}`,
    synthetic: true,
    is_read: false,
    title: "รอชำระเงิน",
    message: `${describeFacility(booking)} · ${formatBookingDate(
      booking.booking_date
    )} ${formatTimeRange(booking.start_time, booking.end_time)}`,
    created_at: booking.created_at,
    to: `/booking/receipt?booking=${booking.id}`,
  };
}

// ข่าวเด่นก็ไม่มีแถวจริงในตาราง notifications เหมือนกัน (ไม่มีระบบยิง insert
// ต่อ user ตอนแอดมินปักหมุดข่าว) จึงสังเคราะห์เป็นรายการแจ้งเตือนแบบเดียวกับ
// unpaidBookingToNotificationItem ข้างบน — message ใช้ข้อความที่แอดมินเขียน
// เองได้ (notify_message ใน AdminNewsEditor.jsx) ถ้าไม่กรอกไว้ถึงค่อย fallback
// ไปคำโปรย/เนื้อหาย่อของข่าว — ต่างจากรอชำระเงินตรงที่ต้อง mark read เอง
// เพราะข่าวไม่ได้ "หายเอง" แบบการจองที่จ่ายเงินแล้วหรือหมดเวลากันสิทธิ์
function featuredNewsToNotificationItem(newsItem) {
  return {
    id: `featured-news-${newsItem.id}`,
    synthetic: true,
    newsId: newsItem.id,
    is_read: false,
    title: `ข่าวเด่นใหม่: ${newsItem.title}`,
    message:
      newsItem.notifyMessage || newsItem.subtitle || newsItem.excerpt || "แตะเพื่ออ่านรายละเอียด",
    created_at: newsItem.publishedAt,
    to: `/news/${newsItem.id}`,
  };
}

// ประเภทที่ไม่เอามาโชว์ในกระดิ่ง เพราะมีป้ายเลขยังไม่อ่านของตัวเองอยู่ที่เมนู
// ของมันเองแล้ว ถ้าขึ้นทั้งสองที่ผู้ใช้จะเห็นของชิ้นเดียวกันนับซ้ำ แล้วต้องไล่
// เคลียร์สองรอบกว่าเลขจะหมด:
//   - community_message → ป้ายเลขอยู่ที่ ChatFlyout
//   - support_reply / support_closed → ป้ายเลขอยู่ที่เมนู "ติดต่อเรา"
const BELL_EXCLUDED_TYPES = ["community_message", ...SUPPORT_NOTIFICATION_TYPES];

// กระดิ่งฝั่งลูกค้า — ต่างจาก dash__bell ของแอดมิน (DashboardLayout.jsx) ตรง
// ที่นี่ดึงแถวแจ้งเตือนของผู้ใช้เองจากตาราง notifications จริง (เขียนเข้ามา
// จาก 5 RPC ฝั่งแอดมิน ดู 0037_wire_notifications.sql) ไม่ใช่ตัวเลขสรุปคิว
// บวกด้วยรายการ "รอชำระเงิน" สังเคราะห์สดจาก bookings (ดู unpaidBookingToNotificationItem)
//
// เคลียร์ทีละใบด้วยการกดเข้าไปดูเท่านั้น การเปิดกระดิ่งเฉย ๆ ไม่นับว่าอ่าน
//
// ดึงเฉพาะใบที่ยังไม่อ่าน (unreadOnly) เพราะกระดิ่งโชว์ได้แค่ 8 ใบ ถ้าเอาของ
// ที่อ่านแล้วมาปนด้วย ของที่ยังไม่ได้ดูจะถูกเบียดตกขอบจนเคลียร์ไม่มีวันหมด
function NotificationBell({ userId }) {
  const [open, setOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const rootRef = useRef(null);

  const unreadCount = useUnreadNotificationCount(userId, reloadKey, BELL_EXCLUDED_TYPES);
  const { notifications, loading } = useNotifications(
    userId,
    reloadKey,
    8,
    BELL_EXCLUDED_TYPES,
    true,
  );
  const unpaidCount = useUnpaidBookingCount();
  const { bookings: unpaidBookings } = useUnpaidBookings(3);
  const unreadFeaturedNews = useUnreadFeaturedNews(userId);

  const items = [
    ...unpaidBookings.map(unpaidBookingToNotificationItem),
    ...unreadFeaturedNews.map(featuredNewsToNotificationItem),
    ...notifications,
  ];
  const totalUnread = unreadCount + unpaidCount + unreadFeaturedNews.length;

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

    if (item.newsId != null) {
      markNewsRead(userId, item.newsId);
      setReloadKey((k) => k + 1);
      return;
    }

    // ใบที่ยังมีงานค้างไม่ปิดตัวเองตอนกด — ฐานข้อมูลปิดให้เองเมื่อรีวิวเสร็จ
    // หรือกดยืนยันรับของแล้ว (trigger ใน 0107)
    if (!item.synthetic && !item.is_read && !isActionRequiredNotification(item)) {
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
        aria-label={`การแจ้งเตือน ${totalUnread} รายการที่ยังไม่ได้อ่าน`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={20} aria-hidden="true" />
        {totalUnread > 0 && <span className="app-header__bell-badge">{totalUnread}</span>}
      </button>

      {open && (
        <div className="app-header__bell-panel" role="menu">
          <p className="app-header__bell-title">การแจ้งเตือน</p>

          {loading && <p className="app-header__bell-empty">กำลังโหลด...</p>}

          {!loading && items.length === 0 && (
            <p className="app-header__bell-empty">ดูครบแล้ว ไม่มีแจ้งเตือนใหม่</p>
          )}

          {!loading &&
            items.map((item) => (
              <Link
                key={item.id}
                to={item.synthetic ? item.to : notificationLink(item) ?? "/profile?tab=notifications"}
                role="menuitem"
                className="app-header__bell-item app-header__bell-item--unread"
                onClick={() => handleItemClick(item)}
              >
                <span className="app-header__bell-item-title">
                  {item.title}
                  {isActionRequiredNotification(item) && (
                    <span className="app-header__bell-item-tag">ต้องดำเนินการ</span>
                  )}
                </span>
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
  { key: "profile", label: "โปรไฟล์ของฉัน", desc: "ข้อมูลส่วนตัว และการตั้งค่า", to: "/profile" },
  { key: "history", label: "ประวัติการจอง", desc: "ดูรายการจองทั้งหมด", to: "/profile?tab=history" },
  { key: "community", label: "ชุมชน", desc: "พูดคุย นัดทีม กิจกรรม", to: "/community", tint: true },
  { key: "rewards", label: "แลกรางวัล", desc: "ใช้แต้มแลกของรางวัล", to: "/rewards", tint: true },
];

export default function AppHeader() {
  const { user, profile, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  // เมนูต้องอยู่ใน DOM ต่ออีกนิดหลังสั่งปิด เพื่อให้ animation ตอนหุบเล่นจบ
  // ก่อนค่อยถอดออก (ถอดตอน onAnimationEnd ด้านล่าง)
  const [menuMounted, setMenuMounted] = useState(false);
  const menuRef = useRef(null);
  // ลิ้นชักเมนูของจอแคบ — บนเดสก์ท็อปลิงก์ทั้งหกกางอยู่บนแถบหัวตลอด แต่พอจอ
  // แคบกว่า 900px มันขึ้นบรรทัดใหม่ซ้อนกันจนแถบหัวสูงกว่าเนื้อหาที่มันพาไป
  // จึงยุบเป็นปุ่มขีดสามขีดแล้วกางลงมาเป็นรายการแนวตั้งแทน
  const [navOpen, setNavOpen] = useState(false);
  const unpaidBookingCount = useUnpaidBookingCount();
  const pendingReceiptCount = usePendingReceiptCount(user?.id);
  const hasUnseenNews = useHasUnseenNews(user?.id);
  // คำตอบจากทีมงานที่ยังไม่ได้อ่าน — ขึ้นเป็นป้ายตัวเลขข้างเมนู "ติดต่อเรา"
  // ที่เดียว ไม่ซ้ำในกระดิ่ง (ดู BELL_EXCLUDED_TYPES)
  const supportUnread = useUnreadSupportReplies(user?.id);
  // ตัวเล่นเสียงจริงอยู่ที่ ChatDock (ดู useAlertSounds) ที่นี่มีแค่สวิตช์เปิด/ปิด
  const { on: soundOn, toggle: toggleSound } = useAlertSoundSetting();

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // เปลี่ยนหน้าแล้วลิ้นชักต้องหุบเอง ไม่งั้นมันค้างบังหน้าใหม่ที่เพิ่งพาไป —
  // เทียบค่ารอบก่อนหน้าระหว่าง render แทน useEffect (pattern เดียวกับที่ใช้
  // ใน ImageCropModal.jsx) จะได้ไม่ต้องวาดรอบที่ลิ้นชักยังเปิดค้างอยู่ก่อน
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setNavOpen(false);
  }

  // ลิ้นชักกางเต็มจอ ถ้าปล่อยให้หน้าข้างหลังเลื่อนตามนิ้วได้ด้วย ผู้ใช้จะปิด
  // ลิ้นชักแล้วพบว่าตัวเองอยู่คนละตำแหน่งของหน้าโดยไม่ได้ตั้งใจ
  useEffect(() => {
    if (!navOpen) return undefined;

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [navOpen]);

  const toggleMenu = () => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }

    setMenuMounted(true);
    setMenuOpen(true);
  };

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
    <header className={`app-header ${navOpen ? "app-header--nav-open" : ""}`}>
      {/* ปุ่มขีดสามขีด — โผล่เฉพาะจอที่แคบเกินกว่าจะกางลิงก์ทั้งหกพร้อมกันได้
          (ดู @media ใน AppHeader.css) บนเดสก์ท็อปมันถูกซ่อนไว้ทั้งปุ่ม */}
      <button
        type="button"
        className="app-header__burger"
        aria-label={navOpen ? "ปิดเมนู" : "เปิดเมนู"}
        aria-expanded={navOpen}
        onClick={() => setNavOpen((value) => !value)}
      >
        <span className={`app-header__burger-icon ${navOpen ? "app-header__burger-icon--open" : ""}`}>
          <span />
          <span />
          <span />
        </span>
      </button>

      <nav className="app-header__links">
        {LEFT_LINKS.map((link) => {
          const active = isActiveLink(pathname, link);

          return (
            <Link
              key={link.label}
              to={link.to}
              className={`app-header__link ${active ? "app-header__link--active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              {link.label}
              {link.key === "news" && hasUnseenNews && (
                <span className="app-header__link-dot" aria-label="มีข่าวใหม่" />
              )}
            </Link>
          );
        })}
      </nav>

      <Link to="/home">
        <img src={logoShield} alt="SPORTSBOOKING" className="app-header__logo" />
      </Link>

      <nav className="app-header__links">
        {RIGHT_LINKS.map((link) => {
          const active = isActiveLink(pathname, link);

          return (
            <Link
              key={link.label}
              to={link.to}
              className={`app-header__link ${active ? "app-header__link--active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              {link.label}
              {/* ตัวเลขแทนจุดแดงเปล่า ๆ — บอกได้ว่ามีกี่เรื่องที่ทีมงานตอบกลับ
                  มาแล้วแต่ยังไม่ได้เปิดอ่าน ไม่ใช่แค่ "มีอะไรสักอย่าง" */}
              {supportUnread.count > 0 && link.key === "contact" && (
                <span className="app-header__link-badge">
                  <span className="app-header__sr-only">ทีมงานตอบกลับแล้ว </span>
                  {supportUnread.count > 9 ? "9+" : supportUnread.count}
                  <span className="app-header__sr-only"> เรื่องที่ยังไม่ได้อ่าน</span>
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="app-header__user" ref={menuRef}>
        <ChatFlyout userId={user?.id} />
        <NotificationBell userId={user?.id} />

        <button
          type="button"
          className="app-header__avatar-btn"
          onClick={toggleMenu}
          aria-expanded={menuOpen}
          aria-haspopup="true"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="app-header__avatar" />
          ) : (
            <UserAvatarIcon className="app-header__avatar" />
          )}
          <span
            className={`app-header__caret ${menuOpen ? "app-header__caret--open" : ""}`}
            aria-hidden="true"
          >
            ▾
          </span>
        </button>

        {menuMounted && (
          <div
            className={`app-menu ${menuOpen ? "app-menu--in" : "app-menu--out"}`}
            role="menu"
            onAnimationEnd={(e) => {
              // animationend ของรายการลูกก็ลอยขึ้นมาถึงตรงนี้ด้วย จึงต้องเช็ค
              // ว่าเป็นของตัวกล่องเอง ไม่งั้นเมนูจะถูกถอดทิ้งตั้งแต่ยังเปิดอยู่
              if (!menuOpen && e.target === e.currentTarget) {
                setMenuMounted(false);
              }
            }}
          >
            <div className="app-menu__profile">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="app-menu__avatar" />
              ) : (
                <UserAvatarIcon className="app-menu__avatar" />
              )}
              <div>
                <p className="app-menu__name">{displayName}</p>
                <p className="app-menu__points">
                  <Trophy size={15} aria-hidden="true" /> คะแนนสะสม {points.toLocaleString()}
                </p>
              </div>
            </div>

            {MENU_ITEMS.map((item) => (
              <Link
                key={item.key}
                to={item.to}
                className={`app-menu__item ${item.tint ? "app-menu__item--tint" : ""}`}
                onClick={() => setMenuOpen(false)}
              >
                <span className="app-menu__item-title">
                  {item.label}
                  {item.key === "history" && unpaidBookingCount > 0 && (
                    <span className="app-menu__item-badge">{unpaidBookingCount}</span>
                  )}
                  {/* ของที่ส่งถึงแล้วแต่ลูกค้ายังไม่กดยืนยัน — รายการค้างอยู่ใน
                      คิวของแอดมินจนกว่าจะกด จึงต้องมีอะไรเตือนค้างไว้ ไม่ใช่
                      แจ้งเตือนใบเดียวที่เลื่อนหายไปในไม่กี่วัน */}
                  {item.key === "rewards" && pendingReceiptCount > 0 && (
                    <span className="app-menu__item-badge">{pendingReceiptCount}</span>
                  )}
                </span>
                <span className="app-menu__item-desc">
                  {item.key === "history" && unpaidBookingCount > 0
                    ? `มี ${unpaidBookingCount} รายการรอชำระเงิน`
                    : item.key === "rewards" && pendingReceiptCount > 0
                      ? `มี ${pendingReceiptCount} ชิ้นรอกดยืนยันรับของ`
                      : item.desc}
                </span>
              </Link>
            ))}

            <hr className="app-menu__divider" />

            {/* สวิตช์เสียงอยู่ในเมนูนี้เพราะเป็นค่าของ "เครื่องนี้" ไม่ใช่ค่าบัญชี
                (เก็บใน localStorage) — ผู้ใช้ที่นั่งทำงานอยู่ในที่เงียบ ๆ ต้องปิด
                ได้ทันทีตรงที่เดียวกับที่เห็นกระดิ่ง ไม่ต้องไปตามหาในหน้าตั้งค่า */}
            <button
              type="button"
              className="app-menu__sound"
              role="switch"
              aria-checked={soundOn}
              onClick={toggleSound}
            >
              <span className="app-menu__item-title">
                {soundOn ? <Volume2 size={17} aria-hidden="true" /> : <VolumeX size={17} aria-hidden="true" />}{" "}
                เสียงแจ้งเตือน
              </span>
              <span
                className={`app-menu__switch ${soundOn ? "app-menu__switch--on" : ""}`}
                aria-hidden="true"
              >
                <span className="app-menu__switch-knob" />
              </span>
            </button>

            <button type="button" className="app-menu__logout" onClick={handleLogout}>
              <span aria-hidden="true">⎋</span> ออกจากระบบ
            </button>
          </div>
        )}
      </div>

      {/* ฉากหลังทึบตอนลิ้นชักกาง — แตะที่ไหนก็ได้นอกลิ้นชักเพื่อปิด */}
      <div
        className={`app-header__scrim ${navOpen ? "app-header__scrim--open" : ""}`}
        onClick={() => setNavOpen(false)}
        aria-hidden="true"
      />

      <nav
        className={`app-header__drawer ${navOpen ? "app-header__drawer--open" : ""}`}
        aria-label="เมนูหลัก"
        aria-hidden={!navOpen}
      >
        {NAV_LINKS.map((link) => {
          const active = isActiveLink(pathname, link);

          return (
            <Link
              key={link.key}
              to={link.to}
              className={`app-header__drawer-link ${
                active ? "app-header__drawer-link--active" : ""
              }`}
              aria-current={active ? "page" : undefined}
              tabIndex={navOpen ? undefined : -1}
              onClick={() => setNavOpen(false)}
            >
              {link.label}
              {link.key === "news" && hasUnseenNews && (
                <span className="app-header__drawer-dot" aria-label="มีข่าวใหม่" />
              )}
              {link.key === "contact" && supportUnread.count > 0 && (
                <span className="app-header__drawer-badge">
                  <span className="app-header__sr-only">ทีมงานตอบกลับแล้ว </span>
                  {supportUnread.count > 9 ? "9+" : supportUnread.count}
                  <span className="app-header__sr-only"> เรื่องที่ยังไม่ได้อ่าน</span>
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
