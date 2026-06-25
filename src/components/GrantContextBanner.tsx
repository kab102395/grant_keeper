import type { GrantRecord } from "../lib/types";
import { grantStatusLabel } from "../lib/shell";

export function GrantContextBanner({ grant }: { grant: GrantRecord | null }) {
  if (!grant) {
    return null;
  }

  return (
    <div className="grant-context-banner">
      <span className="grant-context-label">Drafting for:</span>
      <span className="grant-context-title">{grant.title}</span>
      <span className="grant-context-agency">{grant.agency_dept ?? "Unknown agency"}</span>
      <span className="status-pill">{grantStatusLabel(grant)}</span>
    </div>
  );
}
