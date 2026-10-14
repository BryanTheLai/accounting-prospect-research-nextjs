import assert from "node:assert/strict";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import Database from "better-sqlite3";

const base="http://127.0.0.1:3001",output="../operations/full-ui-qc-20261008";
const db=new Database(`${output}/fixture.sqlite`,{fileMustExist:true});
assert.equal(db.prepare("SELECT marker FROM ui_qc_fixture").get().marker,"full-ui-qc-fixture-only");
db.prepare("DELETE FROM prospects WHERE company_name='QC Call Component LLC'").run();
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});
const checks=[],errors=[];
page.on("pageerror",e=>errors.push(e.message));
page.on("request",r=>assert.equal(new URL(r.url()).hostname,"127.0.0.1"));
page.on("dialog",d=>d.dismiss());
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

 assert.deepEqual(errors,[]);
}finally{
 await writeFile(`${output}/primary-quality-proof.json`,JSON.stringify({checks,errors,environment:"isolated SMTP-disabled fixture; no dial or WhatsApp action"},null,2));console.log(JSON.stringify({checks,errors},null,2));
 await page.unrouteAll({behavior:"wait"});await browser.close();db.close();
}
