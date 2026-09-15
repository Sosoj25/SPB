// แถบเมนูบนหน้าที่ยังไม่ได้ล็อกอิน (Landing) — ทุกปุ่มยกเว้นหน้าแรกพาไป /login
import { Link, useLocation } from "react-router-dom";
import { logoShield } from "../assets/images";
import "./NavHeader.css";

// ปุ่มอื่นนอกจาก Home ทั้งหมดเด้งไป login พร้อมข้อความแจ้งเตือนเดียวกัน
const LOGIN_PROMPT = { error: "กรุณาเข้าสู่ระบบก่อนใช้งานส่วนนี้" };

const LEFT_LINKS = [
  { label: "หน้าเเรก", to: "/", match: "/" },
  { label: "เกี่ยวกับ", to: "/login", state: LOGIN_PROMPT },
  { label: "ข่าว", to: "/login", state: LOGIN_PROMPT },
];

const RIGHT_LINKS = [
  { label: "จองสนามกีฬา", to: "/login", state: LOGIN_PROMPT },
  { label: "ชุมชน", to: "/login", state: LOGIN_PROMPT },
];

// มีแต่ "หน้าเเรก" ที่มีหน้าจริงให้ไฮไลต์ ปุ่มที่เหลือเด้งไป /login หมด —
// ถ้าเทียบจาก to ตรง ๆ พออยู่หน้า login มันจะไฮไลต์พร้อมกันทีเดียวสี่ปุ่ม
function isActiveLink(pathname, link) {
  return Boolean(link.match) && pathname === link.match;
}

export default function NavHeader() {
  const { pathname } = useLocation();

  return (
    <header className="nav-header">
      <span className="nav-header__spacer" aria-hidden="true" />
      <nav className="nav-header__links">
        {LEFT_LINKS.map((link) => (
          <Link
            key={link.label}
            to={link.to}
            state={link.state}
            className={`nav-header__link ${
              isActiveLink(pathname, link) ? "nav-header__link--active" : ""
            }`}
            aria-current={isActiveLink(pathname, link) ? "page" : undefined}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <img src={logoShield} alt="SPORTSBOOKING" className="nav-header__logo" />
      <nav className="nav-header__links">
        {RIGHT_LINKS.map((link) => (
          <Link
            key={link.label}
            to={link.to}
            state={link.state}
            className={`nav-header__link ${
              isActiveLink(pathname, link) ? "nav-header__link--active" : ""
            }`}
            aria-current={isActiveLink(pathname, link) ? "page" : undefined}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <Link to="/login" className="nav-header__cta">
        เข้าสู่ระบบ
      </Link>
    </header>
  );
}
