import { useEffect, useMemo, useState } from "react";
import type { StartupState } from "../lib/types";

export type Surface = "setup" | "dashboard" | "discover" | "grant" | "watchlist" | "organization" | "drafts" | "dev";

export type WorkspaceLocation = {
  surface: Surface;
  grantPortalId: string | null;
  draftId: string | null;
};

export type WorkspaceNavigationState = {
  past: WorkspaceLocation[];
  current: WorkspaceLocation;
  future: WorkspaceLocation[];
};

const WORKSPACE_NAVIGATION_STORAGE_KEY = "grant-keeper-workspace-navigation";

const DEFAULT_WORKSPACE_LOCATION: WorkspaceLocation = {
  surface: "dashboard",
  grantPortalId: null,
  draftId: null,
};

const NAVIGABLE_SURFACES: Surface[] = ["setup", "dashboard", "discover", "grant", "watchlist", "organization", "drafts", "dev"];

export function createWorkspaceLocation(surface: Surface, overrides?: Partial<WorkspaceLocation>): WorkspaceLocation {
  return {
    surface,
    grantPortalId: overrides?.grantPortalId ?? null,
    draftId: overrides?.draftId ?? null,
  };
}

export function normalizeWorkspaceLocation(value: unknown, fallback = DEFAULT_WORKSPACE_LOCATION): WorkspaceLocation {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const candidate = value as Partial<WorkspaceLocation> & { surface?: unknown };
  const surface = candidate.surface;
  const selectedSurface = typeof surface === "string" && NAVIGABLE_SURFACES.includes(surface as Surface)
    ? (surface as Surface)
    : fallback.surface;

  return {
    surface: selectedSurface,
    grantPortalId:
      typeof candidate.grantPortalId === "string" && candidate.grantPortalId.trim() ? candidate.grantPortalId : null,
    draftId: typeof candidate.draftId === "string" && candidate.draftId.trim() ? candidate.draftId : null,
  };
}

function normalizeWorkspaceNavigationState(value: unknown): WorkspaceNavigationState {
  if (!value || typeof value !== "object") {
    return {
      past: [],
      current: DEFAULT_WORKSPACE_LOCATION,
      future: [],
    };
  }

  const candidate = value as Partial<WorkspaceNavigationState>;
  return {
    past: Array.isArray(candidate.past) ? candidate.past.map((entry) => normalizeWorkspaceLocation(entry)) : [],
    current: normalizeWorkspaceLocation(candidate.current),
    future: Array.isArray(candidate.future) ? candidate.future.map((entry) => normalizeWorkspaceLocation(entry)) : [],
  };
}

function loadWorkspaceNavigationState(): WorkspaceNavigationState {
  if (typeof window === "undefined") {
    return {
      past: [],
      current: DEFAULT_WORKSPACE_LOCATION,
      future: [],
    };
  }

  const raw = window.localStorage.getItem(WORKSPACE_NAVIGATION_STORAGE_KEY);
  if (!raw) {
    return {
      past: [],
      current: DEFAULT_WORKSPACE_LOCATION,
      future: [],
    };
  }

  try {
    return normalizeWorkspaceNavigationState(JSON.parse(raw));
  } catch {
    return {
      past: [],
      current: DEFAULT_WORKSPACE_LOCATION,
      future: [],
    };
  }
}

function resolveVisibleLocation(startupState: StartupState, location: WorkspaceLocation, isDevSession: boolean): WorkspaceLocation {
  const requiresSetup =
    startupState === "needs_workspace" ||
    startupState === "needs_login" ||
    startupState === "needs_membership";

  if (requiresSetup) {
    return createWorkspaceLocation("setup");
  }

  if (location.surface === "setup") {
    return createWorkspaceLocation("dashboard");
  }

  if (location.surface === "dev" && !isDevSession) {
    return createWorkspaceLocation("dashboard");
  }

  return location;
}

function isSameWorkspaceLocation(left: WorkspaceLocation, right: WorkspaceLocation) {
  return left.surface === right.surface && left.grantPortalId === right.grantPortalId && left.draftId === right.draftId;
}

export function useNavigation(startupState: StartupState, isDevSession: boolean) {
  const [nav, setNav] = useState<WorkspaceNavigationState>(() => loadWorkspaceNavigationState());

  const visible = useMemo(() => resolveVisibleLocation(startupState, nav.current, isDevSession), [isDevSession, nav.current, startupState]);
  const canGoBack = nav.past.length > 0 && visible.surface !== "setup";
  const canGoForward = nav.future.length > 0 && visible.surface !== "setup";

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(WORKSPACE_NAVIGATION_STORAGE_KEY, JSON.stringify(nav));
  }, [nav]);

  function navigate(next: WorkspaceLocation, mode: "push" | "replace" = "push") {
    const normalized = normalizeWorkspaceLocation(next);
    setNav((current) => {
      if (mode === "replace") {
        if (isSameWorkspaceLocation(current.current, normalized)) {
          return current;
        }
        return { ...current, current: normalized };
      }

      if (isSameWorkspaceLocation(current.current, normalized)) {
        return current;
      }

      return {
        past: [...current.past, current.current],
        current: normalized,
        future: [],
      };
    });
  }

  function goBack() {
    setNav((current) => {
      if (!current.past.length) {
        return current;
      }
      const previous = current.past[current.past.length - 1];
      return {
        past: current.past.slice(0, -1),
        current: previous,
        future: [current.current, ...current.future],
      };
    });
  }

  function goForward() {
    setNav((current) => {
      if (!current.future.length) {
        return current;
      }
      const [next, ...future] = current.future;
      return {
        past: [...current.past, current.current],
        current: next,
        future,
      };
    });
  }

  return {
    nav,
    visible,
    navigate,
    goBack,
    goForward,
    canGoBack,
    canGoForward,
  };
}
