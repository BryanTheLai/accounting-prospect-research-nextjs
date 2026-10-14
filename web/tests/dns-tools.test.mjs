import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkDomainDnsblReputation,
  DNSBL_SERVICES,
  DNS_DOWNLOADS,
  DNS_RECORD_GUIDANCE,
  normalizeDnsDomain,
} from "../lib/dns-tools.mjs";

test("normalizes Streamlit-style domain input and rejects unsafe or malformed targets", () => {
  assert.equal(normalizeDnsDomain(" HTTPS://OpenClose-Desk.com/settings "), "openclose-desk.com");
  assert.equal(normalizeDnsDomain("example.com."), "example.com");
  for (const invalid of ["", "localhost", "127.0.0.1", "example.com:53", "user@example.com", "example..com", "-bad.example"]) {
    assert.equal(normalizeDnsDomain(invalid), null, invalid);
  }
});

test("does not call DNS for invalid input and audits the four configured providers only on explicit invocation", async () => {
  const queried = [];
  const lookup = async (query) => {
    queried.push(query);
    const error = new Error("No listing record");
    error.code = "ENOTFOUND";
    throw error;
  };

  const invalid = await checkDomainDnsblReputation("bad domain", lookup);
  assert.ok("error" in invalid);
  assert.equal(queried.length, 0);

  const result = await checkDomainDnsblReputation("openclose-desk.com", lookup);
  assert.equal(result.overall_status, "CLEAN");
  assert.equal(result.is_listed, false);
  assert.deepEqual(queried, DNSBL_SERVICES.map(({ host }) => `openclose-desk.com.${host}`));
  assert.deepEqual(result.checks.map(({ status }) => status), ["CLEAN", "CLEAN", "CLEAN", "CLEAN"]);
});

test("reports listed results with return codes and keeps provider failures visibly incomplete", async () => {
  const result = await checkDomainDnsblReputation("example.com", async (query) => {
    if (query.endsWith("zen.spamhaus.org")) return ["127.0.0.2"];
    if (query.endsWith("dbl.spamhaus.org")) {
      const error = new Error("No record");
      error.code = "ENODATA";
      throw error;
    }
    const error = new Error("resolver unavailable");
    error.code = "ETIMEOUT";
    throw error;
  });

  assert.equal(result.overall_status, "LISTED");
  assert.equal(result.checks[0].return_code, "127.0.0.2");
  assert.equal(result.checks[1].status, "CLEAN");
  assert.deepEqual(result.checks.slice(2).map(({ status }) => status), ["QUERY_TIMEOUT", "QUERY_TIMEOUT"]);

  const incomplete = await checkDomainDnsblReputation("example.com", async () => {
    const error = new Error("timeout");
    error.code = "ETIMEOUT";
    throw error;
  });
  assert.equal(incomplete.overall_status, "INCOMPLETE");
});

test("ports DNS guidance and fixed download names without accepting arbitrary file names", () => {
  assert.deepEqual(Object.values(DNS_DOWNLOADS).map(({ filename }) => filename), ["cloudflare_dns.zone", "cloudflare_dns_records.json"]);
  assert.equal(DNS_RECORD_GUIDANCE.find(({ record }) => record === "DMARC").purpose.includes("p=none"), true);
  assert.deepEqual(DNSBL_SERVICES.map(({ host }) => host), [
    "zen.spamhaus.org", "dbl.spamhaus.org", "bl.spamcop.net", "b.barracudacentral.org",
  ]);
});
