import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { test } from "node:test";
import {
  buildYcCsv,
  getFilteredYcRows,
  getYcDirectory,
  ingestYcRows,
  parseYcFilters,
  YcInputError,
} from "../lib/yc.ts";

function createFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE yc_5year_directory (
      yc_id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE,
      website TEXT, root_domain TEXT, batch TEXT NOT NULL, batch_season TEXT,
      batch_year INTEGER, status TEXT, stage TEXT, top_company INTEGER DEFAULT 0,
      is_hiring INTEGER DEFAULT 0, nonprofit INTEGER DEFAULT 0, team_size INTEGER DEFAULT 0,
      industry TEXT, subindustry TEXT, tags TEXT, all_locations TEXT, one_liner TEXT,
      yc_url TEXT, small_logo_url TEXT, contact_email TEXT DEFAULT '', contact_phone TEXT DEFAULT ''
    );
    CREATE TABLE prospects (
      lead_id TEXT PRIMARY KEY, company_name TEXT NOT NULL, company_summary TEXT,
      root_domain TEXT NOT NULL DEFAULT '', headquarters TEXT, sector TEXT,
      buyer_name TEXT, buyer_title TEXT, contact_email TEXT, contact_phone TEXT,
      sg_my_wedge TEXT, quality_score INTEGER, tier TEXT, status TEXT, notes TEXT,
      bro_summary TEXT, proof_link TEXT, campaign_id TEXT
    );
  `);
  const insertYc = db.prepare(`INSERT INTO yc_5year_directory
    (yc_id, name, slug, website, root_domain, batch, batch_year, status, stage,
     top_company, is_hiring, team_size, industry, tags, all_locations, one_liner,
     yc_url, contact_email)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', 'Seed', ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  insertYc.run(1, "Alpha Books", "alpha-books", "https://alpha.example", "alpha.example", "Winter 2025", 2025, 1, 1, 12, "Fintech", "ledger, payments", "San Francisco", "Finance tools", "https://www.ycombinator.com/companies/alpha-books", "founder@alpha.example");
  insertYc.run(2, "Beta Data", "beta-data", "https://beta.example", "beta.example", "Summer 2024", 2024, 0, 1, 8, "Analytics", "data, accounting", "New York", "Analytics for modern teams", "https://www.ycombinator.com/companies/beta-data", "founder@beta.example");
  insertYc.run(3, "Gamma Commerce", "gamma-commerce", "https://gamma.example", "gamma.example", "Winter 2025", 2025, 0, 0, 4, "Fintech", "commerce", "Remote", "100% ledger accuracy", "https://www.ycombinator.com/companies/gamma-commerce", "");
  return db;
}

test("YC explorer combines directory filters, search and pagination", () => {
  const db = createFixture();
  try {
    const filters = parseYcFilters(new URLSearchParams({ batch: "Winter 2025", industry: "Fintech", minTeam: "5", hiringOnly: "true", limit: "1" }));
    const firstPage = getYcDirectory(db, filters);
    assert.equal(firstPage.total, 1);
    assert.equal(firstPage.rows.length, 1);
    assert.equal(firstPage.rows[0].slug, "alpha-books");
    assert.equal(firstPage.hasMore, false);

    const literalPercent = parseYcFilters(new URLSearchParams({ q: "100%" }));
    assert.deepEqual(getFilteredYcRows(db, literalPercent).map((row) => row.slug), ["gamma-commerce"]);
    assert.deepEqual(firstPage.batches, ["Winter 2025", "Summer 2024"]);
    assert.deepEqual(firstPage.industries, ["Analytics", "Fintech"]);
  } finally {
    db.close();
  }
});

test("YC CSV contains the active filters' full result set and neutralizes formulas", () => {
  const db = createFixture();
  try {
    db.prepare("UPDATE yc_5year_directory SET one_liner = ? WHERE yc_id = ?").run("=1+1", 3);
    const filters = parseYcFilters(new URLSearchParams({ q: "Gamma" }));
    const csv = buildYcCsv(getFilteredYcRows(db, filters));
    assert.match(csv, /"Company","Batch"/);
    assert.match(csv, /'=1\+1/);
    assert.doesNotMatch(csv, /founder@/i);
  } finally {
    db.close();
  }
});

test("explicit ingestion adds only selected rows for review with empty contact fields", () => {
  const db = createFixture();
  try {
    const result = ingestYcRows(db, [1]);
    assert.deepEqual(result, { added: 1, skipped: 0, selected: 1 });
    const lead = db.prepare("SELECT * FROM prospects WHERE lead_id = ?").get("yc_alpha_books");
    assert.equal(lead.status, "Ready to Review");
    assert.equal(lead.contact_email, "");
    assert.equal(lead.buyer_name, "");
    assert.equal(lead.contact_phone, "");
    assert.equal(lead.company_name, "Alpha Books");
    assert.equal(lead.campaign_id, "yc_us_expansion");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM prospects").get().n, 1);
  } finally {
    db.close();
  }
});

test("repeat ingestion skips matching YC lead IDs without overwriting user edits", () => {
  const db = createFixture();
  try {
    ingestYcRows(db, [2]);
    db.prepare("UPDATE prospects SET status = ?, contact_email = ?, buyer_name = ?, notes = ? WHERE lead_id = ?")
      .run("Approved for Outreach", "founder@verified.example", "Casey Founder", "User's reviewed record", "yc_beta_data");
    const result = ingestYcRows(db, [2, 2]);
    assert.deepEqual(result, { added: 0, skipped: 1, selected: 1 });
    const lead = db.prepare("SELECT status, contact_email, buyer_name, notes FROM prospects WHERE lead_id = ?").get("yc_beta_data");
    assert.deepEqual(lead, {
      status: "Approved for Outreach",
      contact_email: "founder@verified.example",
      buyer_name: "Casey Founder",
      notes: "User's reviewed record",
    });
  } finally {
    db.close();
  }
});

test("invalid selections fail atomically and selection size is bounded", () => {
  const db = createFixture();
  try {
    assert.throws(() => ingestYcRows(db, [1, 999]), YcInputError);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM prospects").get().n, 0);
    assert.throws(() => ingestYcRows(db, []), YcInputError);
    assert.throws(() => ingestYcRows(db, Array.from({ length: 201 }, (_, index) => index + 1)), YcInputError);
    assert.throws(() => parseYcFilters(new URLSearchParams({ minTeam: "-3" })), YcInputError);
    assert.throws(() => parseYcFilters(new URLSearchParams({ limit: "0" })), YcInputError);
  } finally {
    db.close();
  }
});
