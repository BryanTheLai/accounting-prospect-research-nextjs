import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { updateProspectContact, parseContactUpdate } from "../lib/contacts.ts";
import {
  classifyDiscoveredAddress,
  discoverEmailsForDomain,
  isPublicIpv4,
  normalizeCompanyDomain,
} from "../lib/email-discovery.mjs";
import {
  confirmEmailSource,
  ensureEmailPreflightTable,
  getEmailPreflight,
  saveMxCheck,
} from "../lib/email-preflight-core.mjs";

function cloudflareEncode(email) {
  const key = 0x42;
  const encoded = [...email].map((character) => (character.charCodeAt(0) ^ key).toString(16).padStart(2, "0")).join("");
  return `${key.toString(16).padStart(2, "0")}${encoded}`;
}

test("normalizes company domains and rejects userinfo, paths, IPs, and local names", () => {
  assert.equal(normalizeCompanyDomain("Acme.co"), "acme.co");
  assert.equal(normalizeCompanyDomain("https://acme.co/"), "acme.co");
  assert.equal(normalizeCompanyDomain("www.acme.co"), "acme.co");
  for (const value of [
    "http://acme.co",
    "https://user@acme.co",
    "https://acme.co/private-path",
    "https://127.0.0.1",
    "localhost",
    "service.internal",
    "acme.example",
    "acme.co:8443",
  ]) assert.equal(normalizeCompanyDomain(value), null, value);
});

test("allows only public IPv4 addresses for the pinned HTTPS connection", () => {
  assert.equal(isPublicIpv4("93.184.216.34"), true);
  for (const address of ["10.0.0.1", "100.64.1.1", "127.0.0.1", "169.254.1.1", "172.16.0.1", "192.0.2.1", "192.168.1.1", "198.18.0.1", "203.0.113.1", "224.0.0.1", "::1"]) {
    assert.equal(isPublicIpv4(address), false, address);
  }
});

test("returns same-company website candidates with source pages and explicit quality classes", async () => {
  const requested = [];
  const encoded = cloudflareEncode("people@acme.co");
  const result = await discoverEmailsForDomain("acme.co", {
    resolveHost: async () => ["93.184.216.34"],
    fetchHtml: async (url, pinnedAddress) => {
      requested.push({ url: url.toString(), pinnedAddress });
      if (url.pathname !== "/contact") return null;
      return `<a href="mailto:Founder@Acme.co">Founder@Acme.co</a> info@acme.co support@acme.co help@sub.acme.co bad@acme.co.attacker.net trap@fakeacme.co <span data-cfemail="${encoded}"></span>`;
    },
  });

  assert.equal(result.status, "found");
  assert.equal(result.pagesCrawled, 1);
  assert.deepEqual(result.candidates.map((candidate) => [candidate.email, candidate.kind]), [
    ["founder@acme.co", "unclassified"],
    ["help@sub.acme.co", "system_or_support"],
    ["info@acme.co", "generic"],
    ["people@acme.co", "unclassified"],
    ["support@acme.co", "system_or_support"],
  ]);
  assert.deepEqual(result.candidates.find((candidate) => candidate.email === "founder@acme.co").sourceUrls, ["https://acme.co/contact"]);
  assert.ok(requested.every(({ url, pinnedAddress }) => url.startsWith("https://acme.co/") && pinnedAddress === "93.184.216.34"));
  assert.ok(requested.every(({ url }) => ["/", "/contact", "/contact-us", "/about", "/about-us", "/team", "/careers", "/jobs"].includes(new URL(url).pathname)));
});

test("blocks every page when any resolved address is non-public", async () => {
  let fetchCount = 0;
  const result = await discoverEmailsForDomain("acme.co", {
    resolveHost: async () => ["93.184.216.34", "127.0.0.1"],
    fetchHtml: async () => { fetchCount += 1; return "x@y.acme.co"; },
  });
  assert.equal(result.status, "unreachable");
  assert.equal(result.pagesCrawled, 0);
  assert.equal(fetchCount, 0);
});

test("discovery stays unsaved until the contact update flow is explicitly invoked and clears preflight evidence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openc-email-discovery-"));
  const db = new Database(join(directory, "isolated.sqlite"));
  try {
    db.exec(`CREATE TABLE prospects (
      lead_id TEXT PRIMARY KEY, company_name TEXT, root_domain TEXT, buyer_name TEXT,
      buyer_title TEXT, contact_email TEXT, contact_phone TEXT
    )`);
    db.prepare(`INSERT INTO prospects VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      "yc_acme", "Acme", "acme.co", "Founder", "CEO", "old@acme.co", "",
    );
    ensureEmailPreflightTable(db);
    saveMxCheck(db, { leadId: "yc_acme", exactEmail: "old@acme.co", status: "mx_present", hosts: ["mx.acme.co"], checkedAt: "2026-10-04T00:00:00.000Z" });
    confirmEmailSource(db, { leadId: "yc_acme", exactEmail: "old@acme.co", confirmationEmail: "old@acme.co", sawPublishedAddress: true, confirmedAt: "2026-10-04T00:01:00.000Z" });

    const candidates = await discoverEmailsForDomain("acme.co", {
      resolveHost: async () => ["93.184.216.34"],
      fetchHtml: async (url) => url.pathname === "/contact" ? "founder@acme.co" : null,
    });
    assert.equal(candidates.candidates[0].email, "founder@acme.co");
    assert.equal(db.prepare("SELECT contact_email FROM prospects WHERE lead_id = ?").get("yc_acme").contact_email, "old@acme.co");
    assert.equal(getEmailPreflight(db, "yc_acme").email, "old@acme.co");

    const saved = updateProspectContact(db, parseContactUpdate({ leadId: "yc_acme", email: candidates.candidates[0].email }));
    assert.equal(saved.contact.email, "founder@acme.co");
    assert.equal(saved.emailPreflightInvalidated, true);
    assert.deepEqual(getEmailPreflight(db, "yc_acme"), {
      lead_id: "yc_acme", email: "founder@acme.co", mx_status: "not_checked", mx_hosts: "[]",
      checked_at: "", source_confirmed: 0, source_confirmed_at: null,
    });
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("classifies automated/support inboxes as non-adoptable and generic inboxes as review-required", () => {
  assert.equal(classifyDiscoveredAddress("noreply@acme.co"), "system_or_support");
  assert.equal(classifyDiscoveredAddress("billing.eu@acme.co"), "system_or_support");
  assert.equal(classifyDiscoveredAddress("info@acme.co"), "generic");
  assert.equal(classifyDiscoveredAddress("founder@acme.co"), "unclassified");
});
