import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { stageVerifiedAddresses } from '../lib/outreach-preparation.mjs';
import { ensureEmailPreflightTable, getEmailPreflight, isEmailPreflightFresh } from '../lib/email-preflight-core.mjs';

const now = '2026-10-12T12:00:00.000Z';
function fixture() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE prospects(lead_id TEXT PRIMARY KEY,company_name TEXT,root_domain TEXT,contact_email TEXT,status TEXT,notes TEXT,buyer_name TEXT);
    CREATE TABLE campaign_sends(lead_id TEXT,recipient_email TEXT,response_msg TEXT);
    CREATE TABLE email_suppression(email TEXT);
    CREATE TABLE dispatch_queue(id TEXT,status TEXT);
    INSERT INTO prospects VALUES('brand','Brand','brand.my',NULL,'Ready to Review','Existing note',NULL);
    INSERT INTO dispatch_queue VALUES('old-yc-row','PENDING');`);
  ensureEmailPreflightTable(db);
  const record = { lead_id: 'brand', company_name: 'Brand', root_domain: 'brand.my', email: 'hello@brand.my',
    source_url: 'https://brand.my/contact', source_sha256: 'a'.repeat(64), checked_at: now, mx_hosts: ['mx.brand.my'],
    identity_reviewed: true, address_context_reviewed: true, published_address_observed: true };
  return { db, record };
}

test('source staging makes the real preflight fresh without owner name or send approval', () => {
  const { db, record } = fixture();
  const beforeQueue = db.prepare('SELECT * FROM dispatch_queue').all();
  const result = stageVerifiedAddresses(db, [record], { apply: true, now });
  assert.equal(result.applied, 1);
  assert.equal(result.send_approved, 0);
  assert.equal(isEmailPreflightFresh(getEmailPreflight(db, 'brand'), new Date(now)), true);
  const lead = db.prepare('SELECT * FROM prospects').get();
  assert.equal(lead.contact_email, 'hello@brand.my');
  assert.equal(lead.status, 'Ready to Review');
  assert.equal(lead.buyer_name, null);
  assert.deepEqual(db.prepare('SELECT * FROM dispatch_queue').all(), beforeQueue);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM campaign_sends').get().n, 0);
  db.close();
});

test('dry run never modifies prospect or preflight', () => {
  const { db, record } = fixture();
  stageVerifiedAddresses(db, [record], { now });
  assert.equal(db.prepare('SELECT contact_email FROM prospects').get().contact_email, null);
  assert.equal(getEmailPreflight(db, 'brand'), null);
  db.close();
});

test('repeat staging is idempotent and preserves notes', () => {
  const { db, record } = fixture();
  stageVerifiedAddresses(db, [record], { apply: true, now });
  const first = db.prepare('SELECT * FROM prospects').get();
  stageVerifiedAddresses(db, [record], { apply: true, now });
  assert.deepEqual(db.prepare('SELECT * FROM prospects').get(), first);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM email_preflight').get().n, 1);
  db.close();
});

for (const [label, changes, message] of [
  ['unreviewed source', { address_context_reviewed: false }, /need review/],
  ['support address', { email: 'support@brand.my' }, /Unsuitable/],
  ['different company source', { source_url: 'https://other.my/contact' }, /company site/],
  ['missing archived proof', { source_sha256: '' }, /source hash/],
  ['missing mail routing', { mx_hosts: [] }, /routing/],
  ['stale source', { checked_at: '2025-01-01T12:00:00Z' }, /stale/],
]) test(`rejects ${label} before any writes`, () => {
  const { db, record } = fixture();
  assert.throws(() => stageVerifiedAddresses(db, [{ ...record, ...changes }], { apply: true, now }), message);
  assert.equal(db.prepare('SELECT contact_email FROM prospects').get().contact_email, null);
  db.close();
});

test('suppression and previous sends block source staging', () => {
  for (const sql of ["INSERT INTO email_suppression VALUES('hello@brand.my')", "INSERT INTO campaign_sends VALUES('brand','hello@brand.my','250 accepted')"]) {
    const { db, record } = fixture();
    db.exec(sql);
    assert.throws(() => stageVerifiedAddresses(db, [record], { apply: true, now }), /Prior outreach/);
    db.close();
  }
});

test('never overwrites an existing different recipient', () => {
  const { db, record } = fixture();
  db.exec("UPDATE prospects SET contact_email='owner@brand.my'");
  assert.throws(() => stageVerifiedAddresses(db, [record], { apply: true, now }), /do not overwrite/);
  db.close();
});
