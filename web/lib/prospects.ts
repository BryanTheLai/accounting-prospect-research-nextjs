import type Database from "better-sqlite3";
import { classifyEmailTier } from "./email-tier.mjs";
export { classifyEmailTier } from "./email-tier.mjs";

export type EmailTierFilter = "all" | "direct" | "direct_and_department" | "department" | "generic" | "system" | "missing";
export type EmailCheckStatus = "all" | "not_checked" | "mx_present" | "no_mx" | "invalid_syntax" | "lookup_error";

export type ProspectFilters = {
  query: string;
  company: string;
  founder: string;
  location: string;
  phone: string;
  status: string;
  campaignId: string;
  callableOnly: boolean;
  minFit: number;
  maxFit: number;
  hiringOnly: boolean;
  emailTier: EmailTierFilter;
  emailCheckStatus: EmailCheckStatus;
  leadTiers: string[];
  excludeGovernment: boolean;
  limit: number;
  offset: number;
};

type ProspectSourceRow = {
  id: string;
  company: string;
  location: string | null;
  sector: string | null;
  status: string | null;
  fit: number | null;
  leadTier: string | null;
  campaignId: string | null;
  signal: string | null;
  source: string | null;
  hasPhone: number;
  rootDomain: string | null;
  summary: string | null;
  notes: string | null;
  email: string | null;
  buyer: string | null;
  preflightEmail: string | null;
  preflightStatus: string | null;
};

export type ProspectResultRow = Omit<ProspectSourceRow, "rootDomain" | "summary" | "notes" | "email" | "buyer" | "preflightEmail" | "preflightStatus"> & {
  hiringSignal: boolean;
  emailTier: Exclude<EmailTierFilter, "all" | "direct_and_department">;
  emailCheckStatus: Exclude<EmailCheckStatus, "all">;
  leadTier: string | null;
  isGovernment: boolean;
};

export class ProspectFilterInputError extends Error {}

const emailTierValues = new Set<EmailTierFilter>(["all", "direct", "direct_and_department", "department", "generic", "system", "missing"]);
const emailCheckValues = new Set<EmailCheckStatus>(["all", "not_checked", "mx_present", "no_mx", "invalid_syntax", "lookup_error"]);

