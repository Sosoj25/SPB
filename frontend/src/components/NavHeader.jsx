import { Link } from "react-router-dom";
import { logoShield, userIcon } from "../assets/images";
import "./NavHeader.css";

// ปุ่มอื่นนอกจาก Home ทั้งหมดเด้งไป login พร้อมข้อความแจ้งเตือนเดียวกัน
const LOGIN_PROMPT = { error: "กรุณาเข้าสู่ระบบก่อนใช้งานส่วนนี้" };

const LEFT_LINKS = [
  { label: "Home", to: "/" },
  { label: "About", to: "/login", state: LOGIN_PROMPT },
  { label: "NEWS", to: "/login", state: LOGIN_PROMPT },
];

const RIGHT_LINKS = [
  { label: "จองสนามกีฬา", to: "/login", state: LOGIN_PROMPT },
  { label: "ชุมชน", to: "/login", state: LOGIN_PROMPT },
];

export default function NavHeader() {
  return (
    <header className="nav-header">
      <img src={userIcon} alt="" className="nav-header__avatar" />
      <nav className="nav-header__links">
        {LEFT_LINKS.map((link) => (
          <Link
            key={link.label}
            to={link.to}
            state={link.state}
            className="nav-header__link"
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
            className="nav-header__link"
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
