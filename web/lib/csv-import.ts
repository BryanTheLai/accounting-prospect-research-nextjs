import type Database from "better-sqlite3";
import { readSheet } from "read-excel-file/node";

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5_000;
export const MAX_PREVIEW_ROWS = 25;

export type ImportField =
  | "company_name"
  | "company_summary"
  | "root_domain"
  | "headquarters"
  | "sector"
  | "buyer_name"
  | "buyer_title"
  | "contact_email"
  | "contact_phone"
  | "proof_link"
  | "notes";

export type ImportRecord = {
  rowNumber: number;
  company: string;
  summary: string;
  domain: string;
  location: string;
  sector: string;
  buyerName: string;
  buyerTitle: string;
  email: string;
  phone: string;
  source: string;
  notes: string;
  state: "ready" | "existing" | "duplicate" | "invalid";
  reason: string;
};

export class ImportInputError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
    this.name = "ImportInputError";
  }
}

const FIELD_ALIASES: Record<ImportField, string[]> = {
  company_name: ["company_name", "company", "organization_name", "organization", "business_name"],
  company_summary: ["company_summary", "one_liner", "summary", "company_description", "description"],
  root_domain: ["root_domain", "domain"],
  headquarters: ["headquarters", "location", "city", "region"],
  sector: ["sector", "industry", "vertical"],
  buyer_name: ["buyer_name", "contact_name", "founder_name"],
  buyer_title: ["buyer_title", "contact_title", "job_title", "title"],
  contact_email: ["contact_email", "email", "email_address", "work_email"],
  contact_phone: ["contact_phone", "phone", "phone_number"],
  proof_link: ["proof_link", "source_url", "source_link"],
  notes: ["notes", "note", "comments"],
};
const IMPORT_FIELDS: ImportField[] = [
  "company_name", "company_summary", "root_domain", "headquarters", "sector",
  "buyer_name", "buyer_title", "contact_email", "contact_phone", "proof_link", "notes",
];

const IMPORT_NOTE = "Imported from spreadsheet; requires review.";
const UPDATE_NOTE = "Updated from spreadsheet import; requires review.";

// Mapped spreadsheet columns that may overwrite an existing prospect's values.
// status, lead_id, quality_score and tier are deliberately absent: importing a
// spreadsheet never rewrites pipeline stage, identity, score, or tier.
const OVERWRITABLE_COLUMNS: Array<[string, ImportField]> = [
  ["company_name", "company_name"],
  ["company_summary", "company_summary"],
  ["root_domain", "root_domain"],
  ["headquarters", "headquarters"],
  ["sector", "sector"],
  ["buyer_name", "buyer_name"],
  ["buyer_title", "buyer_title"],
  ["contact_email", "contact_email"],
  ["contact_phone", "contact_phone"],
  ["proof_link", "proof_link"],
];

function appendImportNote(notes: string, note: string) {
  const existing = notes.trim();
  if (!existing) return note;
  return existing.endsWith(note) ? existing : `${existing}\n${note}`;
}

type ImportDocument = { headers: string[]; records: string[][] };
type ColumnMapping = Partial<Record<ImportField, string>>;
type AnalyzedRow = { record: ImportRecord; values: Record<ImportField, string> };

function normalizeHeader(value: string) {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function parseCsvText(csvText: string): ImportDocument {
  if (typeof csvText !== "string" || csvText.trim() === "") {
    throw new ImportInputError("Paste or upload a CSV file first.");
  }
  if (Buffer.byteLength(csvText, "utf8") > MAX_IMPORT_BYTES) {
    throw new ImportInputError("CSV files must be 2 MB or smaller.", 413);
  }

  const text = csvText.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let afterQuote = false;

  const finishField = () => {
    row.push(field);
    field = "";
    afterQuote = false;
  };
  const finishRow = () => {
    finishField();
    if (row.some((value) => value.trim() !== "")) records.push(row);
    row = [];
    if (records.length > MAX_IMPORT_ROWS + 1) {
      throw new ImportInputError(`CSV files may contain at most ${MAX_IMPORT_ROWS.toLocaleString()} data rows.`, 413);
    }
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (afterQuote) {
      if (character === ",") finishField();
      else if (character === "\n" || character === "\r") {
        finishRow();
        if (character === "\r" && text[index + 1] === "\n") index += 1;
      } else {
        throw new ImportInputError("CSV has characters after a closing quote. Check the row quoting.");
      }
      continue;
    }

    if (character === '"') {
      if (field.length !== 0) throw new ImportInputError("CSV has a quote inside an unquoted value.");
      inQuotes = true;
    } else if (character === ",") {
      finishField();
    } else if (character === "\n" || character === "\r") {
      finishRow();
      if (character === "\r" && text[index + 1] === "\n") index += 1;
    } else {
      field += character;
    }
  }

  if (inQuotes) throw new ImportInputError("CSV ends inside a quoted value.");
  if (row.length > 0 || field.length > 0 || afterQuote) finishRow();
  if (records.length < 2) throw new ImportInputError("CSV needs a header row and at least one data row.");
  if (records[0].some((header) => header.includes("\u0000"))) throw new ImportInputError("CSV headers contain an invalid character.");
  return { headers: records[0].map((header) => header.trim()), records: records.slice(1) };
}

function stringifyXlsxCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  throw new ImportInputError("XLSX contains a cell type that cannot be imported.");
}

