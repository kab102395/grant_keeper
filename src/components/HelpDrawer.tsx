import type { Surface } from "../hooks/useNavigation";

type HelpSection = {
  heading: string;
  body: string;
};

const HELP_CONTENT: Partial<Record<Surface, { title: string; sections: HelpSection[] }>> = {
  setup: {
    title: "Getting started",
    sections: [
      {
        heading: "Choose your entry point",
        body: "Create account starts a brand-new workspace for your organization. Sign in returns to an existing one. Join workspace adds you as a second writer to a workspace that already exists — you need an invite token from the workspace owner to do this.",
      },
      {
        heading: "Workspace code",
        body: "A short, URL-safe slug that names your workspace, like community-action-network. It becomes the root key for all your data in the database. You choose it on account creation; returning users enter it on the sign-in tab so the app knows which workspace to load.",
      },
      {
        heading: "Invite token",
        body: "A one-time code (starting with gk-) that the workspace owner generates on the Org Profile page. It lets a second writer join without knowing the raw workspace code. Tokens expire once used.",
      },
      {
        heading: "Sign in with Google",
        body: "Clicking Continue with Google opens your system browser for a Google sign-in. Once you approve, the browser closes automatically and Grant Keeper comes back into focus. If your workspace was created with an email/password, you will be prompted to enter that password once to link the two methods — after that, both work forever.",
      },
      {
        heading: "Remember email / password",
        body: "These checkboxes store credentials in a local config file on this device only. Useful for a machine you own; leave unchecked on shared computers.",
      },
    ],
  },
  dashboard: {
    title: "Workspace dashboard",
    sections: [
      {
        heading: "Grant counts",
        body: "Grants shows the total number of opportunities in your local catalog. Saved is how many you have bookmarked to your watchlist. Drafts is how many in-progress applications you have.",
      },
      {
        heading: "Refresh database vs. Sync live sources",
        body: "Refresh database reloads data already in Firebase — it is fast and shows you changes made by collaborators. Sync live sources goes out to the public grant databases (SAM.gov, Grants.gov, etc.) and pulls in new opportunities. Sync is slower and uses your network.",
      },
      {
        heading: "Sync report",
        body: "After a sync, the dashboard shows a summary of how many grants were added, updated, or removed per source. If a source failed, it appears here with an error message.",
      },
    ],
  },
  discover: {
    title: "Discovering grants",
    sections: [
      {
        heading: "Filtering",
        body: "Use the filter bar at the top to narrow grants by keyword, status, funding range, or applicant type. Filters combine — a keyword search plus a status filter shows only grants that match both.",
      },
      {
        heading: "Opening a grant",
        body: "Click any grant card to open the full detail view. From there you can read the eligibility requirements, see the funding range, and start a draft application.",
      },
      {
        heading: "Saving to watchlist",
        body: "Click the bookmark icon on any grant card or in the detail view to add it to your Watchlist. Click again to remove it. Watchlisted grants persist in your workspace so collaborators can see them too.",
      },
      {
        heading: "Starting a draft",
        body: "In the grant detail view, click Generate draft. Grant Keeper creates a structured application shell pre-filled with grant requirements and your org profile. You can edit it freely in the Drafts workspace.",
      },
    ],
  },
  watchlist: {
    title: "Your watchlist",
    sections: [
      {
        heading: "What gets saved",
        body: "The watchlist saves a reference to the grant (by portal ID) plus a timestamp and any note you add. The full grant record is loaded from your catalog each time you view the watchlist, so updates from syncs are reflected automatically.",
      },
      {
        heading: "Notes",
        body: "Each watchlist entry has a free-text note field. Use it to track status, assign it to a team member, or note why you flagged it. Notes are visible to all workspace members.",
      },
      {
        heading: "Removing a grant",
        body: "Click the bookmark icon or the Remove button on any watchlist card to un-save it. The grant stays in your catalog — only the bookmark is removed.",
      },
    ],
  },
  organization: {
    title: "Organization profile",
    sections: [
      {
        heading: "Why completeness matters",
        body: "When you generate an AI draft, Grant Keeper injects your org profile into the prompt. A complete profile means the draft will include your real mission, EIN, service area, and budget — instead of placeholders you have to fill in manually. Aim for 80%+ before heavy drafting.",
      },
      {
        heading: "EIN",
        body: "Employer Identification Number — the 9-digit federal tax ID assigned to your nonprofit by the IRS (format: 12-3456789). Required on most federal grant applications.",
      },
      {
        heading: "NTEE code",
        body: "National Taxonomy of Exempt Entities — a letter-and-number code that classifies your nonprofit's primary activity (e.g. P20 for Community Action Agencies). Used on some grant applications and in eligibility filters.",
      },
      {
        heading: "IRC status",
        body: "Your Internal Revenue Code tax-exempt classification, usually 501(c)(3) for public charities. Some grants restrict eligibility by IRC status.",
      },
      {
        heading: "Workspace invites",
        body: "Generate a one-time invite token to add a second writer to your workspace. Share the token with them; they enter it on the Join workspace tab of the sign-in screen. Each token can only be used once.",
      },
      {
        heading: "AI settings",
        body: "Paste your Anthropic API key here to enable AI-assisted draft generation. Validate first to confirm the key works, then save. Without a key, Grant Keeper uses a local scaffold instead, which creates a structured outline you fill in yourself.",
      },
      {
        heading: "Change password",
        body: "If your workspace account uses email/password sign-in, you can update the password here. Enter your current password to confirm, then set the new one. Your session stays signed in after the change.",
      },
    ],
  },
  drafts: {
    title: "Draft workspace",
    sections: [
      {
        heading: "Draft queue rail",
        body: "The left panel lists all your in-progress drafts. Click any card to open it in the editor. Use the ‹ toggle to collapse the rail when you need more horizontal space — it stays collapsed across page visits until you re-open it.",
      },
      {
        heading: "Grant reference drawer",
        body: "When a draft is linked to a grant, a View grant button appears in the toolbar. Click it to slide open a reference panel showing the grant's deadline, funding range, and eligibility — visible alongside your draft without leaving the page.",
      },
      {
        heading: "Scaffold mode vs. AI mode",
        body: "Scaffold mode generates a structured outline based on the grant schema and your org profile — no API key required and works offline. AI mode sends the same data to Anthropic's Claude to write a fuller first draft. You can switch the default in Org Profile → AI Settings.",
      },
      {
        heading: "Exporting",
        body: "Click Export in the editor to download the draft as a .docx file formatted for submission. The exported file includes all sections in the correct order. You can re-export any time after editing.",
      },
      {
        heading: "Draft status",
        body: "Each draft has a status: draft (in progress), review (ready for a second set of eyes), or submitted (final). Status is informational — it does not lock the draft for editing.",
      },
    ],
  },
};

