import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import {
  classifyMxLookup,
  confirmEmailSource,
  ensureEmailPreflightTable,
  getEmailPreflight,
  invalidateEmailPreflight,
  isEmailPreflightFresh,
  MX_PRESENT_LABEL,
  MX_STATUSES,
  mxStatusLabel,
  saveMxCheck,
  validateEmailSyntax,
} from "../lib/email-preflight-core.mjs";

test("validates syntax without treating syntax as mailbox verification", () => {
  assert.deepEqual(validateEmailSyntax("founder@example.com"), {
    valid: true,
    domain: "example.com",
    reason: "Syntax looks valid.",
  });
  assert.equal(validateEmailSyntax(" founder@example.com").valid, false);
  assert.equal(validateEmailSyntax("founder..lai@example.com").valid, false);
  assert.equal(validateEmailSyntax("founder@-example.com").valid, false);
  assert.equal(validateEmailSyntax("founder@@example.com").valid, false);
});

test("classifies DNS outcomes without any SMTP probe", () => {
  const present = classifyMxLookup([{ exchange: "mx1.example.com." }]);
  assert.deepEqual(present, { mx_status: "mx_present", hosts: ["mx1.example.com"] });
  assert.equal(mxStatusLabel(present.mx_status), MX_PRESENT_LABEL);
  assert.equal(classifyMxLookup([], "ENODATA").mx_status, "no_mx");
  assert.equal(classifyMxLookup([], "ENOTFOUND").mx_status, "no_mx");
  assert.equal(classifyMxLookup([], "ETIMEOUT").mx_status, "lookup_error");
  assert.equal(mxStatusLabel("mx_present"), "MX present; mailbox existence unverified");
});

test("expires live-send evidence after 30 days or when timestamps are missing or in the future", () => {
  const now = Date.parse("2026-10-04T12:00:00.000Z");
  const current = {
    checked_at: "2026-10-01T12:00:00.000Z",
    source_confirmed: 1,
    source_confirmed_at: "2026-10-02T12:00:00.000Z",
  };
  assert.equal(isEmailPreflightFresh(current, now), true);
  assert.equal(isEmailPreflightFresh({ ...current, checked_at: "2026-09-04T11:59:59.000Z" }, now), false);
  assert.equal(isEmailPreflightFresh({ ...current, source_confirmed_at: "" }, now), false);
  assert.equal(isEmailPreflightFresh({ ...current, source_confirmed_at: "2026-10-04T12:00:00" }, now), false);
  assert.equal(isEmailPreflightFresh({ ...current, source_confirmed_at: "2026-10-04T12:06:00.000Z" }, now), false);
});

test("persists exact lead address and resets source confirmation when the address changes", () => {
  const directory = mkdtempSync(join(tmpdir(), "openc-email-preflight-"));
  const db = new Database(join(directory, "isolated.sqlite"));
  try {
    db.exec("CREATE TABLE prospects (lead_id TEXT PRIMARY KEY)");
    db.prepare("INSERT INTO prospects (lead_id) VALUES (?)").run("yc_example");
    ensureEmailPreflightTable(db);
    assert.deepEqual(db.prepare("PRAGMA table_info(email_preflight)").all().map((row) => row.name), [
      "lead_id", "email", "mx_status", "mx_hosts", "checked_at", "source_confirmed", "source_confirmed_at",
    ]);

    const initial = saveMxCheck(db, {
      leadId: "yc_example",
      exactEmail: "Founder@Example.com",
      status: MX_STATUSES.PRESENT,
      hosts: ["mx.example.com"],
      checkedAt: "2026-10-04T00:00:00.000Z",
    });
    assert.equal(initial.email, "Founder@Example.com");
    assert.equal(initial.source_confirmed, 0);
    assert.throws(() => confirmEmailSource(db, {
      leadId: "yc_example",
      exactEmail: "Founder@Example.com",
      confirmationEmail: "founder@example.com",
      sawPublishedAddress: true,
      confirmedAt: "2026-10-04T00:01:00.000Z",
    }), /exact email address/);
    assert.throws(() => confirmEmailSource(db, {
      leadId: "yc_example",
      exactEmail: "Founder@Example.com",
      confirmationEmail: "Founder@Example.com",
      sawPublishedAddress: false,
      confirmedAt: "2026-10-04T00:01:00.000Z",
    }), /exact email address/);

    const confirmed = confirmEmailSource(db, {
      leadId: "yc_example",
      exactEmail: "Founder@Example.com",
      confirmationEmail: "Founder@Example.com",
      sawPublishedAddress: true,
      confirmedAt: "2026-10-04T00:02:00.000Z",
    });
    assert.equal(confirmed.source_confirmed, 1);

    const changed = invalidateEmailPreflight(db, "yc_example", "bryan@example.com");
    assert.equal(changed.email, "bryan@example.com");
    assert.equal(changed.mx_status, "not_checked");
    assert.equal(changed.mx_hosts, "[]");
    assert.equal(changed.checked_at, "");
    assert.equal(changed.source_confirmed, 0);
    assert.equal(changed.source_confirmed_at, null);
    assert.equal(getEmailPreflight(db, "yc_example").email, "bryan@example.com");
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("source confirmation is rejected unless the current exact address has MX", () => {
  const directory = mkdtempSync(join(tmpdir(), "openc-email-preflight-"));
  const db = new Database(join(directory, "isolated.sqlite"));
  try {
    saveMxCheck(db, {
      leadId: "lead_1",
      exactEmail: "person@example.net",
      status: MX_STATUSES.MISSING,
      hosts: [],
      checkedAt: "2026-10-04T00:00:00.000Z",
    });
    assert.throws(() => confirmEmailSource(db, {
      leadId: "lead_1",
      exactEmail: "person@example.net",
      confirmationEmail: "person@example.net",
      sawPublishedAddress: true,
      confirmedAt: "2026-10-04T00:01:00.000Z",
    }), /MX-present check/);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
