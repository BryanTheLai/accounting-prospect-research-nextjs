import { isIP } from "node:net";

export const DNSBL_SERVICES = [
  { host: "zen.spamhaus.org", name: "Spamhaus ZEN (SBL/XBL/PBL)" },
  { host: "dbl.spamhaus.org", name: "Spamhaus Domain Blocklist (DBL)" },
  { host: "bl.spamcop.net", name: "SpamCop Blocking List" },
  { host: "b.barracudacentral.org", name: "Barracuda Reputation Network" },
];

export const DNS_DOWNLOADS = {
  bind: { filename: "cloudflare_dns.zone", mimeType: "text/plain" },
  cloudflare: { filename: "cloudflare_dns_records.json", mimeType: "application/json" },
};

export const DNS_RECORD_GUIDANCE = [
  { record: "MX", purpose: "Routes inbound mail to Microsoft 365 or Google Workspace." },
  { record: "SPF", purpose: "Authorizes approved sending servers; the supplied sample uses ~all." },
  { record: "DKIM", purpose: "Adds a cryptographic signature using provider-issued selectors." },
  { record: "DMARC", purpose: "Sets receiver policy and alignment reporting. The supplied sample uses p=none (monitoring), not p=reject." },
];

/** Mirrors the Streamlit checker: lowercase, strip scheme, then ignore a URL path. */
export function normalizeDnsDomain(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  let candidate = value.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  candidate = candidate.replace(/\.$/, "");
  if (!candidate || candidate.length > 253 || isIP(candidate) || candidate.includes(":") || candidate.includes("@") || candidate.includes("?") || candidate.includes("#")) return null;
  const labels = candidate.split(".");
  if (labels.length < 2 || labels.some((label) => label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
  return candidate;
}

function codeOf(error) {
  return error && typeof error === "object" && typeof error.code === "string" ? error.code : "UNKNOWN";
}

/** lookup(queryTarget) is injected so tests never issue DNS traffic. */
export async function checkDomainDnsblReputation(value, lookup) {
  const domain = normalizeDnsDomain(value);
  if (!domain) return { error: "Enter a valid domain name, such as openclose-desk.com." };
  if (typeof lookup !== "function") throw new TypeError("A DNS lookup function is required");

  const checks = await Promise.all(DNSBL_SERVICES.map(async ({ host, name }) => {
    try {
      const answers = await lookup(`${domain}.${host}`);
      const ips = Array.isArray(answers) ? answers.map(String) : [];
      return ips.length
        ? { service: name, status: "LISTED", return_code: ips[0] }
        : { service: name, status: "QUERY_TIMEOUT" };
    } catch (error) {
      const code = codeOf(error);
      if (code === "ENOTFOUND" || code === "ENODATA" || code === "NXDOMAIN" || code === "NODATA") {
        return { service: name, status: "CLEAN" };
      }
      return { service: name, status: "QUERY_TIMEOUT" };
    }
  }));

  const isListed = checks.some((check) => check.status === "LISTED");
  const hasUnavailable = checks.some((check) => check.status === "QUERY_TIMEOUT");
  const overallStatus = isListed ? "LISTED" : hasUnavailable ? "INCOMPLETE" : "CLEAN";
  return { domain, is_listed: isListed, overall_status: overallStatus, checks };
}
