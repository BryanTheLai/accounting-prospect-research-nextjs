import assert from "node:assert/strict";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import Database from "better-sqlite3";

const base="http://127.0.0.1:3001",output="../operations/full-ui-qc-20261008";
const db=new Database(`${output}/fixture.sqlite`,{fileMustExist:true});
assert.equal(db.prepare("SELECT marker FROM ui_qc_fixture").get().marker,"full-ui-qc-fixture-only");
const old=db.prepare("SELECT lead_id FROM prospects WHERE company_name='QC Call Component LLC'").all();
for(const row of old){if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='call_logs'").get())db.prepare("DELETE FROM call_logs WHERE lead_id=?").run(row.lead_id);}
db.prepare("DELETE FROM prospects WHERE company_name='QC Call Component LLC'").run();
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});
const checks=[],errors=[];
page.on("pageerror",e=>errors.push(e.message));
page.on("request",r=>assert.equal(new URL(r.url()).hostname,"127.0.0.1"));
let accept=true;page.on("dialog",d=>accept?d.accept():d.dismiss());
async function go(path){await page.goto("about:blank");await page.goto(`${base}${path}`);}
async function open(title){const summary=page.getByText(title,{exact:true});if(!await summary.locator("..").evaluate(n=>n.open))await summary.click();}
async function check(name,fn){try{await fn();checks.push({name,status:"passed"});}catch(error){checks.push({name,status:"failed",error:error.message});await page.screenshot({path:`${output}/primary-failure-${checks.length}.png`});throw error;}}
try{
 await check("Prospects: required validation, modal focus/Escape, real fixture add, detail/status persistence and approval without email eligibility",async()=>{
  await go("/#prospects");await page.locator(".prospect-row").first().waitFor();
  await open("Filters");await open("All tiers");
  const tier=page.locator(".prospect-tier-filter label").first();
  const alignment=await tier.evaluate(n=>{const c=n.querySelector('input').getBoundingClientRect(),t=n.querySelector('span').getBoundingClientRect();return Math.abs((c.y+c.height/2)-(t.y+t.height/2));});
  assert.ok(alignment<2,"Tier checkbox and label must share a row");
  await tier.locator("input").check();await page.getByRole("button",{name:"Reset filters",exact:true}).click();
  assert.equal(await tier.locator("input").isChecked(),false);
  await page.getByRole("button",{name:"Add prospect",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"Add a prospect",exact:true});await dialog.waitFor();
  await dialog.getByRole("button",{name:"Add prospect",exact:true}).click();
  assert.equal(await page.getByLabel("Company name",{exact:true}).evaluate(n=>n.validity.valueMissing),true);
  await page.keyboard.press("Escape");assert.equal(await dialog.count(),0);
  await page.getByRole("button",{name:"Add prospect",exact:true}).click();
  await page.getByLabel("Company name",{exact:true}).fill("QC Call Component LLC");
  await page.getByLabel("Location",{exact:true}).fill("Fixture only");await page.getByLabel("Sector",{exact:true}).fill("Fixture QA");
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/prospects"&&r.request().method()==="POST");
  await page.getByRole("dialog").getByRole("button",{name:"Add prospect",exact:true}).click();assert.equal((await response).status(),201);
  await page.getByRole("searchbox",{name:"Search prospects",exact:true}).fill("QC Call Component LLC");
  const row=page.getByRole("button",{name:"Open QC Call Component LLC",exact:true});await row.waitFor();await row.click();
  const stage=page.locator("#prospect-stage");await stage.waitFor();
  const patch=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/prospects"&&r.request().method()==="PATCH");
  await stage.selectOption("Approved for Outreach");assert.equal((await patch).status(),200);
  const saved=db.prepare("SELECT * FROM prospects WHERE company_name='QC Call Component LLC'").get();
  assert.equal(saved.status,"Approved for Outreach");assert.ok(!saved.contact_email&&!saved.contact_phone);
  const dispatch=await(await fetch(`${base}/api/dispatch?campaignId=all`)).json();assert.equal(dispatch.candidates.some(r=>r.id===saved.lead_id),false);
 });

 await check("Call: full expanded panels, dirty-note cancellation, real fixture contact/result save, failed metrics are unknown/retryable, three aligned metrics",async()=>{
  await go("/#dialer");await page.locator(".call-card").waitFor();
  await page.getByRole("button",{name:"All active targets",exact:true}).click();
  await page.getByRole("searchbox",{name:"Search call queue",exact:true}).fill("Component LLC");
  await page.waitForFunction(()=>document.querySelector(".call-identity h2")?.textContent.startsWith("QC "));
  const queue=await(await fetch(`${base}/api/call-queue?category=all_active&q=Component%20LLC&limit=100`)).json();assert.ok(queue.rows.length>=2);
  const company=await page.locator(".call-identity h2").textContent();const lead=queue.rows.find(r=>r.company===company);assert.ok(lead);
  for(const title of ["Why this company","Edit contact details","Follow-up & duration","Other results"])await open(title);
  const more=page.getByText("Other results",{exact:true}).locator("..");
  const inset=await more.evaluate(n=>n.querySelector("button").getBoundingClientRect().x-n.getBoundingClientRect().x);assert.ok(inset>=20);
  await page.getByLabel("Buyer / contact",{exact:true}).fill("QC fixture contact");
  await page.getByLabel("Phone",{exact:true}).fill("+60 11-22223333");
  const contactSave=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/contacts"&&r.request().method()==="PATCH");
  await page.getByRole("button",{name:"Save contact",exact:true}).click();assert.equal((await contactSave).status(),200);
  assert.equal(db.prepare("SELECT buyer_name FROM prospects WHERE lead_id=?").get(lead.id).buyer_name,"QC fixture contact");
  await page.getByLabel("Call notes",{exact:true}).fill("QC fixture outcome");
  accept=false;await page.getByRole("button",{name:"Skip →",exact:true}).click();assert.equal(await page.locator(".call-identity h2").textContent(),company);accept=true;
  await page.getByLabel("Call duration · seconds",{exact:true}).fill("17");
  await page.route("**/api/calls?*",r=>r.fulfill({status:503,json:{error:"Synthetic metrics outage"}}));
  const result=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/calls"&&r.request().method()==="POST");
  await page.getByRole("button",{name:"No answer",exact:true}).click();assert.equal((await result).status(),201);
  await page.getByText("Call outcome saved",{exact:true}).waitFor();
  await page.getByText("Call outcome saved. Metrics and history could not be refreshed.",{exact:true}).waitFor();
  assert.deepEqual(await page.locator(".call-metric-grid strong").allTextContents(),["—","—","—"]);
  const log=db.prepare("SELECT * FROM call_logs WHERE lead_id=? ORDER BY call_id DESC LIMIT 1").get(lead.id);assert.equal(log.call_notes,"QC fixture outcome");assert.equal(log.duration_seconds,17);
  await page.unrouteAll({behavior:"wait"});await page.getByRole("button",{name:"Retry call metrics",exact:true}).click();
  const dashboard=await(await fetch(`${base}/api/calls?campaignId=all`)).json();
  await page.waitForFunction(expected=>Number(document.querySelector(".call-metric-grid strong")?.textContent)===expected,dashboard.metrics.dialsToday);
  for(const width of [1440,768,375,320]){
   await page.setViewportSize({width,height:900});
   const metrics=await page.locator(".call-metric-grid > div").evaluateAll(ns=>ns.map(n=>n.getBoundingClientRect().y));assert.equal(new Set(metrics).size,1);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
   if(width===375)await page.screenshot({path:`${output}/after-call-panels-mobile.png`});
  }
 });
 assert.deepEqual(errors,[]);
}finally{
 await writeFile(`${output}/primary-quality-proof.json`,JSON.stringify({checks,errors,environment:"isolated SMTP-disabled fixture; no dial or WhatsApp action"},null,2));console.log(JSON.stringify({checks,errors},null,2));
 await page.unrouteAll({behavior:"wait"});await browser.close();db.close();
}
