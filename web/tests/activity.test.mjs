import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { test } from "node:test";
import { getOutboundActivity } from "../lib/activity.ts";

function makeTempDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "outbounder-activity-"));
  const path = join(directory, "fixture.sqlite3");
  const db = new Database(path);
  db.exec(`
    CREATE TABLE campaign_sends (
      send_id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      company_name TEXT,
      subject TEXT NOT NULL,
      sender_email TEXT,
      status TEXT NOT NULL,
      response_msg TEXT,
      sent_at TEXT NOT NULL,
      variant_name TEXT
    );
    CREATE TABLE email_suppression (
      email TEXT PRIMARY KEY, reason TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE mailboxes (
      mailbox_id INTEGER PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      provider_type TEXT NOT NULL,
      daily_limit INTEGER NOT NULL,
      hourly_limit INTEGER NOT NULL,
      status TEXT NOT NULL,
      cooldown_until TEXT
    );
  `);
  return { db, path, directory };
}

function closeAndRemove(fixture, db = fixture.db) {
  if (db?.open) db.close();
  rmSync(fixture.directory, { recursive: true, force: true });
}

function reopenReadonly(fixture) {
  if (fixture.db.open) fixture.db.close();
  fixture.db = new Database(fixture.path, { readonly: true, fileMustExist: true });
  return fixture.db;
}

