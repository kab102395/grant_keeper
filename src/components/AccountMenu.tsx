import { useEffect, useRef, useState } from "react";

const PHOTO_STORAGE_KEY = "gk_company_photo";

function deriveInitials(companyName: string | null, email: string | null): string {
  const source = (companyName ?? email ?? "").trim();
  if (!source) return "GK";
  const words = source.split(/[\s@.]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

/**
 * Top-right account control. The avatar shows the company photo (if uploaded) or
 * derived initials; the dropdown exposes account actions — change password, sign
 * out — and lets the user set a company photo. The photo is stored on this device
 * (localStorage) for now; a workspace-wide logo is tracked as a follow-up.
 */
export function AccountMenu({
  email,
  companyName,
  onChangePassword,
  onSignOut,
}: {
  email: string | null;
  companyName: string | null;
  onChangePassword: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try {
      setPhoto(window.localStorage.getItem(PHOTO_STORAGE_KEY));
    } catch {
      // localStorage may be unavailable; fall back to initials
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function handlePhotoFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : null;
      if (!dataUrl) return;
      try {
        window.localStorage.setItem(PHOTO_STORAGE_KEY, dataUrl);
      } catch {
        // ignore quota / availability errors — photo still shows this session
      }
      setPhoto(dataUrl);
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  function removePhoto() {
    try {
      window.localStorage.removeItem(PHOTO_STORAGE_KEY);
    } catch {
      // ignore
    }
    setPhoto(null);
  }

  const initials = deriveInitials(companyName, email);

  return (
    <div className="account-menu" ref={containerRef}>
      <button
        type="button"
        className="account-avatar"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((value) => !value)}
      >
        {photo ? <img src={photo} alt="" /> : <span>{initials}</span>}
      </button>

      {open ? (
        <div className="account-popover" role="menu">
          <div className="account-popover-head">
            {photo ? <img src={photo} alt="" className="account-popover-photo" /> : <span className="account-popover-initials">{initials}</span>}
            <div className="account-popover-id">
              <strong>{companyName ?? "Your workspace"}</strong>
              {email ? <span>{email}</span> : null}
            </div>
          </div>

          <button
            type="button"
            className="account-menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onChangePassword();
            }}
          >
            Change password
          </button>

          <button
            type="button"
            className="account-menu-item"
            role="menuitem"
            onClick={() => fileRef.current?.click()}
          >
            {photo ? "Replace company photo" : "Upload company photo"}
          </button>
          {photo ? (
            <button type="button" className="account-menu-item" role="menuitem" onClick={removePhoto}>
              Remove company photo
            </button>
          ) : null}

          <div className="account-menu-divider" />

          <button
            type="button"
            className="account-menu-item account-menu-item-danger"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            Sign out
          </button>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handlePhotoFile}
            style={{ display: "none" }}
          />
        </div>
      ) : null}
    </div>
  );
}