async function parseXlsxBuffer(buffer: Buffer): Promise<ImportDocument> {
  if (buffer.length === 0) throw new ImportInputError("Choose a non-empty XLSX file.");
  if (buffer.length > MAX_IMPORT_BYTES) {
    throw new ImportInputError("XLSX files must be 2 MB or smaller.", 413);
  }

  try {
    // This parser reads values from the first worksheet. It doesn't evaluate formulas;
    // a spreadsheet-saved cached result may be returned as an ordinary cell value.
    const sheet = await readSheet(buffer, { trim: false });
    const rows = sheet
      .map((row) => row.map(stringifyXlsxCell))
      .filter((row) => row.some((cell) => cell.trim() !== ""));
    if (rows.length < 2) throw new ImportInputError("XLSX needs a header row and at least one data row.");
    if (rows.length > MAX_IMPORT_ROWS + 1) {
      throw new ImportInputError(`XLSX files may contain at most ${MAX_IMPORT_ROWS.toLocaleString()} data rows.`, 413);
    }
    return { headers: rows[0].map((header) => header.trim()), records: rows.slice(1) };
  } catch (error) {
    if (error instanceof ImportInputError) throw error;
    throw new ImportInputError("This is not a readable .xlsx workbook. Save it as an unencrypted .xlsx file and try again.");
  }
}

function mapColumns(headers: string[]): { mapping: ColumnMapping; ignoredHeaders: string[] } {
  const normalized = headers.map(normalizeHeader);
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  for (const field of IMPORT_FIELDS) {
    const aliases = FIELD_ALIASES[field];
    const index = aliases.map((alias) => normalized.indexOf(alias)).find((candidate) => candidate >= 0 && !used.has(candidate));
    if (index !== undefined && index >= 0) {
      mapping[field] = headers[index];
      used.add(index);
    }
  }
  if (!mapping.company_name) {
    throw new ImportInputError("Add a recognized company column: company_name, company, organization, or business_name.", 422);
  }
  return { mapping, ignoredHeaders: headers.filter((_, index) => !used.has(index)) };
}

function emptyImportRecord(rowNumber: number): ImportRecord {
  return {
    rowNumber, company: "", summary: "", domain: "", location: "", sector: "",
    buyerName: "", buyerTitle: "", email: "", phone: "", source: "", notes: "",
    state: "ready", reason: "",
  };
}

function normalizeCompanyName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function valuesFromRow(headers: string[], row: string[], mapping: ColumnMapping) {
  const values: Record<ImportField, string> = {
    company_name: "", company_summary: "", root_domain: "", headquarters: "", sector: "",
    buyer_name: "", buyer_title: "", contact_email: "", contact_phone: "", proof_link: "", notes: "",
  };
  for (const field of IMPORT_FIELDS) {
    const header = mapping[field];
    const index = header === undefined ? -1 : headers.indexOf(header);
    values[field] = index >= 0 ? (row[index] || "").trim() : "";
  }
  return values;
}

function readProspectColumnNames(db: Database.Database) {
  const metadata = db.pragma("table_info(prospects)");
  if (!Array.isArray(metadata)) throw new Error("Prospects table metadata is unavailable.");
  return new Set(metadata.flatMap((column: unknown) => {
    if (typeof column !== "object" || column === null || !("name" in column) || typeof column.name !== "string") return [];
    return [column.name];
  }));
}

