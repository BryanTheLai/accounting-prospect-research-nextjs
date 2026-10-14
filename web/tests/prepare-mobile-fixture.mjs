import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { resolve } from "node:path";

const path = resolve("../operations/ui-qa/mobile-20261007/fixture.db");
const db = new Database(path, { fileMustExist: true });
try {
  assert.ok(db.prepare("SELECT company_name FROM prospects").all().every((row) => row.company_name.startsWith("Synthetic ")), "Synthetic fixture only");
  const seed = db.transaction(() => {
    db.prepare("UPDATE prospects SET company_name = ?, company_summary = ?, phone_script = ? WHERE lead_id = ?").run(
      "Synthetic Acorn International Accounting and Cross-Border Reconciliation Laboratories",
      "A deliberately long synthetic company record for wrapping and mobile layout verification.",
      "Is this a bad time to talk, or do you have 60 seconds?\n\nSynthetic full-length opener and pitch.\n\n" + "Synthetic accounting support conversation. ".repeat(60),
      "uiqa_lead_001",
    );
    db.exec(`CREATE TABLE IF NOT EXISTS yc_5year_directory (
      yc_id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE,
      website TEXT, root_domain TEXT, batch TEXT NOT NULL, batch_season TEXT,
      batch_year INTEGER, status TEXT, stage TEXT, top_company INTEGER DEFAULT 0,
      is_hiring INTEGER DEFAULT 0, nonprofit INTEGER DEFAULT 0, team_size INTEGER DEFAULT 0,
      industry TEXT, subindustry TEXT, tags TEXT, all_locations TEXT, one_liner TEXT,
      yc_url TEXT, small_logo_url TEXT, contact_email TEXT DEFAULT '', contact_phone TEXT DEFAULT ''
    )`);
    db.prepare(`INSERT OR REPLACE INTO yc_5year_directory
      (yc_id, name, slug, root_domain, batch, batch_year, team_size, industry, all_locations, one_liner, is_hiring)
      VALUES (1, ?, 'synthetic-mobile-labs', 'mobile.example.test', 'Winter 2025', 2025, 12, 'Accounting', 'Synthetic city', ?, 1)`)
      .run("Synthetic Mobile Accounting and Reconciliation Laboratories", "Synthetic long directory summary with all information preserved on narrow screens.");
    if (!db.prepare("SELECT 1 FROM campaign_sends WHERE subject = ?").get("Synthetic mobile QA activity")) {
      db.prepare(`INSERT INTO campaign_sends (lead_id, recipient_email, company_name, subject, body, status)
        VALUES ('uiqa_lead_001', 'alex@acorn.example.test', ?, 'Synthetic mobile QA activity', 'Synthetic fixture; nothing sent.', 'DRY_RUN')`)
        .run("Synthetic Acorn International Accounting and Cross-Border Reconciliation Laboratories");
    }
  });
  seed();
  console.log("Prepared long-name, call-script, activity and YC records in the isolated synthetic fixture.");
} finally {
  db.close();
}
