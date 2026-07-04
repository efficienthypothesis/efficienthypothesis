import { formatMonthName, getSevenDayWindow } from "../utils/date";
import { BrandLogo } from "./BrandLogo";

type NavbarProps = {
  onSettings: () => void;
  onInstructions: () => void;
};

export function Navbar({ onSettings, onInstructions }: NavbarProps) {
  const today = new Date();
  const dates = getSevenDayWindow(today);
  const todayKey = today.toDateString();

  return (
    <header className="topbar">
      <div className="topbar-left">
        <BrandLogo />
      </div>
      <div className="topbar-center" aria-label="Current week">
        <div className="month-label">{formatMonthName(today)}</div>
        <div className="week-bar">
          {dates.map((date) => (
            <div
              key={date.toISOString()}
              className={`week-cell ${date.toDateString() === todayKey ? "active" : ""}`}
            >
              {date.getDate()}
            </div>
          ))}
        </div>
      </div>
      <div className="topbar-right">
        <button className="topbar-action" type="button" onClick={onInstructions}>
          instructions
        </button>
        <button className="topbar-action" type="button" onClick={onSettings}>
          settings
        </button>
      </div>
    </header>
  );
}
