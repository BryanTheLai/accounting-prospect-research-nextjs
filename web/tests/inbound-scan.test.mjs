import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canScanInboundMailbox,
  formatInboundScanSummary,
  normalizeInboundScanRequest,
  proxyInboundScan,
} from "../lib/inbound-scan.ts";

test("mailbox UI enables scanning only for credentialed Microsoft or Google providers", () => {
  assert.equal(canScanInboundMailbox("MICROSOFT", true), true);
  assert.equal(canScanInboundMailbox("google", true), true);
  assert.equal(canScanInboundMailbox("OTHER", true), false);
  assert.equal(canScanInboundMailbox("ANY", true), false);
  assert.equal(canScanInboundMailbox("MICROSOFT", false), false);
  assert.match(formatInboundScanSummary({
    status: "SUCCESS", messages_checked: 4, replies_processed: 1,
    bounces_processed: 1, opt_outs_processed: 0, unrelated: 2,
    already_processed: 0, oversized_skipped: 0,
  }), /No email was sent/);
});

test("inbound scan request requires confirmation and a bounded mailbox selection", () => {
  assert.deepEqual(normalizeInboundScanRequest({ mailboxId: 8, confirmed: true }), { mailboxId: 8, maxMessages: 15 });
  assert.deepEqual(normalizeInboundScanRequest({ mailboxId: 2, maxMessages: 20, confirmed: true }), { mailboxId: 2, maxMessages: 20 });
  for (const request of [
    { mailboxId: 1, confirmed: false },
    { mailboxId: "1", confirmed: true },
    { mailboxId: 0, confirmed: true },
    { mailboxId: 1, maxMessages: 21, confirmed: true },
    { mailboxId: 1, maxMessages: 0, confirmed: true },
  ]) assert.throws(() => normalizeInboundScanRequest(request), TypeError);
});

test("API proxy posts only mailbox id and bounded count, then strips unapproved fields", async () => {
  let called = false;
  const response = await proxyInboundScan(
    { mailboxId: 8, maxMessages: 15, confirmed: true, smtpPassword: "DO_NOT_FORWARD" },
    {
      token: "CONTROL_TOKEN",
      port: "9876",
      fetcher: async (url, options) => {
        called = true;
        assert.equal(url, "http://127.0.0.1:9876/inbound-scan");
        assert.equal(options.method, "POST");
        assert.equal(options.headers.Authorization, "Bearer CONTROL_TOKEN");
        assert.deepEqual(JSON.parse(options.body), { mailboxId: 8, maxMessages: 15, confirmed: true });
        assert.ok(options.signal);
        return Response.json({
          status: "SUCCESS", messages_checked: 3, replies_processed: 1,
          bounces_processed: 1, opt_outs_processed: 1, unrelated: 0,
          already_processed: 0, oversized_skipped: 0,
          smtp_password: "NEVER_RETURN", body: "PRIVATE MESSAGE CONTENT", email: "founder@private.test",
        });
      },
    },
  );
  assert.equal(called, true);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload, {
    status: "SUCCESS", messages_checked: 3, replies_processed: 1,
    bounces_processed: 1, opt_outs_processed: 1, unrelated: 0,
    already_processed: 0, oversized_skipped: 0,
  });
  assert.doesNotMatch(JSON.stringify(payload), /NEVER_RETURN|PRIVATE MESSAGE|founder@private|smtp_password/i);
});

test("API proxy rejects invalid or unconfirmed actions before calling sidecar", async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; return Response.json({}); };
  const invalid = await proxyInboundScan({ mailboxId: 1, confirmed: false }, { token: "token", fetcher });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /Confirm the read-only/);
  const unavailable = await proxyInboundScan({ mailboxId: 1, confirmed: true }, { fetcher });
  assert.equal(unavailable.status, 503);
  assert.equal(calls, 0);
});

test("API proxy never forwards mailbox secrets from an upstream failure", async () => {
  const response = await proxyInboundScan(
    { mailboxId: 1, confirmed: true },
    {
      token: "token",
      fetcher: async () => Response.json({ error: "Auth failed for private-login@example.test with DO_NOT_LEAK" }, { status: 503 }),
    },
  );
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.equal(result.error, "Inbound scan failed. Mailbox credentials and server details were not returned.");
  assert.doesNotMatch(JSON.stringify(result), /private-login|DO_NOT_LEAK/);
});
