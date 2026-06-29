import { useEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { downloadDir, join as pathJoin } from "@tauri-apps/api/path";
import { api } from "../lib/tauri";
import type {
  AppSnapshot,
  DraftRecord,
  GrantIngestReport,
  GrantRecord,
  GrantSourceHealthRecord,
  GrantSourceSyncOutcome,
  LocalConfig,
  OrganizationRecord,
  SetupValidation,
  WorkspaceInviteRecord,
  WatchlistEntry,
} from "../lib/types";
import {
  classifyAppError,
  EMPTY_SETUP,
  normalizeDraftRecords,
  normalizeGrantRecords,
  normalizeOrganization,
  normalizeWatchlistEntries,
  parsePrograms,
  serializePrograms,
  exportDraftFileName,
  grantStatusLabel,
  type DiscoveryFilters,
  type SetupForm,
} from "../lib/shell";
import { createWorkspaceLocation, type WorkspaceLocation, type Surface } from "./useNavigation";
import { useAutosave } from "./useAutosave";
import type { Dispatch, SetStateAction } from "react";

function syncSetupFormFromState(current: SetupForm, nextConfig: LocalConfig, organizationName?: string | null): SetupForm {
  const configWorkspaceCode = nextConfig.organization_uid ?? "";
  const nextWorkspaceCode =
    current.mode === "sign_in"
      ? configWorkspaceCode || current.workspace_code
      : current.workspace_code === configWorkspaceCode
        ? ""
        : current.workspace_code;

  return {
    ...current,
    organization_name:
      current.remember_organization_name && organizationName?.trim()
        ? organizationName
        : current.organization_name,
    workspace_code: nextWorkspaceCode,
    invite_token: current.invite_token,
  };
}

function loadSetupFormDraft(): SetupForm {
  if (typeof window === "undefined") {
    return EMPTY_SETUP;
  }

  const raw = window.localStorage.getItem("grant-keeper-setup-form");
  if (!raw) {
    return EMPTY_SETUP;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return EMPTY_SETUP;
    }
    return {
      ...EMPTY_SETUP,
      mode:
        parsed.mode === "sign_in" || parsed.mode === "join_workspace" || parsed.mode === "create_account"
          ? parsed.mode
          : "create_account",
      organization_name: typeof parsed.organization_name === "string" ? parsed.organization_name : "",
      remember_organization_name:
        typeof parsed.remember_organization_name === "boolean" ? parsed.remember_organization_name : true,
      workspace_code: typeof parsed.workspace_code === "string" ? parsed.workspace_code : "",
      invite_token: typeof parsed.invite_token === "string" ? parsed.invite_token : "",
      email: typeof parsed.email === "string" ? parsed.email : "",
      remember_email: typeof parsed.remember_email === "boolean" ? parsed.remember_email : true,
      password:
        typeof parsed.remember_password === "boolean" && parsed.remember_password && typeof parsed.password === "string"
          ? parsed.password
          : "",
      remember_password: typeof parsed.remember_password === "boolean" ? parsed.remember_password : false,
    };
  } catch {
    return EMPTY_SETUP;
  }
}

function serializeSetupFormDraft(form: SetupForm) {
  return JSON.stringify({
    mode: form.mode,
    organization_name: form.remember_organization_name ? form.organization_name : "",
    remember_organization_name: form.remember_organization_name,
    workspace_code: form.workspace_code,
    invite_token: form.invite_token,
    email: form.remember_email ? form.email : "",
    remember_email: form.remember_email,
    password: form.remember_password ? form.password : "",
    remember_password: form.remember_password,
  });
}

function serializeOrganizationDraft(form: OrganizationRecord, programsText: string) {
  return JSON.stringify({
    ...form,
    programsText,
  });
}

function buildWatchlistNote(portalId: string, grant?: GrantRecord) {
  if (!grant) {
    return `Saved grant ${portalId}`;
  }
  const pieces = [
    grant.title,
    grant.agency_dept,
    grant.source_name ?? grant.source_id,
    grantStatusLabel(grant),
    grant.application_deadline ?? grant.open_date,
    grant.est_amounts ?? grant.est_avail_funds,
    grant.categories.length ? grant.categories.slice(0, 3).join(", ") : null,
  ]
    .filter((value): value is string => Boolean(value && value.trim().length > 0))
    .slice(0, 6);
  return pieces.join(" | ") || `Saved grant ${portalId}`;
}

type WorkspaceCacheEntry = {
  snapshot: AppSnapshot;
  config: LocalConfig;
  setupValidation: SetupValidation;
  grants: GrantRecord[];
  watchlist: WatchlistEntry[];
  organization: OrganizationRecord | null;
  drafts: DraftRecord[];
  selectedGrant: GrantRecord | null;
  selectedDraft: DraftRecord | null;
  sourceHealth: GrantSourceHealthRecord[];
  syncOutcomes: GrantSourceSyncOutcome[] | null;
  healthCheckedAt: string | null;
  updatedAt: number;
};

const WORKSPACE_CACHE_TTL_MS = 30_000;

function workspaceCacheKey(surface: Surface, orgUid: string | null) {
  return `${surface}:${orgUid ?? "none"}`;
}

function isWorkspaceCacheFresh(entry: WorkspaceCacheEntry) {
  return Date.now() - entry.updatedAt <= WORKSPACE_CACHE_TTL_MS;
}

