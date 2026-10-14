import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { test } from "node:test";
import {
  classifyEmailTier,
  getProspects,
  isGovernmentLead,
  parseProspectFilters,
  ProspectFilterInputError,
} from "../lib/prospects.ts";

function createFixture(withPreflight = true) {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE prospects (
    lead_id TEXT PRIMARY KEY, company_name TEXT NOT NULL, company_summary TEXT,
    root_domain TEXT, headquarters TEXT, sector TEXT, buyer_name TEXT, buyer_title TEXT,
    contact_email TEXT, contact_phone TEXT, sg_my_wedge TEXT, quality_score INTEGER,
    tier TEXT, status TEXT, notes TEXT, proof_link TEXT, campaign_id TEXT
  )`);
  if (withPreflight) db.exec(`CREATE TABLE email_preflight (
    lead_id TEXT PRIMARY KEY, email TEXT NOT NULL, mx_status TEXT NOT NULL,
    mx_hosts TEXT NOT NULL DEFAULT '[]', checked_at TEXT NOT NULL,
    source_confirmed INTEGER NOT NULL DEFAULT 0, source_confirmed_at TEXT
  )`);
  const add = db.prepare(`INSERT INTO prospects
    (lead_id, company_name, company_summary, root_domain, headquarters, sector, buyer_name,
     contact_email, contact_phone, sg_my_wedge, quality_score, status, notes, proof_link, campaign_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Ready to Review', ?, ?, 'yc_us_expansion')`);
  add.run("yc_alpha", "Alpha Ledger", "SaaS finance platform", "alpha.example", "San Francisco, CA", "Fintech", "Ada Founder", "ceo@alpha.example", "+14155550100", "YC startup", 95, "Hiring: Yes", "https://www.ycombinator.com/companies/alpha-ledger");
  add.run("yc_beta", "Beta Books", "Analytics", "beta.example", "New York, NY", "Analytics", "Casey Chief", "finance@beta.example", "", "Back office platform", 80, "Hiring: No", "https://boards.greenhouse.io/beta/jobs/1");
  add.run("yc_gamma", "Gamma Data", "Generic service", "gamma.example", "Remote", "Software", "", "info@gamma.example", "", "YC company", 65, "", "https://gamma.example/about");
  add.run("yc_delta", "Delta Agency", "Public body", "delta.gov", "Washington, DC", "Public", "", "hello@delta.gov", "", "Government research", 90, "", "https://delta.gov");
  add.run("yc_epsilon", "Epsilon Labs", "No current address check", "epsilon.example", "Austin, TX", "Software", "Riley Builder", "riley@epsilon.example", "", "YC company", 85, "", "https://epsilon.example");
  db.prepare("UPDATE prospects SET tier = CASE lead_id WHEN 'yc_alpha' THEN 'Tier 1 (YC Backed)' WHEN 'yc_beta' THEN 'Tier A' ELSE 'Tier B' END").run();
  if (withPreflight) {
    db.prepare("INSERT INTO email_preflight (lead_id, email, mx_status, checked_at, source_confirmed) VALUES (?, ?, ?, ?, ?)")
      .run("yc_alpha", "ceo@alpha.example", "mx_present", "2026-10-04T00:00:00Z", 1);
    db.prepare("INSERT INTO email_preflight (lead_id, email, mx_status, checked_at) VALUES (?, ?, ?, ?)")
      .run("yc_epsilon", "old@epsilon.example", "mx_present", "2026-10-04T00:00:00Z");
  }
  return db;
}

test("prospect filters combine fit, explicit hiring evidence, email tier/check and government exclusion before pagination", () => {
  const db = createFixture();
  try {
    db.pragma("query_only = ON");
    const filters = parseProspectFilters(new URLSearchParams({
      minFit: "90", maxFit: "100", hiringOnly: "1", emailTier: "direct",
      emailCheckStatus: "mx_present", excludeGovernment: "1", limit: "1", offset: "0",
    }));
    const first = getProspects(db, filters);
    assert.equal(first.total, 1);
    assert.equal(first.rows.length, 1);
    assert.equal(first.rows[0].id, "yc_alpha");
    assert.equal(first.rows[0].emailTier, "direct");
    assert.equal(first.rows[0].emailCheckStatus, "mx_present");
    assert.equal(first.rows[0].hiringSignal, true);
    assert.equal(first.rows[0].isGovernment, false);
    assert.equal(first.hasMore, false);
    assert.throws(() => db.prepare("UPDATE prospects SET status = 'x'").run(), /readonly|read-only/i);
  } finally {
    db.close();
  }
});

test("field-scoped company, founder, location and phone filters combine with callable, stage, hiring and score", () => {
  const db = createFixture();
  try {
    const params = new URLSearchParams({
      company: "Alpha", founder: "Ada", location: "San Francisco", phone: "5550100",
      callable: "1", status: "Ready to Review", minFit: "90", hiringOnly: "1", excludeGovernment: "1",
    });
    const result = getProspects(db, parseProspectFilters(params));
    assert.equal(result.total, 1);
    assert.equal(result.rows[0].id, "yc_alpha");

    const noPhone = getProspects(db, parseProspectFilters(new URLSearchParams({ phone: "5550100", callable: "1" })));
    assert.equal(noPhone.total, 1);
    assert.equal(noPhone.rows[0].id, "yc_alpha");
  } finally {
    db.close();
  }
});

test("scoped search fields match their own source columns and broad search includes founder and phone", () => {
  const db = createFixture();
  try {
    const cases = [
      [{ company: "Beta Books" }, "yc_beta"],
      [{ founder: "Casey" }, "yc_beta"],
      [{ location: "Remote" }, "yc_gamma"],
      [{ phone: "4155550100" }, "yc_alpha"],
      [{ q: "Ada Founder" }, "yc_alpha"],
    ];
    for (const [parameters, expectedId] of cases) {
      const result = getProspects(db, parseProspectFilters(new URLSearchParams(parameters)));
      assert.deepEqual(result.rows.map((row) => row.id), [expectedId]);
    }
  } finally {
    db.close();
  }
});

test("hiring signal uses explicit notes or job listing evidence, not fit-score inference", () => {
  const db = createFixture();
  try {
    const result = getProspects(db, parseProspectFilters(new URLSearchParams({ hiringOnly: "true", excludeGovernment: "1" })));
    assert.deepEqual(result.rows.map((row) => row.id).sort(), ["yc_alpha", "yc_beta"]);
  } finally {
    db.close();
  }
});

test("saved prospect tiers support a lossless multi-select filter and expose available tier values", () => {
  const db = createFixture();
  try {
    const params = new URLSearchParams();
    params.append("tier", "Tier A");
    params.append("tier", "Tier 1 (YC Backed)");
    const result = getProspects(db, parseProspectFilters(params));
    assert.deepEqual(result.rows.map((row) => row.id).sort(), ["yc_alpha", "yc_beta"]);
    assert.deepEqual(result.tiers, ["Tier 1 (YC Backed)", "Tier A", "Tier B"]);
  } finally {
    db.close();
  }
});

test("government detection ports Streamlit shield boundaries and restricted domains", () => {
  assert.equal(isGovernmentLead({ company: "Delta Agency", rootDomain: "", email: "", summary: "An agency under the ministry" }), true);
  assert.equal(isGovernmentLead({ company: "US Army", rootDomain: "", email: "", summary: "" }), true);
  assert.equal(isGovernmentLead({ company: "LanceDB", rootDomain: "lancedb.example", email: "", summary: "" }), false);
  assert.equal(isGovernmentLead({ company: "Private School", rootDomain: "school.ac.uk", email: "", summary: "" }), true);
});

test("email tiers classify direct, department, generic, system and missing addresses", () => {
  assert.equal(classifyEmailTier("ada.founder@alpha.example", "Ada Founder"), "direct");
  assert.equal(classifyEmailTier("finance@alpha.example", ""), "department");
  assert.equal(classifyEmailTier("info@alpha.example", ""), "generic");
  assert.equal(classifyEmailTier("support@alpha.example", ""), "system");
  assert.equal(classifyEmailTier("", ""), "missing");
});

test("email check status is tied to the exact current address and safely defaults when the table is absent", () => {
  const db = createFixture();
  try {
    const result = getProspects(db, parseProspectFilters(new URLSearchParams({ emailCheckStatus: "not_checked" })));
    assert.deepEqual(result.rows.map((row) => row.id).sort(), ["yc_beta", "yc_delta", "yc_epsilon", "yc_gamma"]);
    const stale = result.rows.find((row) => row.id === "yc_epsilon");
    assert.equal(stale.emailCheckStatus, "not_checked");
  } finally {
    db.close();
  }

  const dbWithoutPreflight = createFixture(false);
  try {
    const result = getProspects(dbWithoutPreflight, parseProspectFilters(new URLSearchParams({ emailCheckStatus: "not_checked" })));
    assert.equal(result.total, 5);
    assert.ok(result.rows.every((row) => row.emailCheckStatus === "not_checked"));
  } finally {
    dbWithoutPreflight.close();
  }
});

test("invalid filter parameters are rejected instead of silently changing intent", () => {
  assert.throws(() => parseProspectFilters(new URLSearchParams({ minFit: "91", maxFit: "80" })), ProspectFilterInputError);
  assert.throws(() => parseProspectFilters(new URLSearchParams({ emailTier: "random" })), ProspectFilterInputError);
  assert.throws(() => parseProspectFilters(new URLSearchParams({ excludeGovernment: "sometimes" })), ProspectFilterInputError);
});
