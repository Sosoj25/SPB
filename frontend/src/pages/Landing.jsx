// หน้าแรกก่อนล็อกอิน (/) — ปุ่มเดียวคือพาไปหน้าเข้าสู่ระบบ
import { Link } from "react-router-dom";
import { bgField, logoShield, playIcon } from "../assets/images";
import NavHeader from "../components/NavHeader";
import "./Landing.css";

export default function Landing() {
  return (
    <div className="landing" style={{ backgroundImage: `url(${bgField})` }}>
      <NavHeader />
      <main className="landing__main">
        <div className="landing__panel">
          <img src={logoShield} alt="SPORTSBOOKING" className="landing__logo" />
          <h1 className="landing__heading">
            จองสนามกีฬาง่ายๆ กับเรา
            <br />
            SPORTSBOOKING.COM
          </h1>
          <Link to="/login" className="landing__cta">
            จองเลยตอนนี้
            <img src={playIcon} alt="" className="landing__cta-icon" />
          </Link>
        </div>
      </main>
    </div>
  );
}
