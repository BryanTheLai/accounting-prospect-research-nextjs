import type Database from "better-sqlite3";

export const DEFAULT_YC_PAGE_SIZE = 50;
export const MAX_YC_PAGE_SIZE = 100;
export const MAX_YC_INGEST_SIZE = 200;

export type YcFilters = {
  query: string;
  batch: string;
  industry: string;
  minTeam: number;
  topOnly: boolean;
  hiringOnly: boolean;
  limit: number;
  offset: number;
};

export type YcDirectoryRow = {
  id: number;
  name: string;
  slug: string;
  website: string | null;
  rootDomain: string | null;
  batch: string;
  batchSeason: string | null;
  batchYear: number | null;
  status: string | null;
  stage: string | null;
  topCompany: number;
  isHiring: number;
  teamSize: number;
  industry: string | null;
  subindustry: string | null;
  tags: string | null;
  location: string | null;
  oneLiner: string | null;
  ycUrl: string | null;
  logoUrl: string | null;
};

export class YcInputError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
    this.name = "YcInputError";
  }
}

function parseInteger(value: string | null, fallback: number, label: string, min: number, max: number) {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value)) throw new YcInputError(`${label} must be a whole number.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new YcInputError(`${label} must be between ${min} and ${max}.`);
  }
  return number;
}

function parseBoolean(value: string | null, label: string) {
  if (value === null || value === "" || value === "0" || value === "false") return false;
  if (value === "1" || value === "true") return true;
  throw new YcInputError(`${label} must be true or false.`);
}

export function parseYcFilters(params: URLSearchParams): YcFilters {
  const requestedLimit = parseInteger(
    params.get("limit"),
    DEFAULT_YC_PAGE_SIZE,
    "Limit",
    1,
    MAX_YC_PAGE_SIZE,
  );
  const offset = parseInteger(params.get("offset"), 0, "Offset", 0, 100_000);
  const minTeam = parseInteger(params.get("minTeam"), 0, "Minimum team size", 0, 2_000);

  return {
    query: (params.get("q") || "").trim().slice(0, 200),
    batch: (params.get("batch") || "").trim().slice(0, 100),
    industry: (params.get("industry") || "").trim().slice(0, 100),
    minTeam,
    topOnly: parseBoolean(params.get("topOnly"), "Top company filter"),
    hiringOnly: parseBoolean(params.get("hiringOnly"), "Hiring filter"),
    limit: requestedLimit,
    offset,
  };
}

function whereFor(filters: YcFilters) {
  const conditions = [
    "(@query = '' OR name LIKE @queryLike ESCAPE '\\' OR one_liner LIKE @queryLike ESCAPE '\\' OR tags LIKE @queryLike ESCAPE '\\' OR root_domain LIKE @queryLike ESCAPE '\\')",
    "(@batch = '' OR batch = @batch)",
    "(@industry = '' OR industry = @industry)",
    "(coalesce(team_size, 0) >= @minTeam)",
    "(@topOnly = 0 OR coalesce(top_company, 0) = 1)",
    "(@hiringOnly = 0 OR coalesce(is_hiring, 0) = 1)",
  ];
  const escapedQuery = filters.query.replace(/[\\%_]/g, "\\$&");
  return {
    sql: conditions.join(" AND "),
    params: {
      query: filters.query,
      queryLike: `%${escapedQuery}%`,
      batch: filters.batch,
      industry: filters.industry,
      minTeam: filters.minTeam,
      topOnly: filters.topOnly ? 1 : 0,
      hiringOnly: filters.hiringOnly ? 1 : 0,
    },
  };
}

export function getYcDirectory(db: Database.Database, filters: YcFilters) {
  const { sql, params } = whereFor(filters);
  const count = db.prepare(`SELECT COUNT(*) AS count FROM yc_5year_directory WHERE ${sql}`)
    .get(params) as { count: number };
  const rows = db.prepare(`
    SELECT yc_id AS id, name, coalesce(slug, '') AS slug, website, root_domain AS rootDomain,
      batch, batch_season AS batchSeason, batch_year AS batchYear,
      status, stage, coalesce(top_company, 0) AS topCompany,
      coalesce(is_hiring, 0) AS isHiring, coalesce(team_size, 0) AS teamSize,
      industry, subindustry, tags, all_locations AS location,
      one_liner AS oneLiner, yc_url AS ycUrl, small_logo_url AS logoUrl
    FROM yc_5year_directory
    WHERE ${sql}
    ORDER BY coalesce(top_company, 0) DESC, coalesce(is_hiring, 0) DESC,
      coalesce(team_size, 0) DESC, name COLLATE NOCASE
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit: filters.limit, offset: filters.offset }) as YcDirectoryRow[];

  const batches = db.prepare("SELECT DISTINCT batch FROM yc_5year_directory WHERE trim(coalesce(batch, '')) <> '' ORDER BY batch DESC")
    .all() as { batch: string }[];
  const industries = db.prepare("SELECT DISTINCT industry FROM yc_5year_directory WHERE trim(coalesce(industry, '')) <> '' ORDER BY industry COLLATE NOCASE")
    .all() as { industry: string }[];

  return {
    rows,
    total: count.count,
    batches: batches.map((row) => row.batch),
    industries: industries.map((row) => row.industry),
    limit: filters.limit,
    offset: filters.offset,
    hasMore: filters.offset + rows.length < count.count,
  };
}