export function HelpDrawer({
  open,
  surface,
  onClose,
}: {
  open: boolean;
  surface: Surface;
  onClose: () => void;
}) {
  const content = HELP_CONTENT[surface];

  return (
    <>
      {open && <div className="help-backdrop" onClick={onClose} aria-hidden="true" />}
      <aside className={open ? "help-drawer help-drawer-open" : "help-drawer"} aria-label="Help">
        <div className="help-drawer-header">
          <div>
            <p className="eyebrow">Help</p>
            <h2 className="help-drawer-title">{content?.title ?? "Grant Keeper"}</h2>
          </div>
          <button type="button" className="help-close-btn" onClick={onClose} aria-label="Close help">
            <CloseIcon />
          </button>
        </div>

        <div className="help-drawer-body">
          {content ? (
            content.sections.map((section) => (
              <div key={section.heading} className="help-section">
                <h3 className="help-section-heading">{section.heading}</h3>
                <p className="help-section-body">{section.body}</p>
              </div>
            ))
          ) : (
            <div className="help-section">
              <p className="muted">No specific help available for this page yet.</p>
            </div>
          )}

          <div className="help-footer-note">
            <p className="muted">Grant Keeper is built by <strong>Ember Tech Solutions LLC</strong>. For support, contact your workspace administrator.</p>
          </div>
        </div>
      </aside>
    </>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" style={{ width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" }}>
      <path d="M3 3l10 10M13 3L3 13" />
    </svg>
  );
}
