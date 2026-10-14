// End-to-end import check against a COPY of the real database.
import { copyFileSync } from "node:fs";
import Database from "better-sqlite3";
import { previewCsvImport, importCsvRows } from "../lib/csv-import.ts";

const SRC = "C:/Users/wbrya/OneDrive/Documents/GitHub/accounting-prospect-research-nextjs/operations/recovered-leads-20261008/leads.sqlite";
const TMP = "C:/Users/wbrya/AppData/Local/Temp/opencode/import-test.sqlite";

copyFileSync(SRC, TMP);
const db = new Database(TMP);

const ex = db.prepare(
  "SELECT lead_id, company_name, contact_email, headquarters, notes, status FROM prospects WHERE trim(coalesce(contact_email,''))<>'' LIMIT 1",
).get();
console.log("EXISTING ROW:", ex.lead_id, "|", ex.company_name);
console.log("  email before:", ex.contact_email, "| hq before:", ex.headquarters);

// Row 1: existing company, WITH a new email and location.
// Row 2: existing company, with an EMPTY location cell (must not erase).
// Row 3: brand new company.
const csv = [
  "company,email,location",
  `${ex.company_name},updated@example.test,NEW HQ ADDRESS`,
  `${ex.company_name},second@example.test,`,
  "Totally New Co Ltd,new@example.test,Kuala Lumpur",
].join("\n");

const preview = previewCsvImport(db, csv, "yc_us_expansion");
console.log("\nPREVIEW: ready=%d existing=%d updated=%d duplicate=%d invalid=%d",
  preview.readyRows, preview.existingRows, preview.updatedRows, preview.duplicateRows, preview.invalidRows);

const result = importCsvRows(db, csv, "yc_us_expansion");
console.log("RESULT: added=%d updated=%d skipped=%d", result.added, result.updated, result.skipped);

const after = db.prepare("SELECT contact_email, headquarters, status, notes FROM prospects WHERE lead_id = ?").get(ex.lead_id);
console.log("\nAFTER UPDATE:");
console.log("  email:  ", after.contact_email, "(expected updated@example.test)");
console.log("  hq:     ", after.headquarters, "(expected NEW HQ ADDRESS)");
console.log("  status: ", after.status, "(expected UNCHANGED:", ex.status + ")");
console.log("  notes:  ", JSON.stringify(after.notes).slice(0, 90));

const added = db.prepare("SELECT * FROM prospects WHERE company_name = ?").get("Totally New Co Ltd");
console.log("\nNEW ROW:", added.lead_id, "| status:", added.status, "| email:", added.contact_email);
console.log("  notes:", JSON.stringify(added.notes).slice(0, 70));

console.log("\nTOTAL prospects:", db.prepare("SELECT COUNT(*) c FROM prospects").get().c);
db.close();