import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { DraftRecord, GrantRecord, LocalConfig } from "../lib/types";
import { formatTimestamp } from "../lib/shell";
import { DraftEditor } from "../components/DraftEditor";
import { draftSchemaSummary, resolveGrantDraftSchema } from "../lib/draftSchema";
import { GrantStatusPill } from "../components/ui";

function draftGenerationLabel(mode: DraftRecord["generation_mode"]) {
  switch (mode) {
    case "ai": return "AI";
    case "local_scaffold": return "Scaffold";
    case "manual": return "Manual";
    default: return "Unknown";
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
  const [grantPanelOpen, setGrantPanelOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);

  const linkedGrant = selectedDraft?.grant_portal_id && selectedGrant?.portal_id === selectedDraft.grant_portal_id ? selectedGrant : null;
  const linkedSchema = resolveGrantDraftSchema(linkedGrant);

  const selectedDraftIndex = useMemo(
    () => drafts.findIndex((d) => d.draft_id === selectedDraft?.draft_id),
    [drafts, selectedDraft?.draft_id],
  );

  async function selectRelativeDraft(direction: -1 | 1) {
    const next = selectedDraftIndex + direction;
    if (next < 0 || next >= drafts.length) return;
    await onSelectDraft(drafts[next]);
  }

  return (
    <div className={railCollapsed ? "drafts-shell drafts-shell-collapsed" : "drafts-shell"}>
      {/* Left rail — draft list */}
      <aside className={railCollapsed ? "drafts-rail drafts-rail-collapsed" : "drafts-rail"}>
        <div className="drafts-rail-header">
          {!railCollapsed && <p className="eyebrow">Draft queue</p>}
          {!railCollapsed && <span className="status-chip status-chip-neutral">{drafts.length} total</span>}
          <button
            type="button"
            className="drafts-rail-toggle"
            onClick={() => setRailCollapsed((c) => !c)}
            title={railCollapsed ? "Show draft list" : "Hide draft list"}
          >
            <RailCollapseIcon collapsed={railCollapsed} />
          </button>
        </div>

        {!railCollapsed && (drafts.length === 0 ? (
          <p className="muted drafts-empty">No drafts yet. Create one from a grant.</p>
        ) : (
          <div className="drafts-list">
            {drafts.map((draft) => {
              const isActive = draft.draft_id === selectedDraft?.draft_id;
              const label = draft.title
                ?? (draft.grant_portal_id ? `Draft — ${draft.grant_portal_id.slice(0, 16)}…` : "Untitled draft");
              const ts = formatTimestamp(draft.updated_at);
              return (
                <button
                  key={draft.draft_id}
                  type="button"
                  className={isActive ? "draft-card draft-card-active" : "draft-card"}
                  onClick={() => void onSelectDraft(draft)}
                >
                  <div className="draft-card-top">
                    <strong className="draft-card-title">{label}</strong>
                    <span className="draft-card-mode">{draftGenerationLabel(draft.generation_mode)}</span>
                  </div>
                  <div className="draft-card-meta">
                    <span>{draft.status}</span>
                    {ts && <span>{ts}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        ))}

        {!railCollapsed && selectedDraft && (
          <div className="drafts-rail-nav">
            <button type="button" className="secondary" onClick={() => void selectRelativeDraft(-1)} disabled={selectedDraftIndex <= 0}>
              ← Prev
            </button>
            <button type="button" className="secondary" onClick={() => void selectRelativeDraft(1)} disabled={selectedDraftIndex >= drafts.length - 1}>
              Next →
            </button>
          </div>
        )}
      </aside>

      {/* Main area — editor + optional grant drawer */}
      <div className="drafts-main">
        {selectedDraft ? (
          <>
            {/* Editor toolbar */}
            <div className="drafts-toolbar">
              <div className="drafts-toolbar-left">
                <p className="eyebrow" style={{ margin: 0 }}>Editing</p>
                <strong className="drafts-toolbar-title">
                  {selectedDraft.title ?? "Untitled draft"}
                </strong>
                {linkedSchema && (
                  <div className="chip-row" style={{ margin: 0 }}>
                    <span className="chip active">{linkedSchema.schema_name}</span>
                    {draftSchemaSummary(linkedSchema).map((item) => (
                      <span key={item} className="chip">{item}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="drafts-toolbar-actions">
                {linkedGrant && (
                  <button
                    type="button"
                    className={grantPanelOpen ? "secondary drafts-grant-toggle active" : "secondary drafts-grant-toggle"}
                    onClick={() => setGrantPanelOpen((o) => !o)}
                  >
                    {grantPanelOpen ? "Hide grant" : "View grant"}
                  </button>
                )}
                {selectedDraft.grant_portal_id && (
                  <button type="button" className="ghost" onClick={() => void onOpenGrant(selectedDraft.grant_portal_id ?? "")}>
                    Open in Discovery →
                  </button>
                )}
              </div>
            </div>

            {/* Grant reference drawer */}
            {linkedGrant && grantPanelOpen && (
              <div className="drafts-grant-drawer">
                <div className="drafts-grant-drawer-inner">
                  <div className="drafts-grant-header">
                    <div>
                      <p className="eyebrow">Grant reference</p>
                      <strong>{linkedGrant.title}</strong>
                      <p className="muted">{linkedGrant.agency_dept ?? "Unknown agency"}</p>
                    </div>
                    <GrantStatusPill grant={linkedGrant} />
                  </div>
                  <div className="drafts-grant-facts">
                    <div><span className="eyebrow">Deadline</span><strong>{linkedGrant.deadline_is_ongoing ? "Ongoing" : linkedGrant.application_deadline ?? "—"}</strong></div>
                    <div><span className="eyebrow">Funding</span><strong>{linkedGrant.est_amounts ?? linkedGrant.est_avail_funds ?? "Not stated"}</strong></div>
                    <div><span className="eyebrow">Eligibility</span><strong>{linkedGrant.applicant_types.length ? linkedGrant.applicant_types.join(", ") : "—"}</strong></div>
                  </div>
                  {(linkedGrant.source_excerpt ?? linkedGrant.description) && (
                    <p className="muted drafts-grant-excerpt">{linkedGrant.source_excerpt ?? linkedGrant.description}</p>
                  )}
                </div>
              </div>
            )}

            {/* Draft editor */}
            <div className="drafts-editor-wrap">
              <DraftEditor
                draft={selectedDraft}
                grant={linkedGrant}
                setDraft={setSelectedDraft}
                onSaveDraft={onSaveDraft}
                onAutosaveDraft={onAutosaveDraft}
                onExportDraft={onExportDraft}
                onDeleteDraft={onDeleteDraft}
              />
            </div>
          </>
        ) : (
          <div className="drafts-empty-state">
            <p className="eyebrow">Draft workspace</p>
            <h3>Select a draft to begin</h3>
            <p className="muted">Choose a draft from the list to open the editor. Create drafts from any grant in Discover or Watchlist.</p>
            {config?.last_sync_at && (
              <p className="muted">Catalog synced {formatTimestamp(config.last_sync_at) ?? "—"}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RailCollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      style={{ width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", transform: collapsed ? "rotate(180deg)" : "none", transition: "transform 200ms ease" }}
    >
      <path d="M10 3L6 8l4 5" />
    </svg>
  );
}
