import test from "node:test";
import assert from "node:assert/strict";
import { CALL_OBJECTIONS, callPlaybook, formatCallScript, companyWebsiteUrl, followupSummaryText, linkedinSearchUrl } from "../lib/call-aids.mjs";

test("company website shortcut normalizes a stored root domain safely", () => {
  assert.equal(companyWebsiteUrl("outbounder.test/path?source=yc"), "https://outbounder.test/");
  assert.equal(companyWebsiteUrl("http://example.com/about"), "http://example.com/");
});

test("company website shortcut rejects non-web and malformed domains", () => {
  for (const value of ["javascript:alert(1)", "javascript://alert(1)", "https://user:pass@example.com", "localhost", "127.0.0.1", "bad domain.com", ""]) {
    assert.equal(companyWebsiteUrl(value), null, value);
  }
  assert.equal(companyWebsiteUrl(null), null);
});

test("LinkedIn search encodes contact and company as one query", () => {
  const url = new URL(linkedinSearchUrl("Bryan Lai", "Outbounder & Co"));
  assert.equal(url.origin, "https://www.linkedin.com");
  assert.equal(url.searchParams.get("keywords"), "Bryan Lai Outbounder & Co");
  assert.equal(linkedinSearchUrl(null, "Outbounder"), "https://www.linkedin.com/search/results/all/?keywords=Outbounder");
  assert.equal(linkedinSearchUrl(null, null), null);
});

test("full Streamlit follow-up is personalized without removing its original service lines", () => {
  const text = followupSummaryText("Acme\nSystems", "Jane Doe");
  assert.match(text, /^Hi Jane,/);
  assert.match(text, /Acme Systems/);
  assert.match(text, /\$800\/mo/);
  assert.match(text, /Stripe, Mercury, Brex, and Gusto/);
  assert.match(text, /Delaware franchise tax, Form 1120 extensions, and 83\(b\) tracking/);
  assert.match(text, /5th business day/);
  assert.match(text, /Dedicated Slack channel with certified accountants/);
  assert.match(followupSummaryText("Acme", "Bryan Lai"), /^Hi Bryan,/);
  for (const role of ["Managing Director / Finance Head", "Finance Head", "Director", "CEO"]) {
    assert.match(followupSummaryText("Acme", role), /^Hi Founder,/, role);
  }
  assert.match(followupSummaryText(null, null), /for your company/);
});

test("full Streamlit objection guide retains all paragraphs and campaign-specific replies", () => {
  assert.equal(CALL_OBJECTIONS.length, 6);
  assert.ok(CALL_OBJECTIONS.every((item) => item.objection && item.response));
  assert.match(CALL_OBJECTIONS[0].response, /strict NDAs/);
  assert.equal(CALL_OBJECTIONS[0].response.split("\n").length, 3);
  assert.match(CALL_OBJECTIONS[5].response, /month-end reconciliation/);
  assert.match(callPlaybook("jobstreet_hiring_pain").objections[0].response, /precision engineering facility in Senai/);
  assert.match(followupSummaryText("Acme", "Jane", "jobstreet_hiring_pain", "AutoCount"), /daily bookkeeping & bank reconciliations in AutoCount/i);
  assert.match(followupSummaryText("Acme", "Jane", "jobstreet_hiring_pain"), /30-Day zero-risk trial/);
});

test("long saved phone scripts preserve every section and only replace Streamlit greetings", () => {
  const raw = `{time_greeting}\n[IF GATEKEEPER ANSWERS]\n${"Full original sentence.\n".repeat(160)}\n[THE CLOSE]\nGood day. Would Tuesday work?`;
  const expected = raw.replace("{time_greeting}", "Good afternoon").replace("Good day", "Good afternoon");
  assert.equal(formatCallScript(raw, "Good afternoon"), expected);
  assert.ok(formatCallScript(raw, "Good afternoon").length > 3500);
  assert.equal(formatCallScript(null, "Good morning"), "");
});
