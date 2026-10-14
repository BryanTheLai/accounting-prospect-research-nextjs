import "server-only";
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const databasePath = resolve(
  process.env.OUTBOUNDER_DB_PATH ||
    resolve(process.cwd(), "../operations/recovered-leads-20261008/leads.sqlite"),
);

export function openDatabase(readonly = true) {
  if (!existsSync(databasePath)) {
    throw new Error(`Local database not found at ${databasePath}`);
  }
  return new Database(databasePath, {
    readonly,
    fileMustExist: true,
    timeout: 5000,
  });
}

export function dbError(error: unknown) {
  const message = error instanceof Error ? error.message : "Database unavailable";
  const safeMessage = message.startsWith("Local database not found")
    ? "Local database not found. Check OUTBOUNDER_DB_PATH."
    : "The local database could not complete that request.";
  return Response.json({ error: safeMessage }, { status: 503 });
}

export const prospectFields = `
  lead_id AS id, company_name AS company, company_summary AS summary,
  headquarters AS location, sector, status, quality_score AS fit,
  campaign_id AS campaignId, sg_my_wedge AS signal, proof_link AS source,
  root_domain AS rootDomain,
  buyer_name AS buyer, buyer_title AS title, contact_email AS email,
  contact_phone AS phone, phone_script AS phoneScript,
  accounting_software AS accountingSoftware, malaysia_facility AS facility
`;
