import { chromium } from "playwright";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const browser=await chromium.launch({headless:true});const page=await browser.newPage();
const errors=[],results=[],failed=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>assert.equal(request.method(),'GET','The live walkthrough is read-only'));
page.on('response',response=>{if(new URL(response.url()).pathname.startsWith('/api/')&&response.status()>=400)failed.push({url:new URL(response.url()).pathname,status:response.status()});});
try {
  for(const width of [1440,768,375,320]){
    await page.setViewportSize({width,height:900});
    for(const path of ['/#campaigns','/#prospects','/#settings','/activity','/mailboxes','/playbooks','/yc','/import']){
      await page.goto(`http://127.0.0.1:3000${path}`);
      if(path==='/#campaigns')await page.locator('.dispatch-candidate').first().waitFor();
      else if(path==='/#prospects')await page.locator('.prospect-row').first().waitFor();
      else if(path==='/activity')await page.getByRole('img',{name:'Daily email activity line chart'}).waitFor();
      else if(path==='/mailboxes')await page.getByRole('button',{name:'Refresh mailboxes',exact:true}).waitFor();
      else if(path==='/playbooks')await page.locator('input').first().waitFor();
      else if(path==='/yc')await page.locator('table tbody tr').first().waitFor();
      else if(path==='/import')await page.locator('select option').nth(1).waitFor({state:'attached'});
      else await page.locator('main').waitFor();
      const geometry=await page.evaluate(()=>{
        const visible=e=>e.checkVisibility()&&e.getClientRects().length;
        const small=[...document.querySelectorAll('main button, main input:not([type=checkbox]), main select, main a.button, main summary')].filter(visible).map(e=>{
          const r=e.getBoundingClientRect();return {name:e.getAttribute('aria-label')||e.textContent?.trim().slice(0,50),height:r.height,width:r.width};
        }).filter(r=>r.height<43.5);
        return {documentWidth:document.documentElement.scrollWidth,small};
      });
      assert.ok(geometry.documentWidth<=width+1,`${path} overflows at${width}`);
      assert.equal(await page.locator('main h1').count(),1,`${path} heading`);
      assert.equal(await page.locator('main h1:not(.sr-only)').count(),0);
      assert.equal(await page.locator('.dock-item[aria-current=page]').count(),1,`${path} navigation owner`);
      results.push({path,width,...geometry});
      if(width===1440||width===375)await page.screenshot({path:`../operations/luna-ui-qa-20261008/live-${path.replace(/[^a-z]/gi,'')}-${width}.png`});
    }
  }
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
  await writeFile('../operations/luna-ui-qa-20261008/live-walkthrough.json',JSON.stringify({results,pageErrors:errors,failedApiRequests:failed},null,2));
  console.log(JSON.stringify({pages:results.length,pageErrors:errors,failedApiRequests:failed,smallControls:results.filter(r=>r.small.length)},null,2));
}finally{await browser.close();}
