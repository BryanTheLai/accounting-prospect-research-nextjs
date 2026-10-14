import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { test } from "node:test";
import { buildProspectCsv, loadProspectExportContacts } from "../lib/prospect-export.ts";
import { getProspects, parseProspectFilters } from "../lib/prospects.ts";

function createFixture() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE prospects (
    lead_id TEXT PRIMARY KEY, company_name TEXT NOT NULL, company_summary TEXT,
    root_domain TEXT, headquarters TEXT, sector TEXT, buyer_name TEXT, buyer_title TEXT,
    contact_email TEXT, contact_phone TEXT, sg_my_wedge TEXT, quality_score INTEGER,
    tier TEXT, status TEXT, notes TEXT, proof_link TEXT, campaign_id TEXT
  )`);
  const add = db.prepare(`INSERT INTO prospects
    (lead_id, company_name, headquarters, sector, buyer_name, buyer_title, contact_email,
     contact_phone, quality_score, tier, status, campaign_id)
    VALUES (?, ?, 'San Francisco, CA', 'Software', ?, ?, ?, ?, 90, 'Tier A', 'Ready to Review', 'yc_us_expansion')`);
  add.run("alpha", "Alpha Ledger", "Ada Founder", "CEO", "ada@alpha.example", "+14155550100");
  add.run("beta", "Beta Books", "Casey Builder", "Founder", "casey@beta.example", "+12125550100");
  return db;
}

test("filtered prospect export includes Streamlit contact columns for matching rows only", () => {
  const db = createFixture();
  try {
    const filtered = getProspects(db, parseProspectFilters(new URLSearchParams({ company: "Alpha" })));
    const contacts = loadProspectExportContacts(db, filtered.rows.map((row) => row.id));
    const csv = buildProspectCsv(filtered.rows, contacts);

    assert.equal(filtered.total, 1);
    assert.match(csv, /"Buyer name","Buyer title","Contact email","Contact phone"/);
    assert.match(csv, /"Alpha Ledger".*"Ada Founder","CEO","ada@alpha\.example","'\+14155550100"/);
    assert.doesNotMatch(csv, /Beta Books|Casey Builder|casey@beta\.example/);
  } finally {
    db.close();
  }
});

test("contact CSV cells retain quoting and neutralize spreadsheet formulas", () => {
  const db = createFixture();
  try {
    db.prepare(`UPDATE prospects SET buyer_name = ?, buyer_title = ?, contact_email = ?, contact_phone = ? WHERE lead_id = 'alpha'`)
      .run(' =HYPERLINK("https://bad.example")\nLai', '+CMD', '@SUM(1,2)', '-1+1');
    const filtered = getProspects(db, parseProspectFilters(new URLSearchParams({ company: "Alpha" })));
    const csv = buildProspectCsv(filtered.rows, loadProspectExportContacts(db, filtered.rows.map((row) => row.id)));

    assert.ok(csv.startsWith("\uFEFF"));
    assert.ok(csv.includes('"\' =HYPERLINK(""https://bad.example"") Lai"'));
    assert.ok(csv.includes('"\'+CMD"'));
    assert.ok(csv.includes('"\'@SUM(1,2)"'));
    assert.ok(csv.includes('"\'-1+1"'));
    assert.doesNotMatch(csv, /\r?\nLai/);
  } finally {
    db.close();
  }
});

test("export contact lookup chunks filtered IDs safely and leaves missing rows blank", () => {
  const db = createFixture();
  try {
    const ids = Array.from({ length: 501 }, (_, index) => index === 0 ? "alpha" : `missing-${index}`);
    const contacts = loadProspectExportContacts(db, ids);
    assert.equal(contacts.size, 1);
    assert.equal(contacts.get("alpha")?.buyerName, "Ada Founder");

    const csv = buildProspectCsv([{
      id: "missing", company: "Filtered Prospect", location: null, sector: null, status: null,
      fit: null, leadTier: null, campaignId: null, hiringSignal: false, emailTier: "missing",
      emailCheckStatus: "not_checked", isGovernment: false,
    }], contacts);
    assert.match(csv, /"Filtered Prospect".*"Not flagged","","","",""/);
  } finally {
    db.close();
  }
});
