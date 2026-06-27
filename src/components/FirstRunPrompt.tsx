import type { OrganizationRecord } from "../lib/types";
import { orgCompletenessScore } from "../lib/shell";
import type { Surface } from "../hooks/useNavigation";

export function FirstRunPrompt({
  organization,
  hasWatchlist,
  hasDrafts,
  aiSettingsRequired,
  onNavigate,
  onOpenAiSettings,
}: {
  organization: OrganizationRecord | null;
  hasWatchlist: boolean;
  hasDrafts: boolean;
  aiSettingsRequired: boolean;
  onNavigate: (surface: Surface) => void;
  onOpenAiSettings: () => void;
}) {
  const orgComplete = orgCompletenessScore(organization) === 100;

  return (
    <section className="panel-block panel-block-soft first-run-shell">
      <div className="detail-header first-run-header">
        <div>
          <p className="eyebrow">Welcome</p>
          <h3>Grant Keeper is ready for your first workflow</h3>
          <p className="muted">
            Start with the organization profile, then look for a grant, then open your first draft. Once you save a grant or create a
            draft, this prompt goes away for this workspace.
          </p>
        </div>
        <span className="status-pill">{orgComplete ? "Org profile complete" : "Profile needs work"}</span>
      </div>

      <div className="first-run-grid">
        <article className="first-run-step">
          <span className="first-run-step-number">1</span>
          <div>
            <h4>Complete your org profile</h4>
            <p>Fill in the basics so generated drafts are tied to the right nonprofit.</p>
          </div>
          <button type="button" className="secondary" onClick={() => onNavigate("organization")}>
            Open org profile
          </button>
        </article>

        <article className="first-run-step">
          <span className={hasWatchlist ? "first-run-step-number done" : "first-run-step-number"}>2</span>
          <div>
            <h4>Discover grants</h4>
            <p>Find one grant to save, then use that source record as the foundation for drafting.</p>
          </div>
          <button type="button" className="secondary" onClick={() => onNavigate("discover")}>
            Open discovery
          </button>
        </article>

        <article className="first-run-step">
          <span className={hasDrafts ? "first-run-step-number done" : "first-run-step-number"}>3</span>
          <div>
            <h4>Start your first draft</h4>
            <p>
              {aiSettingsRequired
                ? "AI mode is selected, but the organization still needs an Anthropic API key. You can keep moving with a scaffold draft or open AI settings first."
                : "Generate a draft from a grant and continue editing with the grant context visible."}
            </p>
          </div>
          <div className="surface-actions">
            <button type="button" className="primary" onClick={() => onNavigate("drafts")}>
              {aiSettingsRequired ? "Open scaffold drafts" : "Open drafts"}
            </button>
            {aiSettingsRequired ? (
              <button type="button" className="secondary" onClick={onOpenAiSettings}>
                AI settings
              </button>
            ) : null}
          </div>
        </article>
      </div>
    </section>
  );
}
