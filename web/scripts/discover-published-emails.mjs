/**
 * Bulk-runs published-address discovery over queued prospect domains and writes
 * only what a human still has to attest. Discovery output is a candidate with a
 * source URL, never a confirmation: `source_confirmed` stays a human decision.
 *
 * Run: node scripts/discover-published-emails.mjs <queue.json> <out.json> [limit] [concurrency]
 */

import { readFile, writeFile } from "node:fs/promises";
import { discoverEmailsForDomain, normalizeCompanyDomain } from "../lib/email-discovery.mjs";

const [queuePath, outPath, limitArg, concurrencyArg] = process.argv.slice(2);
if (!queuePath || !outPath) {
  console.error("usage: node scripts/discover-published-emails.mjs <queue.json> <out.json> [limit] [concurrency]");
  process.exit(2);
}

const limit = Number(limitArg) > 0 ? Number(limitArg) : Infinity;
const concurrency = Number(concurrencyArg) > 0 ? Number(concurrencyArg) : 6;

const queue = JSON.parse(await readFile(queuePath, "utf8"));
const targets = queue.slice(0, limit);

const results = new Array(targets.length);
let cursor = 0;
let done = 0;
let foundPublished = 0;

async function worker() {
  while (true) {
    const index = cursor;
    if (index >= targets.length) return;
    cursor += 1;
    const target = targets[index];
    const entry = { ...target, discovery: null, error: null };
    try {
      if (!normalizeCompanyDomain(target.root_domain)) {
        entry.error = "invalid_domain";
      } else {
        const discovery = await discoverEmailsForDomain(target.root_domain);
        entry.discovery = discovery;
        if (discovery.candidates?.length) foundPublished += 1;
      }
    } catch (error) {
      entry.error = error?.code || error?.message || "discovery_failed";
    }
    results[index] = entry;
    done += 1;
    if (done % 10 === 0 || done === targets.length) {
      console.log(`  ${done}/${targets.length} crawled | ${foundPublished} domains published an address`);
    }
  }
}

console.log(`Discovering published addresses for ${targets.length} domains (concurrency ${concurrency})...`);
await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
await writeFile(outPath, JSON.stringify(results, null, 1));

const summary = {
  crawled: results.length,
  unreachable: results.filter((r) => r.discovery?.status === "unreachable").length,
  reachableButNoAddress: results.filter((r) => r.discovery?.status === "no_candidates").length,
  domainsWithPublishedAddress: results.filter((r) => r.discovery?.candidates?.length).length,
  totalCandidateAddresses: results.reduce((sum, r) => sum + (r.discovery?.candidates?.length || 0), 0),
};
console.log(JSON.stringify(summary, null, 2));