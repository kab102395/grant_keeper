import { useEffect, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { DraftRecord, GrantRecord } from "../lib/types";
import { formatCurrency, formatTimestamp, grantStatusLabel } from "../lib/shell";
import { useAutosave } from "../hooks/useAutosave";
import { GrantContextBanner } from "./GrantContextBanner";
import {
  composeGrantAwareDraftBody,
  draftSchemaSummary,
  resolveGrantDraftSchema,
  DRAFT_SCHEMA_VERSION,
} from "../lib/draftSchema";

function draftGenerationLabel(mode: DraftRecord["generation_mode"]) {
  switch (mode) {
    case "ai":
      return "AI generated";
    case "local_scaffold":
      return "Local scaffold";
    case "manual":
      return "Manual";
    default:
      return "Unknown origin";
  }
}

export function DraftEditor({
  draft,
  grant,
  setDraft,
  onSaveDraft,
  onAutosaveDraft,
  onExportDraft,
  onDeleteDraft,
}: {
  draft: DraftRecord | null;
  grant: GrantRecord | null;
  setDraft: Dispatch<SetStateAction<DraftRecord | null>>;
  onSaveDraft: (draft: DraftRecord) => Promise<void>;
  onAutosaveDraft: (draft: DraftRecord) => Promise<void>;
  onExportDraft: (draft: DraftRecord) => Promise<void>;
  onDeleteDraft: (draftId: string) => Promise<void>;
}) {
  const autosave = useAutosave(
    draft,
    (value) => (value ? composeGrantAwareDraftBody(value, grant) : ""),
    async (value) => {
      if (!value) {
        return;
      }
      const currentValue = value;
      const nextDraft: DraftRecord = {
        ...currentValue,
        body: composeGrantAwareDraftBody(currentValue, grant),
        user_edited: true,
        updated_at: new Date().toISOString(),
      };
      await onAutosaveDraft(nextDraft);
    },
    900,
    draft?.draft_id ?? "none",
  );

  const schema = useMemo(() => resolveGrantDraftSchema(grant), [grant]);
  const previewLength = useMemo(() => (draft ? composeGrantAwareDraftBody(draft, grant).length : 0), [draft, grant, schema]);

  useEffect(() => {
    if (!draft) {
      return;
    }
    const editorPanel = document.querySelector<HTMLElement>(".draft-editor-panel");
    if (!editorPanel) return;
    const firstInput = editorPanel.querySelector<HTMLTextAreaElement>("textarea");
    firstInput?.focus();
  }, [draft?.draft_id]);

  if (!draft) {
    return (
      <section className="panel-block panel-block-soft draft-editor-panel draft-editor-empty">
        <div className="surface-copy">
          <h3>Draft editor</h3>
          <p>Select a draft to edit the generated sections.</p>
        </div>
      </section>
    );
  }

  const currentDraft = draft;
  const schemaVersionLabel = currentDraft.scaffold_template_version
    ? `Schema v${currentDraft.scaffold_template_version}`
    : currentDraft.ai_prompt_version
      ? `Prompt v${currentDraft.ai_prompt_version}`
      : `Schema v${DRAFT_SCHEMA_VERSION}`;

  function updateField(key: keyof DraftRecord, value: string) {
    setDraft((current) => (current ? { ...current, [key]: value, user_edited: true, updated_at: new Date().toISOString() } : current));
  }

  async function saveCurrentDraft() {
    const nextDraft: DraftRecord = {
      ...currentDraft,
      body: composeGrantAwareDraftBody(currentDraft, grant),
      user_edited: true,
      updated_at: new Date().toISOString(),
    };
    await onSaveDraft(nextDraft);
  }

  return (
    <section className="panel-block panel-block-soft draft-editor-panel draft-editor-shell">
      <GrantContextBanner grant={grant} />

      <div className="detail-header">
        <div>
          <p className="eyebrow">Draft metadata</p>
          <h4>{currentDraft.title ?? "Untitled draft"}</h4>
        </div>
        <span className="status-pill">{currentDraft.status}</span>
      </div>

      <div className="draft-metadata-strip">
        <span>Autosave: {autosave.status === "saved" && autosave.savedAt ? `saved ${formatTimestamp(autosave.savedAt)}` : autosave.status}</span>
        <span>Draft tied to: {grant?.title ?? currentDraft.grant_portal_id ?? "not loaded"}</span>
        <span>Body preview: {previewLength} chars</span>
      </div>

      <div className="chip-row detail-chip-row draft-schema-row">
        <span className="chip active">{schema.schema_name}</span>
        <span className="chip">{schemaVersionLabel}</span>
        {draftSchemaSummary(schema).map((item) => (
          <span key={item} className="chip">
            {item}
          </span>
        ))}
      </div>

      <div className="draft-summary-grid">
        <div className="panel-card draft-summary-card">
          <p className="eyebrow">Identity</p>
          <dl className="kv-list compact">
            <div>
              <dt>Draft ID</dt>
              <dd>{currentDraft.draft_id}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{currentDraft.version}</dd>
            </div>
            <div>
              <dt>Generation mode</dt>
              <dd>{draftGenerationLabel(currentDraft.generation_mode)}</dd>
            </div>
          </dl>
        </div>

        <div className="panel-card draft-summary-card">
          <p className="eyebrow">Provenance</p>
          <dl className="kv-list compact">
            <div>
              <dt>Grant Portal ID</dt>
              <dd>{currentDraft.grant_portal_id || "not set"}</dd>
            </div>
            <div>
              <dt>Origin org UID</dt>
              <dd>{currentDraft.provenance_org_uid ?? "not set"}</dd>
            </div>
            <div>
              <dt>Scaffold template</dt>
              <dd>{currentDraft.scaffold_template_version ?? "not set"}</dd>
            </div>
          </dl>
        </div>

        <div className="panel-card draft-summary-card">
          <p className="eyebrow">Timing</p>
          <dl className="kv-list compact">
            <div>
              <dt>Updated</dt>
              <dd>{formatTimestamp(currentDraft.updated_at)}</dd>
            </div>
            <div>
              <dt>Preview length</dt>
              <dd>{previewLength} chars</dd>
            </div>
          </dl>
        </div>
      </div>

      <section className="panel-block panel-block-soft draft-grant-anchor">
        <div className="detail-header">
          <div>
            <p className="eyebrow">Grant reference</p>
          <h4>{grant?.title ?? "Linked grant not loaded"}</h4>
          </div>
          {grant ? <span className="status-pill">{grantStatusLabel(grant)}</span> : null}
        </div>
        {grant ? (
          <div className="draft-reference-stack">
            <div className="panel-card draft-reference-summary">
              <div className="detail-trail">
                <div>
                  <span className="eyebrow">Funding</span>
                  <strong>{grant.est_amounts ?? grant.est_avail_funds ?? formatCurrency(grant.est_avail_funds_numeric)}</strong>
                </div>
                <div>
                  <span className="eyebrow">Deadline</span>
                  <strong>{grant.deadline_is_ongoing ? "Ongoing" : grant.application_deadline ?? "Not set"}</strong>
                </div>
                <div>
                  <span className="eyebrow">Status</span>
                  <strong>{grantStatusLabel(grant)}</strong>
                </div>
              </div>
            </div>
            <div className="draft-reference-grid">
              <Field label="Title" value={grant.title} />
              <Field label="Agency" value={grant.agency_dept} />
              <Field label="Status" value={grantStatusLabel(grant)} />
              <Field label="Deadline" value={grant.deadline_is_ongoing ? "Ongoing" : grant.application_deadline} />
              <Field label="Purpose" value={grant.purpose} />
              <Field label="Description" value={grant.description} />
              <Field label="Source" value={grant.source_name ?? grant.source_id} />
              <Field label="Funding" value={grant.est_amounts ?? grant.est_avail_funds ?? formatCurrency(grant.est_avail_funds_numeric)} />
              <Field label="Categories" value={grant.categories.length ? grant.categories.join(", ") : "not set"} />
              <Field label="Contact" value={grant.contact_name} />
              <Field label="Contact email" value={grant.contact_email} />
              <Field label="Contact phone" value={grant.contact_phone} />
            </div>
            <div className="info-row">
              <span>Portal ID: {grant.portal_id}</span>
              <span>Org UID: {grant.organization_uid ?? "not set"}</span>
              <span>Source evidence: {grant.source_excerpt ?? grant.source_page_description ?? "not set"}</span>
            </div>
            {grant.source_highlights.length ? (
              <div className="chip-row detail-chip-row">
                {grant.source_highlights.map((highlight) => (
                  <span key={highlight} className="chip detail-chip">
                    {highlight}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="muted">No grant loaded for this draft.</p>
        )}
      </section>

      <div className="editor-sections draft-editor-sections">
        {schema.sections.map((field) => {
          const value = (draft[field.key] as string | null | undefined) ?? "";
          return (
            <label key={String(field.key)} className="editor-section panel-card draft-editor-field">
              <span className="editor-label">
                {field.label}
                <small>{value.length} chars</small>
              </span>
              <small className="editor-helper">{field.helper}</small>
              <textarea
                rows={4}
                value={value}
                placeholder={field.placeholder}
                onChange={(event) => updateField(field.key, event.target.value)}
              />
            </label>
          );
        })}
      </div>

      <div className="surface-actions draft-editor-actions">
        <button type="button" className="primary" onClick={() => void saveCurrentDraft()}>
          Save changes
        </button>
        <button type="button" className="secondary" onClick={() => void onExportDraft(currentDraft)}>
          Export .docx
        </button>
        <button type="button" className="secondary" onClick={() => void onDeleteDraft(currentDraft.draft_id)}>
          Delete draft
        </button>
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value ?? "not set"}</dd>
    </div>
  );
}
