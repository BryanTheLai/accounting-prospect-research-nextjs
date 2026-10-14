import { isIP } from "node:net";
import { resolve4 } from "./dns-resolver.mjs";
import https from "node:https";

const COMMON_PATHS = ["/", "/contact", "/contact-us", "/about", "/about-us", "/team", "/careers", "/jobs"];
const MAX_HTML_BYTES = 1024 * 1024;
const MAX_CANDIDATES = 30;
const EMAIL_PATTERN = /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+/g;
const CLOUDFLARE_PATTERN = /data-cfemail=["']([0-9a-f]{4,256})["']/gi;

const DENIED_IPV4_RANGES = [
  [[0, 0, 0, 0], 8], [[10, 0, 0, 0], 8], [[100, 64, 0, 0], 10], [[127, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16], [[172, 16, 0, 0], 12], [[192, 0, 0, 0], 24], [[192, 0, 2, 0], 24],
  [[192, 88, 99, 0], 24], [[192, 168, 0, 0], 16], [[198, 18, 0, 0], 15], [[198, 51, 100, 0], 24],
  [[203, 0, 113, 0], 24], [[224, 0, 0, 0], 4], [[240, 0, 0, 0], 4],
];

function ipv4Number(address) {
  if (isIP(address) !== 4) return null;
  return address.split(".").reduce((value, part) => (value * 256) + Number(part), 0) >>> 0;
}

function cidrContains(address, network, prefix) {
  const value = ipv4Number(address);
  if (value === null) return true;
  const base = network.reduce((current, part) => (current * 256) + part, 0) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

export function isPublicIpv4(address) {
  if (ipv4Number(address) === null) return false;
  return !DENIED_IPV4_RANGES.some(([network, prefix]) => cidrContains(address, network, prefix));
}

export function normalizeCompanyDomain(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 260) return null;
  let url;
  try {
    const raw = value.trim();
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return null;

  let host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("www.")) host = host.slice(4);
  if (!host || host.length > 253 || isIP(host) !== 0) return null;
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(labels.at(-1) || "")) return null;
  if (["localhost", "local", "internal", "test", "invalid", "example", "onion"].includes(labels.at(-1) || "")) return null;
  return host;
}

function targetDomainEmail(email, domain) {
  const at = email.lastIndexOf("@");
  if (at <= 0) return false;
  const candidateDomain = email.slice(at + 1).toLowerCase();
  return candidateDomain === domain || candidateDomain.endsWith(`.${domain}`);
}

export function classifyDiscoveredAddress(email) {
  const localPart = email.split("@", 1)[0].toLowerCase();
  if (/^(?:support|billing|help|no[_-]?reply|newsletter|service|notifications?|automated|mailer-daemon|do-not-reply|donotreply)(?:[._+-].*)?$/.test(localPart)) return "system_or_support";
  if (/^(?:info|admin|contact|enquiry|general|mail|office|sales)(?:[._+-].*)?$/.test(localPart)) return "generic";
  return "unclassified";
}

function decodeCloudflare(hex) {
  try {
    const key = Number.parseInt(hex.slice(0, 2), 16);
    if (!Number.isFinite(key)) return "";
    let decoded = "";
    for (let index = 2; index < hex.length; index += 2) {
      const byte = Number.parseInt(hex.slice(index, index + 2), 16);
      if (!Number.isFinite(byte)) return "";
      decoded += String.fromCharCode(byte ^ key);
    }
    return decoded;
  } catch {
    return "";
  }
}

function extractEmails(html, domain) {
  const found = new Set();
  const strings = [html];
  for (const match of html.matchAll(CLOUDFLARE_PATTERN)) strings.push(decodeCloudflare(match[1]));
  for (const text of strings) {
    for (const match of text.matchAll(EMAIL_PATTERN)) {
      const email = match[0].toLowerCase().replace(/[.,;:!?]+$/, "");
      if (email.length <= 254 && targetDomainEmail(email, domain)) found.add(email);
    }
  }
  return [...found];
}

function requestHtml(url, pinnedAddress) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: "GET",
      headers: {
        "User-Agent": "OutbounderContactDiscovery/1.0",
        Accept: "text/html",
        "Accept-Encoding": "identity",
        Connection: "close",
      },
      agent: false,
      maxHeaderSize: 32 * 1024,
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions?.all) callback(null, [{ address: pinnedAddress, family: 4 }]);
        else callback(null, pinnedAddress, 4);
      },
    }, (response) => {
      const contentType = String(response.headers["content-type"] || "").toLowerCase();
      if (response.statusCode !== 200 || !contentType.includes("text/html")) {
        response.resume();
        resolve(null);
        return;
      }
      let bytes = 0;
      const chunks = [];
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_HTML_BYTES) {
          request.destroy(new Error("Page exceeds the size limit"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    request.setTimeout(2500, () => request.destroy(new Error("Page request timed out")));
    request.on("error", reject);
    request.end();
  });
}

async function fetchPublicHtml(hostname, path, resolveHost, fetchHtml) {
  const addresses = await resolveHost(hostname);
  if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some((address) => !isPublicIpv4(address))) {
    throw new Error("Company host does not resolve exclusively to public IPv4 addresses");
  }
  const url = new URL(path, `https://${hostname}`);
  return fetchHtml(url, addresses[0]);
}

export async function discoverEmailsForDomain(value, options = {}) {
  const domain = normalizeCompanyDomain(value);
  if (!domain) return { status: "invalid_domain", pagesCrawled: 0, candidates: [] };

  const resolveHost = options.resolveHost || ((hostname) => resolve4(hostname));
  const fetchHtml = options.fetchHtml || requestHtml;
  const hosts = [domain, `www.${domain}`];
  const candidates = new Map();
  let pagesCrawled = 0;
  let successfulHost = "";

  for (const hostname of hosts) {
    let hostHadHtml = false;
    for (let offset = 0; offset < COMMON_PATHS.length; offset += 2) {
      const batch = COMMON_PATHS.slice(offset, offset + 2);
      const results = await Promise.all(batch.map(async (path) => {
        try {
          return { path, html: await fetchPublicHtml(hostname, path, resolveHost, fetchHtml) };
        } catch {
          return { path, html: null };
        }
      }));
      for (const { path, html } of results) {
        if (html === null) continue;
        pagesCrawled += 1;
        hostHadHtml = true;
        const sourceUrl = new URL(path, `https://${hostname}`).toString();
        for (const email of extractEmails(html, domain)) {
          const existing = candidates.get(email);
          if (existing) {
            if (!existing.sourceUrls.includes(sourceUrl) && existing.sourceUrls.length < 4) existing.sourceUrls.push(sourceUrl);
          } else if (candidates.size < MAX_CANDIDATES) {
            candidates.set(email, { email, kind: classifyDiscoveredAddress(email), sourceUrls: [sourceUrl] });
          }
        }
      }
    }
    if (hostHadHtml) {
      successfulHost = hostname;
      break;
    }
  }

  const result = [...candidates.values()].sort((left, right) => left.email.localeCompare(right.email));
  return {
    status: result.length ? "found" : successfulHost ? "no_candidates" : "unreachable",
    pagesCrawled,
    candidates: result,
  };
}
