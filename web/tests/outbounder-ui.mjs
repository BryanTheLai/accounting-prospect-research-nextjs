import assert from "node:assert/strict";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const base="http://127.0.0.1:3001",output="../operations/outbounder-simplification-20261008";
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:375,height:900}});
const errors=[];page.on('pageerror',(error)=>errors.push(error.message));
const saved=await (await fetch(`${base}/api/playbooks`)).json();
await page.route('**/api/dispatch?*',async(route)=>{
  const pacing=route.request().url().includes('mailboxPacing');
  const data=pacing?{mailboxes:[],isRunning:false}:{snapshot:{is_running:false,is_paused:false,live_dispatch:false,sent_today:0,queue_pending:0},templates:saved.templates,candidates:[],eligibleCount:0,hasMore:false,heldCounts:{needs_approval:2,needs_email_check:2,sent_or_suppressed:0,government:0}};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
});
try {
  await page.goto(`${base}/#campaigns`);
  await page.locator('.email-template-card').nth(1).waitFor();
  assert.equal(await page.title(),'Outbounder');
  assert.equal(await page.locator('h1:not(.sr-only)').count(),0);
  assert.equal(await page.getByText('Other prospects in this audience',{exact:true}).count(),0);
  assert.equal(await page.getByRole('link',{name:/Check emails|Review prospects/}).count(),0);
  assert.equal(await page.getByText('Sender limits',{exact:true}).count(),0);
  assert.equal(await page.locator('.email-template-card pre').count(),2);
  for(const body of await page.locator('.email-template-card pre').allTextContents())assert.ok(body.length>30);
  await page.locator('.message-step').scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/email-mobile.png`});
  await page.getByRole('link',{name:'Call',exact:true}).click();
  await page.getByRole('button',{name:'All active targets',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Call script style',{exact:true}).count(),0);
  assert.equal(await page.getByLabel('Call queue stage',{exact:true}).count(),0);
  assert.equal(await page.getByText('Queue filters',{exact:true}).count(),0);
  await page.getByRole('button',{name:'All active targets',exact:true}).click();
  await page.getByLabel('Search call queue',{exact:true}).fill('Pagination');
  await page.getByRole('heading',{name:'Synthetic Pagination Contact 000',exact:true}).waitFor();
  assert.match(await page.locator('.script-copy').innerText(),/bad time to talk/i);
  await page.screenshot({path:`${output}/call-mobile.png`});
  await page.getByRole('link',{name:'Settings',exact:true}).click();
  await page.getByText('Sender limits',{exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Email checks',exact:true}).count(),1);
  await page.getByRole('link',{name:'Prospects',exact:true}).click();
  await page.getByLabel('Prospect view').selectOption('needs_review');
  await page.locator('.prospect-row').first().waitFor();
  assert.equal(await page.getByLabel('Filter by email quality').count(),0);
  assert.equal(await page.getByLabel('Filter by email check status').count(),0);
  assert.equal(await page.getByRole('button',{name:'Review leads',exact:true}).count(),1);
  await page.goto(`${base}/activity`);
  await page.getByRole('img',{name:'Daily email activity line chart'}).waitFor();
  assert.equal(await page.locator('[class*="chartLegend"] button').count(),5);
  assert.equal(await page.locator('h1:not(.sr-only)').count(),0);
  await page.screenshot({path:`${output}/activity-mobile.png`});
  const layouts=[];
  for(const width of [375,1440]){
    await page.setViewportSize({width,height:900});
    for(const route of ['/#campaigns','/#prospects','/#settings','/activity','/mailboxes','/playbooks','/yc','/import']){
      await page.goto(`${base}${route}`);await page.locator('main').waitFor();
      const layout=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));
      assert.ok(layout.documentWidth<=width+1,`${route} overflows at ${width}`);layouts.push({route,...layout});
      assert.equal(await page.locator('h1:not(.sr-only)').count(),0,`${route} retains an unwanted page title`);
    }
  }
  assert.deepEqual(errors,[]);
  const result={checks:['both templates visible without recipient selection','technical controls only in Settings','one core call script and two audience buttons','review backlog accessible','daily chart has five series','no page-title descriptions'],layouts,pageErrors:errors,fixtureOnly:true};
  await writeFile(`${output}/browser-proof.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {await browser.close();}
