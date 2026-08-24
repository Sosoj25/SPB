import { logoRound } from "../assets/images";
import "./AuthHeader.css";

export default function AuthHeader() {
  return (
    <header className="auth-header">
      <img src={logoRound} alt="SPORTSBOOKING" className="auth-header__logo" />
      <div className="auth-header__text">
        <span className="auth-header__title">SPORTSBOOKING</span>
        <span className="auth-header__subtitle">www.SPORTSBOOKING.COM</span>
      </div>
    </header>
  );
}