function analyzeDocument(db: Database.Database, document: ImportDocument, campaignId: string) {
  const campaign = db.prepare<unknown[], { id: string; name: string; status: string | null }>(
    "SELECT campaign_id AS id, name, status FROM campaigns WHERE campaign_id = ?",
  ).get(campaignId);
  if (!campaign) throw new ImportInputError("Choose an existing campaign before previewing the file.", 404);
  if (campaign.status === "ARCHIVED") throw new ImportInputError("This campaign is archived. Choose an active campaign.", 400);
  if (document.headers.some((header) => header.includes("\u0000"))) {
    throw new ImportInputError("File headers contain an invalid character.");
  }

  const { mapping, ignoredHeaders } = mapColumns(document.headers);
  // Normalized company name -> real lead_id. One lookup backs both the preview
  // state and the UPDATE that importDocumentRows later runs, so preview and
  // apply can never disagree about which row an import row refers to.
  const existingRecords = new Map<string, string>();
  for (const row of db.prepare<[], { company_name: string; lead_id: string }>(
    "SELECT company_name, lead_id FROM prospects",
  ).all()) {
    const key = normalizeCompanyName(row.company_name || "");
    if (key && !existingRecords.has(key)) existingRecords.set(key, row.lead_id);
  }
  const existingNames = new Set(existingRecords.keys());
  const seenNames = new Set<string>();
  const analyzedRows: AnalyzedRow[] = document.records.map((importRow, index) => {
    const record = emptyImportRecord(index + 2);
    const values = valuesFromRow(document.headers, importRow, mapping);
    const company = values.company_name;
    record.company = company;
    record.summary = values.company_summary;
    record.domain = values.root_domain;
    record.location = values.headquarters;
    record.sector = values.sector;
    record.buyerName = values.buyer_name;
    record.buyerTitle = values.buyer_title;
    record.email = values.contact_email;
    record.phone = values.contact_phone;
    record.source = values.proof_link;
    record.notes = values.notes;

    if (importRow.some((cell) => cell.includes("\u0000")) || importRow.some((cell) => cell.length > 10_000)) {
      record.state = "invalid";
      record.reason = "Contains an invalid or overlong cell.";
    } else if (importRow.length > document.headers.length) {
      record.state = "invalid";
      record.reason = "Has more values than the header row.";
    } else if (!company) {
      record.state = "invalid";
      record.reason = "Company name is required.";
    } else if (company.length > 160) {
      record.state = "invalid";
      record.reason = "Company name exceeds 160 characters.";
    } else {
      const key = normalizeCompanyName(company);
      // A company repeated within the same file is a duplicate regardless of
      // whether it also exists in the database: the first row always wins, so
      // the last row can never clobber what the first one supplied.
      if (seenNames.has(key)) {
        record.state = "duplicate";
        record.reason = "Duplicate company in this CSV; first row takes precedence.";
      } else if (existingNames.has(key)) {
        record.state = "existing";
        record.reason = "Company already exists; the existing record will be updated with the mapped columns.";
        seenNames.add(key);
      } else {
        seenNames.add(key);
      }
    }
    return { record, values };
  });

  const summary = {
    campaign,
    mapping,
    ignoredHeaders,
    totalRows: analyzedRows.length,
    readyRows: analyzedRows.filter((row) => row.record.state === "ready").length,
    existingRows: analyzedRows.filter((row) => row.record.state === "existing").length,
    updatedRows: analyzedRows.filter((row) => row.record.state === "existing").length,
    duplicateRows: analyzedRows.filter((row) => row.record.state === "duplicate").length,
    invalidRows: analyzedRows.filter((row) => row.record.state === "invalid").length,
    previewRows: analyzedRows.slice(0, MAX_PREVIEW_ROWS).map((row) => row.record),
  };
  return { summary, rows: analyzedRows, existingRecords };
}

export function listImportCampaigns(db: Database.Database) {
  return db.prepare<[], { id: string; name: string; status: string | null }>(
    "SELECT campaign_id AS id, name, status FROM campaigns WHERE status<>'ARCHIVED' ORDER BY name COLLATE NOCASE",
  ).all();
}

export function previewCsvImport(db: Database.Database, csvText: string, campaignId: string) {
  if (typeof campaignId !== "string" || !campaignId.trim() || campaignId.length > 160) {
    throw new ImportInputError("Choose an existing campaign before previewing the CSV.");
  }
  return analyzeDocument(db, parseCsvText(csvText), campaignId.trim()).summary;
}

export async function previewXlsxImport(db: Database.Database, workbook: Buffer, campaignId: string) {
  if (typeof campaignId !== "string" || !campaignId.trim() || campaignId.length > 160) {
    throw new ImportInputError("Choose an existing campaign before previewing the XLSX file.");
  }
  return analyzeDocument(db, await parseXlsxBuffer(workbook), campaignId.trim()).summary;
}