function hydrateWorkspaceCacheEntry(
  entry: WorkspaceCacheEntry,
  setState: {
    setSnapshot: Dispatch<SetStateAction<AppSnapshot | null>>;
    setConfig: Dispatch<SetStateAction<LocalConfig | null>>;
    setSetupValidation: Dispatch<SetStateAction<SetupValidation | null>>;
    setGrants: Dispatch<SetStateAction<GrantRecord[]>>;
    setWatchlist: Dispatch<SetStateAction<WatchlistEntry[]>>;
    setOrganization: Dispatch<SetStateAction<OrganizationRecord | null>>;
    setOrganizationForm: Dispatch<SetStateAction<OrganizationRecord | null>>;
    setProgramsText: Dispatch<SetStateAction<string>>;
    setAiSettingsDraft: Dispatch<
      SetStateAction<{ anthropicApiKey: string; draftPreference: "local_scaffold" | "ai" }>
    >;
    setDrafts: Dispatch<SetStateAction<DraftRecord[]>>;
    setSelectedGrant: Dispatch<SetStateAction<GrantRecord | null>>;
    setSelectedDraft: Dispatch<SetStateAction<DraftRecord | null>>;
    setSourceHealth: Dispatch<SetStateAction<GrantSourceHealthRecord[]>>;
    setSyncOutcomes: Dispatch<SetStateAction<GrantSourceSyncOutcome[] | null>>;
    setHealthCheckedAt: Dispatch<SetStateAction<string | null>>;
    setSetupForm: Dispatch<SetStateAction<SetupForm>>;
  }) {
  setState.setSnapshot(entry.snapshot);
  setState.setConfig(entry.config);
  setState.setSetupValidation(entry.setupValidation);
  setState.setGrants(entry.grants);
  setState.setWatchlist(entry.watchlist);
  setState.setOrganization(entry.organization);
  setState.setOrganizationForm(entry.organization);
  setState.setProgramsText(serializePrograms(entry.organization?.programs));
  setState.setAiSettingsDraft({
    anthropicApiKey: entry.config.anthropic_api_key ?? "",
    draftPreference: entry.config.draft_generation_preference ?? "local_scaffold",
  });
  setState.setDrafts(entry.drafts);
  setState.setSelectedGrant(entry.selectedGrant);
  setState.setSelectedDraft(entry.selectedDraft);
  setState.setSourceHealth(entry.sourceHealth);
  setState.setSyncOutcomes(entry.syncOutcomes);
  setState.setHealthCheckedAt(entry.healthCheckedAt);
  setState.setSetupForm((current) => syncSetupFormFromState(current, entry.config, entry.organization?.name));
}

export type WorkspaceDataResult = {
  snapshot: AppSnapshot | null;
  config: LocalConfig | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  recoveryTitle: string | null;
  recoveryAction: "sign_in" | "retry" | null;
  grants: GrantRecord[];
  watchlist: WatchlistEntry[];
  organization: OrganizationRecord | null;
  organizationForm: OrganizationRecord | null;
  programsText: string;
  drafts: DraftRecord[];
  setupForm: SetupForm;
  setupValidation: SetupValidation | null;
  discoveryFilters: DiscoveryFilters;
  selectedGrant: GrantRecord | null;
  selectedDraft: DraftRecord | null;
  grantsByPortalId: Map<string, GrantRecord>;
  watchlistedPortalIds: Set<string>;
  syncReport: GrantIngestReport | null;
  sourceHealth: GrantSourceHealthRecord[];
  syncOutcomes: GrantSourceSyncOutcome[] | null;
  healthCheckedAt: string | null;
  setupAutosaveStatus: "idle" | "saving" | "saved" | "error";
  setupAutosavedAt: string | null;
  setupSupportStatus: "idle" | "saving" | "saved" | "error";
  setupSupportMessage: string | null;
  googleAuthStatus: "idle" | "saving" | "saved" | "error" | "needs_link";
  googleLinkEmail: string | null;
  organizationAutosaveStatus: "idle" | "saving" | "saved" | "error";
  organizationAutosavedAt: string | null;
  workspaceInvite: WorkspaceInviteRecord | null;
  workspaceInviteStatus: "idle" | "saving" | "saved" | "error";
  workspaceInviteMessage: string | null;
  aiSettingsDraft: { anthropicApiKey: string; draftPreference: "local_scaffold" | "ai" };
  aiSettingsStatus: "idle" | "validating" | "saving" | "saved" | "error";
  aiSettingsMessage: string | null;
  setSetupForm: Dispatch<SetStateAction<SetupForm>>;
  setDiscoveryFilters: Dispatch<SetStateAction<DiscoveryFilters>>;
  setOrganizationForm: Dispatch<SetStateAction<OrganizationRecord | null>>;
  setProgramsText: Dispatch<SetStateAction<string>>;
  setAiSettingsDraft: Dispatch<
    SetStateAction<{ anthropicApiKey: string; draftPreference: "local_scaffold" | "ai" }>
  >;
  setSelectedGrant: Dispatch<SetStateAction<GrantRecord | null>>;
  setSelectedDraft: Dispatch<SetStateAction<DraftRecord | null>>;
  saveSetup: () => Promise<void>;
  saveSetupWithGoogle: () => Promise<void>;
  completeGoogleLink: (password: string) => Promise<void>;
  requestPasswordReset: () => Promise<void>;
  useDevProfile: () => Promise<void>;
  clearSessionAndReload: () => Promise<void>;
  clearError: () => void;
  recoverFromError: () => Promise<void>;
  refreshCurrentSurface: () => Promise<void>;
  refreshLiveFeeds: () => Promise<void>;
  openGrantDetail: (grant: Pick<GrantRecord, "portal_id">, nextSurface?: Surface) => Promise<void>;
  toggleWatchlistEntry: (grant: Pick<GrantRecord, "portal_id">) => Promise<void>;
  saveOrganizationProfile: () => Promise<void>;
  createWorkspaceInvite: () => Promise<void>;
  validateAiSettings: () => Promise<void>;
  saveAiSettings: () => Promise<void>;
  generateDraftFromGrant: (grant: Pick<GrantRecord, "portal_id">, nextSurface?: Surface) => Promise<void>;
  refreshSourceHealth: () => Promise<void>;
  syncAllEnabledSources: () => Promise<void>;
  syncSingleSource: (sourceId: string) => Promise<void>;
  selectDraft: (draft: DraftRecord, nextSurface?: Surface) => Promise<void>;
  saveSelectedDraft: (draft: DraftRecord) => Promise<void>;
  autosaveSelectedDraft: (draft: DraftRecord) => Promise<void>;
  exportSelectedDraft: (draft: DraftRecord) => Promise<void>;
  deleteSelectedDraft: (draftId: string) => Promise<void>;
  updateBackgroundRefreshInterval: (intervalMs: number) => Promise<void>;
};

type UseWorkspaceDataOptions = {
  visibleSurface: Surface;
  visibleLocation: WorkspaceLocation;
  navigateWorkspace: (next: WorkspaceLocation, mode?: "push" | "replace") => void;
};

