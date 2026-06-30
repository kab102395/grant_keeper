import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { DashboardPage } from "./pages/DashboardPage";
import { DraftsPage } from "./pages/DraftsPage";
import { GrantDetailPage } from "./pages/GrantDetailPage";
import { GrantDiscoveryPage } from "./pages/GrantDiscoveryPage";
import { DevToolsPage } from "./pages/DevToolsPage";
import { FirstRunPrompt } from "./components/FirstRunPrompt";
import { OrganizationPage } from "./pages/OrganizationPage";
import { Sidebar } from "./components/Sidebar";
import { HelpDrawer } from "./components/HelpDrawer";
import { EmberLogo } from "./components/EmberLogo";
import { AccountMenu } from "./components/AccountMenu";
import { SetupPage } from "./pages/SetupPage";
import { WatchlistPage } from "./pages/WatchlistPage";
import { surfaceTitle } from "./lib/shell";
import type { StartupState } from "./lib/types";
import { useNavigation, createWorkspaceLocation } from "./hooks/useNavigation";
import { useWorkspaceData } from "./hooks/useWorkspaceData";

function PageHeader({
  title,
  onBack,
  canGoBack,
  onForward,
  canGoForward,
  children,
}: {
  title: string;
  onBack: () => void;
  canGoBack: boolean;
  onForward: () => void;
  canGoForward: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div className="page-header-left">
        <div className="page-nav-btns">
          <button
            type="button"
            className="page-nav-btn"
            onClick={onBack}
            disabled={!canGoBack}
            title="Go back"
            aria-label="Go back"
          >
            <NavBackIcon />
          </button>
          <button
            type="button"
            className="page-nav-btn"
            onClick={onForward}
            disabled={!canGoForward}
            title="Go forward"
            aria-label="Go forward"
          >
            <NavForwardIcon />
          </button>
        </div>
        <h1 className="page-header-title">{title}</h1>
      </div>
      {children ? <div className="page-header-actions">{children}</div> : null}
    </div>
  );
}

function NavBackIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" style={{ width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
      <path d="M10 3L5 8l5 5" />
    </svg>
  );
}

function NavForwardIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" style={{ width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
      <path d="M6 3l5 5-5 5" />
    </svg>
  );
}


