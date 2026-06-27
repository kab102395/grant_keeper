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
          Choose whether this person is creating a new account, signing into an
          existing account, or joining an existing workspace. The app handles
          Firebase sign-in and attaches the session to the correct organization.
        </p>
      </div>

      <div className="surface-actions">
        <button
          type="button"
          className={setupForm.mode === "create_account" ? "primary" : "secondary"}
          onClick={() =>
            setSetupForm({ ...setupForm, mode: "create_account", workspace_code: setupForm.workspace_code })
          }
        >
          Create account
        </button>
        <button
          type="button"
          className={setupForm.mode === "sign_in" ? "primary" : "secondary"}
          onClick={() => setSetupForm({ ...setupForm, mode: "sign_in" })}
        >
          Sign in
        </button>
        <button
          type="button"
          className={setupForm.mode === "join_workspace" ? "primary" : "secondary"}
          onClick={() => setSetupForm({ ...setupForm, mode: "join_workspace" })}
        >
          Join workspace
        </button>
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
        {setupForm.mode === "create_account" ? (
          <label>
            Organization name
            <input
              value={setupForm.organization_name}
              onChange={(event) => setSetupForm({ ...setupForm, organization_name: event.target.value })}
              placeholder="Community Action Network"
            />
          </label>
        ) : null}
        <label>
          Work email
          <span className="field-hint">
            {setupForm.mode === "create_account" || setupForm.mode === "join_workspace"
              ? "Used to create the Firebase login for this person"
              : "Used to sign in to the existing Firebase account"}
          </span>
          <input
            value={setupForm.email}
            onChange={(event) => setSetupForm({ ...setupForm, email: event.target.value })}
            placeholder="admin@example.org"
          />
        </label>
        <label>
          Password
          <span className="field-hint">Stored only for this sign-in or account creation attempt</span>
          <input
            type="password"
            value={setupForm.password}
            onChange={(event) => setSetupForm({ ...setupForm, password: event.target.value })}
            placeholder="Minimum Firebase password"
          />
        </label>
        <label>
          Workspace code
          <span className="field-hint">
            {setupForm.mode === "create_account"
              ? "Optional custom slug for the new workspace"
              : "Required to open or join an existing workspace"}
          </span>
          <input
            value={setupForm.workspace_code}
            onChange={(event) => setSetupForm({ ...setupForm, workspace_code: event.target.value })}
            placeholder="community-action-network"
          />
        </label>
      </div>

      <div className="surface-actions">
        <button type="button" className="primary" onClick={() => void saveSetup()} disabled={!canSaveSetup}>
          {setupForm.mode === "create_account"
            ? "Create account and workspace"
            : setupForm.mode === "sign_in"
              ? "Sign in to workspace"
              : "Create account and join workspace"}
        </button>
        <button type="button" className="secondary" onClick={() => void useDevProfile()} disabled={!canStartDevProfile}>
          Start local dev profile
        </button>
      </div>

      <div className="info-row">
        <span>
          Autosave:{" "}
          {autosaveStatus === "saved" && autosaveAt ? `saved ${new Date(autosaveAt).toLocaleString()}` : autosaveStatus}
        </span>
        <span>Setup fields persist locally while you type</span>
      </div>

      <p className="field-hint">
        Anthropic key and AI draft mode now live in the organization settings
        surface so onboarding stays focused on identity and workspace access.
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
    return "self serve account and workspace";
  }
  return bootstrap.join_model.split("_").join(" ");
}

function formatRequiredInputs(bootstrap: WorkspaceBootstrapContract | undefined) {
  if (!bootstrap) {
    return "email, password, organization name or workspace code";
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
