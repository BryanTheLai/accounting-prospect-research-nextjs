import assert from 'node:assert/strict';

// Start Next on port 3001 with the create-ui-fixture database and no dispatcher.
// This script refuses the main app port and refuses non-synthetic records.
const base = new URL(process.env.UI_QA_URL || 'http://127.0.0.1:3001');
assert.equal(base.hostname, '127.0.0.1');
assert.equal(base.port, '3001');
async function request(path, body, method = 'POST') {
  const response = await fetch(new URL(path, base), body === undefined ? {} : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
const initial = await request('/api/prospects');
assert.equal(initial.status, 200);
assert(initial.body.rows.length >= 3);
assert(initial.body.rows.every(row => row.company.startsWith('Synthetic ')));
const mailbox = await request('/api/mailboxes');
assert.equal(mailbox.status, 200);
assert(JSON.stringify(mailbox.body).includes('qa-sender@example.test'));
assert(!JSON.stringify(mailbox.body).includes('openclose-desk.com'));

const id = 'uiqa_lead_003';
const patch = await request('/api/prospects', { id, status: 'Approved for Outreach' }, 'PATCH');
assert.equal(patch.status, 200);
assert.equal((await request(`/api/prospects?id=${id}`)).body.status, 'Approved for Outreach');
console.log('PASS approval round trip');
assert.equal((await request('/api/prospects', { id, status: 'Made up stage' }, 'PATCH')).status, 400);
console.log('PASS invalid stage rejected');

const outcome = await request('/api/calls', {
  leadId: id, disposition: 'CONNECTED_CALLBACK', notes: 'Synthetic API QA only; no call made.',
});
assert.equal(outcome.status, 201);
assert.equal((await request(`/api/prospects?id=${id}`)).body.status, 'Nurture / Follow-up');
console.log('PASS follow-up outcome and stage round trip');

const preflight = await request('/api/email-preflight?leadId=uiqa_lead_001');
assert.equal(preflight.status, 200);
assert.equal(preflight.body.prospect.contact_email, 'alex@acorn.example.test');
assert.equal(preflight.body.preflight.mx_status, 'not_checked');
console.log('PASS exact-address preflight read');

const csvText = 'company_name,root_domain,contact_email\nSynthetic API Fir,fir.example.test,qa@fir.example.test';
const importBody = { campaignId: 'yc_us_expansion', csvText, action: 'preview' };
assert.equal((await request('/api/import', importBody)).status, 200);
assert.equal((await request('/api/import', { ...importBody, action: 'import' })).status, 400);
assert.equal((await request('/api/import', { ...importBody, action: 'import', confirmed: true })).status, 200);
assert((await request('/api/prospects')).body.rows.some(row => row.company === 'Synthetic API Fir'));
console.log('PASS preview, confirmation gate and import round trip');

const dispatcher = await request('/api/dispatch');
assert.equal(dispatcher.status, 503);
console.log('PASS isolated dispatcher unavailable (no sends possible through this service)');
console.log('6 integration checks passed');
