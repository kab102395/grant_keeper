import { useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { DraftRecord, GrantRecord, LocalConfig } from "../lib/types";
import { formatTimestamp } from "../lib/shell";
import { DraftEditor } from "../components/DraftEditor";
import { draftSchemaSummary, resolveGrantDraftSchema } from "../lib/draftSchema";

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

export function DraftsPage({
  drafts,
  selectedDraft,
  setSelectedDraft,
  selectedGrant,
  config,
  onSelectDraft,
  onOpenGrant,
  onSaveDraft,
  onAutosaveDraft,
  onExportDraft,
  onDeleteDraft,
}: {
  drafts: DraftRecord[];
  selectedDraft: DraftRecord | null;
  setSelectedDraft: Dispatch<SetStateAction<DraftRecord | null>>;
  selectedGrant: GrantRecord | null;
  config: LocalConfig | null;
  onSelectDraft: (draft: DraftRecord) => Promise<void>;
  onOpenGrant: (portalId: string) => Promise<void>;
  onSaveDraft: (draft: DraftRecord) => Promise<void>;
  onAutosaveDraft: (draft: DraftRecord) => Promise<void>;
  onExportDraft: (draft: DraftRecord) => Promise<void>;
  onDeleteDraft: (draftId: string) => Promise<void>;
}) {
  const selectedDraftIndex = useMemo(
    () => drafts.findIndex((draft) => draft.draft_id === selectedDraft?.draft_id),
    [drafts, selectedDraft?.draft_id],
  );
  const hasPreviousDraft = selectedDraftIndex > 0;
  const hasNextDraft = selectedDraftIndex >= 0 && selectedDraftIndex < drafts.length - 1;
  const linkedGrant = selectedDraft?.grant_portal_id && selectedGrant?.portal_id === selectedDraft.grant_portal_id ? selectedGrant : null;
  const linkedSchema = resolveGrantDraftSchema(linkedGrant);

  async function selectRelativeDraft(direction: -1 | 1) {
    if (selectedDraftIndex < 0) {
      return;
    }
    const nextIndex = selectedDraftIndex + direction;
    if (nextIndex < 0 || nextIndex >= drafts.length) {
      return;
    }
    await onSelectDraft(drafts[nextIndex]);
  }

  return (
    <div className="surface-stack draft-page">
      <section className="panel-block panel-block-soft draft-hero">
        <div className="draft-hero-copy">
          <p className="eyebrow">Draft workspace</p>
          <h3>{selectedDraft?.title ?? "Pick a draft to begin"}</h3>
          <p className="muted">
            Each draft stays tied to one grant. Move between drafts on the left, edit in the center, and keep the linked grant visible
            on the right. The queue reads from the cached catalog stored in RTDB.
          </p>
          {selectedDraft ? (
            <div className="info-row">
              <span>Draft ID: {selectedDraft.draft_id}</span>
              <span>Version: {selectedDraft.version}</span>
              <span>Mode: {draftGenerationLabel(selectedDraft.generation_mode)}</span>
              <span>Updated: {formatTimestamp(selectedDraft.updated_at)}</span>
              <span>{config?.last_sync_at ? `Catalog synced ${formatTimestamp(config.last_sync_at)}` : "No live sync recorded"}</span>
              <span>
                Next draft mode:{" "}
                {config?.draft_generation_preference === "ai" && config?.anthropic_api_key
                  ? "Anthropic AI"
                  : config?.draft_generation_preference === "ai"
                    ? "AI requested but key missing"
                    : "Local scaffold"}
              </span>
            </div>
          ) : (
            <p className="muted">Choose a draft from the rail to open the editor.</p>
          )}
          {linkedGrant ? (
            <div className="chip-row detail-chip-row">
              <span className="chip active">{linkedSchema.schema_name}</span>
              {draftSchemaSummary(linkedSchema).map((item) => (
                <span key={item} className="chip">
                  {item}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="draft-hero-actions">
          <button type="button" className="secondary" onClick={() => void selectRelativeDraft(-1)} disabled={!hasPreviousDraft}>
            Back draft
          </button>
          <button type="button" className="secondary" onClick={() => void selectRelativeDraft(1)} disabled={!hasNextDraft}>
            Forward draft
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void onOpenGrant(selectedDraft?.grant_portal_id ?? "")}
            disabled={!selectedDraft?.grant_portal_id}
          >
            Open source grant
          </button>
        </div>
      </section>

      <div className="draft-workspace">
        <aside className="surface-column draft-rail">
          <div className="panel-block panel-block-soft draft-rail-header">
            <div className="detail-header">
              <div>
                <p className="eyebrow">Draft queue</p>
                <h4>Recent drafts</h4>
              </div>
              <span className="status-pill">{drafts.length} total</span>
            </div>
            <p className="muted">The current org's draft queue stays compact so the selected draft remains the focus.</p>
          </div>

          <div className="draft-list">
            {drafts.length === 0 ? (
              <p className="muted">No drafts found.</p>
            ) : (
              drafts.map((draft) => (
                <button
                  key={draft.draft_id}
                  type="button"
                  className={selectedDraft?.draft_id === draft.draft_id ? "draft-list-item active" : "draft-list-item"}
                  onClick={() => void onSelectDraft(draft)}
                >
                  <span className="draft-list-top">
                    <strong>{draft.title ?? draft.draft_id}</strong>
                    <span>{draft.status}</span>
                  </span>
                  <span className="draft-list-meta">
                    {formatTimestamp(draft.updated_at)} | {draftGenerationLabel(draft.generation_mode)}
                  </span>
                  <span className="draft-list-note">{draft.provenance_note ?? draft.notes ?? "No notes"}</span>
                  <span className="draft-list-link">Grant Portal ID: {draft.grant_portal_id || "—"}</span>
                </button>
              ))
            )}
          </div>
        </aside>

        <main className="draft-editor-column">
          <DraftEditor
            draft={selectedDraft}
            grant={linkedGrant}
            setDraft={setSelectedDraft}
            onSaveDraft={onSaveDraft}
            onAutosaveDraft={onAutosaveDraft}
            onExportDraft={onExportDraft}
            onDeleteDraft={onDeleteDraft}
          />
        </main>

        <aside className="panel-block panel-block-soft draft-grant-panel">
          <div className="detail-header">
            <div>
              <p className="eyebrow">Grant panel</p>
              <h4>{linkedGrant?.title ?? "No grant loaded"}</h4>
            </div>
            {linkedGrant ? <span className="status-pill">{linkedGrant.status ?? "open"}</span> : null}
          </div>

          {linkedGrant ? (
            <div className="draft-grant-summary">
              <div className="draft-grant-facts">
                <div>
                  <span className="eyebrow">Agency</span>
                  <strong>{linkedGrant.agency_dept ?? "Unknown agency"}</strong>
                </div>
                <div>
                  <span className="eyebrow">Deadline</span>
                  <strong>{linkedGrant.deadline_is_ongoing ? "Ongoing" : linkedGrant.application_deadline ?? "Not set"}</strong>
                </div>
                <div>
                  <span className="eyebrow">Funding</span>
                  <strong>{linkedGrant.est_amounts ?? linkedGrant.est_avail_funds ?? "Not set"}</strong>
                </div>
                <div>
                  <span className="eyebrow">Eligibility</span>
                  <strong>{linkedGrant.applicant_types.length ? linkedGrant.applicant_types.join(", ") : "Not set"}</strong>
                </div>
              </div>
              <p className="draft-grant-note">
                {linkedGrant.source_excerpt ?? linkedGrant.source_page_description ?? linkedGrant.description ?? "No source evidence loaded."}
              </p>
              <button type="button" className="secondary" onClick={() => void onOpenGrant(linkedGrant.portal_id)}>
                View grant
              </button>
            </div>
          ) : (
            <p className="muted">Open the source grant to keep the writing tied to the opportunity.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