function numericParameter(params: URLSearchParams, name: string, fallback: number, min: number, max: number) {
  const raw = params.get(name);
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ProspectFilterInputError(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function booleanParameter(params: URLSearchParams, name: string, fallback = false) {
  const raw = params.get(name);
  if (raw === null) return fallback;
  if (["1", "true"].includes(raw.toLowerCase())) return true;
  if (["0", "false"].includes(raw.toLowerCase())) return false;
  throw new ProspectFilterInputError(`${name} must be true or false.`);
}

export function parseProspectFilters(params: URLSearchParams): ProspectFilters {
  const minFit = numericParameter(params, "minFit", 0, 0, 100);
  const maxFit = numericParameter(params, "maxFit", 100, 0, 100);
  if (minFit > maxFit) throw new ProspectFilterInputError("Minimum fit cannot be greater than maximum fit.");

  const emailTier = params.get("emailTier") || "all";
  if (!emailTierValues.has(emailTier as EmailTierFilter)) throw new ProspectFilterInputError("Choose a valid email quality tier.");

  const emailCheckStatus = params.get("emailCheckStatus") || "all";
  if (!emailCheckValues.has(emailCheckStatus as EmailCheckStatus)) throw new ProspectFilterInputError("Choose a valid email check status.");
  const leadTiers = params.getAll("tier").map((value) => value.trim()).filter(Boolean);
  if (leadTiers.length > 30 || leadTiers.some((value) => value.length > 120)) {
    throw new ProspectFilterInputError("Choose no more than 30 prospect tiers, each 120 characters or fewer.");
  }

  return {
    query: (params.get("q") || "").trim().slice(0, 120),
    company: (params.get("company") || "").trim().slice(0, 120),
    founder: (params.get("founder") || "").trim().slice(0, 120),
    location: (params.get("location") || "").trim().slice(0, 120),
    phone: (params.get("phone") || "").trim().slice(0, 120),
    status: params.get("status") || "all",
    campaignId: params.get("campaignId") || "all",
    callableOnly: booleanParameter(params, "callable", false),
    minFit,
    maxFit,
    hiringOnly: booleanParameter(params, "hiringOnly", false),
    emailTier: emailTier as EmailTierFilter,
    emailCheckStatus: emailCheckStatus as EmailCheckStatus,
    leadTiers: [...new Set(leadTiers)],
    excludeGovernment: booleanParameter(params, "excludeGovernment", false),
    limit: numericParameter(params, "limit", 150, 1, 500),
    offset: numericParameter(params, "offset", 0, 0, 1_000_000),
  };
}

const governmentKeywords = [
  "department of", "internal revenue service", "securities and exchange commission", "federal reserve", "federal trade commission", "department of justice", "department of defense", "department of state", "department of treasury", "small business administration", "us army", "us navy", "us air force", "homeland security", "environmental protection agency", "national science foundation",
  "ministry of", "commission of", "board of", "corporation of", "customs", "police", "military", "statutory board", "govtech", "monetary authority", "inland revenue", "housing authority", "land transport", "environment agency", "public utilities", "water agency", "redevelopment authority", "petronas", "tenaga nasional", "telekom", "temasek holdings", "khazanah",
];
const governmentSummaryPhrases = ["ministry", "statutory board", "municipal council", "government-linked", "agency under the ministry"];

function isGovernmentDomain(rawDomain: string | null) {
  const domain = (rawDomain || "").toLowerCase().trim().replace(/^https?:\/\//, "").split("/", 1)[0];
  return /\.(?:gov|mil|edu)(?:\.[a-z]{2})?$/.test(domain) || /\.ac\.[a-z]{2}$/.test(domain) || /\.gc\.ca$/.test(domain);
}

export function isGovernmentLead(row: Pick<ProspectSourceRow, "company" | "rootDomain" | "email" | "summary">) {
  const emailDomain = row.email?.includes("@") ? row.email.split("@").at(-1) || "" : "";
  if (isGovernmentDomain(row.rootDomain) || isGovernmentDomain(emailDomain)) return true;
  const company = (row.company || "").toLowerCase();
  if (governmentKeywords.some((keyword) => new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(company))) return true;
  const summary = (row.summary || "").toLowerCase();
  return governmentSummaryPhrases.some((phrase) => summary.includes(phrase));
}

export function hasHiringEvidence(row: Pick<ProspectSourceRow, "notes" | "source" | "signal" | "summary">) {
  const notes = row.notes || "";
  if (/\bhiring\s*:\s*yes\b|\bactively hiring\b|\bhiring now\b|\bactive job posting\b/i.test(notes)) return true;
  const source = (row.source || "").toLowerCase();
  const signal = `${row.signal || ""} ${row.summary || ""}`;
  return /jobstreet\.|indeed\.|greenhouse\.io|lever\.co|myworkdayjobs\.|\/jobs?\/|\/careers?\//i.test(source) || /\bactively hiring\b|\bhiring now\b|\bjob posting\b/i.test(signal);
}

function preflightStatus(row: ProspectSourceRow) {
  const statuses = new Set(["mx_present", "no_mx", "invalid_syntax", "lookup_error"]);
  return row.email && row.preflightEmail === row.email && statuses.has(row.preflightStatus || "")
    ? row.preflightStatus as Exclude<EmailCheckStatus, "all" | "not_checked">
    : "not_checked";
}

function matchesEmailTier(filter: EmailTierFilter, tier: ProspectResultRow["emailTier"]) {
  if (filter === "all") return true;
  if (filter === "direct_and_department") return tier === "direct" || tier === "department";
  return filter === tier;
}

export function filterProspectRows(rows: ProspectSourceRow[], filters: ProspectFilters): ProspectResultRow[] {
  return rows.flatMap((row) => {
    const hiringSignal = hasHiringEvidence(row);
    const emailTier = classifyEmailTier(row.email, row.buyer);
    const emailCheckStatus = preflightStatus(row);
    const isGovernment = isGovernmentLead(row);
    if (filters.minFit > 0 && (row.fit ?? 0) < filters.minFit) return [];
    if (filters.maxFit < 100 && (row.fit ?? 0) > filters.maxFit) return [];
    if (filters.hiringOnly && !hiringSignal) return [];
    if (filters.leadTiers.length && !filters.leadTiers.includes(row.leadTier || "")) return [];
    if (!matchesEmailTier(filters.emailTier, emailTier)) return [];
    if (filters.emailCheckStatus !== "all" && filters.emailCheckStatus !== emailCheckStatus) return [];
    if (filters.excludeGovernment && isGovernment) return [];
    return [{
      id: row.id,
      company: row.company,
      location: row.location,
      sector: row.sector,
      status: row.status,
      fit: row.fit,
      campaignId: row.campaignId,
      signal: row.signal,
      source: row.source,
      hasPhone: row.hasPhone,
      hiringSignal,
      emailTier,
      emailCheckStatus,
      leadTier: row.leadTier,
      isGovernment,
    }];
  });
}

export function getProspects(db: Database.Database, filters: ProspectFilters) {
  const hasPreflightTable = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'email_preflight'").get());
  const preflightColumns = hasPreflightTable
    ? "pf.email AS preflightEmail, pf.mx_status AS preflightStatus"
    : "NULL AS preflightEmail, NULL AS preflightStatus";
  const preflightJoin = hasPreflightTable ? "LEFT JOIN email_preflight pf ON pf.lead_id = p.lead_id" : "";
  const sourceRows = db.prepare(`
    SELECT p.lead_id AS id, p.company_name AS company, p.headquarters AS location,
      p.sector, p.status, p.quality_score AS fit, p.tier AS leadTier, p.campaign_id AS campaignId,
      p.sg_my_wedge AS signal, p.proof_link AS source,
      CASE WHEN trim(coalesce(p.contact_phone, '')) <> '' THEN 1 ELSE 0 END AS hasPhone,
      p.root_domain AS rootDomain, p.company_summary AS summary, p.notes,
      p.contact_email AS email, p.buyer_name AS buyer, ${preflightColumns}
    FROM prospects p
    ${preflightJoin}
    WHERE (@query = '' OR p.company_name LIKE @like OR p.headquarters LIKE @like OR p.sector LIKE @like OR p.sg_my_wedge LIKE @like OR p.buyer_name LIKE @like OR p.buyer_title LIKE @like OR p.contact_phone LIKE @like)
      AND (@company = '' OR p.company_name LIKE @companyLike)
      AND (@founder = '' OR p.buyer_name LIKE @founderLike OR p.buyer_title LIKE @founderLike)
      AND (@location = '' OR p.headquarters LIKE @locationLike)
      AND (@phone = '' OR p.contact_phone LIKE @phoneLike)
      AND (@status = 'all' OR (@status='needs_review' AND p.status IN ('NEW','Ready to Review','Target Identified')) OR (@status='call_active' AND coalesce(p.status,'') NOT IN ('Discarded / DNC','Bounced / 550 Invalid','Closed Won (Retainer Signed)')) OR p.status = @status)
      AND (@campaignId = 'all' OR p.campaign_id = @campaignId)
      AND (@callableOnly = 0 OR trim(coalesce(p.contact_phone, '')) <> '')
    ORDER BY COALESCE(p.quality_score, 0) DESC, p.company_name COLLATE NOCASE
  `).all({
    query: filters.query,
    like: `%${filters.query}%`,
    company: filters.company,
    companyLike: `%${filters.company}%`,
    founder: filters.founder,
    founderLike: `%${filters.founder}%`,
    location: filters.location,
    locationLike: `%${filters.location}%`,
    phone: filters.phone,
    phoneLike: `%${filters.phone}%`,
    status: filters.status,
    campaignId: filters.campaignId,
    callableOnly: filters.callableOnly ? 1 : 0,
  }) as ProspectSourceRow[];

  const filteredRows = filterProspectRows(sourceRows, filters);
  const statuses = db.prepare("SELECT status, COUNT(*) AS count FROM prospects GROUP BY status ORDER BY count DESC").all();
  const tierRows = db.prepare("SELECT DISTINCT tier FROM prospects WHERE trim(coalesce(tier, '')) <> '' ORDER BY tier COLLATE NOCASE").all() as Array<{ tier: string }>;
  const tiers = tierRows.map((row) => row.tier);
  return {
    rows: filteredRows.slice(filters.offset, filters.offset + filters.limit),
    statuses,
    tiers,
    total: filteredRows.length,
    hasMore: filters.offset + filters.limit < filteredRows.length,
  };
}