function insertSend(db, input) {
  db.prepare(`INSERT INTO campaign_sends (
    lead_id, recipient_email, company_name, subject, sender_email, status,
    response_msg, sent_at, variant_name
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      input.leadId || "lead",
      input.recipient,
      input.company,
      input.subject,
      input.sender,
      input.status,
      input.response,
      input.sentAt,
      input.variant ?? null,
    );
}

test("report groups outcomes and returns only redacted, read-only summaries", () => {
  const fixture = makeTempDatabase();
  try {
    const { db } = fixture;
    const now = db.prepare("SELECT datetime('now', 'localtime') AS value").get().value;
    db.prepare("INSERT INTO mailboxes (email, provider_type, daily_limit, hourly_limit, status) VALUES (?, ?, ?, ?, ?)")
      .run("sender.one@private.example", "MICROSOFT", 2, 1, "ACTIVE");
    db.prepare("INSERT INTO mailboxes (email, provider_type, daily_limit, hourly_limit, status) VALUES (?, ?, ?, ?, ?)")
      .run("sender.two@private.example", "GOOGLE", 25, 4, "COOLDOWN");
    db.prepare("INSERT INTO email_suppression (email, reason) VALUES (?, ?), (?, ?)")
      .run("blocked.one@private.example", "Bounce", "blocked.two@private.example", "Manual DNC");

    insertSend(db, { recipient: "founder@acme.example", sender: "sender.one@private.example", company: "Acme Ledger", subject: "Books for Acme", status: "SENT", response: "250 accepted", sentAt: now, variant: "Variant A" });
    insertSend(db, { recipient: "dry-run@acme.example", sender: "sender.one@private.example", company: "Acme Ledger", subject: "Dry run", status: "SENT", response: "[DRY-RUN SAFETY SHIELD] simulated", sentAt: now, variant: "Variant B" });
    insertSend(db, { recipient: "bounced@acme.example", sender: "sender.two@private.example", company: "bounced@acme.example", subject: "Bounce for founder@acme.example", status: "BOUNCED", response: "SMTP error mentions founder@acme.example", sentAt: now, variant: "Variant A" });
    insertSend(db, { recipient: "deferred@acme.example", sender: "sender.two@private.example", company: "Deferred Co", subject: "Later", status: "DEFERRED", response: "421", sentAt: now, variant: "Variant B" });
    insertSend(db, { recipient: "retry@acme.example", sender: "sender.two@private.example", company: "Retry Co", subject: "Retry", status: "DEFERRED_MAX_RETRIES", response: "retry exhausted", sentAt: now, variant: null });
    insertSend(db, { recipient: "failed@acme.example", sender: "sender.two@private.example", company: "Failed Co", subject: "Failed", status: "FAILED", response: "permanent error", sentAt: now, variant: null });
    insertSend(db, { recipient: "suppressed@acme.example", sender: "sender.two@private.example", company: "Suppressed Co", subject: "Suppressed", status: "SUPPRESSED", response: "DNC", sentAt: now, variant: null });
    insertSend(db, { recipient: "auth@acme.example", sender: "sender.two@private.example", company: "Auth Co", subject: "Auth", status: "AUTH_ERROR", response: "credentials rejected", sentAt: now, variant: null });
    insertSend(db, { recipient: "other@acme.example", sender: "sender.two@private.example", company: "Legacy Co", subject: "Legacy", status: "LEGACY_RESULT", response: "legacy status", sentAt: now, variant: null });

    const before = db.prepare("SELECT COUNT(*) AS count FROM campaign_sends").get().count;
    const readonlyDb = reopenReadonly(fixture);
    const report = getOutboundActivity(readonlyDb);
    const after = readonlyDb.prepare("SELECT COUNT(*) AS count FROM campaign_sends").get().count;

    assert.deepEqual(report.counts, {
      sent: 1,
      dryRun: 1,
      bounced: 1,
      deferred: 2,
      failedSuppressed: 3,
      other: 1,
      total: 9,
    });
    assert.equal(report.suppressionCount, 2);
    assert.equal(report.daily.length, 30);
    assert.equal(report.daily.at(-1).sent, 1);
    assert.equal(report.daily.at(-1).dryRun, 1);
    assert.equal(report.daily.at(-1).bounced, 1);
    assert.equal(report.daily.at(-1).deferred, 2);
    assert.equal(report.daily.at(-1).failedSuppressed, 3);
    assert.equal(report.daily.slice(0,-1).every((day) => day.total === 0), true);
    assert.equal(report.recentEvents.length, 9);
    assert.deepEqual(report.statusBreakdown.find((row) => row.status === "SENT"), { status: "SENT", count: 2 });
    assert.equal(report.recentEvents.find((event) => event.dryRun)?.variant, "Variant B");
    assert.equal("mailboxes" in report, false, "sender configuration belongs in Mailboxes, not send history");
    assert.equal(before, after, "reporting must not mutate send history");
    assert.throws(() => readonlyDb.prepare("DELETE FROM campaign_sends").run(), /readonly/i);

    const serialized = JSON.stringify(report);
    for (const privateAddress of [
      "founder@acme.example", "dry-run@acme.example", "sender.one@private.example",
      "sender.two@private.example", "blocked.one@private.example", "blocked.two@private.example",
    ]) {
      assert.equal(serialized.includes(privateAddress), false, `report leaked ${privateAddress}`);
    }
    assert.match(report.recentEvents.find((event) => event.status === "BOUNCED").subject, /\[redacted address\]/);
  } finally {
    closeAndRemove(fixture);
  }
});

test("recent activity is capped at the latest 100 events and tolerates missing variant attribution", () => {
  const fixture = makeTempDatabase();
  try {
    const { db } = fixture;
    const insert = db.prepare(`INSERT INTO campaign_sends (
      lead_id, recipient_email, company_name, subject, sender_email, status,
      response_msg, sent_at, variant_name
    ) VALUES (?, ?, ?, ?, ?, 'FAILED', '', ?, NULL)`);
    for (let index = 0; index < 105; index += 1) {
      const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString().replace("T", " ").slice(0, 19);
      insert.run(`lead-${index}`, `recipient${index}@private.example`, `Company ${index}`, `Subject ${index}`, "sender@private.example", timestamp);
    }

    // Simulate an older local database that predates A/B attribution columns.
    db.exec("ALTER TABLE campaign_sends DROP COLUMN variant_name");
    const readonlyDb = reopenReadonly(fixture);
    const report = getOutboundActivity(readonlyDb);

    assert.equal(report.recentEvents.length, 100);
    assert.equal(report.recentEvents[0].company, "Company 104");
    assert.equal(report.recentEvents[99].company, "Company 5");
    assert.equal(report.recentEvents[0].variant, null);
    assert.equal(report.counts.failedSuppressed, 105);
    assert.equal(JSON.stringify(report).includes("recipient104@private.example"), false);
  } finally {
    closeAndRemove(fixture);
  }
});