export function useWorkspaceData({
  visibleSurface,
  visibleLocation,
  navigateWorkspace,
}: UseWorkspaceDataOptions): WorkspaceDataResult {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [config, setConfig] = useState<LocalConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryTitle, setRecoveryTitle] = useState<string | null>(null);
  const [recoveryAction, setRecoveryAction] = useState<"sign_in" | "retry" | null>(null);
  const [grants, setGrants] = useState<GrantRecord[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [organization, setOrganization] = useState<OrganizationRecord | null>(null);
  const [organizationForm, setOrganizationForm] = useState<OrganizationRecord | null>(null);
  const [programsText, setProgramsText] = useState("");
  const [workspaceInvite, setWorkspaceInvite] = useState<WorkspaceInviteRecord | null>(null);
  const [workspaceInviteStatus, setWorkspaceInviteStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [workspaceInviteMessage, setWorkspaceInviteMessage] = useState<string | null>(null);
  const [aiSettingsDraft, setAiSettingsDraft] = useState<{
    anthropicApiKey: string;
    draftPreference: "local_scaffold" | "ai";
  }>({
    anthropicApiKey: "",
    draftPreference: "local_scaffold",
  });
  const [aiSettingsStatus, setAiSettingsStatus] = useState<"idle" | "validating" | "saving" | "saved" | "error">("idle");
  const [aiSettingsMessage, setAiSettingsMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [setupForm, setSetupForm] = useState<SetupForm>(() => loadSetupFormDraft());
  const [setupValidation, setSetupValidation] = useState<SetupValidation | null>(null);
  const [setupSupportStatus, setSetupSupportStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [setupSupportMessage, setSetupSupportMessage] = useState<string | null>(null);
  const [googleAuthStatus, setGoogleAuthStatus] = useState<"idle" | "saving" | "saved" | "error" | "needs_link">("idle");
  const [googleLinkEmail, setGoogleLinkEmail] = useState<string | null>(null);
  const [discoveryFilters, setDiscoveryFilters] = useState<DiscoveryFilters>({
    query: "",
    status: "open",
    sourceKind: "all",
    jurisdiction: "all",
    sortBy: "recommended",
    sourceFamily: "all",
    categories: [],
    minAmount: "",
    maxAmount: "",
    deadlineWindow: "any",
    loiRequired: "any",
    matchingFunds: "any",
    onlyWatchlisted: false,
  });
  const [selectedGrant, setSelectedGrant] = useState<GrantRecord | null>(null);
  const [selectedDraft, setSelectedDraft] = useState<DraftRecord | null>(null);
  const [syncReport, setSyncReport] = useState<GrantIngestReport | null>(null);
  const [sourceHealth, setSourceHealth] = useState<GrantSourceHealthRecord[]>([]);
  const [syncOutcomes, setSyncOutcomes] = useState<GrantSourceSyncOutcome[] | null>(null);
  const [healthCheckedAt, setHealthCheckedAt] = useState<string | null>(null);

  async function handleWorkspaceError(err: unknown, options?: { fallbackToSetup?: boolean }) {
    const recovery = classifyAppError(err);
    setError(recovery.message);
    setRecoveryTitle(recovery.title);
    if (recovery.kind === "reauth") {
      try {
        await api.clearSession();
      } catch {
        // best effort session cleanup before routing to setup
      }
      setRecoveryAction("sign_in");
      if (options?.fallbackToSetup ?? true) {
        await loadBootstrapState(createWorkspaceLocation("setup"));
      }
      return;
    }
    setRecoveryAction(recovery.kind === "service_outage" ? "retry" : null);
  }

  function clearError() {
    setError(null);
    setRecoveryTitle(null);
    setRecoveryAction(null);
  }
  const workspaceCacheRef = useRef(new Map<string, WorkspaceCacheEntry>());
  const refreshCurrentSurfaceRef = useRef(refreshCurrentSurface);
  const refreshingRef = useRef(refreshing);
  const handleWorkspaceErrorRef = useRef(handleWorkspaceError);
  const DEFAULT_REFRESH_INTERVAL_MS = 120_000;

  function rememberWorkspaceCache(surface: Surface, orgUidValue: string | null, entry: Omit<WorkspaceCacheEntry, "updatedAt">) {
    workspaceCacheRef.current.set(workspaceCacheKey(surface, orgUidValue), {
      ...entry,
      updatedAt: Date.now(),
    });
  }

  function tryHydrateWorkspaceCache(surface: Surface, orgUidValue: string | null) {
    const entry = workspaceCacheRef.current.get(workspaceCacheKey(surface, orgUidValue));
    if (!entry || !isWorkspaceCacheFresh(entry)) {
      return false;
    }

    hydrateWorkspaceCacheEntry(entry, {
      setSnapshot,
      setConfig,
      setSetupValidation,
      setGrants,
      setWatchlist,
      setOrganization,
      setOrganizationForm,
      setProgramsText,
      setAiSettingsDraft,
      setDrafts,
      setSelectedGrant,
      setSelectedDraft,
      setSourceHealth,
      setSyncOutcomes,
      setHealthCheckedAt,
      setSetupForm,
    });
    return true;
  }

  function updateWorkspaceCache(surface: Surface = visibleSurface, orgUidValue: string | null = orgUid) {
    if (!snapshot || !config || !setupValidation) {
      return;
    }

    rememberWorkspaceCache(surface, orgUidValue, {
      snapshot,
      config,
      setupValidation,
      grants,
      watchlist,
      organization,
      drafts,
      selectedGrant,
      selectedDraft,
      sourceHealth,
      syncOutcomes,
      healthCheckedAt,
    });
  }

  const setupAutosave = useAutosave(
    setupForm,
    serializeSetupFormDraft,
    async (current) => {
      if (typeof window === "undefined") {
        return;
      }
      window.localStorage.setItem("grant-keeper-setup-form", serializeSetupFormDraft(current));
    },
    600,
    `${setupForm.mode}|${setupForm.organization_name}|${setupForm.workspace_code}|${setupForm.email}`,
  );

  const organizationAutosave = useAutosave(
    { form: organizationForm, programsText },
    (value) => (value.form ? serializeOrganizationDraft(value.form, value.programsText) : ""),
    async (value) => {
      if (!value.form) {
        return;
      }
      const nextOrganization: OrganizationRecord = {
        ...value.form,
        programs: parsePrograms(value.programsText),
      };
      const saved = await api.upsertOrganization(nextOrganization);
      setOrganization(saved);
      setOrganizationForm(saved);
      setSetupValidation(await api.validateSetup());
    },
    900,
    organizationForm?.uid ?? "none",
  );

  const setupComplete = Boolean(snapshot?.config.setup_complete);
  const orgUid = snapshot?.organization_uid ?? config?.organization_uid ?? snapshot?.current_org_uid ?? config?.firebase_uid ?? null;
  const visibleGrantPortalId = visibleLocation.grantPortalId;
  const visibleDraftId = visibleLocation.draftId;

  async function loadBootstrapState(nextLocation?: WorkspaceLocation) {
    clearError();
    const [nextSnapshot, nextConfig, nextValidation] = await Promise.all([
      api.getAppSnapshot(),
      api.getLocalConfig(),
      api.validateSetup(),
    ]);

    setSnapshot(nextSnapshot);
    setConfig(nextConfig);
    setSetupValidation(nextValidation);
    setAiSettingsDraft({
      anthropicApiKey: nextConfig.anthropic_api_key ?? "",
      draftPreference: nextConfig.draft_generation_preference ?? "local_scaffold",
    });
    setSetupForm((current) => syncSetupFormFromState(current, nextConfig));

    if (nextValidation.ready) {
      const nextResolvedLocation = nextLocation ?? createWorkspaceLocation("dashboard");
      navigateWorkspace(nextResolvedLocation, "replace");
    } else {
      navigateWorkspace(createWorkspaceLocation("setup"), "replace");
    }

    if (nextSnapshot.session.mode === "dev_profile") {
      const nextHealth = await api.listGrantSourceHealth();
      setSourceHealth(nextHealth);
      setHealthCheckedAt(new Date().toISOString());
      updateWorkspaceCache("dev", orgUid);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const [boot, localConfig, setup] = await Promise.all([
          api.getAppSnapshot(),
          api.getLocalConfig(),
          api.validateSetup(),
        ]);
        if (cancelled) return;
        setSnapshot(boot);
        setConfig(localConfig);
        setSetupValidation(setup);
        setAiSettingsDraft({
          anthropicApiKey: localConfig.anthropic_api_key ?? "",
          draftPreference: localConfig.draft_generation_preference ?? "local_scaffold",
        });
        setSetupForm((current) => syncSetupFormFromState(current, localConfig));
        if (boot.session.signed_in) {
          await api.refreshSession();
        }
        if (!cancelled) {
          await loadBootstrapState();
        }
      } catch (err) {
        if (!cancelled) await handleWorkspaceError(err, { fallbackToSetup: true });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!setupComplete && visibleSurface !== "setup") return;
    let cancelled = false;

    async function loadSurfaceData() {
      try {
        if (tryHydrateWorkspaceCache(visibleSurface, orgUid)) {
          return;
        }
        setRefreshing(true);
        clearError();
        const nextValidation = await api.validateSetup();
        setSetupValidation(nextValidation);
        const [nextSnapshot, nextConfig] = await Promise.all([api.getAppSnapshot(), api.getLocalConfig()]);
        if (!cancelled) {
          setSnapshot(nextSnapshot);
          setConfig(nextConfig);
          setAiSettingsDraft({
            anthropicApiKey: nextConfig.anthropic_api_key ?? "",
            draftPreference: nextConfig.draft_generation_preference ?? "local_scaffold",
          });
          setSetupForm((current) => syncSetupFormFromState(current, nextConfig));
        }

        const nextWorkspaceReady =
          nextSnapshot.startup_state === "ready" || nextSnapshot.startup_state === "dev_profile_ready";
        if (!nextWorkspaceReady && visibleSurface !== "setup") {
          if (!cancelled) {
            navigateWorkspace(createWorkspaceLocation("setup"), "replace");
          }
          return;
        }

        if (visibleSurface === "setup") {
          return;
        }

        if (visibleSurface === "dashboard") {
          const [nextGrants, nextWatchlist, nextDrafts, nextOrganization] = await Promise.all([
            api.listGrants(),
            orgUid ? api.listWatchlist() : Promise.resolve([]),
            orgUid ? api.listDrafts() : Promise.resolve([]),
            orgUid ? api.listOrganization() : Promise.resolve(null),
          ]);
          if (!cancelled) {
            setGrants(normalizeGrantRecords(nextGrants));
            setWatchlist(normalizeWatchlistEntries(nextWatchlist));
            setDrafts(normalizeDraftRecords(nextDrafts));
            const normalizedOrganization = normalizeOrganization(nextOrganization, orgUid);
            setOrganization(normalizedOrganization);
            setOrganizationForm(normalizedOrganization);
            const nextProgramsText = serializePrograms(normalizedOrganization?.programs);
            setProgramsText(nextProgramsText);
            setSetupForm((current) => ({
              ...current,
              organization_name: normalizedOrganization?.name ?? current.organization_name,
              workspace_code: nextConfig.organization_uid ?? current.workspace_code,
            }));
            rememberWorkspaceCache(visibleSurface, orgUid, {
              snapshot: nextSnapshot,
              config: nextConfig,
              setupValidation: nextValidation,
              grants: normalizeGrantRecords(nextGrants),
              watchlist: normalizeWatchlistEntries(nextWatchlist),
              organization: normalizedOrganization,
              drafts: normalizeDraftRecords(nextDrafts),
              selectedGrant,
              selectedDraft,
              sourceHealth,
              syncOutcomes,
              healthCheckedAt,
            });
          }
        } else if (visibleSurface === "discover" || visibleSurface === "watchlist" || visibleSurface === "grant") {
          const [nextGrants, nextWatchlist] = await Promise.all([
            api.listGrants(),
            orgUid ? api.listWatchlist() : Promise.resolve([]),
          ]);
          if (!cancelled) {
            const normalizedGrants = normalizeGrantRecords(nextGrants);
            const normalizedWatchlist = normalizeWatchlistEntries(nextWatchlist);
            setGrants(normalizedGrants);
            setWatchlist(normalizedWatchlist);
            rememberWorkspaceCache(visibleSurface, orgUid, {
              snapshot: nextSnapshot,
              config: nextConfig,
              setupValidation: nextValidation,
              grants: normalizedGrants,
              watchlist: normalizedWatchlist,
              organization,
              drafts,
              selectedGrant,
              selectedDraft,
              sourceHealth,
              syncOutcomes,
              healthCheckedAt,
            });
          }
        } else if (visibleSurface === "organization") {
          const payload = await api.listOrganization();
          if (!cancelled) {
            const nextOrganization = normalizeOrganization(payload, orgUid);
            setOrganization(nextOrganization);
            setOrganizationForm(nextOrganization);
            setProgramsText(serializePrograms(nextOrganization?.programs));
            rememberWorkspaceCache(visibleSurface, orgUid, {
              snapshot: nextSnapshot,
              config: nextConfig,
              setupValidation: nextValidation,
              grants,
              watchlist,
              organization: nextOrganization,
              drafts,
              selectedGrant,
              selectedDraft,
              sourceHealth,
              syncOutcomes,
              healthCheckedAt,
            });
          }
        } else if (visibleSurface === "drafts") {
          const payload = await api.listDrafts();
          if (!cancelled) {
            const nextDrafts = normalizeDraftRecords(payload);
            setDrafts(nextDrafts);
            rememberWorkspaceCache(visibleSurface, orgUid, {
              snapshot: nextSnapshot,
              config: nextConfig,
              setupValidation: nextValidation,
              grants,
              watchlist,
              organization,
              drafts: nextDrafts,
              selectedGrant,
              selectedDraft,
              sourceHealth,
              syncOutcomes,
              healthCheckedAt,
            });
          }
        }
      } catch (err) {
        if (!cancelled) await handleWorkspaceError(err, { fallbackToSetup: visibleSurface !== "setup" });
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    }

    void loadSurfaceData();
    return () => {
      cancelled = true;
    };
  }, [orgUid, setupComplete, visibleSurface]);

  useEffect(() => {
    const grantPortalId = visibleGrantPortalId;
    if (grantPortalId === null) return;
    const safeGrantPortalId: string = grantPortalId;
    let cancelled = false;

    async function loadGrantDetail() {
      try {
        const fullGrant = await api.getGrant(safeGrantPortalId);
        if (!cancelled && fullGrant) {
          setSelectedGrant(fullGrant);
        }
      } catch (err) {
        if (!cancelled) await handleWorkspaceError(err, { fallbackToSetup: false });
      }
    }

    void loadGrantDetail();
    return () => {
      cancelled = true;
    };
  }, [visibleGrantPortalId]);

  useEffect(() => {
    const draftId = visibleDraftId;
    if (draftId === null) return;
    const safeDraftId: string = draftId;
    let cancelled = false;

    async function loadDraftDetail() {
      try {
        const fullDraft = await api.getDraft(safeDraftId);
        if (cancelled) return;
        if (fullDraft) {
          setSelectedDraft(fullDraft);
          if (fullDraft.grant_portal_id) {
            const linkedGrantId: string = fullDraft.grant_portal_id;
            const linkedGrant = await api.getGrant(linkedGrantId);
            if (!cancelled && linkedGrant) {
              setSelectedGrant(linkedGrant);
            }
          }
        }
      } catch (err) {
        if (!cancelled) await handleWorkspaceError(err, { fallbackToSetup: false });
      }
    }

    void loadDraftDetail();
    return () => {
      cancelled = true;
    };
  }, [visibleDraftId]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [visibleSurface, selectedGrant?.portal_id, selectedDraft?.draft_id]);

  async function useDevProfile() {
    try {
      setRefreshing(true);
      clearError();
      await api.startDevProfile();
      await loadBootstrapState(createWorkspaceLocation("dashboard"));
    } catch (err) {
      await handleWorkspaceError(err, { fallbackToSetup: false });
    } finally {
      setRefreshing(false);
    }
  }

  async function saveSetup() {
    try {
      setRefreshing(true);
      clearError();
      setSetupSupportStatus("idle");
      setSetupSupportMessage(null);

      if (!setupForm.email.trim()) {
        throw new Error("Enter a work email before continuing.");
      }
      if (!setupForm.password.trim()) {
        throw new Error("Enter a password before continuing.");
      }

      if (setupForm.mode === "create_account") {
        if (!setupForm.organization_name.trim()) {
          throw new Error("Enter an organization name before continuing.");
        }
        await api.createWorkspaceAccount({
          email: setupForm.email.trim(),
          password: setupForm.password,
          organization_name: setupForm.organization_name.trim(),
          workspace_code: setupForm.workspace_code.trim() || null,
        });
      } else if (setupForm.mode === "sign_in") {
        if (!setupForm.workspace_code.trim()) {
          throw new Error("Enter a workspace code before continuing.");
        }
        await api.signInToWorkspace({
          email: setupForm.email.trim(),
          password: setupForm.password,
          workspace_code: setupForm.workspace_code.trim(),
        });
      } else {
        if (!setupForm.invite_token.trim()) {
          throw new Error("Enter an invite token before continuing.");
        }
        await api.signUpToJoinWorkspace({
          email: setupForm.email.trim(),
          password: setupForm.password,
          invite_token: setupForm.invite_token.trim(),
        });
      }
      const nextConfig = await api.updateLocalConfig({
        setup_complete: true,
      });
      setConfig(nextConfig);
      setSetupForm((current) => ({ ...current, password: "" }));
      await loadBootstrapState(createWorkspaceLocation("dashboard"));
    } catch (err) {
      await handleWorkspaceError(err, { fallbackToSetup: false });
    } finally {
      setRefreshing(false);
    }
  }

  async function clearSessionAndReload() {
    try {
      setRefreshing(true);
      clearError();
      await api.clearSession();
      await loadBootstrapState(setupComplete ? createWorkspaceLocation("dashboard") : createWorkspaceLocation("setup"));
    } catch (err) {
      await handleWorkspaceError(err, { fallbackToSetup: true });
    } finally {
      setRefreshing(false);
    }
  }

  async function saveSetupWithGoogle() {
    try {
      setRefreshing(true);
      clearError();
      setSetupSupportStatus("idle");
      setSetupSupportMessage(null);
      setGoogleAuthStatus("saving");

      if (setupForm.mode === "create_account") {
        if (!setupForm.organization_name.trim()) {
          throw new Error("Enter an organization name before continuing.");
        }
        await api.createWorkspaceAccountWithGoogle({
          organization_name: setupForm.organization_name.trim(),
          workspace_code: setupForm.workspace_code.trim() || null,
        });
      } else if (setupForm.mode === "sign_in") {
        await api.signInToWorkspaceWithGoogle({
          workspace_code: setupForm.workspace_code.trim() || null,
        });
      } else {
        if (!setupForm.invite_token.trim()) {
          throw new Error("Enter an invite token before continuing.");
        }
        await api.joinWorkspaceWithGoogle({
          invite_token: setupForm.invite_token.trim(),
        });
      }

      const nextConfig = await api.updateLocalConfig({
        setup_complete: true,
      });
      setConfig(nextConfig);
      setSetupForm((current) => ({ ...current, password: "" }));
      setGoogleAuthStatus("saved");
      await loadBootstrapState(createWorkspaceLocation("dashboard"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("NEEDS_GOOGLE_LINK:")) {
        const email = msg.split("NEEDS_GOOGLE_LINK:")[1]?.trim() ?? "";
        setGoogleLinkEmail(email);
        setGoogleAuthStatus("needs_link");
      } else {
        setGoogleAuthStatus("error");
        await handleWorkspaceError(err, { fallbackToSetup: false });
      }
    } finally {
      setRefreshing(false);
    }
  }

  async function completeGoogleLink(password: string) {
    try {
      setRefreshing(true);
      setGoogleAuthStatus("saving");
      await api.completeGoogleAccountLink(password);
      const nextConfig = await api.updateLocalConfig({ setup_complete: true });
      setConfig(nextConfig);
      setGoogleAuthStatus("saved");
      setGoogleLinkEmail(null);
      await loadBootstrapState(createWorkspaceLocation("dashboard"));
    } catch (err) {
      setGoogleAuthStatus("error");
      setGoogleLinkEmail(null);
      await handleWorkspaceError(err, { fallbackToSetup: false });
    } finally {
      setRefreshing(false);
    }
  }

  async function requestPasswordReset() {
    try {
      clearError();
      setSetupSupportStatus("saving");
      if (!setupForm.email.trim()) {
        throw new Error("Enter the work email first so Grant Keeper knows where to send the reset link.");
      }
      await api.sendPasswordResetEmail(setupForm.email.trim());
      setSetupSupportStatus("saved");
      setSetupSupportMessage(`Password reset email sent to ${setupForm.email.trim()}.`);
    } catch (err) {
      setSetupSupportStatus("error");
      setSetupSupportMessage(classifyAppError(err).message);
    }
  }

  async function recoverFromError() {
    if (recoveryAction === "sign_in") {
      clearError();
      await loadBootstrapState(createWorkspaceLocation("setup"));
      return;
    }
    await refreshCurrentSurface();
  }

  async function refreshCurrentSurface() {
    try {
      setRefreshing(true);
      clearError();
      const [nextSnapshot, nextConfig] = await Promise.all([api.getAppSnapshot(), api.getLocalConfig()]);
      setSnapshot(nextSnapshot);
      setConfig(nextConfig);
      setSetupValidation(await api.validateSetup());
      setSetupForm((current) =>
        syncSetupFormFromState(current, nextConfig, null),
      );
      setAiSettingsDraft({
        anthropicApiKey: nextConfig.anthropic_api_key ?? "",
        draftPreference: nextConfig.draft_generation_preference ?? "local_scaffold",
      });

      if (visibleSurface === "setup") {
        return;
      }

      if (visibleSurface === "dashboard") {
        const [nextGrants, nextWatchlist, nextDrafts, nextOrganization] = await Promise.all([
          api.listGrants(),
          orgUid ? api.listWatchlist() : Promise.resolve([]),
          orgUid ? api.listDrafts() : Promise.resolve([]),
          orgUid ? api.listOrganization() : Promise.resolve(null),
        ]);
        setGrants(normalizeGrantRecords(nextGrants));
        setWatchlist(normalizeWatchlistEntries(nextWatchlist));
        setDrafts(normalizeDraftRecords(nextDrafts));
        const normalizedOrganization = normalizeOrganization(nextOrganization, orgUid);
        setOrganization(normalizedOrganization);
        setOrganizationForm(normalizedOrganization);
        const nextProgramsText = serializePrograms(normalizedOrganization?.programs);
        setProgramsText(nextProgramsText);
        setSetupForm((current) => ({
          ...current,
          organization_name: normalizedOrganization?.name ?? current.organization_name,
          workspace_code: nextConfig.organization_uid ?? current.workspace_code,
        }));
      } else if (visibleSurface === "discover" || visibleSurface === "watchlist" || visibleSurface === "grant") {
        setGrants(normalizeGrantRecords(await api.listGrants()));
        setWatchlist(normalizeWatchlistEntries(orgUid ? await api.listWatchlist() : []));
      } else if (visibleSurface === "organization") {
        const nextOrganization = normalizeOrganization(await api.listOrganization(), orgUid);
        setOrganization(nextOrganization);
        setOrganizationForm(nextOrganization);
        const nextProgramsText = serializePrograms(nextOrganization?.programs);
        setProgramsText(nextProgramsText);
        setSetupForm((current) => syncSetupFormFromState(current, nextConfig, nextOrganization?.name));
      } else if (visibleSurface === "drafts") {
        setDrafts(normalizeDraftRecords(await api.listDrafts()));
      } else if (visibleSurface === "dev") {
        await refreshSourceHealth();
      }

      if (visibleLocation.grantPortalId) {
        const visibleGrantId = visibleLocation.grantPortalId;
        setSelectedGrant((await api.getGrant(visibleGrantId)) ?? selectedGrant);
      }
      if (visibleLocation.draftId) {
        const visibleDraftId = visibleLocation.draftId;
        setSelectedDraft((await api.getDraft(visibleDraftId)) ?? selectedDraft);
      }
      setHealthCheckedAt(new Date().toISOString());
      updateWorkspaceCache();
    } catch (err) {
      await handleWorkspaceError(err, { fallbackToSetup: visibleSurface !== "setup" });
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!setupComplete || visibleSurface === "setup") {
      return;
    }

    let cancelled = false;
    const intervalMs = Math.max(30_000, config?.background_refresh_interval_ms ?? DEFAULT_REFRESH_INTERVAL_MS);

    const tick = async () => {
      if (cancelled || typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      if (refreshingRef.current) {
        return;
      }
      try {
        // Keep the Firebase token warm even when the surface data is cache-fresh, so
        // an idle-but-open window doesn't drift past the 1-hour token lifetime. The
        // backend only hits the network when the token is actually near expiry.
        await api.refreshSession();
        await refreshCurrentSurfaceRef.current();
      } catch (err) {
        // A revoked or expired refresh token can't be recovered silently — route the
        // user to sign-in instead of leaving them staring at stale data. All other
        // background errors still fail closed without surfacing noise.
        if (!cancelled && classifyAppError(err).kind === "reauth") {
          await handleWorkspaceErrorRef.current(err, { fallbackToSetup: true });
        }
      }
    };

    const timer = window.setInterval(() => {
      void tick();
    }, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [setupComplete, visibleSurface, orgUid, config?.background_refresh_interval_ms]);

  async function refreshLiveFeeds() {
    try {
      setRefreshing(true);
      clearError();
      const outcomes = await api.syncEnabledGrantSources(true);
      const [nextSnapshot, nextConfig, nextGrants, nextHealth] = await Promise.all([
        api.getAppSnapshot(),
        api.getLocalConfig(),
        api.listGrants(),
        api.listGrantSourceHealth(),
      ]);
      setSnapshot(nextSnapshot);
      setConfig(nextConfig);
      setGrants(normalizeGrantRecords(nextGrants));
      setSourceHealth(nextHealth);
      setSyncOutcomes(outcomes);
      setHealthCheckedAt(new Date().toISOString());
      updateWorkspaceCache();
      setSyncReport({
        source_id: "batch",
        source_name: "Enabled grant sources",
        source_kind: "webpage",
        source_url: "batch refresh",
        total_rows: nextGrants.length,
        upserted: nextGrants.length,
        closed_missing: 0,
      });
    } catch (err) {
      await handleWorkspaceError(err, { fallbackToSetup: false });
    } finally {
      setRefreshing(false);
    }
  }

  async function openGrantDetail(grant: Pick<GrantRecord, "portal_id">, nextSurface: Surface = "grant") {
    try {
      setRefreshing(true);
      clearError();
      const fullGrant = await api.getGrant(grant.portal_id);
      if (!fullGrant) {
        throw new Error(`grant ${grant.portal_id} not found`);
      }
      setSelectedGrant(fullGrant);
      navigateWorkspace(createWorkspaceLocation(nextSurface, { grantPortalId: fullGrant.portal_id }));
    } catch (err) {
      await handleWorkspaceError(err, { fallbackToSetup: false });
    } finally {
      setRefreshing(false);
    }
  }

  async function toggleWatchlistEntry(grant: Pick<GrantRecord, "portal_id">) {
    try {
      setRefreshing(true);
      clearError();
      const nextNote = buildWatchlistNote(grant.portal_id, grantsByPortalId.get(grant.portal_id));
      if (watchlistedPortalIds.has(grant.portal_id)) {
        await api.deleteWatchlistEntry(grant.portal_id);
      } else {
        await api.upsertWatchlistEntry({
          portal_id: grant.portal_id,
          saved: true,
          note: nextNote,
          updated_at: null,
        });
      }
      setWatchlist(normalizeWatchlistEntries(await api.listWatchlist()));
      updateWorkspaceCache();
    } catch (err) {
      await handleWorkspaceError(err, { fallbackToSetup: false });
    } finally {
      setRefreshing(false);
    }
  }

  async function saveOrganizationProfile() {
    try {
      setRefreshing(true);
      clearError();
      if (!organizationForm) {
        throw new Error("No organization form loaded.");
      }
      const nextOrganization: OrganizationRecord = {
        ...organizationForm,
        programs: parsePrograms(programsText),
      };
      const saved = await api.upsertOrganization(nextOrganization);
      setOrganization(saved);
      setOrganizationForm(saved);
      setProgramsText(serializePrograms(saved.programs));
      setSetupValidation(await api.validateSetup());
      updateWorkspaceCache("organization", orgUid);
      clearError();
    } catch (err) {
      await handleWorkspaceError(err, { fallbackToSetup: false });
    } finally {
      setRefreshing(false);
    }
  }

  async function createWorkspaceInvite() {
    try {
      setWorkspaceInviteStatus("saving");
      setWorkspaceInviteMessage(null);
      const invite = await api.createWorkspaceInvite();
      setWorkspaceInvite(invite);
      setWorkspaceInviteStatus("saved");
      setWorkspaceInviteMessage(`Invite token ready for ${invite.organization_name ?? invite.organization_uid}. This token can be used once.`);
    } catch (err) {
      setWorkspaceInviteStatus("error");
      setWorkspaceInviteMessage(classifyAppError(err).message);
    }
  }

  async function validateAiSettings() {
    const apiKey = aiSettingsDraft.anthropicApiKey.trim();
    if (!apiKey) {
      setAiSettingsStatus("error");
      setAiSettingsMessage("Enter an Anthropic API key before validating.");
      return;
    }

    try {
      setAiSettingsStatus("validating");
      clearError();
      await api.validateAnthropicApiKey(apiKey);
      setAiSettingsStatus("saved");
      setAiSettingsMessage("Anthropic API key validated successfully.");
    } catch (err) {
      setAiSettingsStatus("error");
      setAiSettingsMessage(classifyAppError(err).message);
      await handleWorkspaceError(err, { fallbackToSetup: false });
    }
  }

  async function saveAiSettings() {
    try {
      setAiSettingsStatus("saving");
      clearError();
      const nextConfig = await api.updateLocalConfig({
        // Send the trimmed value (empty string when cleared) rather than null, so the
        // backend can tell "remove the key" apart from "field omitted / unchanged".
        anthropic_api_key: aiSettingsDraft.anthropicApiKey.trim(),
        draft_generation_preference: aiSettingsDraft.draftPreference,
      });
      setConfig(nextConfig);
      setAiSettingsDraft({
        anthropicApiKey: nextConfig.anthropic_api_key ?? "",
        draftPreference: nextConfig.draft_generation_preference ?? "local_scaffold",
      });
      setAiSettingsStatus("saved");
      setAiSettingsMessage(
        nextConfig.anthropic_api_key
          ? "AI drafting settings saved."
          : "AI key removed. Drafts will stay in local scaffold mode unless you add a new key.",
      );
      updateWorkspaceCache("organization", orgUid);
    } catch (err) {
      setAiSettingsStatus("error");
      setAiSettingsMessage(classifyAppError(err).message);
      await handleWorkspaceError(err, { fallbackToSetup: false });
    }
  }

  async function generateDraftFromGrant(grant: Pick<GrantRecord, "portal_id">, nextSurface: Surface = "drafts") {
    try {
      setRefreshing(true);
      clearError();
      const generated = await api.generateDraft(grant.portal_id);
      setSelectedDraft(generated);
      const linkedGrant = await api.getGrant(grant.portal_id);
      if (linkedGrant) {
        setSelectedGrant(linkedGrant);
      }
      setDrafts(normalizeDraftRecords(await api.listDrafts()));
      navigateWorkspace(
        createWorkspaceLocation(nextSurface, {
          draftId: generated.draft_id,
          grantPortalId: grant.portal_id,
        }),
      );
    } catch (err) {
      await handleWorkspaceError(err, { fallbackToSetup: false });
    } finally {
      setRefreshing(false);
    }
  }

  async function refreshSourceHealth() {
    try {
      setRefreshing(true);
      clearError();
      const nextHealth = await api.listGrantSourceHealth();
      setSourceHealth(nextHealth);
      setHealthCheckedAt(new Date().toISOString());
    } catch (err) {
      await handleWorkspaceError(err, { fallbackToSetup: false });
    } finally {
      setRefreshing(false);
    }
  }

  async function updateBackgroundRefreshInterval(intervalMs: number) {
    try {
      clearError();
      const nextConfig = await api.updateLocalConfig({
        background_refresh_interval_ms: intervalMs,
      });
      setConfig(nextConfig);
    } catch (err) {
      await handleWorkspaceError(err, { fallbackToSetup: false });
      throw err;
    }
  }

  async function syncAllEnabledSources() {
    try {
      setRefreshing(true);
      clearError();
      const outcomes = await api.syncEnabledGrantSources(true);
      const [health, nextGrants, nextConfig, nextSnapshot] = await Promise.all([
        api.listGrantSourceHealth(),
        api.listGrants(),
        api.getLocalConfig(),
        api.getAppSnapshot(),
      ]);
      setSyncOutcomes(outcomes);
      setSourceHealth(health);
      setGrants(normalizeGrantRecords(nextGrants));
      setConfig(nextConfig);
      setSnapshot(nextSnapshot);
      setHealthCheckedAt(new Date().toISOString());
    } catch (err) {
      await handleWorkspaceError(err, { fallbackToSetup: false });
    } finally {
      setRefreshing(false);
    }
  }

  async function syncSingleSource(sourceId: string) {
    try {
      setRefreshing(true);
      clearError();
      const report = await api.syncGrantSource(sourceId, true);
      const [health, nextGrants] = await Promise.all([api.listGrantSourceHealth(), api.listGrants()]);
      setSyncOutcomes((current) => [
        {
          source_id: sourceId,
          source_name: report.source_name ?? report.source_id ?? sourceId,
          success: true,
          report,
          error: null,
        },
        ...(current ?? []),
      ]);
      setSourceHealth(health);
      setGrants(normalizeGrantRecords(nextGrants));
      setHealthCheckedAt(new Date().toISOString());
      updateWorkspaceCache();
    } catch (err) {
      await handleWorkspaceError(err, { fallbackToSetup: false });
    } finally {
      setRefreshing(false);
    }
  }

  async function selectDraft(draft: DraftRecord, nextSurface: Surface = "drafts") {
    try {
      setRefreshing(true);
      clearError();
      const fullDraft = await api.getDraft(draft.draft_id);
      const nextDraft = fullDraft ?? draft;
      setSelectedDraft(nextDraft);
      if (nextDraft.grant_portal_id) {
        const linkedGrant = await api.getGrant(nextDraft.grant_portal_id);
        if (linkedGrant) {
          setSelectedGrant(linkedGrant);
        }
      }
      navigateWorkspace(
        createWorkspaceLocation(nextSurface, {
          draftId: nextDraft.draft_id,
          grantPortalId: nextDraft.grant_portal_id || null,
        }),
      );
      updateWorkspaceCache("drafts", orgUid);
    } catch (err) {
      await handleWorkspaceError(err, { fallbackToSetup: false });
    } finally {
      setRefreshing(false);
    }
  }

  async function saveSelectedDraft(draft: DraftRecord) {
    try {
      setRefreshing(true);
      clearError();
      const saved = await api.upsertDraft(draft);
      setSelectedDraft(saved);
      setDrafts(normalizeDraftRecords(await api.listDrafts()));
      updateWorkspaceCache("drafts", orgUid);
    } catch (err) {
      await handleWorkspaceError(err, { fallbackToSetup: false });
    } finally {
      setRefreshing(false);
    }
  }

  async function autosaveSelectedDraft(draft: DraftRecord) {
    try {
      const saved = await api.upsertDraft(draft);
      setSelectedDraft(saved);
      setDrafts((current) => {
        const index = current.findIndex((entry) => entry.draft_id === saved.draft_id);
        if (index === -1) {
          return [saved, ...current];
        }
        const next = current.slice();
        next[index] = saved;
        return next;
      });
      updateWorkspaceCache("drafts", orgUid);
    } catch (err) {
      await handleWorkspaceError(err, { fallbackToSetup: false });
      throw err;
    }
  }

  async function exportSelectedDraft(draft: DraftRecord) {
    try {
      setRefreshing(true);
      clearError();
      let filePath: string | null = null;
      try {
        const defaultDirectory = await downloadDir();
        const defaultPath = await pathJoin(defaultDirectory, exportDraftFileName(draft));
        filePath = await save({
          defaultPath,
          title: "Save draft as",
        });
        if (!filePath) {
          return;
        }
      } catch {
        filePath = null;
      }

      const exportedPath = await api.exportDraft(draft.draft_id, filePath);
      await api.revealPathInFolder(exportedPath);
    } catch (err) {
      await handleWorkspaceError(err, { fallbackToSetup: false });
    } finally {
      setRefreshing(false);
    }
  }

  async function deleteSelectedDraft(draftId: string) {
    try {
      setRefreshing(true);
      clearError();
      await api.deleteDraft(draftId);
      setDrafts(normalizeDraftRecords(await api.listDrafts()));
      setSelectedDraft((current) => (current?.draft_id === draftId ? null : current));
      updateWorkspaceCache("drafts", orgUid);
    } catch (err) {
      await handleWorkspaceError(err, { fallbackToSetup: false });
    } finally {
      setRefreshing(false);
    }
  }

  refreshCurrentSurfaceRef.current = refreshCurrentSurface;
  refreshingRef.current = refreshing;
  handleWorkspaceErrorRef.current = handleWorkspaceError;

  const grantsByPortalId = useMemo(() => new Map(grants.map((grant) => [grant.portal_id, grant])), [grants]);
  const watchlistedPortalIds = useMemo(() => new Set(watchlist.map((entry) => entry.portal_id)), [watchlist]);

  return {
    snapshot,
    config,
    loading,
    refreshing,
    error,
    recoveryTitle,
    recoveryAction,
    grants,
    watchlist,
    organization,
    organizationForm,
    programsText,
    drafts,
    setupForm,
    setupValidation,
    discoveryFilters,
    selectedGrant,
    selectedDraft,
    grantsByPortalId,
    watchlistedPortalIds,
    syncReport,
    sourceHealth,
    syncOutcomes,
    healthCheckedAt,
    setupAutosaveStatus: setupAutosave.status,
    setupAutosavedAt: setupAutosave.savedAt,
    setupSupportStatus,
    setupSupportMessage,
    googleAuthStatus,
    googleLinkEmail,
    organizationAutosaveStatus: organizationAutosave.status,
    organizationAutosavedAt: organizationAutosave.savedAt,
    workspaceInvite,
    workspaceInviteStatus,
    workspaceInviteMessage,
    aiSettingsDraft,
    aiSettingsStatus,
    aiSettingsMessage,
    setSetupForm,
    setDiscoveryFilters,
    setOrganizationForm,
    setProgramsText,
    setAiSettingsDraft,
    setSelectedGrant,
    setSelectedDraft,
    saveSetup,
    saveSetupWithGoogle,
    completeGoogleLink,
    requestPasswordReset,
    useDevProfile,
    clearSessionAndReload,
    clearError,
    recoverFromError,
    refreshCurrentSurface,
    refreshLiveFeeds,
    openGrantDetail,
    toggleWatchlistEntry,
    saveOrganizationProfile,
    createWorkspaceInvite,
    validateAiSettings,
    saveAiSettings,
    generateDraftFromGrant,
    refreshSourceHealth,
    updateBackgroundRefreshInterval,
    syncAllEnabledSources,
    syncSingleSource,
    selectDraft,
    saveSelectedDraft,
    autosaveSelectedDraft,
    exportSelectedDraft,
    deleteSelectedDraft,
  };
}
