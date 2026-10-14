import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const base=process.env.UI_QA_URL||"http://127.0.0.1:3001";
assert.equal(new URL(base).hostname,"127.0.0.1");
const output="../operations/full-ui-qc-20261008";await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,ignoreDefaultArgs:["--hide-scrollbars"]});const page=await browser.newPage();
const errors=[],failed=[],results=[];
page.on("pageerror",e=>errors.push(e.message));
page.on("request",r=>assert.equal(r.method(),"GET","Expanded live walkthrough must never mutate"));
page.on("response",r=>{if(new URL(r.url()).pathname.startsWith("/api/")&&r.status()>=400)failed.push({url:new URL(r.url()).pathname,status:r.status()});});
const routes=["/#campaigns","/#prospects","/#settings","/activity","/mailboxes","/playbooks","/yc","/import","/email-preflight?return=settings"];
try{
 for(const width of [1440,768,375,320]){
  await page.setViewportSize({width,height:900});
  for(const path of routes){
   await page.goto("about:blank");await page.goto(`${base}${path}`);
   if(path==="/#campaigns")await page.waitForFunction(()=>document.querySelector('.dispatch-state')?.textContent.trim()&&!document.querySelector('.dispatch-state').textContent.includes('Connecting'));
   else if(path==="/#prospects")await page.locator(".prospect-row").first().waitFor();
   else if(path==="/#settings"){await page.getByRole("combobox",{name:"Campaign scope",exact:true}).selectOption("hydroball_clones");await page.getByText("Send window",{exact:true}).waitFor();}
   else if(path==="/activity")await page.getByRole("img",{name:"Daily email activity line chart",exact:true}).waitFor();
   else if(path==="/mailboxes"){
    const edit=page.getByRole("button",{name:/^Edit /}).first();await edit.waitFor();await edit.click();
   }else if(path==="/playbooks")await page.getByLabel("Display name",{exact:true}).waitFor();
   else if(path==="/yc")await page.locator("table tbody tr").first().waitFor();
   else if(path==="/import")await page.locator("main select option").nth(1).waitFor({state:"attached"});
   else if(path.startsWith("/email-preflight")){
    const selected=page.locator("main section button").first();await selected.waitFor();await selected.click();await page.getByLabel("Exact address to check",{exact:true}).waitFor();
   }
   const panels=[];
   for(const summary of await page.locator("main details > summary").all()){
    const details=summary.locator("..");
    if(!await details.evaluate(n=>n.open))await summary.click();
    const label=(await summary.textContent()).trim();
    await summary.focus();await summary.press("Enter");assert.equal(await details.evaluate(n=>n.open),false);
    await summary.press("Enter");assert.equal(await details.evaluate(n=>n.open),true);
    panels.push(label);
   }
   for(const disclosure of await page.locator("main details.simple-disclosure").all()){
    const spacing=await disclosure.evaluate(node=>{
      const summary=node.querySelector(":scope > summary").getBoundingClientRect();
      const body=[...node.children].find(child=>child.tagName!=="SUMMARY");
      const first=body?.querySelector("label,input,button,h3,h2,p,dt,strong")||body;
      if(!first)return null;
      const rect=first.getBoundingClientRect();
      return{label:node.querySelector("summary").textContent,leftInset:rect.left-node.getBoundingClientRect().left,topGap:rect.top-summary.bottom};
    });
    if(spacing)assert.ok(spacing.leftInset>=15&&spacing.topGap>=12,`${path} flush expanded content: ${JSON.stringify(spacing)}`);
   }
   const geometry=await page.evaluate(()=>{
    const visible=n=>n.checkVisibility()&&n.getBoundingClientRect().height>0;
    const small=[...document.querySelectorAll('main button,main input:not([type=checkbox]):not([type=radio]):not([type=hidden]),main select,main a.button,main header a,main summary')].filter(visible).map(n=>({name:n.getAttribute("aria-label")||n.textContent.trim().slice(0,65),height:n.getBoundingClientRect().height,width:n.getBoundingClientRect().width})).filter(n=>n.height<43.5);
    return{clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,small};
   });
   assert.ok(geometry.scrollWidth<=geometry.clientWidth,`${path} usable-width overflow at ${width}: ${JSON.stringify(geometry)}`);
   assert.deepEqual(geometry.small,[],`${path} undersized expanded controls at ${width}`);
   assert.equal(await page.locator('main h1.sr-only').count(),1);
   assert.equal(await page.locator('.dock-item[aria-current="page"]').count(),1);
   results.push({path,width,panels,keyboardToggleChecked:panels.length,...geometry});
   if(width===1440||width===375){
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:`${output}/expanded-${base.endsWith('3000')?'live':'fixture'}-${path.replace(/[^a-z]/gi,'')}-${width}.png`});
   }
  }
 }
 assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
}finally{
 const proof={target:base,results,pageErrors:errors,failedApiRequests:failed};
 await writeFile(`${output}/expanded-${base.endsWith('3000')?'live':'fixture'}-walkthrough.json`,JSON.stringify(proof,null,2));
 console.log(JSON.stringify({pages:results.length,disclosuresChecked:results.reduce((sum,r)=>sum+r.panels.length,0),keyboardToggleActions:results.reduce((sum,r)=>sum+r.panels.length*2,0),pageErrors:errors,failedApiRequests:failed},null,2));
 await browser.close();
}
