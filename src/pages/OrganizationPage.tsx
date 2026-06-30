import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { LocalConfig, OrganizationRecord, WorkspaceInviteRecord } from "../lib/types";
import {
  buildInviteMessage,
  copyTextToClipboard,
  formatTimestamp,
  orgCompletenessScore,
  orgMissingFields,
} from "../lib/shell";
import { FieldTip } from "../components/FieldTip";

const ORG_FIELD_LABELS: Record<keyof OrganizationRecord, string> = {
  uid: "Workspace UID",
  name: "Organization name",
  ein: "EIN",
  ntee_code: "NTEE code",
  irc_status: "IRC status",
  mission: "Mission",
  founded_year: "Founded year",
  address: "Address",
  city: "City",
  state: "State",
  zip: "ZIP",
  website: "Website",
  phone: "Phone",
  contact_name: "Contact name",
  contact_email: "Contact email",
  annual_budget: "Annual budget",
  staff_count: "Staff count",
  volunteer_count: "Volunteer count",
  service_area: "Service area",
  target_population: "Target population",
  programs: "Programs",
  description: "Description",
  updated_at: "Updated at",
};

const ORG_FIELDS: Array<
  | { key: "name" | "ein" | "ntee_code" | "irc_status" | "city" | "state" | "zip" | "website" | "phone" | "contact_name" | "contact_email" | "service_area" | "target_population"; kind: "text"; placeholder?: string; tip?: string }
  | { key: "mission" | "address" | "description"; kind: "textarea"; placeholder?: string; tip?: string }
  | { key: "founded_year" | "annual_budget" | "staff_count" | "volunteer_count"; kind: "number"; placeholder?: string; tip?: string }
> = [
  { key: "name", kind: "text", placeholder: "Organization legal or public name" },
  { key: "ein", kind: "text", placeholder: "12-3456789", tip: "Employer Identification Number — the 9-digit federal tax ID the IRS assigned to your nonprofit (format: 12-3456789). Required on most federal grant applications." },
  { key: "ntee_code", kind: "text", placeholder: "Example: P20", tip: "National Taxonomy of Exempt Entities — a letter-and-number code classifying your nonprofit's primary activity (e.g. P20 for Community Action Agencies). Used on some grant applications and in eligibility filters." },
  { key: "irc_status", kind: "text", placeholder: "501(c)(3)", tip: "Your Internal Revenue Code tax-exempt classification. Most public charities are 501(c)(3). Some grants restrict eligibility by IRC status." },
  { key: "mission", kind: "textarea", placeholder: "What does the organization exist to do?", tip: "A concise statement of your organization's core purpose. This goes directly into AI-generated grant narratives, so write it the way you want it to appear in applications." },
  { key: "description", kind: "textarea", placeholder: "Short profile for grant drafting context", tip: "A longer org profile used as background context when generating drafts. It supplements the mission — include history, approach, and key programs." },
  { key: "address", kind: "textarea", placeholder: "Street address or mailing address" },
  { key: "city", kind: "text", placeholder: "City" },
  { key: "state", kind: "text", placeholder: "State" },
  { key: "zip", kind: "text", placeholder: "ZIP" },
  { key: "website", kind: "text", placeholder: "https://example.org" },
  { key: "phone", kind: "text", placeholder: "(555) 555-5555" },
  { key: "contact_name", kind: "text", placeholder: "Primary grant contact", tip: "The person responsible for grant applications at your organization. Their name may appear on grant submission forms." },
  { key: "contact_email", kind: "text", placeholder: "grants@example.org" },
  { key: "service_area", kind: "text", placeholder: "Counties, cities, or region served", tip: "The geographic area your organization operates in. Grant funders often require applicants to serve a specific region — this field is used to match eligibility." },
  { key: "target_population", kind: "text", placeholder: "Who the organization serves", tip: "The communities or demographics your programs serve (e.g. low-income families, youth ages 12–18, rural seniors). Included in draft narratives automatically." },
  { key: "founded_year", kind: "number", placeholder: "1988" },
  { key: "annual_budget", kind: "number", placeholder: "250000", tip: "Total annual operating budget in USD. Used by the AI to calibrate funding request amounts in drafts — a $200K org requesting $2M looks unrealistic." },
  { key: "staff_count", kind: "number", placeholder: "12" },
  { key: "volunteer_count", kind: "number", placeholder: "48" },
];

