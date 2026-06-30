import type {
  AppCommandError,
  DraftRecord,
  GrantRecord,
  GrantSummary,
  OrganizationProgram,
  OrganizationRecord,
  SetupValidation,
  WatchlistEntry,
} from "./types";

export type Surface = "setup" | "dashboard" | "discover" | "grant" | "watchlist" | "organization" | "drafts" | "dev";
export type DiscoveryStatusFilter = "all" | "open" | "historical";
export type DiscoveryDeadlineFilter = "any" | "30" | "60" | "90";
export type DiscoveryBinaryFilter = "any" | "yes" | "no";
export type DiscoverySourceFilter = "all" | "csv" | "json" | "webpage";
export type DiscoveryJurisdictionFilter = "all" | "california" | "other";
export type DiscoverySortFilter = "recommended" | "jurisdiction" | "newest" | "funding";
export type DiscoveryFamilyFilter =
  | "all"
  | "ca-grants-portal"
  | "cde-grants"
  | "caloes-grants"
  | "calepa-grants"
  | "scc-grants"
  | "calfire-grants"
  | "hcd-grants"
  | "csd-grants"
  | "sgc-grants"
  | "cnra-grants"
  | "cdfa-grants"
  | "cdfw-grants"
  | "carb-grants"
  | "arts-council-grants"
  | "calosba-grants";

export type DiscoveryFilters = {
  query: string;
  status: DiscoveryStatusFilter;
  sourceKind: DiscoverySourceFilter;
  jurisdiction: DiscoveryJurisdictionFilter;
  sortBy: DiscoverySortFilter;
  sourceFamily: DiscoveryFamilyFilter;
  categories: string[];
  minAmount: string;
  maxAmount: string;
  deadlineWindow: DiscoveryDeadlineFilter;
  loiRequired: DiscoveryBinaryFilter;
  matchingFunds: DiscoveryBinaryFilter;
  onlyWatchlisted: boolean;
};

export type SetupForm = {
  mode: "create_account" | "sign_in" | "join_workspace";
  organization_name: string;
  remember_organization_name: boolean;
  workspace_code: string;
  invite_token: string;
  email: string;
  remember_email: boolean;
  password: string;
  remember_password: boolean;
};

export const SURFACES: Array<{ id: Surface; label: string; description: string }> = [
  { id: "dashboard", label: "Workspace", description: "Overview, status, and shortcuts." },
  { id: "discover", label: "Grant Discovery", description: "Browse live California grants." },
  { id: "grant", label: "Grant Detail", description: "Full grant record and actions." },
  { id: "watchlist", label: "Watchlist", description: "Saved grants for the current org." },
  { id: "organization", label: "Org Profile", description: "Current organization profile payload." },
  { id: "drafts", label: "Drafts", description: "Stored draft packages and provenance." },
  { id: "dev", label: "Dev Tools", description: "Health checks, syncs, and backend status." },
];

export const EMPTY_SETUP: SetupForm = {
  mode: "create_account",
  organization_name: "",
  remember_organization_name: true,
  workspace_code: "",
  invite_token: "",
  email: "",
  remember_email: true,
  password: "",
  remember_password: false,
};

export const DEFAULT_DISCOVERY_FILTERS: DiscoveryFilters = {
  query: "",
  status: "open",
  sourceKind: "all",
  jurisdiction: "all",
  sortBy: "recommended",
  sourceFamily: "all",
  categories: [],
  minAmount: "",
  maxAmount: "",
  deadlineWindow: "any",
  loiRequired: "any",
  matchingFunds: "any",
  onlyWatchlisted: false,
};

export function toMessage(value: unknown): string {
  const parsedError = parseAppCommandError(value);
  if (parsedError) return parsedError.message;
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return "Unexpected error";
}

export function parseAppCommandError(value: unknown): AppCommandError | null {
  if (isObject(value) && typeof value.message === "string") {
    return value as AppCommandError;
  }

  if (typeof value !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    if (isObject(parsed) && typeof parsed.message === "string") {
      return parsed as AppCommandError;
    }
  } catch {
    // fall back to legacy string classification
  }

  return null;
}

