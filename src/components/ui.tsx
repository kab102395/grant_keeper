import type { ReactNode } from "react";
import type { GrantRecord } from "../lib/types";
import { deadlineDaysLeft, deadlineUrgency, grantStatusLabel } from "../lib/shell";

export type StatusTone = "open" | "soon" | "urgent" | "closed" | "neutral";

/**
 * Semantic status pill that hugs its content (never stretches). One consistent
 * shape and color language for grant state across every page.
 */
export function StatusPill({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <span className={`status-chip status-chip-${tone}`}>{children}</span>;
}

/**
 * Derives a grant's status pill from its status text and deadline urgency:
 * green "Open", amber "Closing soon" / "Closes in N days", red for the final
 * stretch, gray "Closed".
 */
export function GrantStatusPill({ grant }: { grant: GrantRecord }) {
  const status = grantStatusLabel(grant);
  if (status === "closed") {
    return <StatusPill tone="closed">Closed</StatusPill>;
  }

  const urgency = deadlineUrgency(grant);
  const daysLeft = deadlineDaysLeft(grant);

  if (urgency === "urgent" && daysLeft != null && daysLeft >= 0) {
    return (
      <StatusPill tone="urgent">
        {daysLeft === 0 ? "Closes today" : `Closes in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`}
      </StatusPill>
    );
  }
  if (urgency === "soon") {
    return <StatusPill tone="soon">Closing soon</StatusPill>;
  }
  return <StatusPill tone="open">Open</StatusPill>;
}

/**
 * A missing/empty field value. Renders a quiet em-dash or short phrase so empties
 * read as intentional instead of repeating "not set" everywhere.
 */
export function EmptyValue({ label = "—" }: { label?: string }) {
  return <span className="empty-value">{label}</span>;
}

/** Small "sparse details" tag for cards whose source data is thin. */
export function SparseTag({ children = "Sparse details" }: { children?: ReactNode }) {
  return <span className="sparse-tag">{children}</span>;
}

/** Icon + value used in the grant card meta strip and key-fact rows. */
export function MetaItem({
  icon,
  children,
  muted = false,
}: {
  icon: ReactNode;
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <span className={muted ? "meta-item meta-item-muted" : "meta-item"}>
      {icon}
      <span>{children}</span>
    </span>
  );
}
