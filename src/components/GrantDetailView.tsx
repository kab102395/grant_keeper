import { useState } from "react";
import type { ReactNode } from "react";
import type { GrantRecord } from "../lib/types";
import {
  deadlineUrgency,
  formatCurrency,
  formatTimestamp,
  grantDeadlineLabel,
  grantFundingLabel,
  grantJurisdictionLabel,
  grantSourceLabel,
  grantStatusLabel,
} from "../lib/shell";
import { draftSchemaSummary, resolveGrantDraftSchema } from "../lib/draftSchema";
import { EmptyValue, GrantStatusPill, StatusPill } from "./ui";

function orEmpty(value: string | null | undefined, label = "Not provided"): ReactNode {
  return value && value.trim() ? value : <EmptyValue label={label} />;
}

function CollapsibleSection({
  eyebrow,
  defaultOpen = true,
  children,
  className,
}: {
  eyebrow: string;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`panel-block collapsible-section${className ? ` ${className}` : ""}${open ? "" : " collapsible-section-closed"}`}>
      <button
        type="button"
        className="collapsible-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <p className="eyebrow">{eyebrow}</p>
        <ChevronIcon open={open} />
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </section>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      style={{
        width: 14,
        height: 14,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.8,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        transform: open ? "rotate(0deg)" : "rotate(-90deg)",
        transition: "transform 200ms ease",
        flexShrink: 0,
      }}
    >
      <path d="M3 6l5 5 5-5" />
    </svg>
  );
}

