import type { Dispatch, SetStateAction } from "react";
import { createWorkspaceLocation, type Surface, type WorkspaceLocation } from "../hooks/useNavigation";
import { GrantKeeperLogo } from "./GrantKeeperLogo";

type SidebarSummary = {
  grants: number;
  saved: number;
  drafts: number;
};

type SidebarNavItem = {
  id: Surface;
  label: string;
  icon: () => JSX.Element;
};

const NAV_ITEMS: SidebarNavItem[] = [
  { id: "setup", label: "Setup", icon: SetupIcon },
  { id: "dashboard", label: "Workspace", icon: DashboardIcon },
  { id: "discover", label: "Discover", icon: SearchIcon },
  { id: "watchlist", label: "Watchlist", icon: BookmarkIcon },
  { id: "organization", label: "Org Profile", icon: BuildingIcon },
  { id: "drafts", label: "Drafts", icon: FileTextIcon },
  { id: "dev", label: "Dev Tools", icon: TerminalIcon },
];

export function Sidebar({
  visibleSurface,
  setupLocked,
  showDev,
  navigate,
  summary,
  sessionEmail,
  theme,
  setTheme,
  refreshing,
  onRefreshDatabase,
  onClearSession,
  canClearSession,
  collapsed,
  onToggleCollapse,
}: {
  visibleSurface: Surface;
  setupLocked: boolean;
  showDev: boolean;
  navigate: (next: WorkspaceLocation, mode?: "push" | "replace") => void;
  summary: SidebarSummary;
  sessionEmail: string | null;
  theme: "light" | "dark";
  setTheme: Dispatch<SetStateAction<"light" | "dark">>;
  refreshing: boolean;
  onRefreshDatabase: () => void;
  onClearSession: () => void;
  canClearSession: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const visibleItems = setupLocked ? NAV_ITEMS.filter((surface) => surface.id === "setup") : NAV_ITEMS.filter((surface) => surface.id !== "dev" || showDev);

  return (
    <aside className={collapsed ? "sidebar sidebar-collapsed" : "sidebar"}>
      <div className="sidebar-brand">
        <span className="brand-mark">
          <GrantKeeperLogo size={28} tone="onDark" />
        </span>
        {!collapsed && <span className="brand-name">Grant Keeper</span>}
        <button type="button" className="sidebar-collapse-btn" onClick={onToggleCollapse} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <CollapseIcon collapsed={collapsed} />
        </button>
      </div>

      <nav className="sidebar-nav">
        {visibleItems.map((surface) => (
          <button
            key={surface.id}
            type="button"
            className={surface.id === visibleSurface ? "nav-item active" : "nav-item"}
            onClick={() => navigate(createWorkspaceLocation(surface.id))}
            title={collapsed ? surface.label : undefined}
          >
            <surface.icon />
            {!collapsed && <span>{surface.label}</span>}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        {!collapsed && (
          <>
            <button type="button" className="secondary" onClick={onRefreshDatabase} disabled={refreshing}>
              {refreshing ? "Refreshing..." : "Refresh database"}
            </button>
            <button type="button" className="secondary" onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}>
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
            <button type="button" className="ghost" onClick={onClearSession} disabled={!canClearSession}>
              Sign out
            </button>
            <p className="sidebar-summary">
              {summary.grants} grants · {summary.saved} saved · {summary.drafts} drafts
            </p>
            <p className="sidebar-session">{sessionEmail ?? "No active identity"}</p>
          </>
        )}
        {collapsed && (
          <>
            <button type="button" className="nav-item" onClick={onRefreshDatabase} disabled={refreshing} title="Refresh database">
              <RefreshIcon />
            </button>
            <button type="button" className="nav-item" onClick={() => setTheme((c) => (c === "dark" ? "light" : "dark"))} title={theme === "dark" ? "Light mode" : "Dark mode"}>
              <ThemeIcon dark={theme === "dark"} />
            </button>
            <button type="button" className="nav-item" onClick={onClearSession} disabled={!canClearSession} title="Sign out">
              <SignOutIcon />
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

function SetupIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.75v12.5M1.75 8h12.5M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 2.5h5v4H2zM9 2.5h5v9.5H9zM2 8h5v4H2z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4" />
      <path d="M10.2 10.2 14 14" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.25h8v11.5l-4-2.5-4 2.5z" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 13.75h10M4.25 13.75V3.5h7.5v10.25M6 5.25h1.5M6 8h1.5M6 10.75h1.5M8.5 5.25H10M8.5 8H10M8.5 10.75H10" />
    </svg>
  );
}

function FileTextIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 1.75h5l3 3V14.25H4zM9 1.75v3h3" />
      <path d="M5.5 8h5M5.5 10.25h5M5.5 5.75h1.5" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 3h12v10H2zM4.25 6l2 2-2 2M7.5 10h4.25" />
    </svg>
  );
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" style={{ transform: collapsed ? "rotate(180deg)" : "none", transition: "transform 240ms ease" }}>
      <path d="M10 3L6 8l4 5" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13 8A5 5 0 1 1 8 3h3M11 1v4H7" />
    </svg>
  );
}

function ThemeIcon({ dark }: { dark: boolean }) {
  return dark ? (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="3.5" />
      <path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.6 3.6l.7.7M11.7 11.7l.7.7M11.7 3.6l-.7.7M4.3 11.7l-.7.7" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M11 8.5A4.5 4.5 0 0 1 5.5 4a4.5 4.5 0 1 0 5.5 4.5z" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 2.5H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3M10.5 11l3-3-3-3M13.5 8H6" />
    </svg>
  );
}