function importDocumentRows(db: Database.Database, document: ImportDocument, campaignId: string) {
  if (typeof campaignId !== "string" || !campaignId.trim() || campaignId.length > 160) {
    throw new ImportInputError("Choose an existing campaign before importing the file.");
  }
  const insertRows = db.transaction(() => {
    const { summary, rows, existingRecords } = analyzeDocument(db, document, campaignId.trim());
    const prospectColumns = readProspectColumnNames(db);
    const fields = [
      "lead_id", "company_name", "company_summary", "root_domain", "headquarters", "sector",
      "buyer_name", "buyer_title", "contact_email", "contact_phone", "quality_score", "tier",
      "status", "notes", "proof_link", "campaign_id",
    ].filter((field) => prospectColumns.has(field));
    if (!prospectColumns.has("lead_id") || !prospectColumns.has("company_name") ||
        !prospectColumns.has("campaign_id") || !prospectColumns.has("status")) {
      throw new Error("Prospects table is missing required identity, campaign, or status columns.");
    }
    const insert = db.prepare(`INSERT INTO prospects (${fields.map((field) => `"${field}"`).join(", ")})
      VALUES (${fields.map(() => "?").join(", ")}) ON CONFLICT(lead_id) DO NOTHING`);
    let added = 0;
    let updated = 0;
    let skipped = summary.invalidRows + summary.duplicateRows;

    // Columns an existing row may receive from the file. lead_id, status,
    // quality_score, tier and campaign_id are deliberately excluded: importing a
    // spreadsheet must never re-identify a lead, move it to another pipeline
    // stage or campaign, or rewrite its score and tier.
    const updatableFields = OVERWRITABLE_COLUMNS
      .filter(([column]) => prospectColumns.has(column));
    const readNotes = prospectColumns.has("notes")
      ? db.prepare<[string], { notes: string | null }>("SELECT notes FROM prospects WHERE lead_id = ?")
      : null;
    const notesByLead = new Map<string, string>();
    const storedNotes = (leadId: string) => {
      if (!readNotes) return "";
      const cached = notesByLead.get(leadId);
      if (cached !== undefined) return cached;
      const value = readNotes.get(leadId)?.notes ?? "";
      notesByLead.set(leadId, value);
      return value;
    };
    const updateStatements = new Map<string, Database.Statement>();
    const updateFor = (assignments: string[]) => {
      const key = assignments.join(",");
      const cached = updateStatements.get(key);
      if (cached) return cached;
      const statement = db.prepare(
        `UPDATE prospects SET ${key} WHERE "lead_id" = ?`,
      );
      updateStatements.set(key, statement);
      return statement;
    };

    for (const { record, values } of rows) {
      if (record.state === "existing") {
        const leadId = existingRecords.get(normalizeCompanyName(record.company));
        if (!leadId) {
          skipped += 1;
          continue;
        }
        const assignments: string[] = [];
        const bound: Array<string | number> = [];
        for (const [column, field] of updatableFields) {
          // An empty cell in the file leaves the stored value alone; an import
          // never blanks out a column the upload did not actually supply.
          const value = values[field].trim();
          if (!value) continue;
          assignments.push(`"${column}" = ?`);
          bound.push(value);
        }
        if (prospectColumns.has("notes")) {
          const base = values.notes.trim() || storedNotes(leadId);
          assignments.push(`"notes" = ?`);
          bound.push(appendImportNote(base, UPDATE_NOTE));
        }
        if (assignments.length) {
          updateFor(assignments).run(...bound, leadId);
          updated += 1;
        } else {
          skipped += 1;
        }
        continue;
      }
      if (record.state !== "ready") continue;
      const safeValues: Record<string, string | number> = {
        lead_id: `import_${crypto.randomUUID().replaceAll("-", "")}`,
        company_name: record.company,
        company_summary: values.company_summary,
        root_domain: values.root_domain,
        headquarters: values.headquarters,
        sector: values.sector,
        buyer_name: values.buyer_name,
        buyer_title: values.buyer_title,
        contact_email: values.contact_email,
        contact_phone: values.contact_phone,
        quality_score: 0,
        tier: "Unreviewed spreadsheet",
        status: "Ready to Review",
        notes: values.notes || IMPORT_NOTE,
        proof_link: values.proof_link,
        campaign_id: campaignId.trim(),
      };
      const result = insert.run(...fields.map((field) => safeValues[field] ?? ""));
      if (result.changes) added += 1;
      else skipped += 1;
    }
    return { added, updated, skipped, totalRows: summary.totalRows, campaign: summary.campaign };
  });
  return insertRows.immediate();
}

export function importCsvRows(db: Database.Database, csvText: string, campaignId: string) {
  return importDocumentRows(db, parseCsvText(csvText), campaignId);
}

export async function importXlsxRows(db: Database.Database, workbook: Buffer, campaignId: string) {
  return importDocumentRows(db, await parseXlsxBuffer(workbook), campaignId);
}
