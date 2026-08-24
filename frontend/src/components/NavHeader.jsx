import { Link } from "react-router-dom";
import { logoShield, userIcon } from "../assets/images";
import "./NavHeader.css";

const LEFT_LINKS = [
  { label: "Home", to: "/" },
  { label: "About", to: "/" },
  { label: "NEWS", to: "/" },
];

const RIGHT_LINKS = [
  { label: "จองสนามกีฬา", to: "/" },
  { label: "ชุมชน", to: "/" },
];

export default function NavHeader() {
  return (
    <header className="nav-header">
      <img src={userIcon} alt="" className="nav-header__avatar" />
      <nav className="nav-header__links">
        {LEFT_LINKS.map((link) => (
          <Link key={link.label} to={link.to} className="nav-header__link">
            {link.label}
          </Link>
        ))}
      </nav>
      <img src={logoShield} alt="SPORTSBOOKING" className="nav-header__logo" />
      <nav className="nav-header__links">
        {RIGHT_LINKS.map((link) => (
          <Link key={link.label} to={link.to} className="nav-header__link">
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
