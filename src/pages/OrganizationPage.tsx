import { useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { LocalConfig, OrganizationRecord } from "../lib/types";
import { formatTimestamp, orgCompletenessScore, orgMissingFields } from "../lib/shell";

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
  | { key: "name" | "ein" | "ntee_code" | "irc_status" | "city" | "state" | "zip" | "website" | "phone" | "contact_name" | "contact_email" | "service_area" | "target_population"; kind: "text"; placeholder?: string }
  | { key: "mission" | "address" | "description"; kind: "textarea"; placeholder?: string }
  | { key: "founded_year" | "annual_budget" | "staff_count" | "volunteer_count"; kind: "number"; placeholder?: string }
> = [
  { key: "name", kind: "text", placeholder: "Organization legal or public name" },
  { key: "ein", kind: "text", placeholder: "12-3456789" },
  { key: "ntee_code", kind: "text", placeholder: "Example: P20" },
  { key: "irc_status", kind: "text", placeholder: "501(c)(3)" },
  { key: "mission", kind: "textarea", placeholder: "What does the organization exist to do?" },
  { key: "description", kind: "textarea", placeholder: "Short profile for grant drafting context" },
  { key: "address", kind: "textarea", placeholder: "Street address or mailing address" },
  { key: "city", kind: "text", placeholder: "City" },
  { key: "state", kind: "text", placeholder: "State" },
  { key: "zip", kind: "text", placeholder: "ZIP" },
  { key: "website", kind: "text", placeholder: "https://example.org" },
  { key: "phone", kind: "text", placeholder: "(555) 555-5555" },
  { key: "contact_name", kind: "text", placeholder: "Primary grant contact" },
  { key: "contact_email", kind: "text", placeholder: "grants@example.org" },
  { key: "service_area", kind: "text", placeholder: "Counties, cities, or region served" },
  { key: "target_population", kind: "text", placeholder: "Who the organization serves" },
  { key: "founded_year", kind: "number", placeholder: "1988" },
  { key: "annual_budget", kind: "number", placeholder: "250000" },
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
  autosaveStatus,
  autosaveAt,
}: {
  organization: OrganizationRecord | null;
  organizationForm: OrganizationRecord | null;
  setOrganizationForm: Dispatch<SetStateAction<OrganizationRecord | null>>;
  programsText: string;
  setProgramsText: Dispatch<SetStateAction<string>>;
  orgUid: string | null;
  config: LocalConfig | null;
  onSave: () => Promise<void>;
  autosaveStatus: "idle" | "saving" | "saved" | "error";
  autosaveAt: string | null;
}) {
  const profile = organizationForm ?? organization;
  const completeness = useMemo(() => orgCompletenessScore(profile), [profile]);
  const missingFields = useMemo(() => orgMissingFields(profile), [profile]);
  const missingLabels = missingFields.map((field) => ORG_FIELD_LABELS[field]);
  const filledFields = 12 - missingFields.length;

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
        <aside className="panel-block panel-block-soft org-completeness-card">
          <div className="detail-header">
            <div>
              <p className="eyebrow">Profile completeness</p>
              <h4>{completeness}% complete</h4>
            </div>
            <span className="status-pill">{filledFields}/12 filled</span>
          </div>

          <p className="muted">Fill the missing fields to improve draft quality and make the nonprofit profile reusable.</p>

          <div className="completeness-bar" aria-hidden="true">
            <div className="completeness-fill" style={{ width: `${completeness}%` }} />
          </div>

          <div className="org-uid-card">
            <span className="eyebrow">Workspace UID</span>
            <p className="field-value">{orgUid ?? "not set"}</p>
          </div>

          <div className="org-missing-section">
            <div className="detail-header">
              <div>
                <p className="eyebrow">Missing</p>
                <h4>Fields to finish</h4>
              </div>
            </div>
            {missingLabels.length === 0 ? (
              <p className="muted">No missing scored fields.</p>
            ) : (
              <ul className="org-missing-list">
                {missingLabels.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="org-summary-card">
            <p className="eyebrow">Autosave</p>
            <p className="field-value">{autosaveStatus === "saved" && autosaveAt ? `Saved ${formatTimestamp(autosaveAt)}` : autosaveStatus}</p>
            <p className="muted">Profile changes persist automatically while you type.</p>
          </div>
        </aside>

        <section className="panel-block org-form-panel">
          <div className="detail-header">
            <div>
              <p className="eyebrow">Org form fields</p>
              <h4>Organization details</h4>
            </div>
            <span className="status-pill">{organization ? "Loaded" : "Empty"}</span>
          </div>

          <div className="form-grid org-form-grid">
            {ORG_FIELDS.map((field) => {
              const value = profile?.[field.key];

              if (field.kind === "textarea") {
                return (
                  <label key={field.key} className="grid-span-2">
                    {ORG_FIELD_LABELS[field.key]}
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
                    {ORG_FIELD_LABELS[field.key]}
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
                  {ORG_FIELD_LABELS[field.key]}
                  <input
                    value={typeof value === "string" ? value : ""}
                    onChange={(event) => updateTextField(field.key, event.target.value)}
                    placeholder={field.placeholder}
                  />
                </label>
              );
            })}

            <label className="grid-span-2">
              Programs
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

          <div className="org-summary-grid">
            <div className="panel-card">
              <p className="eyebrow">Profile summary</p>
              {organization ? (
                <dl className="kv-list compact">
                  <div>
                    <dt>Name</dt>
                    <dd>{organization.name ?? "not set"}</dd>
                  </div>
                  <div>
                    <dt>Mission</dt>
                    <dd>{organization.mission ?? "not set"}</dd>
                  </div>
                  <div>
                    <dt>Programs</dt>
                    <dd>{organization.programs?.length ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{organization.updated_at ? formatTimestamp(organization.updated_at) : "not set"}</dd>
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
                  <dd>{profile?.contact_name ?? "not set"}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{profile?.contact_email ?? "not set"}</dd>
                </div>
                <div>
                  <dt>Service area</dt>
                  <dd>{profile?.service_area ?? "not set"}</dd>
                </div>
                <div>
                  <dt>Target population</dt>
                  <dd>{profile?.target_population ?? "not set"}</dd>
                </div>
              </dl>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
