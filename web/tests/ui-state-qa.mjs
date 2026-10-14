import assert from "node:assert/strict";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const base="http://127.0.0.1:3001", output="../operations/luna-ui-qa-20261008";
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});
const checks=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>{if(request.method()!=='GET')assert.equal(new URL(request.url()).origin,base,'Only writes to the isolated fixture service are allowed');});
try {
  await page.goto(`${base}/import`);
  const importChoice=page.locator('select').first();await importChoice.locator('option').nth(1).waitFor({state:'attached'});
  const optionNames=await importChoice.locator('option').allTextContents();
  assert.equal(optionNames.length,4,'Exactly three campaigns plus placeholder');
  assert.equal(optionNames.some(name=>/Conversational Founder|Subcontracting|LHDN/.test(name)),false);
  await page.getByRole('link',{name:'← Prospects',exact:true}).click();
  assert.equal(new URL(page.url()).hash,'#prospects');
  await page.goto(`${base}/yc`);await page.getByRole('link',{name:'← Prospects',exact:true}).click();
  assert.equal(new URL(page.url()).hash,'#prospects');
  await page.goto(`${base}/playbooks`);await page.locator('input').first().waitFor();
  assert.equal(await page.getByRole('button',{name:/New draft/}).count(),0);
  checks.push('three import campaigns; no new-campaign control; YC/import return to Prospects');
  await page.goto(`${base}/#settings`);
  await page.getByRole('link',{name:'Email checks',exact:true}).click();
  await page.getByRole('link',{name:'← Settings',exact:true}).waitFor();
  assert.equal(await page.locator('.dock-item[aria-current="page"]').count(),1);
  assert.equal(await page.locator('.dock-item[aria-current="page"]').innerText(),'Settings');
  await page.getByRole('link',{name:'← Settings',exact:true}).click();
  assert.equal(new URL(page.url()).hash,'#settings');
  checks.push('email checks has one active navigation owner and returns to Settings');

   const prototype=await (await fetch(`${base}/api/prospects?id=OC-JOB-001`)).json();
   await page.route('**/api/prospects?id=*',route=>route.fulfill({json:{...prototype,id:new URL(route.request().url()).searchParams.get('id')}}));
  let releaseProspects;
  await page.route('**/api/prospects?*',async route=>{
    const url=new URL(route.request().url());
    if(url.searchParams.has('id')){await route.fulfill({json:{...prototype,id:url.searchParams.get('id')}});return;}
    const next=Number(url.searchParams.get('offset'))>0, changed=url.searchParams.get('q')==='new view';
    if(next)await new Promise(resolve=>{releaseProspects=resolve;});
    const name=changed?'Synthetic New View':next?'Synthetic STALE Response':'Synthetic Initial View';
    await route.fulfill({contentType:'application/json',body:JSON.stringify({rows:[{...prototype,id:changed?'new':next?'stale':'first',company:name,fit:95,status:'Ready to Review'}],total:changed?1:101,hasMore:!changed&&!next,statuses:[],tiers:[]})});
  });
  await page.goto(`${base}/#prospects`);await page.getByRole('button',{name:'Open Synthetic Initial View',exact:true}).waitFor();
  await page.getByRole('button',{name:'Load next 100 prospects',exact:true}).click();
  await page.getByRole('searchbox',{name:'Search prospects',exact:true}).fill('new view');
  await page.getByRole('button',{name:'Open Synthetic New View',exact:true}).waitFor();
  assert.ok(releaseProspects);releaseProspects();
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole('button',{name:'Open Synthetic STALE Response',exact:true}).count(),0);
  await page.unroute('**/api/prospects?*');
  checks.push('late prospect pagination cannot contaminate the new filtered view');

  await page.unrouteAll({behavior:'wait'});
  for(const path of ['/#campaigns','/#prospects','/#settings','/activity','/mailboxes','/playbooks','/yc','/import']){
    await page.goto(`${base}${path}`);await page.locator('main h1').waitFor({state:'attached'});
    assert.equal(await page.locator('main h1').count(),1,`${path}: one accessible top heading`);
    assert.equal(await page.locator('main h1:not(.sr-only)').count(),0,`${path}: no visible title clutter`);
  }
  checks.push('all eight pages retain one screen-reader heading without visible title clutter');
  assert.deepEqual(errors,[]);await writeFile(`${output}/state-proof.json`,JSON.stringify({checks,pageErrors:errors},null,2));
  console.log(JSON.stringify({checks,pageErrors:errors},null,2));
} catch(error){console.error('State QA failed at',page.url());throw error;}
finally{await browser.close();}
