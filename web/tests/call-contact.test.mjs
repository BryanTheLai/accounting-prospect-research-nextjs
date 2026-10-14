import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { test } from "node:test";
import {
  CALL_DISPOSITIONS,
  CallInputError,
  getCallDashboard,
  parseCallInput,
  saveCallOutcome,
} from "../lib/calls.ts";
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

test("call input preserves notes, stores UTC follow-up time, and rejects unsafe bounds", () => {
  assert.deepEqual(parseCallInput({
    leadId: "yc_alpha", disposition: "CONNECTED_CALLBACK", notes: "  Call after demo  ",
    nextFollowupAt: "2026-10-05T09:30:00-07:00", durationSeconds: 82,
  }), {
    leadId: "yc_alpha", disposition: "CONNECTED_CALLBACK", notes: "Call after demo",
    nextFollowupAt: "2026-10-05T16:30:00.000Z", durationSeconds: 82,
  });
  assert.throws(() => parseCallInput({ leadId: "yc_alpha", disposition: "UNKNOWN" }), CallInputError);
  assert.throws(() => parseCallInput({ leadId: "yc_alpha", disposition: "BUSY", durationSeconds: 3601 }), CallInputError);
  assert.throws(() => parseCallInput({ leadId: "yc_alpha", disposition: "BUSY", notes: "x".repeat(1001) }), CallInputError);
  assert.equal(CALL_DISPOSITIONS.length, 10);
  assert.ok(CALL_DISPOSITIONS.some((item) => item.code === "CONNECTED_WRONG_PERSON"));
  assert.ok(CALL_DISPOSITIONS.some((item) => item.code === "GATEKEEPER_BLOCKED"));
  assert.ok(CALL_DISPOSITIONS.some((item) => item.code === "GATEKEEPER_TRANSFERRED"));
});

test("call logging is durable, updates aggregate lead status, and dashboard metrics/history are campaign-scoped", () => {
  const db = fixture();
  try {
    const now = new Date("2026-10-04T12:00:00.000Z");
    const callbackId = saveCallOutcome(db, parseCallInput({
      leadId: "yc_alpha", disposition: "CONNECTED_CALLBACK", notes: "After product demo",
      nextFollowupAt: "2026-10-06T16:00:00.000Z", durationSeconds: 95,
    }), now);
    const wrongPersonId = saveCallOutcome(db, parseCallInput({
      leadId: "yc_beta", disposition: "CONNECTED_WRONG_PERSON", notes: "Founder left company",
    }), new Date("2026-10-04T13:00:00.000Z"));
    saveCallOutcome(db, parseCallInput({ leadId: "sg_gamma", disposition: "GATEKEEPER_BLOCKED" }), now);
    assert.ok(callbackId > 0);
    assert.ok(wrongPersonId > callbackId);

    const lead = db.prepare("SELECT status, call_attempts_count, last_disposition FROM prospects WHERE lead_id = 'yc_alpha'").get();
    assert.deepEqual(lead, { status: "Nurture / Follow-up", call_attempts_count: 1, last_disposition: "CONNECTED_CALLBACK" });
    const stats = getCallDashboard(db, "yc_us_expansion", now);
    assert.deepEqual(stats.metrics, {
      dialsToday: 2, connectsToday: 2, meetingsBookedToday: 0, gatekeeperBlocks: 0,
      connectRatePct: 100, meetingConversionPct: 0,
    });
    assert.equal(stats.recentCalls.length, 2);
    assert.equal(stats.recentCalls[0].disposition, "CONNECTED_WRONG_PERSON");
    assert.equal(stats.recentCalls[1].notes, "After product demo");
    assert.equal(stats.recentCalls[1].nextFollowupAt, "2026-10-06T16:00:00.000Z");

    const allCampaigns = getCallDashboard(db, "all", now);
    assert.equal(allCampaigns.metrics.dialsToday, 3);
    assert.equal(allCampaigns.metrics.gatekeeperBlocks, 1);
    assert.equal(getCallDashboard(db, "yc_us_expansion", new Date("2026-10-05T12:00:00Z")).metrics.dialsToday, 0);
  } finally {
    db.close();
  }
});

test("call outcome and prospect status changes roll back together if the lead update fails", () => {
  const db = fixture();
  try {
    db.exec(`CREATE TRIGGER reject_lead_call_update BEFORE UPDATE ON prospects
      BEGIN SELECT RAISE(ABORT, 'lead update blocked'); END`);
    assert.throws(() => saveCallOutcome(db, parseCallInput({ leadId: "yc_alpha", disposition: "CONNECTED_MEETING_BOOKED" }), new Date("2026-10-04T12:00:00Z")), /lead update blocked/);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM call_logs").get().count, 0);
    assert.equal(db.prepare("SELECT status FROM prospects WHERE lead_id = 'yc_alpha'").get().status, "Ready to Review");
  } finally {
    db.close();
  }
});
