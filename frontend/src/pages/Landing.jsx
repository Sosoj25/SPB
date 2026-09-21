// หน้าแรกก่อนล็อกอิน (/) — ปุ่มเดียวคือพาไปหน้าเข้าสู่ระบบ
import { Link } from "react-router-dom";
import { bgField, logoShield, playIcon } from "../assets/images";
import NavHeader from "../components/NavHeader";
import useReveal from "../hooks/useReveal";
import "./Landing.css";

export default function Landing() {
  const revealRef = useReveal();

  return (
    <div className="landing" style={{ backgroundImage: `url(${bgField})` }}>
      <NavHeader />
      <main className="landing__main" ref={revealRef}>
        <div className="landing__panel">
          <img
            src={logoShield}
            alt="SPORTSBOOKING"
            className="landing__logo"
            data-reveal
          />
          <h1 className="landing__heading" data-reveal data-reveal-delay="1">
            จองสนามกีฬาง่ายๆ กับเรา
            <br />
            SPORTSBOOKING.COM
          </h1>
          <Link to="/login" className="landing__cta" data-reveal data-reveal-delay="2">
            จองเลยตอนนี้
            <img src={playIcon} alt="" className="landing__cta-icon" />
          </Link>
        </div>
      </main>
    </div>
  );
}
