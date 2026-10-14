import type Database from "better-sqlite3";

export type ProspectExportContact = {
  buyerName: string | null;
  buyerTitle: string | null;
  email: string | null;
  phone: string | null;
};

export type ProspectExportRow = {
  id: string;
  company: string;
  location: string | null;
  sector: string | null;
  status: string | null;
  fit: number | null;
  leadTier: string | null;
  campaignId: string | null;
  hiringSignal: boolean;
  emailTier: string;
  emailCheckStatus: string;
  isGovernment: boolean;
};

function csvCell(value: unknown) {
  let text = String(value ?? "").replace(/\r?\n/g, " ");
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/** Fetch contact fields only for the already-filtered prospect IDs. */
export function loadProspectExportContacts(db: Database.Database, ids: readonly string[]) {
  const contacts = new Map<string, ProspectExportContact>();
  for (let offset = 0; offset < ids.length; offset += 500) {
    const chunk = ids.slice(offset, offset + 500);
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = db.prepare(`
      SELECT lead_id AS id, buyer_name AS buyerName, buyer_title AS buyerTitle,
        contact_email AS email, contact_phone AS phone
      FROM prospects
      WHERE lead_id IN (${placeholders})
    `).all(...chunk) as Array<{ id: string } & ProspectExportContact>;
    for (const row of rows) contacts.set(row.id, row);
  }
  return contacts;
}

export function buildProspectCsv(
  rows: readonly ProspectExportRow[],
  contacts: ReadonlyMap<string, ProspectExportContact>,
) {
  const header = [
    "Company", "Location", "Sector", "Stage", "Fit", "Prospect tier", "Campaign",
    "Hiring evidence noted", "Email tier (pattern)", "MX check status (not mailbox verification)",
    "Government affiliation", "Buyer name", "Buyer title", "Contact email", "Contact phone",
  ];
  const data = rows.map((row) => {
    const contact = contacts.get(row.id);
    return [
      row.company, row.location, row.sector, row.status, row.fit, row.leadTier, row.campaignId,
      row.hiringSignal ? "Yes" : "No explicit evidence", row.emailTier, row.emailCheckStatus,
      row.isGovernment ? "Flagged" : "Not flagged", contact?.buyerName, contact?.buyerTitle,
      contact?.email, contact?.phone,
    ];
  });
  return `\uFEFF${[header, ...data].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}