export default function App() {
  const [startupState, setStartupState] = useState<StartupState>("needs_workspace");
  const [isDevSession, setIsDevSession] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") {
      return "light";
    }
    const stored = window.localStorage.getItem("grant-keeper-theme");
    if (stored === "light" || stored === "dark") {
      return stored;
    }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("grant-keeper-theme", theme);
  }, [theme]);

  const navState = useNavigation(startupState, isDevSession);
  const data = useWorkspaceData({
    visibleSurface: navState.visible.surface,
    visibleLocation: navState.visible,
    navigateWorkspace: navState.navigate,
  });

  const setupComplete = Boolean(data.snapshot?.config.setup_complete);

  useEffect(() => {
    if (!data.snapshot) {
      return;
    }
    setStartupState(data.snapshot.startup_state);
    setIsDevSession(data.snapshot.session.mode === "dev_profile");
  }, [data.snapshot]);

  const summary = useMemo(
    () => ({
      grants: data.grants.length,
      saved: data.watchlist.length,
      drafts: data.drafts.length,
    }),
    [data.drafts.length, data.grants.length, data.watchlist.length],
  );

  const pageTitle = navState.visible.surface === "grant" ? "Grant detail" : surfaceTitle(navState.visible.surface);
  const firstRunStorageKey = useMemo(() => {
    const orgKey = data.snapshot?.organization_uid ?? data.snapshot?.current_org_uid ?? data.config?.organization_uid ?? "workspace";
    return `grant-keeper-first-run-dismissed:${orgKey}`;
  }, [data.config?.organization_uid, data.snapshot?.current_org_uid, data.snapshot?.organization_uid]);
  const [firstRunDismissed, setFirstRunDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setFirstRunDismissed(window.localStorage.getItem(firstRunStorageKey) === "1");
  }, [firstRunStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (data.watchlist.length > 0 || data.drafts.length > 0) {
      window.localStorage.setItem(firstRunStorageKey, "1");
      setFirstRunDismissed(true);
    }
  }, [data.drafts.length, data.watchlist.length, firstRunStorageKey]);

  const showFirstRunPrompt =
    navState.visible.surface === "dashboard" &&
    setupComplete &&
    data.grants.length > 0 &&
    data.watchlist.length === 0 &&
    data.drafts.length === 0 &&
    !firstRunDismissed;

  const canSubmitSetup =
    Boolean(data.setupForm.email.trim() && data.setupForm.password.trim()) &&
    (data.setupForm.mode === "create_account"
      ? Boolean(data.setupForm.organization_name.trim())
      : data.setupForm.mode === "sign_in"
        ? Boolean(data.setupForm.workspace_code.trim())
        : Boolean(data.setupForm.invite_token.trim()));
  const canSubmitGoogleSetup =
    data.setupForm.mode === "create_account"
      ? Boolean(data.setupForm.organization_name.trim())
      : data.setupForm.mode === "sign_in"
        ? true
        : Boolean(data.setupForm.invite_token.trim());
  const aiSettingsRequired =
    data.config?.draft_generation_preference === "ai" &&
    !data.config?.anthropic_api_key?.trim();
  const openAiSettings = () => navState.navigate(createWorkspaceLocation("organization"));

  useEffect(() => {
    if (!data.snapshot) {
      return;
    }

    const nextSetupRequired =
      data.snapshot.startup_state === "needs_workspace" ||
      data.snapshot.startup_state === "needs_login" ||
      data.snapshot.startup_state === "needs_membership" ||
      !data.snapshot.config.setup_complete;
    const nextIsDevSession = data.snapshot.session.mode === "dev_profile";
    const nextSurface = nextSetupRequired ? "setup" : navState.visible.surface === "setup" ? "dashboard" : navState.visible.surface;
    const nextVisibleSurface = nextSurface === "dev" && !nextIsDevSession ? "dashboard" : nextSurface;

    if (nextVisibleSurface !== navState.visible.surface) {
      navState.navigate(createWorkspaceLocation(nextVisibleSurface), "replace");
    }
  }, [data.snapshot, navState]);

  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-width", sidebarCollapsed ? "56px" : "220px");
  }, [sidebarCollapsed]);

  const body = data.loading ? (
    <div className="loading-panel">
      <div className="spinner" />
      <p>Loading Grant Keeper shell...</p>
    </div>
  ) : (
    <>
      <Sidebar
        visibleSurface={navState.visible.surface}
        setupLocked={!setupComplete}
        showDev={isDevSession && data.snapshot?.session.mode !== "firebase"}
        navigate={navState.navigate}
        summary={summary}
        sessionEmail={data.snapshot?.session.email ?? null}
        theme={theme}
        setTheme={setTheme}
        refreshing={data.refreshing}
        onRefreshDatabase={() => void data.refreshCurrentSurface()}
        onClearSession={() => void data.clearSessionAndReload()}
        canClearSession={Boolean(data.snapshot?.session.signed_in)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
      />

      <section className="main-pane">
        <PageHeader
          title={pageTitle}
          onBack={navState.goBack}
          canGoBack={navState.canGoBack}
          onForward={navState.goForward}
          canGoForward={navState.canGoForward}
        >
          <>
            {data.snapshot?.session.signed_in ? (
              <AccountMenu
                email={data.snapshot?.session.email ?? null}
                companyName={data.organization?.name ?? null}
                onChangePassword={() => navState.navigate(createWorkspaceLocation("organization"))}
                onSignOut={() => void data.clearSessionAndReload()}
              />
            ) : null}
            <button
              type="button"
              className="help-trigger-btn"
              onClick={() => setHelpOpen((o) => !o)}
              aria-label="Open help"
              title="Help"
            >
              ?
            </button>
          </>
        </PageHeader>

        {data.error ? (
          <div className="error-banner main-error-banner">
            <div>
              {data.recoveryTitle ? <strong>{data.recoveryTitle}</strong> : null}
              <p>{data.error}</p>
            </div>
            <div className="banner-actions">
              {data.recoveryAction ? (
                <button type="button" className="secondary" onClick={() => void data.recoverFromError()}>
                  {data.recoveryAction === "sign_in" ? "Go to sign in" : "Retry"}
                </button>
              ) : null}
              <button type="button" className="ghost" onClick={data.clearError}>
                Dismiss
              </button>
            </div>
          </div>
        ) : null}

        <div className={navState.visible.surface === "drafts" ? "page-body page-body-flush" : "page-body"}>
          {navState.visible.surface === "grant" ? (
            <GrantDetailPage
              grant={data.selectedGrant}
              config={data.config}
              watchlistedPortalIds={data.watchlistedPortalIds}
              onBack={navState.goBack}
              onToggleWatchlist={data.toggleWatchlistEntry}
              onCreateDraft={data.generateDraftFromGrant}
              aiSettingsRequired={Boolean(aiSettingsRequired)}
              onOpenAiSettings={openAiSettings}
              canWriteOrg={Boolean(data.snapshot?.session.signed_in && data.snapshot?.organization_uid)}
              writeDisabledReason="Open a workspace session to save watchlist entries or generate drafts."
            />
          ) : null}

          {navState.visible.surface === "setup" ? (
            <SetupPage
              setupForm={data.setupForm}
              setSetupForm={data.setSetupForm}
              saveSetup={data.saveSetup}
              saveSetupWithGoogle={data.saveSetupWithGoogle}
              completeGoogleLink={data.completeGoogleLink}
              requestPasswordReset={data.requestPasswordReset}
              useDevProfile={data.useDevProfile}
              canSaveSetup={canSubmitSetup}
              canSaveSetupWithGoogle={canSubmitGoogleSetup}
              canStartDevProfile={true}
              autosaveStatus={data.setupAutosaveStatus}
              autosaveAt={data.setupAutosavedAt}
              googleSignInEnabled={Boolean(data.config?.google_oauth_client_id?.trim())}
              googleAuthStatus={data.googleAuthStatus}
              googleLinkEmail={data.googleLinkEmail}
              setupSupportStatus={data.setupSupportStatus}
              setupSupportMessage={data.setupSupportMessage}
            />
          ) : null}

          {navState.visible.surface === "dashboard" ? (
            showFirstRunPrompt ? (
              <FirstRunPrompt
                organization={data.organization}
                hasWatchlist={data.watchlist.length > 0}
                hasDrafts={data.drafts.length > 0}
                aiSettingsRequired={Boolean(aiSettingsRequired)}
                onNavigate={(surface) => navState.navigate(createWorkspaceLocation(surface))}
                onOpenAiSettings={openAiSettings}
              />
            ) : (
              <DashboardPage
              snapshot={data.snapshot}
              config={data.config}
              organization={data.organization}
              syncReport={data.syncReport}
              onRefreshDatabase={data.refreshCurrentSurface}
              onRefreshLiveFeeds={data.refreshLiveFeeds}
              isDevSession={isDevSession}
              grantCount={summary.grants}
              watchlistCount={summary.saved}
                draftCount={summary.drafts}
                selectedGrant={data.selectedGrant}
                selectedDraft={data.selectedDraft}
                aiSettingsRequired={Boolean(aiSettingsRequired)}
                onOpenSurface={(surface, overrides) => navState.navigate(createWorkspaceLocation(surface, overrides))}
                onOpenAiSettings={openAiSettings}
              />
            )
          ) : null}

          {navState.visible.surface === "discover" ? (
            <GrantDiscoveryPage
              grants={data.grants}
              watchlistedPortalIds={data.watchlistedPortalIds}
              discoveryFilters={data.discoveryFilters}
              setDiscoveryFilters={data.setDiscoveryFilters}
              selectedGrant={data.selectedGrant}
              config={data.config}
              onSelectGrant={(grant) => data.openGrantDetail(grant, "grant")}
              onToggleWatchlist={data.toggleWatchlistEntry}
              onCreateDraft={data.generateDraftFromGrant}
              aiSettingsRequired={Boolean(aiSettingsRequired)}
              onOpenAiSettings={openAiSettings}
              canWriteOrg={Boolean(data.snapshot?.session.signed_in && data.snapshot?.organization_uid)}
              writeDisabledReason="Open a workspace session to save watchlist entries or generate drafts."
            />
          ) : null}

          {navState.visible.surface === "watchlist" ? (
            <WatchlistPage
              watchlist={data.watchlist}
              grantsByPortalId={data.grantsByPortalId}
              config={data.config}
              onRemove={data.toggleWatchlistEntry}
              onViewGrant={(portalId) => data.openGrantDetail({ portal_id: portalId }, "grant")}
              onCreateDraft={data.generateDraftFromGrant}
              aiSettingsRequired={Boolean(aiSettingsRequired)}
              onOpenAiSettings={openAiSettings}
              canWriteOrg={Boolean(data.snapshot?.session.signed_in && data.snapshot?.organization_uid)}
              writeDisabledReason="Open a workspace session to save watchlist entries or generate drafts."
            />
          ) : null}

          {navState.visible.surface === "organization" ? (
            <OrganizationPage
              organization={data.organization}
              organizationForm={data.organizationForm}
              setOrganizationForm={data.setOrganizationForm}
              programsText={data.programsText}
              setProgramsText={data.setProgramsText}
              orgUid={data.snapshot?.organization_uid ?? data.config?.organization_uid ?? data.snapshot?.current_org_uid ?? null}
              config={data.config}
              onSave={data.saveOrganizationProfile}
              onCreateWorkspaceInvite={data.createWorkspaceInvite}
              workspaceInvite={data.workspaceInvite}
              workspaceInviteStatus={data.workspaceInviteStatus}
              workspaceInviteMessage={data.workspaceInviteMessage}
              aiSettingsDraft={data.aiSettingsDraft}
              setAiSettingsDraft={data.setAiSettingsDraft}
              onValidateAiSettings={data.validateAiSettings}
              onSaveAiSettings={data.saveAiSettings}
              aiSettingsStatus={data.aiSettingsStatus}
              aiSettingsMessage={data.aiSettingsMessage}
              autosaveStatus={data.organizationAutosaveStatus}
              autosaveAt={data.organizationAutosavedAt}
              onChangePassword={data.changePassword}
              passwordChangeStatus={data.passwordChangeStatus}
              passwordChangeMessage={data.passwordChangeMessage}
              passwordChangeAvailable={data.snapshot?.session.mode === "firebase"}
            />
          ) : null}

          {navState.visible.surface === "drafts" ? (
              <DraftsPage
                drafts={data.drafts}
                selectedDraft={data.selectedDraft}
                setSelectedDraft={data.setSelectedDraft}
                selectedGrant={data.selectedGrant}
                config={data.config}
                onSelectDraft={data.selectDraft}
                onOpenGrant={(portalId) => data.openGrantDetail({ portal_id: portalId }, "grant")}
                onSaveDraft={data.saveSelectedDraft}
              onAutosaveDraft={data.autosaveSelectedDraft}
              onExportDraft={data.exportSelectedDraft}
              onDeleteDraft={data.deleteSelectedDraft}
            />
          ) : null}

          {navState.visible.surface === "dev" ? (
            <DevToolsPage
              snapshot={data.snapshot}
              config={data.config}
              setupValidation={data.setupValidation}
              sourceHealth={data.sourceHealth}
              syncOutcomes={data.syncOutcomes}
              lastCheckedAt={data.healthCheckedAt}
              onRefreshHealth={data.refreshSourceHealth}
              onSyncAll={data.syncAllEnabledSources}
              onSyncSource={data.syncSingleSource}
              onUpdateRefreshInterval={data.updateBackgroundRefreshInterval}
            />
          ) : null}
        </div>

        <footer className="app-footer">
          <EmberLogo size={16} tone="onLight" />
          <span>© {new Date().getFullYear()} Ember Tech Solutions LLC. All rights reserved.</span>
        </footer>
      </section>

      <HelpDrawer
        open={helpOpen}
        surface={navState.visible.surface}
        onClose={() => setHelpOpen(false)}
      />
    </>
  );

  return <div className="app-shell">{body}</div>;
}