export function getFilteredYcRows(db: Database.Database, filters: YcFilters) {
  const { sql, params } = whereFor(filters);
  return db.prepare(`
    SELECT yc_id AS id, name, coalesce(slug, '') AS slug, website, root_domain AS rootDomain,
      batch, batch_season AS batchSeason, batch_year AS batchYear,
      status, stage, coalesce(top_company, 0) AS topCompany,
      coalesce(is_hiring, 0) AS isHiring, coalesce(team_size, 0) AS teamSize,
      industry, subindustry, tags, all_locations AS location,
      one_liner AS oneLiner, yc_url AS ycUrl, small_logo_url AS logoUrl
    FROM yc_5year_directory
    WHERE ${sql}
    ORDER BY coalesce(top_company, 0) DESC, coalesce(is_hiring, 0) DESC,
      coalesce(team_size, 0) DESC, name COLLATE NOCASE
  `).all(params) as YcDirectoryRow[];
}

function csvCell(value: unknown) {
  let text = String(value ?? "").replace(/\r?\n/g, " ");
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildYcCsv(rows: YcDirectoryRow[]) {
  const columns: (keyof YcDirectoryRow)[] = [
    "name", "batch", "batchYear", "topCompany", "isHiring", "teamSize",
    "industry", "rootDomain", "website", "location", "oneLiner", "ycUrl",
  ];
  const header = ["Company", "Batch", "Batch year", "Top company", "Hiring", "Team size", "Industry", "Domain", "Website", "Location", "One liner", "YC profile"];
  const csvRows = [header, ...rows.map((row) => columns.map((column) => row[column]))];
  return `\uFEFF${csvRows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

function normalizeIds(rawIds: unknown): number[] {
  if (!Array.isArray(rawIds)) throw new YcInputError("Choose one or more YC companies to add.");
  const ids = new Set<number>();
  for (const rawId of rawIds) {
    const id = typeof rawId === "number" ? rawId : typeof rawId === "string" && /^\d+$/.test(rawId) ? Number(rawId) : NaN;
    if (!Number.isSafeInteger(id) || id <= 0) throw new YcInputError("YC company IDs must be positive whole numbers.");
    ids.add(id);
  }
  if (ids.size === 0) throw new YcInputError("Choose one or more YC companies to add.");
  if (ids.size > MAX_YC_INGEST_SIZE) {
    throw new YcInputError(`Add at most ${MAX_YC_INGEST_SIZE} checked companies per import.`);
  }
  return [...ids];
}

type SourceYcRow = {
  yc_id: number;
  name: string;
  slug: string | null;
  root_domain: string | null;
  batch: string | null;
  team_size: number | null;
  top_company: number | null;
  is_hiring: number | null;
  industry: string | null;
  all_locations: string | null;
  one_liner: string | null;
  yc_url: string | null;
};

export function ingestYcRows(db: Database.Database, rawIds: unknown) {
  const ids = normalizeIds(rawIds);
  const placeholders = ids.map(() => "?").join(", ");
  const sourceRows = db.prepare(`
    SELECT yc_id, name, slug, root_domain, batch, team_size, top_company,
      is_hiring, industry, all_locations, one_liner, yc_url
    FROM yc_5year_directory WHERE yc_id IN (${placeholders})
  `).all(...ids) as SourceYcRow[];
  if (sourceRows.length !== ids.length) {
    throw new YcInputError("One or more selected YC companies are no longer available. Refresh the directory and try again.", 404);
  }

  const prospectColumns = new Set(
    (db.pragma("table_info(prospects)") as { name: string }[]).map((column) => column.name),
  );
  const allowedFields = [
    "lead_id", "company_name", "company_summary", "root_domain", "headquarters",
    "sector", "buyer_name", "buyer_title", "contact_email", "contact_phone",
    "sg_my_wedge", "quality_score", "tier", "status", "notes", "bro_summary",
    "proof_link", "campaign_id",
  ];
  const fields = allowedFields.filter((field) => prospectColumns.has(field));
  if (!prospectColumns.has("lead_id") || !prospectColumns.has("company_name")) {
    throw new Error("Prospects table is missing required identity columns.");
  }

  const insert = db.prepare(`
    INSERT INTO prospects (${fields.map((field) => `"${field}"`).join(", ")})
    VALUES (${fields.map(() => "?").join(", ")})
    ON CONFLICT(lead_id) DO NOTHING
  `);
  const insertMany = db.transaction((rows: SourceYcRow[]) => {
    let added = 0;
    for (const row of rows) {
      if (!row.slug?.trim() || !row.name?.trim()) continue;
      const leadId = `yc_${row.slug.trim().replaceAll("-", "_")}`;
      const teamSize = Number(row.team_size || 0);
      const topCompany = Number(row.top_company || 0) === 1;
      const hiring = Number(row.is_hiring || 0) === 1;
      const score = topCompany ? 95 : hiring ? 85 : teamSize >= 10 ? 75 : 60;
      const batch = row.batch || "";
      const companySummary = row.one_liner || `${row.name} - YC ${batch}`;
      const values: Record<string, string | number> = {
        lead_id: leadId,
        company_name: row.name,
        company_summary: companySummary,
        root_domain: row.root_domain || "",
        headquarters: row.all_locations || "",
        sector: row.industry || "",
        buyer_name: "",
        buyer_title: "",
        contact_email: "",
        contact_phone: "",
        sg_my_wedge: "Pilot Fatigue & Dedicated Venture Close ($800/mo Dedicated Accounting Desk)",
        quality_score: score,
        tier: "Tier 1 (YC Backed)",
        status: "Ready to Review",
        notes: `Source: YC directory | Batch: ${batch} | Team: ${teamSize} | Top company: ${topCompany ? "yes" : "no"} | Hiring: ${hiring ? "yes" : "no"}`,
        bro_summary: companySummary,
        proof_link: row.yc_url || `https://www.ycombinator.com/companies/${row.slug}`,
        campaign_id: "yc_us_expansion",
      };
      const result = insert.run(...fields.map((field) => values[field] ?? ""));
      added += result.changes;
    }
    return added;
  });
  const added = insertMany(sourceRows);
  return { added, skipped: ids.length - added, selected: ids.length };
}
