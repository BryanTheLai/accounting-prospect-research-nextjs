import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { resolveMx } from '../lib/dns-resolver.mjs';
import { stageVerifiedAddresses } from '../lib/outreach-preparation.mjs';

const args = process.argv.slice(2);
const manifestArg = args.find(arg => !arg.startsWith('--'));
if (!manifestArg) throw new Error('Usage: node scripts/prepare-reviewed-outreach.mjs <reviewed-manifest.json> [--apply]');
const apply = args.includes('--apply');
const manifestPath = resolve(manifestArg);
const directory = dirname(manifestPath);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const records = Array.isArray(manifest) ? manifest : manifest.records;
if (!Array.isArray(records) || records.length === 0) throw new Error('Expected nonempty reviewed records');
for (const record of records) {
  const archive = resolve(directory, record.archive_file);
  if (!archive.startsWith(directory + sep)) throw new Error('Archived source must be inside the batch directory');
  const html = await readFile(archive, 'utf8');
  const strings = [html];
  for (const match of html.matchAll(/data-cfemail=["']([a-f0-9]+)["']/gi)) {
    const bytes = Buffer.from(match[1], 'hex');
    strings.push([...bytes.subarray(1)].map(value => String.fromCharCode(value ^ bytes[0])).join(''));
  }
  if (!strings.some(text => text.toLowerCase().includes(record.email.toLowerCase()))) throw new Error(`Exact address not in archived source: ${record.lead_id}`);
  const hash = createHash('sha256').update(html).digest('hex');
  if (record.source_sha256 && hash !== record.source_sha256) throw new Error('Archived source changed since review');
  record.source_sha256 = hash;
  const mx = await resolveMx(record.email.split('@')[1]);
  if (mx.some(item => item.priority === 0 && (!item.exchange || item.exchange === '.'))) throw new Error('Null MX rejects mail');
  record.mx_hosts = mx.map(item => item.exchange.replace(/\.$/, '')).filter(Boolean);
}
const dbPath = fileURLToPath(new URL('../../operations/recovered-leads-20261008/leads.sqlite', import.meta.url));
const db = new Database(dbPath, { readonly: !apply, fileMustExist: true });
try {
  db.pragma('busy_timeout = 5000');
  stageVerifiedAddresses(db, records);
  if (apply) await db.backup(resolve(directory, `before-preflight-${Date.now()}.sqlite`));
  const result = stageVerifiedAddresses(db, records, { apply });
  await writeFile(resolve(directory, 'preparation-receipt.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  db.close();
}
