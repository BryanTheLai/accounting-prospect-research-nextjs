import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import Database from "better-sqlite3";

const base = "http://127.0.0.1:3001", output = "../operations/full-ui-qc-20261008";
const db = new Database(`${output}/fixture.sqlite`, { fileMustExist: true });
assert.equal(db.prepare("SELECT marker FROM ui_qc_fixture").get().marker, "full-ui-qc-fixture-only");
db.prepare("DELETE FROM prospects WHERE company_name='QC Import Component LLC'").run();
const original = db.prepare("SELECT * FROM prospects WHERE lead_id='OC-JOB-001'").get();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const checks = [], errors = [];
page.on("pageerror", (error) => errors.push(error.message));
let acceptDialog = true;
page.on("dialog", (dialog) => acceptDialog ? dialog.accept() : dialog.dismiss());
page.on("request", (request) => assert.equal(new URL(request.url()).hostname, "127.0.0.1"));
async function go(path) { await page.goto("about:blank"); await page.goto(`${base}${path}`); }
async function open(title) { const summary = page.getByText(title, { exact: true }); if (!await summary.locator("..").evaluate((node) => node.open)) await summary.click(); }
async function check(name, fn) {
  try { await fn(); checks.push({ name, status: "passed" }); }
  catch (error) { checks.push({ name, status: "failed", error: error.message }); await page.screenshot({ path: `${output}/secondary-failure-${checks.length}.png` }); throw error; }
}
try {
  await check("Import: real CSV upload/parse, ready/duplicate/invalid/existing rows, confirmation/Escape, fixture upsert, in-place update, real XLSX parse", async () => {
    await go("/import");
    const select = page.locator("main select").first(); await select.locator("option").nth(1).waitFor({ state: "attached" });
    await select.selectOption("hydroball_clones");
    const csv = "company_name,email,unknown_column\nQC Import Component LLC,qc.import@example.test,ignored\nQC Import Component LLC,duplicate@example.test,ignored\n,missing@example.test,ignored\nAdvancelab Sdn. Bhd.,never-overwrite@example.test,ignored\n";
    await page.locator('input[type="file"]').setInputFiles({ name: "qc-components.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    const previewResponse = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/import" && r.request().method() === "POST");
    await page.getByRole("button", { name: "Preview import", exact: true }).click();
    const preview = await (await previewResponse).json();
    assert.deepEqual([preview.readyRows, preview.updatedRows, preview.duplicateRows, preview.invalidRows, preview.existingRows], [1,1,1,1,1]);
    await open("Other rows: 2"); await open("Import rules");
    assert.equal(await page.locator("main table tbody tr").count(), 4);
    await page.getByRole("button", { name: "Confirm 1 new and 1 updated", exact: true }).click();
    await page.getByRole("alertdialog").waitFor(); await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("alertdialog").count(), 0);
    await page.getByRole("button", { name: "Confirm 1 new and 1 updated", exact: true }).click();
    const insertResponse = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/import" && r.request().method() === "POST");
    await page.getByRole("button", { name: "Confirm import", exact: true }).click();
    const inserted = await (await insertResponse).json(); assert.equal(inserted.added, 1); assert.equal(inserted.updated, 1); assert.equal(inserted.skipped, 2);
    const imported = db.prepare("SELECT * FROM prospects WHERE company_name='QC Import Component LLC'").get();
    assert.equal(imported.status, "Ready to Review"); assert.equal(imported.contact_email, "qc.import@example.test");
    assert.ok(!imported.contact_phone && !imported.buyer_name);
    // An existing company is updated in place: the mapped email is overwritten
    // while identity, scoring and tier stay put, and the row is not duplicated.
    const updated = db.prepare("SELECT * FROM prospects WHERE lead_id='OC-JOB-001'").get();
    assert.equal(updated.contact_email, "never-overwrite@example.test");
    assert.equal(updated.lead_id, original.lead_id);
    assert.equal(updated.status, original.status);
    assert.equal(updated.quality_score, original.quality_score);
    assert.equal(updated.tier, original.tier);
    assert.equal(updated.campaign_id, original.campaign_id);
    assert.match(updated.notes, /Updated from spreadsheet import/);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM prospects WHERE lower(company_name)=lower('Advancelab Sdn. Bhd.')").get().count, 1);
    const workbook = await readFile(new URL("./fixtures/prospects-import.xlsx", import.meta.url));
    await page.locator('input[type="file"]').setInputFiles({ name: "qc-workbook.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: workbook });
    const workbookResponse = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/import" && r.request().method() === "POST");
    await page.getByRole("button", { name: "Preview import", exact: true }).click();
    const workbookPreview = await (await workbookResponse).json();
    assert.equal(workbookPreview.totalRows, 3); assert.equal(workbookPreview.previewRows[0].company, "Acme Ledger");
    assert.equal(workbookPreview.previewRows[0].email, "");
    for (const width of [1440,375,320]) { await page.setViewportSize({ width, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true); }
  });

  await check("YC: real fixture import and duplicate skip keep contacts blank and existing records unchanged; filters/export/pagination covered separately", async () => {
    const candidate = db.prepare("SELECT yc_id,name,slug FROM yc_5year_directory d WHERE trim(coalesce(slug,''))<>'' AND NOT EXISTS(SELECT 1 FROM prospects p WHERE p.lead_id='yc_'||replace(d.slug,'-','_')) LIMIT 1").get();
    assert.ok(candidate);
    await go("/yc"); await page.locator("main table tbody tr").first().waitFor();
    const filteredResponse = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/yc" && new URL(r.url()).searchParams.get("q") === candidate.name);
    await page.getByLabel("Search companies", { exact: true }).fill(candidate.name); await filteredResponse;
    const selected = page.getByRole("checkbox", { name: `Select ${candidate.name}`, exact: true }); await selected.waitFor(); await selected.check();
    assert.ok((await selected.boundingBox()).width<=20);
    assert.ok((await selected.locator("..").boundingBox()).height>=44);
    await page.getByRole("button", { name: "Add 1 checked company to Prospects", exact: true }).click();
    const response = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/yc" && r.request().method() === "POST");
    await page.getByRole("button", { name: "Confirm import", exact: true }).click();
    const result = await (await response).json(); assert.equal(result.added, 1);
    const id = `yc_${candidate.slug.replaceAll("-","_")}`;
    const inserted = db.prepare("SELECT * FROM prospects WHERE lead_id=?").get(id);
    assert.equal(inserted.status, "Ready to Review"); assert.ok(!inserted.contact_email && !inserted.buyer_name && !inserted.contact_phone);
    const repeated = await fetch(`${base}/api/yc`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [candidate.yc_id] }) });
    assert.equal((await repeated.json()).skipped, 1);
    assert.deepEqual(db.prepare("SELECT * FROM prospects WHERE lead_id=?").get(id), inserted);
  });

  await check("Campaign setup: all disclosure spacing, dirty-edit protection, real fixture save/reload, busy fields, paused activation, error/retry", async () => {
    await page.setViewportSize({ width: 1440, height: 900 }); await go("/playbooks");
    await page.getByLabel("Display name", { exact: true }).waitFor();
    await open("Research & agent instructions"); await open("Optional description"); await open("Review draft values");
    const fold = page.getByText("Research & agent instructions", { exact: true }).locator("..");
    const geometry = await fold.evaluate((node) => { const field=node.querySelector("label").getBoundingClientRect(), summary=node.querySelector("summary").getBoundingClientRect(); return { inset:field.x-node.getBoundingClientRect().x,topGap:field.y-summary.bottom }; });
    assert.ok(geometry.inset>=20 && geometry.topGap>=20, JSON.stringify(geometry));
    const display = page.getByLabel("Display name", { exact: true }); const currentName = await display.inputValue();
    const savedTagline = `QC saved fixture tagline ${Date.now()}`;
    await page.getByLabel("Tagline", { exact: true }).fill(savedTagline);
    acceptDialog = false;
    await page.locator("aside button").nth(1).click();
    assert.equal(await display.inputValue(), currentName);
    acceptDialog = true;
    let saved = false;
    await page.route("**/api/playbooks", async (route) => {
      if (route.request().method() === "PATCH") {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const response = await route.fetch(); saved = true; return route.fulfill({ response });
      }
      return route.continue();
    });
    await page.getByRole("button", { name: "Save reviewed changes", exact: true }).click();
    await page.getByRole("button", { name: "Saving…", exact: true }).waitFor();
    assert.equal(await display.isDisabled(), true); assert.equal(await page.locator("aside button").first().isDisabled(), true);
    await page.getByText("Playbook changes saved. No dispatch was started.", { exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('main input').disabled);
    assert.equal(saved, true); assert.equal(await page.getByLabel("Tagline", { exact: true }).inputValue(), savedTagline);
    await page.unrouteAll({ behavior: "wait" });
    db.prepare("UPDATE campaigns SET status='PAUSED' WHERE campaign_id='jobstreet_hiring_pain'").run();
    await go("/playbooks"); await page.getByLabel("Display name", { exact: true }).waitFor();
    await page.locator("aside button").filter({ hasText: "JobStreet hiring pain" }).click();
    await page.getByRole("button", { name: "Mark ACTIVE", exact: true }).click();
    await page.getByText("Campaign marked ACTIVE. No queue was started and no email was sent.", { exact: true }).waitFor();
    assert.equal(db.prepare("SELECT status FROM campaigns WHERE campaign_id='jobstreet_hiring_pain'").get().status, "ACTIVE");
    let failed = true;
    await page.route("**/api/playbooks", (route) => failed ? route.fulfill({ status: 503, json: { error: "Synthetic campaign outage" } }) : route.continue());
    await go("/playbooks"); await page.getByText("Synthetic campaign outage", { exact: true }).waitFor();
    failed = false; await page.getByRole("button", { name: "Retry campaign settings", exact: true }).click();
    await page.getByLabel("Display name", { exact: true }).waitFor();
    await page.unrouteAll({ behavior: "wait" });
    await open("Research & agent instructions"); await open("Optional description"); await open("Review draft values");
    for (const width of [1440,375,320]) { await page.setViewportSize({ width, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true); if(width!==320)await page.screenshot({path:`${output}/after-playbooks-open-${width}.png`}); }
  });

  await check("Email checks: late searches cannot overwrite new results; list failures retry; MX/discovery/invalidation states are synthetic, never provider calls", async () => {
    let releaseOld, oldStarted, oldDelivered;
    const started = new Promise((resolve) => { oldStarted = resolve; });
    const delivered = new Promise((resolve) => { oldDelivered = resolve; });
    let searchFailure = false;
    const imported = db.prepare("SELECT lead_id,company_name,contact_email FROM prospects WHERE company_name='QC Import Component LLC'").get();
    await page.route("**/api/email-preflight**", async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() === "GET" && url.searchParams.get("q") === "slow-old") {
        oldStarted(); await new Promise((resolve) => { releaseOld = resolve; });
        try { await route.fulfill({ json: { prospects: [{ lead_id:"qc-old",company_name:"QC stale search",contact_email:null }] } }); }
        finally { oldDelivered(); }
        return;
      }
      if (request.method() === "GET" && searchFailure) return route.fulfill({ status:503,json:{error:"Synthetic prospect search outage"} });
      if (request.method() === "GET") return route.continue();
      const body = request.postDataJSON();
      const mx_status = body.action === "check" ? "mx_present" : "not_checked";
      return route.fulfill({ json: { preflight: { lead_id:imported.lead_id,email:body.email || imported.contact_email,mx_status,mx_hosts:'["mx.example.test"]',checked_at:new Date().toISOString(),source_confirmed:0,source_confirmed_at:null } } });
    });
    await page.route("**/api/email-discovery", (route) => route.fulfill({ json: { status:"no_candidates",pagesCrawled:2,candidates:[] } }));
    await go("/email-preflight?return=settings");
    const search = page.getByRole("searchbox", { name:"Search prospects",exact:true });
    await search.fill("slow-old"); await started;
    await search.fill("QC Import Component LLC");
    const company = page.getByRole("button", { name:/QC Import Component LLC/ }); await company.waitFor();
    releaseOld();
    await delivered;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForFunction(() => !document.querySelector('[role="status"]')?.textContent.includes("Searching"));
    assert.equal(await page.getByRole("button", { name:/QC stale search/ }).count(),0);
    assert.equal(await company.count(),1);
    searchFailure = true; await search.fill("outage");
    await page.getByText("Synthetic prospect search outage", { exact:true }).waitFor();
    searchFailure = false; await page.getByRole("button", { name:"Retry prospect search",exact:true }).click();
    await page.getByText("No prospects found. Try another search.", { exact:true }).waitFor();
    await search.fill("QC Import Component LLC"); await company.waitFor(); await company.click();
    await page.getByLabel("Exact address to check", { exact:true }).waitFor();
    await open("Find a public email candidate");
    await page.getByRole("button", { name:"Search company website",exact:true }).click();
    await page.getByText("Scanned 2 page(s); no company-domain email candidates were found.", { exact:true }).waitFor();
    await page.getByRole("button", { name:"Check syntax + MX",exact:true }).click();
    await page.getByText("MX record found. This does not confirm the mailbox exists.", { exact:true }).last().waitFor();
    const confirm = page.getByRole("button", { name:"Record source confirmation",exact:true });
    assert.equal(await confirm.isDisabled(),true);
    await page.getByLabel("Retype the address to confirm", { exact:true }).fill(imported.contact_email);
    assert.equal(await confirm.isDisabled(),true);
    await page.getByRole("checkbox", { name:"I saw this exact address published by the company.",exact:true }).check();
    assert.equal(await confirm.isEnabled(),true);
    await page.getByLabel("Exact address to check", { exact:true }).fill("changed@example.test");
    await page.getByText("Not checked yet.", { exact:true }).waitFor();
    assert.equal(await confirm.count(),0);
  });
  assert.deepEqual(errors,[]);
  const status = await (await fetch(`${base}/api/dispatch?summary=1`)).json();
  assert.equal(status.snapshot.is_running,false); assert.equal(status.snapshot.live_dispatch,false);
} finally {
  await writeFile(`${output}/secondary-quality-proof.json`,JSON.stringify({checks,errors,environment:"isolated fixture; preflight/provider responses synthesized"},null,2));
  console.log(JSON.stringify({checks,errors},null,2));
  await page.unrouteAll({behavior:"wait"});await browser.close();db.close();
}
