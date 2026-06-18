import { useState } from "react";
import type { EHUser } from "../types";

type ProfileMenuProps = {
  user: EHUser;
  onSettings: () => void;
};

export function ProfileMenu({ user, onSettings }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const initials = (user.name || user.email || "EH")
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <div className="profile-menu" onMouseLeave={() => setOpen(false)}>
      <button
        className="profile-button"
        type="button"
        onClick={() => setOpen((value) => !value)}
        onMouseEnter={() => setOpen(true)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {user.picture ? <img src={user.picture} alt="" /> : <span>{initials}</span>}
      </button>
      {open ? (
        <div className="profile-popover" role="menu">
          <button type="button" onClick={onSettings} role="menuitem">
            Settings
          </button>
          <a href="/logout" role="menuitem">
            Logout
          </a>
        </div>
      ) : null}
    </div>
  );
}
