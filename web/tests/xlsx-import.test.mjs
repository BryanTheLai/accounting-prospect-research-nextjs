import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Database from "better-sqlite3";
import { test } from "node:test";
import {
  ImportInputError,
  importXlsxRows,
  previewXlsxImport,
} from "../lib/csv-import.ts";

const workbookFixture = await readFile(new URL("./fixtures/prospects-import.xlsx", import.meta.url));

function createFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE campaigns (
      campaign_id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT
    );
    INSERT INTO campaigns (campaign_id, name, status) VALUES
      ('yc_us_expansion', 'YC Startups', 'ACTIVE');
    CREATE TABLE prospects (
      lead_id TEXT PRIMARY KEY, company_name TEXT NOT NULL, company_summary TEXT,
      root_domain TEXT NOT NULL DEFAULT '', headquarters TEXT, sector TEXT,
      buyer_name TEXT, buyer_title TEXT, contact_email TEXT, contact_phone TEXT,
      quality_score INTEGER, tier TEXT, status TEXT, notes TEXT, proof_link TEXT,
      campaign_id TEXT
    );
  `);
  return db;
}

test("XLSX preview maps first-sheet headers and rows", async () => {
  const db = createFixture();
  try {
    const preview = await previewXlsxImport(db, workbookFixture, "yc_us_expansion");
    assert.equal(preview.totalRows, 3);
    assert.equal(preview.readyRows, 2);
    assert.equal(preview.previewRows[0].rowNumber, 2);
    assert.equal(preview.previewRows[0].company, "Acme Ledger");
    assert.equal(preview.previewRows[0].domain, "acme.example");
    assert.equal(preview.previewRows[0].buyerName, "Casey Lai");
    assert.equal(preview.previewRows[0].summary, "AI accounting tools");
    assert.equal(preview.mapping.company_name, "Company Name");
    assert.ok(preview.ignoredHeaders.includes("Extra"));
  } finally {
    db.close();
  }
});

test("formula cells are not calculated and unknown columns are ignored", async () => {
  const db = createFixture();
  try {
    const preview = await previewXlsxImport(db, workbookFixture, "yc_us_expansion");
    assert.equal(preview.previewRows[0].email, "");
    assert.ok(preview.ignoredHeaders.includes("Extra"));
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM prospects").get().count, 0);
  } finally {
    db.close();
  }
});

test("malformed workbooks are rejected before writes", async () => {
  const db = createFixture();
  try {
    await assert.rejects(previewXlsxImport(db, Buffer.from("not a zip archive"), "yc_us_expansion"), ImportInputError);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM prospects").get().count, 0);
  } finally {
    db.close();
  }
});

test("XLSX import updates existing companies and skips in-file duplicates", async () => {
  const db = createFixture();
  try {
    db.prepare(`INSERT INTO prospects (lead_id, company_name, contact_email, contact_phone, buyer_name,
        quality_score, tier, status, notes, campaign_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      "manual_1", "Existing Co", "reviewed@example.test", "+1 415 555 0199", "Stored Buyer",
      42, "Tier A", "Approved for Outreach", "Keep this", "yc_us_expansion");
    const preview = await previewXlsxImport(db, workbookFixture, "yc_us_expansion");
    assert.equal(preview.readyRows, 1);
    assert.equal(preview.existingRows, 1);
    assert.equal(preview.updatedRows, 1);
    assert.equal(preview.duplicateRows, 1);

    const result = await importXlsxRows(db, workbookFixture, "yc_us_expansion");
    assert.equal(result.added, 1);
    assert.equal(result.updated, 1);
    assert.equal(result.skipped, 1);

    // Every mapped column the workbook supplies is written to the real lead_id.
    const existing = db.prepare("SELECT * FROM prospects WHERE lead_id = ?").get("manual_1");
    assert.equal(existing.lead_id, "manual_1");
    assert.equal(existing.contact_email, "changed@example.test");
    assert.equal(existing.root_domain, "existing.example");
    assert.equal(existing.buyer_name, "Different Person");
    assert.equal(existing.company_summary, "Updated summary");
    // contact_phone is not in the workbook, so the stored value survives.
    assert.equal(existing.contact_phone, "+1 415 555 0199");
    // Pipeline stage, scoring and identity are never rewritten by an import.
    assert.equal(existing.status, "Approved for Outreach");
    assert.equal(existing.quality_score, 42);
    assert.equal(existing.tier, "Tier A");
    assert.match(existing.notes, /^Keep this/);
    assert.match(existing.notes, /Updated from spreadsheet import/);

    // The new company is appended, and the repeated " acme   ledger " row never
    // clobbers the first Acme Ledger row: first-row-wins.
    const imported = db.prepare("SELECT * FROM prospects WHERE company_name = ?").get("Acme Ledger");
    assert.equal(imported.status, "Ready to Review");
    assert.equal(imported.contact_email, "");
    assert.equal(imported.buyer_name, "Casey Lai");
    assert.equal(imported.root_domain, "acme.example");
    assert.equal(imported.campaign_id, "yc_us_expansion");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM prospects").get().count, 2);
  } finally {
    db.close();
  }
});
