import type { Dispatch, SetStateAction } from "react";
import type { SetupForm } from "../lib/shell";

export function SetupPage({
  setupForm,
  setSetupForm,
  saveSetup,
  requestPasswordReset,
  useDevProfile,
  canSaveSetup,
  canStartDevProfile,
  autosaveStatus,
  autosaveAt,
  setupSupportStatus,
  setupSupportMessage,
}: {
  setupForm: SetupForm;
  setSetupForm: Dispatch<SetStateAction<SetupForm>>;
  saveSetup: () => Promise<void>;
  requestPasswordReset: () => Promise<void>;
  useDevProfile: () => Promise<void>;
  canSaveSetup: boolean;
  canStartDevProfile: boolean;
  autosaveStatus: "idle" | "saving" | "saved" | "error";
  autosaveAt: string | null;
  setupSupportStatus: "idle" | "saving" | "saved" | "error";
  setupSupportMessage: string | null;
}) {
  const workspaceCodeHint =
    setupForm.mode === "create_account"
      ? "Optional custom slug for the new workspace. Leave it blank to generate one automatically."
      : "Enter the workspace code for an existing workspace you already belong to.";
  const inviteTokenHint =
    "Enter the one-time invite token shared by the organization owner.";
  const submitLabel =
    setupForm.mode === "create_account"
      ? "Create account and workspace"
      : setupForm.mode === "sign_in"
        ? "Sign in to workspace"
        : "Create account and join workspace";

  return (
    <div className="surface-stack">
      <div className="surface-copy">
        <h3>Create or join a workspace</h3>
        <p>
          Enter the work email and workspace details for this nonprofit. Grant
          Keeper handles the account and workspace connection automatically.
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
        {setupForm.mode !== "join_workspace" ? (
          <label>
            Workspace code
            <span className="field-hint">{workspaceCodeHint}</span>
            <input
              value={setupForm.workspace_code}
              onChange={(event) => setSetupForm({ ...setupForm, workspace_code: event.target.value })}
              placeholder="community-action-network"
            />
          </label>
        ) : null}
        {setupForm.mode === "join_workspace" ? (
          <label>
            Invite token
            <span className="field-hint">{inviteTokenHint}</span>
            <input
              value={setupForm.invite_token}
              onChange={(event) => setSetupForm({ ...setupForm, invite_token: event.target.value })}
              placeholder="gk-..."
            />
          </label>
        ) : null}
      </div>

      <div className="surface-actions">
        <button type="button" className="primary" onClick={() => void saveSetup()} disabled={!canSaveSetup}>
          {submitLabel}
        </button>
        {setupForm.mode !== "create_account" ? (
          <button
            type="button"
            className="secondary"
            onClick={() => void requestPasswordReset()}
            disabled={setupSupportStatus === "saving"}
          >
            {setupSupportStatus === "saving" ? "Sending reset..." : "Forgot password?"}
          </button>
        ) : null}
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
        Anthropic key and AI draft mode live in organization settings after sign-in so onboarding stays focused on account access.
      </p>
      {setupSupportMessage ? (
        <p className="field-hint">
          {setupSupportMessage}
        </p>
      ) : null}
      {setupForm.mode !== "create_account" ? (
        <p className="field-hint">
          {setupForm.mode === "join_workspace"
            ? "Use the invite token from the organization owner. Password resets are sent to the work email above."
            : "Use the workspace code for a workspace you already belong to. Password resets are sent to the work email above."}
        </p>
      ) : null}
    </div>
  );
}
