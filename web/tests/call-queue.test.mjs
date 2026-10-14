import assert from "node:assert/strict";
import { test } from "node:test";
import { CallQueueFilterError, parseCallQueueFilters } from "../lib/call-queue.mjs";
import { coreCallScript } from "../lib/core-call-script.mjs";

test("callable requires a phone and a score strictly above 80", () => {
  const filters = parseCallQueueFilters(new URLSearchParams());
  assert.equal(filters.prospects.callableOnly, true);
  assert.equal(filters.prospects.minFit, 81);
  assert.equal(filters.scriptStyle, "original");
});
test("all active targets keeps scope/search without a stage or script-mode filter", () => {
  const filters = parseCallQueueFilters(new URLSearchParams({ category: "all_active", campaignId: "yc_us_expansion", q: "Acme", status: "Ready to Review", scriptStyle: "all" }));
  assert.equal(filters.prospects.callableOnly, false);
  assert.equal(filters.prospects.minFit, 0);
  assert.equal(filters.prospects.status, "call_active");
  assert.equal(filters.prospects.campaignId, "yc_us_expansion");
  assert.equal(filters.prospects.query, "Acme");
  assert.equal(filters.scriptStyle, "original");
});
test("only the two requested audience modes are accepted", () => {
  for (const category of ["hiring_first", "high_priority", "everything"]) assert.throws(() => parseCallQueueFilters(new URLSearchParams({ category })), CallQueueFilterError);
  assert.throws(() => parseCallQueueFilters(new URLSearchParams({ limit: "0" })), /limit/);
});
test("the full saved original is preserved; short/missing scripts get the complete original-style flow", () => {
  const saved = "{time_greeting} Alex. Is this a bad time to talk? Original pitch.";
  assert.equal(coreCallScript({ phoneScript: saved }, "Good morning"), saved.replace("{time_greeting}", "Good morning"));
  const fallback = coreCallScript({ company: "Example", buyer: "Alex", phoneScript: "Hey, got 20 seconds?" }, "Good afternoon");
  assert.match(fallback, /Is this a bad time to talk, or do you have 60 seconds/);
  assert.match(fallback, /Example/);
  assert.doesNotMatch(fallback, /got 20 seconds/);
  for (const section of ["[IF RECEPTIONIST / GATEKEEPER ANSWERS]", "[WHEN DECISION MAKER PICKS UP]", "[UNDERSTAND THEIR CURRENT SETUP]", '[THE CHRIS VOSS "NO"-ORIENTED CLOSE]', "[POLITE BAILOUT IF THEY ASK DETAILED TAX / AUDIT RULES]", "[IF NOT INTERESTED / BUSY]"]) {
    assert.ok(fallback.includes(section), `Missing full-script section: ${section}`);
  }
  assert.match(fallback, /Would you be entirely against a brief 10-minute chat/);
  assert.ok(fallback.length > 2000);
  assert.doesNotMatch(fallback, /RM800|\$800|hiring an|Saw your/);
});

test("long fallback keeps campaign-specific service and pricing without inventing a contact name", () => {
  const malaysia = coreCallScript({ company: "Example", buyer: "Managing Director", campaignId: "hydroball_clones" }, "Good morning");
  assert.match(malaysia, /RM800 to RM1,200/);
  assert.match(malaysia, /SST-02/);
  assert.doesNotMatch(malaysia, /Good morning Managing Director|\$800/);
  const yc = coreCallScript({ company: "Example", buyer: "Alex", campaignId: "yc_us_expansion" }, "Good evening");
  assert.match(yc, /\$800\/mo/);
  assert.match(yc, /Stripe, Mercury, Brex, Gusto/);
  assert.doesNotMatch(yc, /RM800|SST-02/);
  const saved = `Good day Alex. Is this a bad time to talk?\n${"Original complete company-specific sentence.\n".repeat(100)}`;
  assert.equal(coreCallScript({ phoneScript: saved }, "Good morning"), saved);
});