export function OrganizationPage({
  organization,
  organizationForm,
  setOrganizationForm,
  programsText,
  setProgramsText,
  orgUid,
  config,
  onSave,
  onCreateWorkspaceInvite,
  workspaceInvite,
  workspaceInviteStatus,
  workspaceInviteMessage,
  aiSettingsDraft,
  setAiSettingsDraft,
  onValidateAiSettings,
  onSaveAiSettings,
  aiSettingsStatus,
  aiSettingsMessage,
  autosaveStatus,
  autosaveAt,
  onChangePassword,
  passwordChangeStatus,
  passwordChangeMessage,
  passwordChangeAvailable,
}: {
  organization: OrganizationRecord | null;
  organizationForm: OrganizationRecord | null;
  setOrganizationForm: Dispatch<SetStateAction<OrganizationRecord | null>>;
  programsText: string;
  setProgramsText: Dispatch<SetStateAction<string>>;
  orgUid: string | null;
  config: LocalConfig | null;
  onSave: () => Promise<void>;
  onCreateWorkspaceInvite: () => Promise<void>;
  workspaceInvite: WorkspaceInviteRecord | null;
  workspaceInviteStatus: "idle" | "saving" | "saved" | "error";
  workspaceInviteMessage: string | null;
  aiSettingsDraft: { anthropicApiKey: string; draftPreference: "local_scaffold" | "ai" };
  setAiSettingsDraft: Dispatch<
    SetStateAction<{ anthropicApiKey: string; draftPreference: "local_scaffold" | "ai" }>
  >;
  onValidateAiSettings: () => Promise<void>;
  onSaveAiSettings: () => Promise<void>;
  aiSettingsStatus: "idle" | "validating" | "saving" | "saved" | "error";
  aiSettingsMessage: string | null;
  autosaveStatus: "idle" | "saving" | "saved" | "error";
  autosaveAt: string | null;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  passwordChangeStatus: "idle" | "saving" | "saved" | "error";
  passwordChangeMessage: string | null;
  passwordChangeAvailable: boolean;
}) {
  const profile = organizationForm ?? organization;
  const completeness = useMemo(() => orgCompletenessScore(profile), [profile]);
  const missingFields = useMemo(() => orgMissingFields(profile), [profile]);
  const missingLabels = missingFields.map((field) => ORG_FIELD_LABELS[field]);
  const filledFields = 12 - missingFields.length;
  const [inviteCopyState, setInviteCopyState] = useState<"idle" | "token" | "message" | "error">("idle");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  async function copyInvite(kind: "token" | "message") {
    if (!workspaceInvite?.invite_token) return;
    const text =
      kind === "token"
        ? workspaceInvite.invite_token
        : buildInviteMessage(workspaceInvite.invite_token, profile?.name);
    const ok = await copyTextToClipboard(text);
    setInviteCopyState(ok ? kind : "error");
    if (ok) {
      window.setTimeout(() => setInviteCopyState("idle"), 2000);
    }
  }

  const passwordsMismatch = newPassword.length > 0 && confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canSubmitPassword =
    currentPassword.trim().length > 0 &&
    newPassword.length >= 6 &&
    newPassword === confirmPassword &&
    passwordChangeStatus !== "saving";

  async function submitPasswordChange() {
    if (!canSubmitPassword) return;
    await onChangePassword(currentPassword, newPassword);
  }

  // Clear the password fields only after a successful change; on error the user
  // keeps their input so they can correct just the wrong field.
  useEffect(() => {
    if (passwordChangeStatus === "saved") {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
  }, [passwordChangeStatus]);

  function updateTextField(key: keyof OrganizationRecord, value: string) {
    setOrganizationForm((current) => (current ? { ...current, [key]: value } : current));
  }

  function updateNumberField(key: keyof OrganizationRecord, value: string) {
    setOrganizationForm((current) =>
      current ? { ...current, [key]: value.trim() ? Number(value) : null } : current,
    );
  }

  return (
    <div className="surface-stack organization-page">
      <div className="surface-copy organization-copy">
        <h3>Organization profile</h3>
        <p>Complete the org profile once and the draft workflow has the context it needs every time you write. This surface reads from the same cached RTDB-backed workspace catalog as the rest of the app.</p>
      </div>

      <div className="info-row">
        <span>Catalog source: RTDB</span>
        <span>{config?.last_sync_at ? `Synced ${formatTimestamp(config.last_sync_at)}` : "No live sync recorded"}</span>
      </div>

      <div className="org-layout">
        {/* Compact horizontal status bar */}
        <div className="panel-block panel-block-soft org-completeness-card">
          <div>
            <p className="eyebrow">Profile completeness</p>
            <strong>{completeness}% · {filledFields}/12 fields</strong>
          </div>
          <div className="org-completeness-bar-wrap">
            <div className="completeness-bar" aria-hidden="true">
              <div className="completeness-fill" style={{ width: `${completeness}%` }} />
            </div>
            {missingLabels.length > 0 && (
              <p className="muted org-missing-inline">Missing: {missingLabels.join(", ")}</p>
            )}
          </div>
          <div className="org-status-pills">
            <span className="org-status-chip">
              <span className="eyebrow">Autosave</span>
              <span>{autosaveStatus === "saved" && autosaveAt ? `Saved ${formatTimestamp(autosaveAt) ?? ""}` : autosaveStatus}</span>
            </span>
            <span className="org-status-chip">
              <span className="eyebrow">AI drafting</span>
              <span>{config?.anthropic_api_key ? "Key configured" : "No key yet"}</span>
            </span>
          </div>
          <div>
            <p className="eyebrow">Workspace</p>
            <code className="org-uid-inline">{orgUid ?? "—"}</code>
          </div>
        </div>

        <section className="panel-block org-form-panel">
          <div className="detail-header">
            <div>
              <p className="eyebrow">Organization details</p>
              <h4>{organization ? "Edit profile" : "Create profile"}</h4>
            </div>
            <span className="status-pill">{organization ? "Loaded" : "Empty"}</span>
          </div>

          <div className="form-grid org-form-grid">
            {ORG_FIELDS.map((field) => {
              const value = profile?.[field.key];

              const labelNode = (
                <span className="label-with-tip">
                  {ORG_FIELD_LABELS[field.key]}
                  {field.tip && <FieldTip tip={field.tip} />}
                </span>
              );

              if (field.kind === "textarea") {
                return (
                  <label key={field.key} className="grid-span-2">
                    {labelNode}
                    <textarea
                      value={typeof value === "string" ? value : ""}
                      onChange={(event) => updateTextField(field.key, event.target.value)}
                      placeholder={field.placeholder}
                      rows={5}
                    />
                  </label>
                );
              }

              if (field.kind === "number") {
                return (
                  <label key={field.key}>
                    {labelNode}
                    <input
                      type="number"
                      value={typeof value === "number" ? value : ""}
                      onChange={(event) => updateNumberField(field.key, event.target.value)}
                      placeholder={field.placeholder}
                    />
                  </label>
                );
              }

              return (
                <label key={field.key}>
                  {labelNode}
                  <input
                    value={typeof value === "string" ? value : ""}
                    onChange={(event) => updateTextField(field.key, event.target.value)}
                    placeholder={field.placeholder}
                  />
                </label>
              );
            })}

            <label className="grid-span-2">
              <span className="label-with-tip">
                Programs
                <FieldTip tip="List your organization's programs, one per line, in the format: Program name | short description | annual budget. Grant Keeper uses this to match programs to grant eligibility criteria and pre-fill application narratives." />
              </span>
              <textarea
                value={programsText}
                onChange={(event) => setProgramsText(event.target.value)}
                placeholder="Program name | description | budget"
                rows={5}
              />
            </label>
          </div>

          <div className="surface-actions org-actions">
            <button type="button" className="primary" onClick={() => void onSave()} disabled={!organizationForm}>
              Save organization
            </button>
          </div>

          <section className="panel-block panel-block-soft ai-settings-panel">
            <div className="detail-header">
              <div>
                <p className="eyebrow">Workspace invites</p>
                <h4>Generate a one-time join token</h4>
              </div>
              <span className="status-pill">{workspaceInvite ? "Invite ready" : "Owner action"}</span>
            </div>

            <p className="muted">
              Share the generated token with a second writer. New users join with this token instead of a raw workspace code.
            </p>

            <div className="surface-actions org-actions">
              <button
                type="button"
                className="primary"
                onClick={() => void onCreateWorkspaceInvite()}
                disabled={workspaceInviteStatus === "saving"}
              >
                {workspaceInviteStatus === "saving" ? "Generating..." : "Generate invite token"}
              </button>
            </div>

            <div className="form-grid">
              <label className="grid-span-2">
                Current invite token
                <input value={workspaceInvite?.invite_token ?? ""} readOnly placeholder="Generate a token to invite another writer" />
              </label>
            </div>

            {workspaceInvite?.invite_token ? (
              <div className="surface-actions org-actions">
                <button type="button" className="secondary" onClick={() => void copyInvite("token")}>
                  {inviteCopyState === "token" ? "Token copied!" : "Copy token"}
                </button>
                <button type="button" className="secondary" onClick={() => void copyInvite("message")}>
                  {inviteCopyState === "message" ? "Message copied!" : "Copy invite message"}
                </button>
              </div>
            ) : null}

            <div className="info-row">
              <span>Status: {workspaceInviteStatus}</span>
              <span>
                {inviteCopyState === "error"
                  ? "Couldn't reach the clipboard — select the token and copy it manually."
                  : workspaceInviteMessage ?? "Only workspace owners can generate join tokens."}
              </span>
            </div>
          </section>

          {passwordChangeAvailable ? (
            <section className="panel-block panel-block-soft ai-settings-panel">
              <div className="detail-header">
                <div>
                  <p className="eyebrow">Account security</p>
                  <h4>Change your password</h4>
                </div>
                <span className="status-pill">{passwordChangeStatus === "saved" ? "Updated" : "Account action"}</span>
              </div>

              <p className="muted">
                Update the password for your email sign-in. You'll confirm your current password first; your session stays signed in.
              </p>

              <div className="form-grid">
                <label className="grid-span-2">
                  Current password
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Your current password"
                  />
                </label>
                <label>
                  New password
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 6 characters"
                  />
                </label>
                <label>
                  Confirm new password
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                  />
                </label>
              </div>

              <div className="surface-actions org-actions">
                <button
                  type="button"
                  className="primary"
                  onClick={() => void submitPasswordChange()}
                  disabled={!canSubmitPassword}
                >
                  {passwordChangeStatus === "saving" ? "Updating..." : "Update password"}
                </button>
              </div>

              <div className="info-row">
                <span>Status: {passwordChangeStatus}</span>
                <span>
                  {passwordsMismatch
                    ? "New password and confirmation don't match."
                    : passwordChangeMessage ?? "Use at least 6 characters for the new password."}
                </span>
              </div>
            </section>
          ) : null}

          <section className="panel-block panel-block-soft ai-settings-panel">
            <div className="detail-header">
              <div>
                <p className="eyebrow">AI settings</p>
                <h4>Anthropic drafting controls</h4>
              </div>
              <span className="status-pill">
                {aiSettingsDraft.draftPreference === "ai" ? "AI mode" : "Scaffold mode"}
              </span>
            </div>

            <div className="form-grid">
              <label className="grid-span-2">
                Anthropic API key
                <span className="field-hint">
                  Save a workspace-local key here so the drafting flow can use Anthropic without operator help.
                </span>
                <input
                  type="password"
                  value={aiSettingsDraft.anthropicApiKey}
                  onChange={(event) =>
                    setAiSettingsDraft((current) => ({ ...current, anthropicApiKey: event.target.value }))
                  }
                  placeholder="sk-ant-..."
                />
              </label>

              <label>
                Draft generation mode
                <select
                  value={aiSettingsDraft.draftPreference}
                  onChange={(event) =>
                    setAiSettingsDraft((current) => ({
                      ...current,
                      draftPreference: event.target.value as "local_scaffold" | "ai",
                    }))
                  }
                >
                  <option value="local_scaffold">Local scaffold</option>
                  <option value="ai">AI draft</option>
                </select>
              </label>

              <div className="panel-card">
                <p className="eyebrow">Current status</p>
                <p className="field-value">
                  {config?.anthropic_api_key ? "Key saved" : "No saved key"}
                </p>
                <p className="muted">
                  {aiSettingsDraft.draftPreference === "ai"
                    ? "New drafts will attempt Anthropic generation when the key validates."
                    : "New drafts will stay scaffold-first even if a key is saved."}
                </p>
              </div>
            </div>

            <div className="surface-actions org-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => void onValidateAiSettings()}
                disabled={!aiSettingsDraft.anthropicApiKey.trim() || aiSettingsStatus === "validating"}
              >
                {aiSettingsStatus === "validating" ? "Validating..." : "Validate key"}
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void onSaveAiSettings()}
                disabled={aiSettingsStatus === "saving"}
              >
                {aiSettingsStatus === "saving" ? "Saving..." : "Save AI settings"}
              </button>
            </div>

            <div className="info-row">
              <span>Status: {aiSettingsStatus}</span>
              <span>{aiSettingsMessage ?? "Validate or save the current AI drafting settings."}</span>
            </div>
          </section>

          <div className="org-summary-grid">
            <div className="panel-card">
              <p className="eyebrow">Profile summary</p>
              {organization ? (
                <dl className="kv-list compact">
                  <div>
                    <dt>Name</dt>
                    <dd>{organization.name ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Mission</dt>
                    <dd>{organization.mission ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Programs</dt>
                    <dd>{organization.programs?.length ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{organization.updated_at ? formatTimestamp(organization.updated_at) : "—"}</dd>
                  </div>
                </dl>
              ) : (
                <p className="muted">No organization profile loaded.</p>
              )}
            </div>

            <div className="panel-card">
              <p className="eyebrow">Drafting inputs</p>
              <dl className="kv-list compact">
                <div>
                  <dt>Contact</dt>
                  <dd>{profile?.contact_name ?? "—"}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{profile?.contact_email ?? "—"}</dd>
                </div>
                <div>
                  <dt>Service area</dt>
                  <dd>{profile?.service_area ?? "—"}</dd>
                </div>
                <div>
                  <dt>Target population</dt>
                  <dd>{profile?.target_population ?? "—"}</dd>
                </div>
              </dl>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
