import dns from "node:dns";
import { Resolver } from "node:dns/promises";

const FALLBACK_SERVERS = ["1.1.1.1", "8.8.8.8", "9.9.9.9"];
const LOOPBACK = new Set(["127.0.0.1", "::1", "0.0.0.0", ""]);

// ENODATA = name exists without the record; ENOTFOUND = name does not exist.
// Both are authoritative answers, so a second resolver must not overrule them.
const AUTHORITATIVE_CODES = new Set(["ENODATA", "ENOTFOUND"]);

let cachedServer = "";

/** Loopback is the shape of a misconfigured resolver, so it is never trusted. */
function ambientServers() {
  return dns.getServers().filter((server) => !LOOPBACK.has(server));
}

function candidateServers() {
  const ordered = cachedServer ? [cachedServer] : [];
  for (const server of [...ambientServers(), ...FALLBACK_SERVERS]) {
    if (!ordered.includes(server)) ordered.push(server);
  }
  return ordered;
}

function resolverFor(server) {
  const resolver = new Resolver({ timeout: 3000, tries: 1 });
  resolver.setServers([server]);
  return resolver;
}

async function resolveAcrossServers(method, target) {
  let lastError;
  for (const server of candidateServers()) {
    try {
      const records = await resolverFor(server)[method](target);
      cachedServer = server;
      return records;
    } catch (error) {
      if (AUTHORITATIVE_CODES.has(error?.code)) throw error;
      lastError = error;
    }
  }
  throw lastError ?? new Error("No DNS resolver answered.");
}

/** MX lookup that survives a dead ambient resolver instead of reporting a false negative. */
export function resolveMx(domain) {
  return resolveAcrossServers("resolveMx", domain);
}

/** IPv4 lookup used by discovery to prove a host is publicly routable before crawling. */
export function resolve4(hostname) {
  return resolveAcrossServers("resolve4", hostname);
}

export function resetDnsResolverCache() {
  cachedServer = "";
}