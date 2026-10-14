import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { test } from "node:test";
import {
  ImportInputError,
  importCsvRows,
  listImportCampaigns,
  previewCsvImport,
} from "../lib/csv-import.ts";

function createFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE campaigns (
      campaign_id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT
    );
    INSERT INTO campaigns (campaign_id, name, status) VALUES
      ('yc_us_expansion', 'YC Startups', 'ACTIVE'),
      ('other_campaign', 'Other audience', 'PAUSED');
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

test("campaign list and preview use explicit headers and ignore unknown columns", () => {
  const db = createFixture();
  try {
    const campaigns = listImportCampaigns(db);
    assert.deepEqual(campaigns.map((campaign) => campaign.id), ["other_campaign", "yc_us_expansion"]);
    const csv = 'Company Name,Domain,Location,Email,Source Guess,Extra\n"Comma, Inc",comma.example,San Francisco,,,unmapped';
    const preview = previewCsvImport(db, csv, "yc_us_expansion");
    assert.equal(preview.readyRows, 1);
    assert.equal(preview.previewRows[0].company, "Comma, Inc");
    assert.equal(preview.previewRows[0].domain, "comma.example");
    assert.equal(preview.previewRows[0].email, "");
    assert.equal(preview.mapping.company_name, "Company Name");
    assert.ok(preview.ignoredHeaders.includes("Source Guess"));
    assert.ok(preview.ignoredHeaders.includes("Extra"));
  } finally {
    db.close();
  }
});

test("archived campaigns cannot reappear through import or receive imported rows", () => {
  const db = createFixture();
  try {
    db.prepare("UPDATE campaigns SET status='ARCHIVED' WHERE campaign_id='other_campaign'").run();
    assert.deepEqual(listImportCampaigns(db).map((campaign) => campaign.id), ["yc_us_expansion"]);
    assert.throws(() => previewCsvImport(db, "company\nExample", "other_campaign"), /archived/);
    assert.throws(() => importCsvRows(db, "company\nExample", "other_campaign"), /archived/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM prospects").get().n, 0);
  } finally { db.close(); }
});

test("CSV import sets review status, stores only explicit fields, and never infers contact data", () => {
  const db = createFixture();
  try {
    const csv = [
      "company_name,domain,industry,location",
      "Acme Ledger,acme.example,Fintech,San Francisco",
    ].join("\n");
    const result = importCsvRows(db, csv, "yc_us_expansion");
    assert.equal(result.added, 1);
    assert.equal(result.skipped, 0);
    const lead = db.prepare("SELECT * FROM prospects WHERE company_name = ?").get("Acme Ledger");
    assert.equal(lead.status, "Ready to Review");
    assert.equal(lead.contact_email, "");
    assert.equal(lead.buyer_name, "");
    assert.equal(lead.contact_phone, "");
    assert.equal(lead.root_domain, "acme.example");
    assert.equal(lead.sector, "Fintech");
    assert.equal(lead.headquarters, "San Francisco");
    assert.equal(lead.campaign_id, "yc_us_expansion");
  } finally {
    db.close();
  }
});

test("explicit contact columns are imported literally but remain in review", () => {
  const db = createFixture();
  try {
    const csv = [
      "company,email,founder_name,phone_number,description,source_url",
      "Source Co,Casey@source.example,Casey Founder,+1 415 555 0100,Ledger tools,https://source.example/about",
    ].join("\n");
    importCsvRows(db, csv, "other_campaign");
    const lead = db.prepare("SELECT * FROM prospects WHERE company_name = ?").get("Source Co");
    assert.equal(lead.contact_email, "Casey@source.example");
    assert.equal(lead.buyer_name, "Casey Founder");
    assert.equal(lead.contact_phone, "+1 415 555 0100");
    assert.equal(lead.company_summary, "Ledger tools");
    assert.equal(lead.proof_link, "https://source.example/about");
    assert.equal(lead.status, "Ready to Review");
    assert.equal(lead.campaign_id, "other_campaign");
  } finally {
    db.close();
  }
});

test("existing companies and repeated CSV rows are skipped without updates", () => {
  const db = createFixture();
  try {
    db.prepare(`INSERT INTO prospects (lead_id, company_name, contact_email, status, notes, campaign_id)
      VALUES (?, ?, ?, ?, ?, ?)`).run("manual_1", "Existing Co", "reviewed@example.test", "Approved for Outreach", "User notes", "other_campaign");
    const csv = [
      "company,email",
      "Existing Co,changed@example.test",
      "New Co,",
      " new   co,duplicate@example.test",
    ].join("\n");
    const preview = previewCsvImport(db, csv, "yc_us_expansion");
    assert.equal(preview.readyRows, 1);
    assert.equal(preview.existingRows, 1);
    assert.equal(preview.duplicateRows, 1);
    const result = importCsvRows(db, csv, "yc_us_expansion");
    assert.equal(result.added, 1);
    assert.equal(result.skipped, 2);
    const existing = db.prepare("SELECT contact_email, status, notes, campaign_id FROM prospects WHERE lead_id = ?").get("manual_1");
    assert.deepEqual(existing, {
      contact_email: "reviewed@example.test",
      status: "Approved for Outreach",
      notes: "User notes",
      campaign_id: "other_campaign",
    });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM prospects WHERE lower(company_name) = 'new co'").get().count, 1);
  } finally {
    db.close();
  }
});

test("invalid CSV and campaign input are rejected before database writes", () => {
  const db = createFixture();
  try {
    assert.throws(() => previewCsvImport(db, "name,email\nNo Company Header,value", "yc_us_expansion"), ImportInputError);
    assert.throws(() => previewCsvImport(db, 'company\n"unfinished', "yc_us_expansion"), ImportInputError);
    assert.throws(() => previewCsvImport(db, "company\nNo Campaign", "missing_campaign"), ImportInputError);
    assert.throws(() => previewCsvImport(db, `company\n${"x".repeat(2 * 1024 * 1024 + 1)}`, "yc_us_expansion"), ImportInputError);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM prospects").get().count, 0);
  } finally {
    db.close();
  }
});
