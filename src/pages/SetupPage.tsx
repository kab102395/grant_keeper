import type { Dispatch, SetStateAction } from "react";
import type {
  AppSnapshot,
  LocalConfig,
  SetupValidation,
  StartupState,
  WorkspaceBootstrapContract,
} from "../lib/types";
import type { SetupForm } from "../lib/shell";
import { summarizeSetup } from "../lib/shell";

export function SetupPage({
  setupForm,
  setSetupForm,
  saveSetup,
  useDevProfile,
  setupComplete,
  snapshot,
  config,
  validation,
  startupState,
  canSaveSetup,
  canStartDevProfile,
  autosaveStatus,
  autosaveAt,
}: {
  setupForm: SetupForm;
  setSetupForm: Dispatch<SetStateAction<SetupForm>>;
  saveSetup: () => Promise<void>;
  useDevProfile: () => Promise<void>;
  setupComplete: boolean;
  snapshot: AppSnapshot | null;
  config: LocalConfig | null;
  validation: SetupValidation | null;
  startupState: StartupState;
  canSaveSetup: boolean;
  canStartDevProfile: boolean;
  autosaveStatus: "idle" | "saving" | "saved" | "error";
  autosaveAt: string | null;
}) {
  const setupSummary = summarizeSetup(validation);
  const bootstrap = snapshot?.workspace_bootstrap;
  const bootstrapScreens = bootstrap?.screens ?? [];

  return (
    <div className="surface-stack">
      <div className="surface-copy">
        <h3>Create or join a workspace</h3>
        <p>
          Enter your organization and work email. The app will create a workspace
          for your team or attach you to an existing one, keep the data under one
          organization, and handle the backend connection automatically.
        </p>
      </div>

      <div className="panel-block">
        <div className="eyebrow">Workspace bootstrap contract</div>
        <div className="info-row">
          <span>Join model: {formatJoinModel(bootstrap)}</span>
          <span>Required inputs: {formatRequiredInputs(bootstrap)}</span>
          <span>Identity boundary: {formatIdentityBoundary(bootstrap)}</span>
        </div>
        <div className="surface-grid">
          {bootstrapScreens.map((step, index) => (
            <article key={step.id} className="panel-card">
              <div className="eyebrow">Step {index + 1}</div>
              <h4>{step.title}</h4>
              <p>{step.description}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="info-row">
        <span>Startup state: {startupState.split("_").join(" ")}</span>
        <span>Session mode: {setupSummary.mode}</span>
        <span>Workspace ready: {setupSummary.workspaceReady}</span>
        <span>Dev profile ready: {setupSummary.devProfileReady}</span>
        <span>Active workspace: {snapshot?.organization_uid ?? config?.organization_uid ?? "not set"}</span>
      </div>

      <div className="form-grid">
        <label>
          Organization name
          <input
            value={setupForm.organization_name}
            onChange={(event) => setSetupForm({ ...setupForm, organization_name: event.target.value })}
            placeholder="Community Action Network"
          />
        </label>
        <label>
          Work email
          <span className="field-hint">Used to create the workspace login for this person</span>
          <input
            value={setupForm.email}
            onChange={(event) => setSetupForm({ ...setupForm, email: event.target.value })}
            placeholder="admin@example.org"
          />
        </label>
        <label>
          Workspace code
          <span className="field-hint">Leave blank to create a new workspace</span>
          <input
            value={setupForm.workspace_code}
            onChange={(event) => setSetupForm({ ...setupForm, workspace_code: event.target.value })}
            placeholder="community-action-network"
          />
        </label>
        <label>
          Anthropic API Key
          <span className="field-hint">Optional — enables AI-assisted draft generation</span>
          <input
            value={setupForm.anthropic_api_key}
            onChange={(event) => setSetupForm({ ...setupForm, anthropic_api_key: event.target.value })}
            placeholder="sk-ant-..."
          />
        </label>
      </div>

      <div className="surface-actions">
        <button type="button" className="primary" onClick={() => void saveSetup()} disabled={!canSaveSetup}>
          Create workspace
        </button>
        <button type="button" className="secondary" onClick={() => void useDevProfile()} disabled={!canStartDevProfile}>
          Start local dev profile
        </button>
      </div>

      <div className="info-row">
        <span>Autosave: {autosaveStatus === "saved" && autosaveAt ? `saved ${new Date(autosaveAt).toLocaleString()}` : autosaveStatus}</span>
        <span>Setup fields persist locally while you type</span>
      </div>

      <p className="field-hint">
        This flow creates a workspace session keyed to the organization. The
        app stores grants, drafts, watchlists, and organization data under that
        workspace so writers can reopen it without re-entering technical setup.
      </p>

      <div className="info-row">
        <span>Setup complete: {setupComplete ? "yes" : "no"}</span>
        <span>Validation: {setupSummary.ready}</span>
        {setupSummary.missing ? <span>Missing: {setupSummary.missing}</span> : null}
      </div>
    </div>
  );
}

function formatJoinModel(bootstrap: WorkspaceBootstrapContract | undefined) {
  if (!bootstrap) {
    return "admin created workspace with optional code";
  }
  return bootstrap.join_model.split("_").join(" ");
}

function formatRequiredInputs(bootstrap: WorkspaceBootstrapContract | undefined) {
  if (!bootstrap) {
    return "organization name, email";
  }
  return bootstrap.required_inputs.map((value) => value.split("_").join(" ")).join(", ");
}

function formatIdentityBoundary(bootstrap: WorkspaceBootstrapContract | undefined) {
  if (!bootstrap) {
    return "firebase_uid -> organization_uid";
  }
  if (!bootstrap.identity_boundary) {
    return "firebase_uid -> organization_uid";
  }
  return `${bootstrap.identity_boundary.session_key} -> ${bootstrap.identity_boundary.data_key}`;
}
