import test from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns";
import { resolveMx, resolve4, resetDnsResolverCache } from "../lib/dns-resolver.mjs";

const live = { skip: process.env.DNS_RESOLVER_LIVE !== "1" };

test("resolveMx returns MX records through a dead ambient resolver", live, async () => {
  resetDnsResolverCache();
  const records = await resolveMx("anglera.com");
  assert.ok(records.length > 0, "expected at least one MX record");
  assert.ok(records.some((record) => /google\.com$/.test(String(record.exchange).replace(/\.$/, ""))));
});

test("resolve4 returns a public address", live, async () => {
  resetDnsResolverCache();
  const addresses = await resolve4("anglera.com");
  assert.ok(addresses.length > 0);
  assert.ok(addresses.every((address) => /^\d+\.\d+\.\d+\.\d+$/.test(address)));
});

test("an absent domain fails authoritatively instead of being retried away", live, async () => {
  resetDnsResolverCache();
  await assert.rejects(
    () => resolveMx("this-domain-absolutely-does-not-exist-outbounder-test.invalid"),
    (error) => error.code === "ENOTFOUND" || error.code === "ENODATA",
  );
});

test("loopback ambient resolvers are never trusted", async () => {
  const original = dns.getServers;
  dns.getServers = () => ["127.0.0.1", "::1"];
  try {
    resetDnsResolverCache();
    // Candidates must still include the public fallbacks, so a live lookup succeeds.
    const records = await resolveMx("anglera.com");
    assert.ok(records.length > 0, "dead loopback ambient config must not break lookups");
  } finally {
    dns.getServers = original;
    resetDnsResolverCache();
  }
});