export function GrantDetailView({
  grant,
  watchlistedPortalIds,
  onToggleWatchlist,
  onCreateDraft,
  aiSettingsRequired,
  onOpenAiSettings,
  canWrite,
  writeDisabledReason,
  layout = "embedded",
}: {
  grant: GrantRecord | null;
  watchlistedPortalIds: Set<string>;
  onToggleWatchlist: (grant: GrantRecord) => Promise<void>;
  onCreateDraft: (grant: GrantRecord) => Promise<void>;
  aiSettingsRequired: boolean;
  onOpenAiSettings: () => void;
  canWrite: boolean;
  writeDisabledReason: string;
  layout?: "embedded" | "page";
}) {
  if (!grant) {
    return (
      <div className="surface-copy">
        <h3>Grant detail</h3>
        <p>Select a grant to inspect the full record and launch watchlist or draft actions.</p>
      </div>
    );
  }

  const statusLabel = grantStatusLabel(grant);
  const deadlineState = deadlineUrgency(grant);
  const summaryText = grant.source_excerpt ?? grant.description ?? grant.purpose ?? null;
  const sourceSummary = grant.source_page_description ?? grant.source_page_title ?? grantSourceLabel(grant);
  const sourceHighlights = grant.source_highlights ?? [];
  const fundingAmount = grantFundingLabel(grant);
  const estimatedAmount =
    grant.est_amounts ??
    (grant.est_amount_min != null || grant.est_amount_max != null
      ? `${formatCurrency(grant.est_amount_min) ?? "?"} – ${formatCurrency(grant.est_amount_max) ?? "?"}`
      : null);
  const deadlineText = grantDeadlineLabel(grant);
  const deadlineClass =
    deadlineState === "urgent"
      ? "deadline urgent"
      : deadlineState === "soon"
        ? "deadline soon"
        : deadlineState === "closed"
          ? "deadline closed"
          : "deadline";
  const isWatchlisted = watchlistedPortalIds.has(grant.portal_id);
  const draftSchema = resolveGrantDraftSchema(grant);

  const hero = (
    <section className="panel-block detail-hero-card">
      <div className="detail-hero-top">
        <div className="detail-hero-title">
          <p className="eyebrow">Grant detail</p>
          <h4>{grant.title}</h4>
          <p className="muted">
            {grant.agency_dept ?? "Unknown agency"} — {grantSourceLabel(grant)}
          </p>
        </div>
        <div className="detail-badge-stack">
          <GrantStatusPill grant={grant} />
          <StatusPill tone="neutral">{deadlineText}</StatusPill>
          {grant.loi_required ? <span className="chip active">LOI required</span> : <span className="chip">No LOI</span>}
        </div>
      </div>

      <div className="detail-summary-grid">
        <div className="detail-summary-card">
          <p className="eyebrow">Snapshot</p>
          <dl className="kv-list compact">
            <Field label="Portal ID" value={grant.portal_id} />
            <Field label="Type" value={grant.grant_type} />
            <Field label="Source kind" value={grant.source_kind} />
            <Field label="Jurisdiction" value={grantJurisdictionLabel(grant)} />
          </dl>
        </div>

        <div className="detail-summary-card">
          <p className="eyebrow">Funding</p>
          <dl className="kv-list compact">
            <Field label="Available funds" value={fundingAmount} />
            <Field label="Estimated amount" value={estimatedAmount} />
            <Field label="Matching funds" value={grant.matching_funds} />
            <Field label="Funding method" value={grant.funding_method} />
          </dl>
        </div>

        <div className="detail-summary-card">
          <p className="eyebrow">Dates</p>
          <dl className="kv-list compact">
            <Field label="Open date" value={grant.open_date} />
            <Field label="Deadline" value={deadlineText} className={deadlineClass} />
            <Field label="Award period" value={grant.award_period} />
            <Field label="Updated" value={formatTimestamp(grant.updated_at)} />
          </dl>
        </div>
      </div>
    </section>
  );

  const overview = (
    <CollapsibleSection eyebrow="Grant summary" defaultOpen>
      <p className="detail-summary-copy">{orEmpty(summaryText, "No summary provided")}</p>
      <div className="detail-trail">
        <div>
          <span className="muted">Source page</span>
          <strong>{sourceSummary}</strong>
        </div>
        <div>
          <span className="muted">Last updated source</span>
          <strong>{orEmpty(grant.last_updated_source)}</strong>
        </div>
        <div>
          <span className="muted">Change notes</span>
          <strong>{orEmpty(grant.change_notes)}</strong>
        </div>
      </div>
      {sourceHighlights.length ? (
        <div className="chip-row detail-chip-row">
          {sourceHighlights.map((highlight) => (
            <span key={highlight} className="chip detail-chip">
              {highlight}
            </span>
          ))}
        </div>
      ) : null}
    </CollapsibleSection>
  );

  const draftSchemaPanel = (
    <CollapsibleSection eyebrow="Draft field profile" defaultOpen>
      <div className="chip-row detail-chip-row">
        <span className="chip active">{draftSchema.schema_name}</span>
        {draftSchemaSummary(draftSchema).map((item) => (
          <span key={item} className="chip">
            {item}
          </span>
        ))}
      </div>
      <p className="detail-summary-copy">
        This grant will render {draftSchema.section_count} writing sections before export. The LOI and matching-funds sections are
        included only when the source data requires them.
      </p>
    </CollapsibleSection>
  );

  const eligibility = (
    <CollapsibleSection eyebrow="Eligibility" defaultOpen>
      <dl className="kv-list compact">
        <Field label="Applicant types" value={grant.applicant_types.length ? grant.applicant_types.join(", ") : null} />
        <Field label="Applicant notes" value={grant.applicant_type_notes} />
        <Field label="Geography" value={grant.geography} />
        <Field label="Organization UID" value={grant.organization_uid} />
      </dl>
    </CollapsibleSection>
  );

  const evidence = (
    <CollapsibleSection eyebrow="Source evidence" defaultOpen={false}>
      <div className="detail-narrative-grid">
        <article>
          <span className="muted">Source page title</span>
          <p>{orEmpty(grant.source_page_title)}</p>
        </article>
        <article>
          <span className="muted">Source page description</span>
          <p>{orEmpty(grant.source_page_description)}</p>
        </article>
        <article>
          <span className="muted">Source excerpt</span>
          <p>{orEmpty(grant.source_excerpt)}</p>
        </article>
      </div>
    </CollapsibleSection>
  );

  const narrative = (
    <CollapsibleSection eyebrow="Narrative" defaultOpen={false}>
      <div className="detail-narrative-grid">
        <article>
          <span className="muted">Purpose</span>
          <p>{orEmpty(grant.purpose)}</p>
        </article>
        <article>
          <span className="muted">Description</span>
          <p>{orEmpty(grant.description)}</p>
        </article>
        <article>
          <span className="muted">Source excerpt</span>
          <p>{orEmpty(grant.source_excerpt)}</p>
        </article>
      </div>
    </CollapsibleSection>
  );

  const links = (
    <CollapsibleSection eyebrow="Links & contact" defaultOpen={false}>
      <dl className="kv-list compact">
        <Field label="Grant URL" value={grant.grant_url} />
        <Field label="Agency URL" value={grant.agency_url} />
        <Field label="Submission URL" value={grant.elec_submission_url} />
        <Field label="Subscribe URL" value={grant.agency_subscribe_url} />
        <Field label="Events URL" value={grant.grant_events_url} />
        <Field label="Contact" value={grant.contact_name} />
        <Field label="Contact email" value={grant.contact_email} />
        <Field label="Contact phone" value={grant.contact_phone} />
      </dl>
    </CollapsibleSection>
  );

  const actions = (
    <CollapsibleSection eyebrow="Actions" defaultOpen className="detail-rail-card detail-actions-card">
      <div className="detail-action-stack">
        <button
          type="button"
          className="secondary"
          onClick={() => void onToggleWatchlist(grant)}
          disabled={!canWrite}
          title={!canWrite ? writeDisabledReason : undefined}
        >
          {isWatchlisted ? "Remove watchlist" : "Save watchlist"}
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => void onCreateDraft(grant)}
          disabled={!canWrite}
          title={!canWrite ? writeDisabledReason : undefined}
        >
          {aiSettingsRequired ? "Create scaffold draft" : "Create draft"}
        </button>
        {aiSettingsRequired ? (
          <button type="button" className="ghost" onClick={onOpenAiSettings}>
            Configure AI
          </button>
        ) : null}
      </div>
      {!canWrite ? <p className="muted detail-action-note">{writeDisabledReason}</p> : null}
      {canWrite && aiSettingsRequired ? (
        <p className="muted detail-action-note">
          AI mode is selected, but no Anthropic key is configured. Open org settings to finish AI setup.
        </p>
      ) : null}
    </CollapsibleSection>
  );

  const keyFacts = (
    <CollapsibleSection eyebrow="Key facts" defaultOpen className="detail-rail-card">
      <dl className="kv-list compact">
        <Field label="Source" value={grantSourceLabel(grant)} />
        <Field label="Status" value={statusLabel} />
        <Field label="Deadline" value={deadlineText} className={deadlineClass} />
        <Field label="Funding" value={fundingAmount} />
        <Field label="Estimated amount" value={estimatedAmount} />
      </dl>
    </CollapsibleSection>
  );

  const railEvidence = (
    <CollapsibleSection eyebrow="Source evidence" defaultOpen={false} className="detail-rail-card">
      <div className="detail-rail-evidence">
        <p>{orEmpty(summaryText, "No summary provided")}</p>
        <small>{orEmpty(grant.source_page_title)}</small>
        <small>{orEmpty(grant.source_page_description)}</small>
      </div>
    </CollapsibleSection>
  );

  const rail = (
    <aside className="detail-rail">
      {actions}
      {keyFacts}
      {railEvidence}
    </aside>
  );

  if (layout === "page") {
    return (
      <div className="detail-shell detail-shell-page">
        {hero}
        <div className="detail-grid">
          <div className="detail-main">
            {overview}
            {draftSchemaPanel}
            {eligibility}
            {evidence}
            {narrative}
            {links}
          </div>
          {rail}
        </div>
      </div>
    );
  }

  return (
    <div className="surface-stack detail-stack">
      {hero}
      {overview}
      {draftSchemaPanel}
      {eligibility}
      {evidence}
      {narrative}
      {links}
      {actions}
    </div>
  );
}

function Field({
  label,
  value,
  className,
}: {
  label: string;
  value: string | null | undefined;
  className?: string;
}) {
  const isEmpty = value == null || value.trim() === "";
  return (
    <div>
      <dt>{label}</dt>
      <dd className={className}>{isEmpty ? <EmptyValue /> : value}</dd>
    </div>
  );
}