export function classifyAppError(value: unknown): {
  kind: "reauth" | "service_outage" | "generic";
  title: string;
  message: string;
} {
  const parsed = parseAppCommandError(value);
  const message = parsed?.message ?? toMessage(value);
  const normalized = `${parsed?.code ?? ""} ${parsed?.service ?? ""} ${parsed?.detail ?? ""} ${message}`.toLowerCase();

  if (
    normalized.includes("invalid_idp_response") ||
    normalized.includes("oauth 2.0 client id") ||
    normalized.includes("client_secret is missing")
  ) {
    return {
      kind: "generic",
      title: "Google sign-in configuration failed",
      message: parsed?.detail ?? message,
    };
  }

  if (
    parsed?.requires_reauth ||
    normalized.includes("invalid_grant") ||
    normalized.includes("token expired") ||
    normalized.includes("invalid refresh token") ||
    normalized.includes("missing active session") ||
    normalized.includes("missing refresh token")
  ) {
    return {
      kind: "reauth",
      title: "Session expired",
      message: "Your session expired or is no longer valid. Sign in again to reopen the workspace.",
    };
  }

  if (
    parsed?.retryable ||
    normalized.includes("rtdb request failed") ||
    normalized.includes("service account auth failed") ||
    normalized.includes("firebase auth request failed") ||
    normalized.includes("anthropic request failed") ||
    normalized.includes("temporarily unavailable") ||
    normalized.includes("timeout")
  ) {
    return {
      kind: "service_outage",
      title: "Service unavailable",
      message: "Grant Keeper could not reach one of its backend services. Your current screen state is still here. Retry in a moment.",
    };
  }

  return {
    kind: "generic",
    title: "Action failed",
    message,
  };
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function surfaceTitle(surface: Surface) {
  return SURFACES.find((entry) => entry.id === surface)?.label ?? surface;
}

/**
 * Builds the ready-to-send invite message an owner copies and pastes to a colleague.
 * Kept pure so it is easy to test and reuse outside the component.
 */
export function buildInviteMessage(token: string, organizationName?: string | null): string {
  const workspace = organizationName?.trim() ? `the "${organizationName.trim()}"` : "our";
  return [
    `You've been invited to join ${workspace} Grant Keeper workspace.`,
    "",
    "To join:",
    "1. Open Grant Keeper and choose \"Join workspace\"",
    `2. Enter this invite token: ${token}`,
    "3. Sign in with your email and password or with Google",
    "",
    "This token is single-use and stops working once it's claimed.",
  ].join("\n");
}

/**
 * Writes text to the clipboard, resolving to whether it succeeded. Wrapped so callers
 * get a boolean instead of a throwing promise (clipboard access can be blocked).
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to report failure
  }
  return false;
}

export function formatTimestamp(value: string | null | undefined) {
  if (!value) return "not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function formatCurrency(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "not set";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    value,
  );
}

export function grantStatusLabel(grant: GrantRecord) {
  const raw = (grant.status ?? "").trim().toLowerCase();
  if (raw.includes("closed") || raw.includes("expired") || raw.includes("inactive")) return "closed";
  if (raw.includes("open") || raw.includes("active")) return "open";

  if (grant.deadline_is_ongoing) return "open";

  const openDate = parseDate(grant.open_date);
  const deadlineDate = parseDate(grant.application_deadline);
  const now = Date.now();

  if (deadlineDate != null) {
    return deadlineDate.getTime() >= now ? "open" : "closed";
  }
  if (openDate != null) {
    return openDate.getTime() <= now ? "open" : "closed";
  }
  return raw || "unknown";
}

export function grantDeadlineLabel(grant: GrantRecord) {
  if (grant.deadline_is_ongoing) return "Ongoing";
  return grant.application_deadline ?? "not set";
}

export function grantFundingLabel(grant: GrantRecord) {
  return grant.est_amounts ?? grant.est_avail_funds ?? formatCurrency(grant.est_avail_funds_numeric);
}

export function grantSourceLabel(grant: GrantRecord) {
  return grant.source_name ?? grant.source_id ?? "California Grants Portal";
}

export function grantJurisdictionLabel(grant: GrantRecord) {
  return grant.source_jurisdiction ?? grant.geography ?? "Not set";
}

export function deadlineUrgency(grant: GrantRecord): "urgent" | "soon" | "distant" | "ongoing" | "closed" {
  if (grant.deadline_is_ongoing) return "ongoing";
  if (!grant.application_deadline) return "distant";

  const deadline = new Date(grant.application_deadline);
  if (Number.isNaN(deadline.getTime())) return "distant";

  const daysLeft = (deadline.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  if (daysLeft < 0) return "closed";
  if (daysLeft <= 14) return "urgent";
  if (daysLeft <= 45) return "soon";
  return "distant";
}

export function deadlineDaysLeft(grant: GrantRecord): number | null {
  if (grant.deadline_is_ongoing || !grant.application_deadline) return null;
  const deadline = new Date(grant.application_deadline);
  if (Number.isNaN(deadline.getTime())) return null;
  return Math.ceil((deadline.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

export const ORG_SCORED_FIELDS: Array<keyof OrganizationRecord> = [
  "name",
  "mission",
  "ein",
  "city",
  "state",
  "website",
  "contact_name",
  "contact_email",
  "service_area",
  "target_population",
  "annual_budget",
  "description",
];

function isFilledOrgField(value: unknown) {
  if (value == null) return false;
  if (typeof value === "number") return Number.isFinite(value);
  return String(value).trim().length > 0;
}

export function orgCompletenessScore(org: OrganizationRecord | null) {
  if (!org) return 0;
  const filled = ORG_SCORED_FIELDS.filter((field) => isFilledOrgField(org[field])).length;
  return Math.round((filled / ORG_SCORED_FIELDS.length) * 100);
}

export function orgMissingFields(org: OrganizationRecord | null) {
  if (!org) return ORG_SCORED_FIELDS;
  return ORG_SCORED_FIELDS.filter((field) => !isFilledOrgField(org[field]));
}

function grantStatusRank(grant: GrantRecord) {
  const label = grantStatusLabel(grant);
  if (label === "open") return 0;
  if (label === "closed") return 1;
  return 2;
}

function grantJurisdictionRank(grant: GrantRecord) {
  const jurisdiction = (grant.source_jurisdiction ?? grant.geography ?? "").trim().toLowerCase();
  if (!jurisdiction) return 2;
  if (jurisdiction.includes("california") || jurisdiction === "ca") return 0;
  return 1;
}

function grantRecencyValue(grant: GrantRecord) {
  const candidates = [grant.updated_at, grant.application_deadline, grant.open_date];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.getTime();
    }
  }
  return Number.NEGATIVE_INFINITY;
}

function grantFundingSortValue(grant: GrantRecord) {
  return grantFundingValue(grant) ?? Number.NEGATIVE_INFINITY;
}

function grantFamilyFilterValue(grant: GrantRecord) {
  const family = (grant.source_family ?? "").trim().toLowerCase();
  if (!family) return "other";
  return family;
}

export function sortGrantDiscoveryResults(grants: GrantRecord[], sortBy: DiscoverySortFilter = "recommended") {
  return [...grants].sort((left, right) => {
    if (sortBy === "funding") {
      const fundingDelta = grantFundingSortValue(right) - grantFundingSortValue(left);
      if (fundingDelta !== 0) return fundingDelta;
    }

    if (sortBy === "newest") {
      const recencyDelta = grantRecencyValue(right) - grantRecencyValue(left);
      if (recencyDelta !== 0) return recencyDelta;
    }

    if (sortBy === "jurisdiction") {
      const jurisdictionDelta = grantJurisdictionRank(left) - grantJurisdictionRank(right);
      if (jurisdictionDelta !== 0) return jurisdictionDelta;
    }

    if (sortBy === "recommended") {
      const jurisdictionDelta = grantJurisdictionRank(left) - grantJurisdictionRank(right);
      if (jurisdictionDelta !== 0) return jurisdictionDelta;
    }

    const statusDelta = grantStatusRank(left) - grantStatusRank(right);
    if (statusDelta !== 0) return statusDelta;

    const recencyDelta = grantRecencyValue(right) - grantRecencyValue(left);
    if (recencyDelta !== 0) return recencyDelta;

    if (sortBy === "funding") {
      const fundingDelta = grantFundingSortValue(right) - grantFundingSortValue(left);
      if (fundingDelta !== 0) return fundingDelta;
    }

    return left.title.localeCompare(right.title);
  });
}

export function serializePrograms(programs: OrganizationProgram[] | null | undefined): string {
  if (!programs?.length) return "";
  return programs
    .map((program) => {
      const budget = program.budget == null ? "" : String(program.budget);
      return [program.name, program.description ?? "", budget].join(" | ");
    })
    .join("\n");
}

export function parsePrograms(text: string): OrganizationProgram[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = "", description = "", budget = ""] = line.split("|").map((part) => part.trim());
      const parsedBudget = budget ? Number.parseInt(budget.replace(/[$,]/g, ""), 10) : Number.NaN;
      return {
        name,
        description: description || null,
        budget: Number.isNaN(parsedBudget) ? null : parsedBudget,
      };
    })
    .filter((program) => Boolean(program.name));
}

function grantRecordFromPayloadValue(value: Record<string, unknown>, portalId: string): GrantRecord {
  return {
    portal_id: String(value.portal_id ?? portalId),
    grant_id_external: typeof value.grant_id_external === "string" ? value.grant_id_external : null,
    status: typeof value.status === "string" ? value.status : null,
    last_updated_source: typeof value.last_updated_source === "string" ? value.last_updated_source : null,
    change_notes: typeof value.change_notes === "string" ? value.change_notes : null,
    title: String(value.title ?? portalId),
    agency_dept: typeof value.agency_dept === "string" ? value.agency_dept : null,
    grant_type: typeof value.grant_type === "string" ? value.grant_type : null,
    loi_required: Boolean(value.loi_required),
    categories: Array.isArray(value.categories)
      ? value.categories.filter((entry): entry is string => typeof entry === "string")
      : [],
    category_suggestion: typeof value.category_suggestion === "string" ? value.category_suggestion : null,
    purpose: typeof value.purpose === "string" ? value.purpose : null,
    description: typeof value.description === "string" ? value.description : null,
    source_page_title: typeof value.source_page_title === "string" ? value.source_page_title : null,
    source_page_description: typeof value.source_page_description === "string" ? value.source_page_description : null,
    source_excerpt: typeof value.source_excerpt === "string" ? value.source_excerpt : null,
    source_highlights: Array.isArray(value.source_highlights)
      ? value.source_highlights.filter((entry): entry is string => typeof entry === "string")
      : [],
    applicant_types: Array.isArray(value.applicant_types)
      ? value.applicant_types.filter((entry): entry is string => typeof entry === "string")
      : [],
    applicant_type_notes: typeof value.applicant_type_notes === "string" ? value.applicant_type_notes : null,
    geography: typeof value.geography === "string" ? value.geography : null,
    funding_source: typeof value.funding_source === "string" ? value.funding_source : null,
    funding_source_notes: typeof value.funding_source_notes === "string" ? value.funding_source_notes : null,
    matching_funds: typeof value.matching_funds === "string" ? value.matching_funds : null,
    matching_funds_notes: typeof value.matching_funds_notes === "string" ? value.matching_funds_notes : null,
    est_avail_funds: typeof value.est_avail_funds === "string" ? value.est_avail_funds : null,
    est_avail_funds_numeric: typeof value.est_avail_funds_numeric === "number" ? value.est_avail_funds_numeric : null,
    est_awards: typeof value.est_awards === "string" ? value.est_awards : null,
    est_amounts: typeof value.est_amounts === "string" ? value.est_amounts : null,
    est_amount_min: typeof value.est_amount_min === "number" ? value.est_amount_min : null,
    est_amount_max: typeof value.est_amount_max === "number" ? value.est_amount_max : null,
    funding_method: typeof value.funding_method === "string" ? value.funding_method : null,
    funding_method_notes: typeof value.funding_method_notes === "string" ? value.funding_method_notes : null,
    open_date: typeof value.open_date === "string" ? value.open_date : null,
    application_deadline: typeof value.application_deadline === "string" ? value.application_deadline : null,
    deadline_is_ongoing: Boolean(value.deadline_is_ongoing),
    award_period: typeof value.award_period === "string" ? value.award_period : null,
    exp_award_date: typeof value.exp_award_date === "string" ? value.exp_award_date : null,
    elec_submission_url: typeof value.elec_submission_url === "string" ? value.elec_submission_url : null,
    grant_url: typeof value.grant_url === "string" ? value.grant_url : null,
    agency_url: typeof value.agency_url === "string" ? value.agency_url : null,
    agency_subscribe_url: typeof value.agency_subscribe_url === "string" ? value.agency_subscribe_url : null,
    grant_events_url: typeof value.grant_events_url === "string" ? value.grant_events_url : null,
    contact_name: typeof value.contact_name === "string" ? value.contact_name : null,
    contact_email: typeof value.contact_email === "string" ? value.contact_email : null,
    contact_phone: typeof value.contact_phone === "string" ? value.contact_phone : null,
    award_stats: typeof value.award_stats === "string" ? value.award_stats : null,
    organization_uid: typeof value.organization_uid === "string" ? value.organization_uid : null,
    source_id: typeof value.source_id === "string" ? value.source_id : null,
    source_family: typeof value.source_family === "string" ? value.source_family : null,
    canonical_source_id: typeof value.canonical_source_id === "string" ? value.canonical_source_id : null,
    source_name: typeof value.source_name === "string" ? value.source_name : null,
    source_kind:
      value.source_kind === "csv" || value.source_kind === "json" || value.source_kind === "webpage"
        ? value.source_kind
        : null,
    source_url: typeof value.source_url === "string" ? value.source_url : null,
    source_record_key: typeof value.source_record_key === "string" ? value.source_record_key : null,
    source_jurisdiction: typeof value.source_jurisdiction === "string" ? value.source_jurisdiction : null,
    updated_at: typeof value.updated_at === "string" ? value.updated_at : null,
  };
}

export function normalizeGrantRecords(payload: unknown): GrantRecord[] {
  if (Array.isArray(payload)) {
    return payload.map((value, index) =>
      isObject(value) ? grantRecordFromPayloadValue(value, String(value.portal_id ?? value.id ?? index)) : grantRecordFromPayloadValue({}, String(index)),
    );
  }
  if (!isObject(payload)) return [];
  return Object.entries(payload).map(([portalId, value]) =>
    grantRecordFromPayloadValue(isObject(value) ? value : {}, portalId),
  );
}

export function normalizeGrants(payload: unknown): GrantSummary[] {
  return normalizeGrantRecords(payload).map((grant) => ({
    portal_id: grant.portal_id,
    title: grant.title,
    agency_dept: grant.agency_dept,
    status: grant.status,
    deadline: grant.deadline_is_ongoing ? "Ongoing" : grant.application_deadline,
  }));
}

export function normalizeWatchlistEntries(payload: unknown): WatchlistEntry[] {
  if (Array.isArray(payload)) {
    return payload.map((value, index) => {
      if (isObject(value)) {
        const portalId = String(value.portal_id ?? value.id ?? index);
        return {
          portal_id: portalId,
          saved: Boolean(value.saved ?? true),
          note: typeof value.note === "string" ? value.note : null,
          updated_at: typeof value.updated_at === "string" ? value.updated_at : null,
        };
      }
      return {
        portal_id: String(index),
        saved: true,
        note: null,
        updated_at: null,
      };
    });
  }
  if (!isObject(payload)) return [];
  return Object.entries(payload).map(([portalId, value]) => {
    if (isObject(value)) {
      return {
        portal_id: String(value.portal_id ?? portalId),
        saved: Boolean(value.saved ?? true),
        note: typeof value.note === "string" ? value.note : null,
        updated_at: typeof value.updated_at === "string" ? value.updated_at : null,
      };
    }
    return {
      portal_id: portalId,
      saved: Boolean(value),
      note: null,
      updated_at: null,
    };
  });
}

export function normalizeOrganization(payload: unknown, fallbackUid: string | null): OrganizationRecord | null {
  if (Array.isArray(payload)) {
    const first = payload[0];
    if (!isObject(first)) return null;
    const uid = typeof first.uid === "string" ? first.uid : fallbackUid ?? "";
    if (!uid) return null;
    return {
      uid,
      name: typeof first.name === "string" ? first.name : null,
      ein: typeof first.ein === "string" ? first.ein : null,
      ntee_code: typeof first.ntee_code === "string" ? first.ntee_code : null,
      irc_status: typeof first.irc_status === "string" ? first.irc_status : null,
      mission: typeof first.mission === "string" ? first.mission : null,
      founded_year: typeof first.founded_year === "number" ? first.founded_year : null,
      address: typeof first.address === "string" ? first.address : null,
      city: typeof first.city === "string" ? first.city : null,
      state: typeof first.state === "string" ? first.state : null,
      zip: typeof first.zip === "string" ? first.zip : null,
      website: typeof first.website === "string" ? first.website : null,
      phone: typeof first.phone === "string" ? first.phone : null,
      contact_name: typeof first.contact_name === "string" ? first.contact_name : null,
      contact_email: typeof first.contact_email === "string" ? first.contact_email : null,
      annual_budget: typeof first.annual_budget === "number" ? first.annual_budget : null,
      staff_count: typeof first.staff_count === "number" ? first.staff_count : null,
      volunteer_count: typeof first.volunteer_count === "number" ? first.volunteer_count : null,
      service_area: typeof first.service_area === "string" ? first.service_area : null,
      target_population: typeof first.target_population === "string" ? first.target_population : null,
      programs: Array.isArray(first.programs)
        ? first.programs
            .filter(isObject)
            .map((program) => ({
              name: String(program.name ?? ""),
              description: typeof program.description === "string" ? program.description : null,
              budget: typeof program.budget === "number" ? program.budget : null,
            }))
        : [],
      description: typeof first.description === "string" ? first.description : null,
      updated_at: typeof first.updated_at === "string" ? first.updated_at : null,
    };
  }
  if (!isObject(payload)) return null;
  const uid = typeof payload.uid === "string" ? payload.uid : fallbackUid ?? "";
  if (!uid) return null;
  return {
    uid,
    name: typeof payload.name === "string" ? payload.name : null,
    ein: typeof payload.ein === "string" ? payload.ein : null,
    ntee_code: typeof payload.ntee_code === "string" ? payload.ntee_code : null,
    irc_status: typeof payload.irc_status === "string" ? payload.irc_status : null,
    mission: typeof payload.mission === "string" ? payload.mission : null,
    founded_year: typeof payload.founded_year === "number" ? payload.founded_year : null,
    address: typeof payload.address === "string" ? payload.address : null,
    city: typeof payload.city === "string" ? payload.city : null,
    state: typeof payload.state === "string" ? payload.state : null,
    zip: typeof payload.zip === "string" ? payload.zip : null,
    website: typeof payload.website === "string" ? payload.website : null,
    phone: typeof payload.phone === "string" ? payload.phone : null,
    contact_name: typeof payload.contact_name === "string" ? payload.contact_name : null,
    contact_email: typeof payload.contact_email === "string" ? payload.contact_email : null,
    annual_budget: typeof payload.annual_budget === "number" ? payload.annual_budget : null,
    staff_count: typeof payload.staff_count === "number" ? payload.staff_count : null,
    volunteer_count: typeof payload.volunteer_count === "number" ? payload.volunteer_count : null,
    service_area: typeof payload.service_area === "string" ? payload.service_area : null,
    target_population: typeof payload.target_population === "string" ? payload.target_population : null,
    programs: Array.isArray(payload.programs)
      ? payload.programs
          .filter(isObject)
          .map((program) => ({
            name: String(program.name ?? ""),
            description: typeof program.description === "string" ? program.description : null,
            budget: typeof program.budget === "number" ? program.budget : null,
          }))
      : [],
    description: typeof payload.description === "string" ? payload.description : null,
    updated_at: typeof payload.updated_at === "string" ? payload.updated_at : null,
  };
}

export function normalizeDraftRecords(payload: unknown): DraftRecord[] {
  if (Array.isArray(payload)) {
    return payload.map((value, index) => {
      if (isObject(value)) {
        const generationMode = normalizeDraftGenerationMode(value.generation_mode);
        return {
          draft_id: String(value.draft_id ?? value.id ?? index),
          grant_portal_id: String(value.grant_portal_id ?? ""),
          status: typeof value.status === "string" ? value.status : "draft",
          version: typeof value.version === "number" ? value.version : 1,
          generation_mode: generationMode,
          provenance_note: typeof value.provenance_note === "string" ? value.provenance_note : null,
          title: typeof value.title === "string" ? value.title : null,
          body: typeof value.body === "string" ? value.body : null,
          notes: typeof value.notes === "string" ? value.notes : null,
          updated_at: typeof value.updated_at === "string" ? value.updated_at : null,
          provenance_org_uid: typeof value.provenance_org_uid === "string" ? value.provenance_org_uid : null,
          scaffold_template_version:
            typeof value.scaffold_template_version === "number" ? value.scaffold_template_version : null,
          section_org_overview: typeof value.section_org_overview === "string" ? value.section_org_overview : null,
          section_need_statement: typeof value.section_need_statement === "string" ? value.section_need_statement : null,
          section_project_description:
            typeof value.section_project_description === "string" ? value.section_project_description : null,
          section_goals_objectives:
            typeof value.section_goals_objectives === "string" ? value.section_goals_objectives : null,
          section_implementation_plan:
            typeof value.section_implementation_plan === "string" ? value.section_implementation_plan : null,
          section_evaluation_plan:
            typeof value.section_evaluation_plan === "string" ? value.section_evaluation_plan : null,
          section_budget_narrative:
            typeof value.section_budget_narrative === "string" ? value.section_budget_narrative : null,
          section_sustainability: typeof value.section_sustainability === "string" ? value.section_sustainability : null,
          section_org_capacity: typeof value.section_org_capacity === "string" ? value.section_org_capacity : null,
          section_loi_text: typeof value.section_loi_text === "string" ? value.section_loi_text : null,
          ai_model_used: typeof value.ai_model_used === "string" ? value.ai_model_used : null,
          ai_prompt_version: typeof value.ai_prompt_version === "number" ? value.ai_prompt_version : null,
          generation_tokens: typeof value.generation_tokens === "number" ? value.generation_tokens : null,
          user_edited: Boolean(value.user_edited),
          created_at: typeof value.created_at === "string" ? value.created_at : null,
        };
      }
      return {
        draft_id: String(index),
        grant_portal_id: "",
        status: "draft",
        version: 1,
        generation_mode: "unknown",
        title: null,
        body: null,
        notes: null,
        updated_at: null,
      };
    });
  }
  if (!isObject(payload)) return [];
  return Object.entries(payload).map(([draftId, value]) => {
    if (isObject(value)) {
      const generationMode = normalizeDraftGenerationMode(value.generation_mode);
      return {
        draft_id: String(value.draft_id ?? draftId),
        grant_portal_id: String(value.grant_portal_id ?? ""),
        status: typeof value.status === "string" ? value.status : "draft",
        version: typeof value.version === "number" ? value.version : 1,
        generation_mode: generationMode,
        provenance_note: typeof value.provenance_note === "string" ? value.provenance_note : null,
        title: typeof value.title === "string" ? value.title : null,
        body: typeof value.body === "string" ? value.body : null,
        notes: typeof value.notes === "string" ? value.notes : null,
        updated_at: typeof value.updated_at === "string" ? value.updated_at : null,
        provenance_org_uid: typeof value.provenance_org_uid === "string" ? value.provenance_org_uid : null,
        scaffold_template_version:
          typeof value.scaffold_template_version === "number" ? value.scaffold_template_version : null,
        section_org_overview: typeof value.section_org_overview === "string" ? value.section_org_overview : null,
        section_need_statement: typeof value.section_need_statement === "string" ? value.section_need_statement : null,
        section_project_description:
          typeof value.section_project_description === "string" ? value.section_project_description : null,
        section_goals_objectives:
          typeof value.section_goals_objectives === "string" ? value.section_goals_objectives : null,
        section_implementation_plan:
          typeof value.section_implementation_plan === "string" ? value.section_implementation_plan : null,
        section_evaluation_plan: typeof value.section_evaluation_plan === "string" ? value.section_evaluation_plan : null,
        section_budget_narrative:
          typeof value.section_budget_narrative === "string" ? value.section_budget_narrative : null,
        section_sustainability: typeof value.section_sustainability === "string" ? value.section_sustainability : null,
        section_org_capacity: typeof value.section_org_capacity === "string" ? value.section_org_capacity : null,
        section_loi_text: typeof value.section_loi_text === "string" ? value.section_loi_text : null,
        ai_model_used: typeof value.ai_model_used === "string" ? value.ai_model_used : null,
        ai_prompt_version: typeof value.ai_prompt_version === "number" ? value.ai_prompt_version : null,
        generation_tokens: typeof value.generation_tokens === "number" ? value.generation_tokens : null,
        user_edited: Boolean(value.user_edited),
        created_at: typeof value.created_at === "string" ? value.created_at : null,
      };
    }
    return {
      draft_id: draftId,
      grant_portal_id: "",
      status: "draft",
      version: 1,
      generation_mode: "unknown",
      title: null,
      body: null,
      notes: null,
      updated_at: null,
    };
  });
}

function normalizeDraftGenerationMode(value: unknown): DraftRecord["generation_mode"] {
  switch (value) {
    case "ai":
    case "local_scaffold":
    case "manual":
    case "unknown":
      return value;
    default:
      return "unknown";
  }
}

export function composeDraftBody(draft: DraftRecord) {
  const sections = [
    draft.section_org_overview && `Organization Overview:\n${draft.section_org_overview}`,
    draft.section_need_statement && `Need Statement:\n${draft.section_need_statement}`,
    draft.section_project_description && `Project Description:\n${draft.section_project_description}`,
    draft.section_goals_objectives && `Goals & Objectives:\n${draft.section_goals_objectives}`,
    draft.section_implementation_plan && `Implementation Plan:\n${draft.section_implementation_plan}`,
    draft.section_evaluation_plan && `Evaluation Plan:\n${draft.section_evaluation_plan}`,
    draft.section_budget_narrative && `Budget Narrative:\n${draft.section_budget_narrative}`,
    draft.section_sustainability && `Sustainability:\n${draft.section_sustainability}`,
    draft.section_org_capacity && `Organization Capacity:\n${draft.section_org_capacity}`,
    draft.section_loi_text && `Letter of Intent:\n${draft.section_loi_text}`,
  ].filter(Boolean) as string[];

  return [draft.title && `Title: ${draft.title}`, ...sections].filter(Boolean).join("\n\n");
}

export function exportDraftFileName(draft: DraftRecord) {
  const title = draft.title?.trim() || draft.grant_portal_id || draft.draft_id || "grant-keeper-draft";
  return `${title.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim()}-${draft.draft_id}.docx`;
}

function parseAmount(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.replace(/[$,]/g, "").trim();
  const numeric = Number.parseFloat(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function grantFundingValue(grant: GrantRecord) {
  return grant.est_avail_funds_numeric ?? grant.est_amount_max ?? grant.est_amount_min ?? parseAmount(grant.est_avail_funds) ?? parseAmount(grant.est_amounts);
}

function matchesBinaryField(value: string | null | undefined, filter: DiscoveryBinaryFilter) {
  if (filter === "any") return true;
  const lower = (value ?? "").toLowerCase();
  const negative =
    lower.includes("not required") ||
    lower === "no" ||
    lower.includes("no matching") ||
    lower.includes("none") ||
    lower.includes("false");
  const positive = !negative && (lower.includes("required") || lower.includes("yes") || lower.includes("true") || lower.includes("match"));
  return filter === "yes" ? positive : !positive;
}

export function grantMatchesFilters(grant: GrantRecord, filters: DiscoveryFilters) {
  const haystack = [
    grant.title,
    grant.agency_dept ?? "",
    grant.status ?? "",
    grant.purpose ?? "",
    grant.description ?? "",
    grant.source_name ?? "",
    grant.source_family ?? "",
    grant.source_id ?? "",
    grant.source_jurisdiction ?? "",
    grant.source_url ?? "",
    grant.grant_id_external ?? "",
    grant.contact_name ?? "",
    grant.categories.join(" "),
    grant.applicant_types.join(" "),
  ]
    .join(" ")
    .toLowerCase();
  const matchesQuery = haystack.includes(filters.query.trim().toLowerCase());
  const matchesStatus =
    filters.status === "all" ||
    (filters.status === "open"
      ? grantStatusLabel(grant) === "open"
      : grantStatusLabel(grant) === "closed");
  const matchesSourceKind =
    filters.sourceKind === "all" ||
    (grant.source_kind ?? "csv") === filters.sourceKind;
  const jurisdiction = (grant.source_jurisdiction ?? grant.geography ?? "").trim().toLowerCase();
  const matchesJurisdiction =
    filters.jurisdiction === "all" ||
    (filters.jurisdiction === "california"
      ? jurisdiction.includes("california") || jurisdiction === "ca"
      : jurisdiction !== "" && !jurisdiction.includes("california") && jurisdiction !== "ca");
  const matchesSourceFamily =
    filters.sourceFamily === "all" || grantFamilyFilterValue(grant) === filters.sourceFamily;
  const selectedCategories = filters.categories.map((category) => category.toLowerCase());
  const matchesCategories =
    selectedCategories.length === 0 ||
    selectedCategories.some((category) => grant.categories.some((grantCategory) => grantCategory.toLowerCase() === category));
  const grantAmount = grantFundingValue(grant);
  const minAmount = filters.minAmount.trim() ? Number.parseFloat(filters.minAmount) : Number.NaN;
  const maxAmount = filters.maxAmount.trim() ? Number.parseFloat(filters.maxAmount) : Number.NaN;
  const matchesMin = Number.isNaN(minAmount) || (grantAmount != null && grantAmount >= minAmount);
  const matchesMax = Number.isNaN(maxAmount) || (grantAmount != null && grantAmount <= maxAmount);
  const deadlineDays = filters.deadlineWindow === "any" ? null : Number.parseInt(filters.deadlineWindow, 10);
  const deadlineDate = parseDate(grant.application_deadline);
  const matchesDeadline =
    deadlineDays == null ||
    grant.deadline_is_ongoing ||
    (deadlineDate != null &&
      deadlineDate.getTime() >= Date.now() &&
      deadlineDate.getTime() - Date.now() <= deadlineDays * 24 * 60 * 60 * 1000);
  const matchesLoi = matchesBinaryField(grant.loi_required ? "yes" : "no", filters.loiRequired);
  const matchesMatchingFunds = matchesBinaryField(grant.matching_funds, filters.matchingFunds);
  return (
    matchesQuery &&
    matchesStatus &&
    matchesSourceKind &&
    matchesJurisdiction &&
    matchesSourceFamily &&
    matchesCategories &&
    matchesMin &&
    matchesMax &&
    matchesDeadline &&
    matchesLoi &&
    matchesMatchingFunds
  );
}

export function summarizeSetup(validation: SetupValidation | null) {
  return {
    ready: validation?.ready ? "ready" : "blocked",
    missing: validation?.missing_fields?.length ? validation.missing_fields.join(", ") : null,
    mode:
      validation?.session_mode === "firebase"
        ? "Firebase session"
        : validation?.session_mode === "workspace_profile"
          ? "Workspace session"
        : validation?.session_mode === "dev_profile"
          ? "Local dev profile"
          : "No session",
    workspaceReady: validation?.workspace_ready ? "ready" : "blocked",
    devProfileReady: validation?.dev_profile_ready ? "ready" : "blocked",
  };
}
