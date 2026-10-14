import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { test } from "node:test";
import {
  applyMailboxAction,
  addSuppression,
  createMailbox,
  deleteMailbox,
  listMailboxes,
  listSuppressions,
  MailboxInputError,
  MailboxNotFoundError,
  MailboxSchemaError,
  setMailboxStatus,
  updateMailbox,
} from "../lib/mailboxes.ts";

function fixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE mailboxes (
      mailbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      sender_name TEXT NOT NULL DEFAULT 'Bryan @ Outbounder',
      smtp_server TEXT NOT NULL DEFAULT 'smtp.office365.com',
      smtp_port INTEGER NOT NULL DEFAULT 587,
      smtp_user TEXT NOT NULL,
      smtp_password TEXT NOT NULL,
      daily_limit INTEGER NOT NULL DEFAULT 50,
      hourly_limit INTEGER NOT NULL DEFAULT 6,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'COOLDOWN', 'PAUSED', 'ERROR')),
      provider_type TEXT NOT NULL DEFAULT 'MICROSOFT',
      cooldown_until TEXT,
      last_sent_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE campaign_sends (
      send_id INTEGER PRIMARY KEY,
      sender_email TEXT,
      status TEXT,
      response_msg TEXT,
      sent_at TEXT
    );
    CREATE TABLE email_suppression (email TEXT PRIMARY KEY, reason TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO mailboxes (email, smtp_user, smtp_password, status, daily_limit, hourly_limit)
      VALUES ('sender@example.test', 'smtp-login@example.test', 'DO_NOT_RETURN_this-secret', 'ACTIVE', 5, 3);
    INSERT INTO campaign_sends (sender_email, status, response_msg, sent_at) VALUES
      ('sender@example.test', 'SENT', '250 accepted', datetime('now', 'localtime')),
      ('sender@example.test', 'SENT', '[DRY-RUN] simulated', datetime('now', 'localtime')),
      ('sender@example.test', 'FAILED', '535 denied', datetime('now', 'localtime'));
  `);
  return db;
}

const validMailbox = (overrides = {}) => ({
  email: "new@example.test",
  senderName: "Bryan @ Outbounder",
  smtpServer: "smtp.example.test",
  smtpPort: 587,
  smtpUser: "new@example.test",
  smtpPassword: "test-secret",
  dailyLimit: 20,
  hourlyLimit: 4,
  providerType: "OTHER",
  ...overrides,
});

test("mailbox list returns health and quota data without credentials", () => {
  const db = fixture();
  try {
    const rows = listMailboxes(db);
    assert.equal(rows.length, 1);
    assert.deepEqual({
      id: rows[0].id, email: rows[0].email, status: rows[0].status,
      sendsToday: rows[0].sendsToday, sendsThisHour: rows[0].sendsThisHour,
      health: rows[0].health, credentialConfigured: rows[0].credentialConfigured,
    }, {
      id: 1, email: "sender@example.test", status: "ACTIVE",
      sendsToday: 1, sendsThisHour: 1, health: "Available", credentialConfigured: true,
    });
    const serialized = JSON.stringify(rows);
    assert.doesNotMatch(serialized, /DO_NOT_RETURN|smtp-login@example\.test|smtpPassword|smtp_user/i);
  } finally {
    db.close();
  }
});

test("health reports a configured sender at quota", () => {
  const db = fixture();
  try {
    db.prepare("UPDATE mailboxes SET daily_limit = 1 WHERE mailbox_id = 1").run();
    assert.equal(listMailboxes(db)[0].health, "At quota");
  } finally {
    db.close();
  }
});

test("create saves new mailbox paused and rejects malformed/duplicate credentials", () => {
  const db = fixture();
  try {
    const id = createMailbox(db, validMailbox());
    assert.equal(id, 2);
    const saved = db.prepare("SELECT email, smtp_password, status FROM mailboxes WHERE mailbox_id = ?").get(id);
    assert.deepEqual(saved, { email: "new@example.test", smtp_password: "test-secret", status: "PAUSED" });
    assert.throws(() => createMailbox(db, validMailbox({ smtpPort: 70000 })), MailboxInputError);
    assert.throws(() => createMailbox(db, validMailbox({ email: "bad-address" })), MailboxInputError);
    assert.throws(() => createMailbox(db, validMailbox({ email: "SENDER@example.test" })), MailboxInputError);
    assert.throws(() => createMailbox(db, validMailbox({ smtpPassword: "" })), MailboxInputError);
    assert.throws(() => createMailbox(db, validMailbox({ dailyLimit: 0 })), MailboxInputError);
    assert.throws(() => createMailbox(db, validMailbox({ hourlyLimit: 1.5 })), MailboxInputError);
    assert.throws(() => createMailbox(db, validMailbox({ dailyLimit: 3, hourlyLimit: 4 })), MailboxInputError);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM mailboxes").get().count, 2);
  } finally {
    db.close();
  }
});

test("operator quotas above the old caps persist without credential changes or legacy auto-unlocking", () => {
  const db = fixture();
  try {
    assert.equal(listMailboxes(db)[0].manualLimits, false);
    updateMailbox(db, 1, validMailbox({ email: "sender@example.test", smtpUser: "", smtpPassword: "", dailyLimit: 50, hourlyLimit: 10, manualLimits: true }));
    const saved = db.prepare("SELECT daily_limit,hourly_limit,manual_limits,smtp_password FROM mailboxes WHERE mailbox_id=1").get();
    assert.deepEqual(saved, { daily_limit: 50, hourly_limit: 10, manual_limits: 1, smtp_password: "DO_NOT_RETURN_this-secret" });
    assert.equal(listMailboxes(db)[0].manualLimits, true);
  } finally { db.close(); }
});

test("edit without replacement password preserves secret; explicit replacement updates it", () => {
  const db = fixture();
  try {
    const changes = validMailbox({ email: "sender@example.test", smtpPassword: "" });
    updateMailbox(db, 1, changes);
    assert.equal(db.prepare("SELECT smtp_password FROM mailboxes WHERE mailbox_id = 1").get().smtp_password, "DO_NOT_RETURN_this-secret");
    updateMailbox(db, 1, { ...changes, smtpPassword: "replacement-secret" });
    assert.equal(db.prepare("SELECT smtp_password FROM mailboxes WHERE mailbox_id = 1").get().smtp_password, "replacement-secret");
    assert.throws(() => updateMailbox(db, 999, changes), MailboxNotFoundError);
  } finally {
    db.close();
  }
});

test("pause/activate/delete are scoped to an existing mailbox id", () => {
  const db = fixture();
  try {
    setMailboxStatus(db, 1, "PAUSED");
    assert.equal(listMailboxes(db)[0].health, "Paused");
    setMailboxStatus(db, 1, "ACTIVE");
    deleteMailbox(db, 1);
    assert.deepEqual(listMailboxes(db), []);
    assert.throws(() => setMailboxStatus(db, 1, "PAUSED"), MailboxNotFoundError);
    assert.throws(() => deleteMailbox(db, 1), MailboxNotFoundError);
  } finally {
    db.close();
  }
});

test("API action core requires explicit confirmation before any mutation", () => {
  const db = fixture();
  try {
    assert.throws(() => applyMailboxAction(db, { action: "pause", id: 1, confirmed: false }), MailboxInputError);
    assert.equal(db.prepare("SELECT status FROM mailboxes WHERE mailbox_id = 1").get().status, "ACTIVE");
    assert.deepEqual(applyMailboxAction(db, { action: "pause", id: 1, confirmed: true }), {
      result: { updated: true }, status: 200,
    });
    assert.equal(db.prepare("SELECT status FROM mailboxes WHERE mailbox_id = 1").get().status, "PAUSED");
    assert.throws(() => applyMailboxAction(db, { action: "unexpected", confirmed: true }), MailboxInputError);
  } finally {
    db.close();
  }
});

test("manual suppression normalizes addresses, deduplicates case-insensitively, and lists reason", () => {
  const db = fixture();
  try {
    assert.deepEqual(addSuppression(db, { email: "Stop@Example.Test", reason: "Manual opt-out" }), { added: true });
    assert.deepEqual(addSuppression(db, { email: "stop@example.test", reason: "Duplicate" }), { added: false });
    assert.deepEqual(listSuppressions(db), [{ email: "stop@example.test", reason: "Manual opt-out", createdAt: listSuppressions(db)[0].createdAt }]);
    assert.throws(() => addSuppression(db, { email: "wrong", reason: "Bad input" }), MailboxInputError);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM email_suppression").get().count, 1);
  } finally {
    db.close();
  }
});

test("management fails closed when required local tables are missing", () => {
  const db = new Database(":memory:");
  try {
    assert.throws(() => listMailboxes(db), MailboxSchemaError);
    assert.throws(() => addSuppression(db, { email: "x@example.test", reason: "request" }), MailboxSchemaError);
  } finally {
    db.close();
  }
});
