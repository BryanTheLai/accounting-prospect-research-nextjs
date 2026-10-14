import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { test } from "node:test";
import {
  ContactInputError,
  parseContactUpdate,
  updateProspectContact,
} from "../lib/contacts.ts";

function fixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE prospects (
      lead_id TEXT PRIMARY KEY, company_name TEXT NOT NULL, buyer_name TEXT,
      buyer_title TEXT, contact_email TEXT, contact_phone TEXT, status TEXT,
      campaign_id TEXT
    );
    INSERT INTO prospects VALUES
      ('yc_alpha', 'Alpha Startup', 'Ada Founder', 'CEO', 'ada@alpha.example', '+14155550101', 'Ready to Review', 'yc_us_expansion'),
      ('yc_beta', 'Beta Startup', 'Ben Founder', 'Founder', 'ben@beta.example', '+14155550102', 'Ready to Review', 'yc_us_expansion'),
      ('sg_gamma', 'Gamma Startup', 'Cam Founder', 'Founder', 'cam@gamma.example', '+6590000000', 'Ready to Review', 'sg_johor');
    CREATE TABLE email_preflight (
      lead_id TEXT PRIMARY KEY, email TEXT NOT NULL, mx_status TEXT NOT NULL,
      mx_hosts TEXT NOT NULL DEFAULT '[]', checked_at TEXT NOT NULL,
      source_confirmed INTEGER NOT NULL DEFAULT 0, source_confirmed_at TEXT
    );
    INSERT INTO email_preflight VALUES
      ('yc_alpha', 'ada@alpha.example', 'mx_present', '["mx.alpha.example"]', '2026-10-04T00:00:00.000Z', 1, '2026-10-04T00:00:00.000Z');
  `);
  return db;
}

test("contact updates accept only known fields and validate the replacement email", () => {
  assert.deepEqual(parseContactUpdate({ leadId: "yc_alpha", buyer: "Ada Founder", title: "CEO", email: "ada@alpha.example", phone: "+14155550101" }), {
    leadId: "yc_alpha", buyer: "Ada Founder", title: "CEO", email: "ada@alpha.example", phone: "+14155550101",
  });
  assert.throws(() => parseContactUpdate({ leadId: "yc_alpha", email: "not-an-email" }), ContactInputError);
  assert.throws(() => parseContactUpdate({ leadId: "yc_alpha", contact_email: "attacker@alpha.example" }), ContactInputError);
  assert.throws(() => parseContactUpdate({ leadId: "yc_alpha", phone: "x".repeat(121) }), ContactInputError);
});

test("changing the exact email and invalidating its MX/source preflight happen in one SQLite transaction", () => {
  const db = fixture();
  try {
    db.exec(`CREATE TRIGGER reject_preflight_reset BEFORE UPDATE ON email_preflight
      BEGIN SELECT RAISE(ABORT, 'preflight reset blocked'); END`);
    assert.throws(() => updateProspectContact(db, parseContactUpdate({ leadId: "yc_alpha", email: "new@alpha.example" })), /preflight reset blocked/);
    assert.equal(db.prepare("SELECT contact_email FROM prospects WHERE lead_id = 'yc_alpha'").get().contact_email, "ada@alpha.example");
    assert.equal(db.prepare("SELECT email, mx_status, source_confirmed FROM email_preflight WHERE lead_id = 'yc_alpha'").get().mx_status, "mx_present");

    db.exec("DROP TRIGGER reject_preflight_reset");
    const result = updateProspectContact(db, parseContactUpdate({ leadId: "yc_alpha", email: "new@alpha.example" }));
    assert.equal(result.emailPreflightInvalidated, true);
    assert.deepEqual(result.contact, {
      leadId: "yc_alpha", buyer: "Ada Founder", title: "CEO", email: "new@alpha.example", phone: "+14155550101",
    });
    assert.deepEqual(db.prepare("SELECT email, mx_status, mx_hosts, source_confirmed, source_confirmed_at FROM email_preflight WHERE lead_id = 'yc_alpha'").get(), {
      email: "new@alpha.example", mx_status: "not_checked", mx_hosts: "[]", source_confirmed: 0, source_confirmed_at: null,
    });
  } finally {
    db.close();
  }
});

test("contact edits can update buyer, title and phone without clearing a matching email preflight", () => {
  const db = fixture();
  try {
    const result = updateProspectContact(db, parseContactUpdate({
      leadId: "yc_alpha", buyer: "Ada Li", title: "Co-founder", phone: "+14155550999", email: "ada@alpha.example",
    }));
    assert.equal(result.emailPreflightInvalidated, false);
    assert.equal(db.prepare("SELECT mx_status FROM email_preflight WHERE lead_id = 'yc_alpha'").get().mx_status, "mx_present");
    assert.equal(result.contact.buyer, "Ada Li");
    assert.equal(result.contact.title, "Co-founder");
    assert.equal(result.contact.phone, "+14155550999");
  } finally {
    db.close();
  }
});
