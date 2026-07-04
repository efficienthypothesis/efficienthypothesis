import { useEffect, useRef, useState } from "react";
import type { EHUser } from "../types";

type ProfileMenuProps = {
  user: EHUser;
  onSettings: () => void;
  onInstructions: () => void;
};

export function ProfileMenu({ user, onSettings, onInstructions }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const initials = (user.name || user.email || "EH")
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="profile-menu" ref={menuRef}>
      <button
        className="profile-button"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {user.picture ? <img src={user.picture} alt="" /> : <span>{initials}</span>}
      </button>
      {open ? (
        <div className="profile-popover" role="menu">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onSettings();
            }}
            role="menuitem"
          >
            Settings
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onInstructions();
            }}
            role="menuitem"
          >
            Instructions
          </button>
        </div>
      ) : null}
    </div>
  );
}
