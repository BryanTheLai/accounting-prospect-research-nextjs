import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.UI_QA_URL || "http://127.0.0.1:3001";
assert.equal(new URL(base).hostname, "127.0.0.1");
const output = "../operations/luna-ui-qa-20261008";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], checks = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => assert.equal(request.method(), "GET", "This QA must never send a mutation"));
try {
  const report = await (await fetch(`${base}/api/activity`)).json();
  await page.goto(`${base}/activity`);
  const chart = page.getByRole("img", { name: "Daily email activity line chart" });
  await chart.waitFor();
  assert.equal(await chart.locator("polyline").count(), 5);
  assert.equal(await chart.locator("rect").count(), 0);
  const refresh = page.getByRole("button", { name: "Refresh activity report", exact: true });
  assert.equal((await refresh.innerText()).trim(), "");
  assert.equal(await refresh.locator("svg").count(), 1);
  assert.ok((await refresh.boundingBox()).height >= 44);
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/activity");
  await refresh.click(); await response;
  await page.waitForFunction(() => !document.querySelector('[aria-label="Refresh activity report"]')?.disabled);
  await page.getByRole("button", { name: "SMTP accepted", exact: true }).click();
  assert.equal(await chart.locator("polyline").count(), 4);
  assert.equal(await chart.locator('[data-series="sent"]').count(), 0);
  await page.getByRole("button", { name: "SMTP accepted", exact: true }).click();
  assert.equal(await chart.locator("polyline").count(), 5);
  await chart.focus();
  await chart.press("End");
  const tooltip = page.locator('[class*="chartTooltip"]');
  await tooltip.waitFor();
  assert.equal(await tooltip.locator("strong").innerText(), report.daily.at(-1).date);
  assert.deepEqual((await tooltip.locator("b").allTextContents()).map(Number), ["sent", "dryRun", "bounced", "deferred", "failedSuppressed"].map((key) => report.daily.at(-1)[key]));
  await chart.press("ArrowLeft");
  assert.equal(await tooltip.locator("strong").innerText(), report.daily.at(-2).date);
  await chart.press("Home");
  assert.equal(await tooltip.locator("strong").innerText(), report.daily[0].date);
  await chart.press("Escape");
  assert.equal(await tooltip.count(), 0);
  const box = await chart.boundingBox();
  const hoverIndex = 14;
  const renderedPoint = await chart.evaluate((svg,index) => {
    const point=svg.querySelector('polyline[data-series="sent"]').points.getItem(index);
    const screen=new DOMPoint(point.x,point.y).matrixTransform(svg.getScreenCTM());return {x:screen.x,y:screen.y};
  }, hoverIndex);
  await page.mouse.move(renderedPoint.x, renderedPoint.y);
  await tooltip.waitFor();
  assert.equal(await tooltip.locator("strong").innerText(), report.daily[hoverIndex].date);
  assert.deepEqual((await tooltip.locator("b").allTextContents()).map(Number), ["sent", "dryRun", "bounced", "deferred", "failedSuppressed"].map((key) => report.daily[hoverIndex][key]));
  const dateLabels = await chart.locator("text").evaluateAll((nodes) => nodes.filter((node) => /^\d\d-\d\d$/.test(node.textContent || "")).map((node) => { const r=node.getBoundingClientRect();return {left:r.left,right:r.right}; }));
  assert.ok(dateLabels.every((label,index) => !index || label.left >= dateLabels[index-1].right), "Chart date labels overlap");
  await page.screenshot({ path: `${output}/line-chart-desktop.png` });
  checks.push("five unstacked lines, no bars, icon-only refresh reloads actual API, legend toggles and keyboard/hover values match data");
  let releaseRefresh, failRefresh = false;
  const refreshed = structuredClone(report);
  refreshed.daily.at(-1).sent += 3;
  refreshed.daily.at(-1).total += 3;
  refreshed.counts.sent += 3; refreshed.counts.total += 3;
  async function waitForRelease() {
    const deadline = Date.now()+2000;
    while (!releaseRefresh) { if (Date.now()>deadline) throw new Error("Refresh request did not reach its test gate"); await page.waitForTimeout(10); }
  }
  await page.route("**/api/activity", async (route) => {
    if (failRefresh) { await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic refresh failure" }) }); return; }
    await new Promise((resolve) => { releaseRefresh = resolve; });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(refreshed) });
  });
  await refresh.click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Refresh activity report"]')?.getAttribute('aria-busy') === 'true');
  assert.equal(await refresh.isDisabled(), true);
  assert.equal((await refresh.innerText()).trim(), "");
  await waitForRelease();
  releaseRefresh();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Refresh activity report"]')?.disabled);
  await chart.focus(); await chart.press("End");
  assert.equal(Number(await tooltip.locator("b").first().innerText()), refreshed.daily.at(-1).sent);
  failRefresh = true;
  await refresh.click();
  await page.getByRole("alert").filter({ hasText: "Synthetic refresh failure" }).waitFor();
  failRefresh = false; releaseRefresh = null;
  await refresh.click();
  await waitForRelease();
  releaseRefresh();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Refresh activity report"]')?.disabled);
  await page.waitForFunction(() => document.querySelectorAll('[role="alert"]').length === 0, null, { timeout: 5000 });
  assert.equal(await page.locator("main").getByRole("alert").count(), 0);
  await page.unroute("**/api/activity");
  checks.push("delayed refresh stays icon-only/busy; changed data renders; failed refresh retries successfully (browser-only synthetic responses)");
  for (const name of ["SMTP accepted", "Dry run", "Bounce events", "Deferred", "Failed / suppressed"]) await page.getByRole("button", { name, exact: true }).click();
  await page.getByText("No series selected", { exact: true }).waitFor();
  assert.equal(await page.locator('polyline').count(), 0);
  for (const name of ["SMTP accepted", "Dry run", "Bounce events", "Deferred", "Failed / suppressed"]) await page.getByRole("button", { name, exact: true }).click();
  assert.equal(await chart.locator('polyline').count(), 5);
  const zeros=structuredClone(report);zeros.daily= zeros.daily.map(day=>Object.fromEntries(Object.keys(day).map(key=>[key,key==='date'?day.date:0])));
  await page.route('**/api/activity',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(zeros)}));
  await page.reload();await chart.waitFor();
  assert.equal(await chart.locator('polyline').count(),5);
  for(const points of await chart.locator('polyline').evaluateAll(lines=>lines.map(line=>line.getAttribute('points'))))assert.doesNotMatch(points,/NaN|Infinity/);
  zeros.daily=[];await page.reload();await page.getByText('No activity recorded',{exact:true}).waitFor();
  await page.unroute('**/api/activity');
  checks.push('hide-all/restore, all-zero series and empty report have defined, valid states (browser-only synthetic responses)');

  for (const width of [1440, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/#dialer`);
    const toolbar = page.locator(".call-queue-controls");
    await toolbar.waitFor();
    const callable = toolbar.getByRole("button", { name: "Callable leads", exact: true });
    assert.match(await callable.getAttribute("title"), /Phone on file and fit score above 80/);
    const controls = await toolbar.locator("button,input").evaluateAll((nodes) => nodes.map((node) => {
      const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height, width: r.width };
    }));
    assert.ok(controls.every((r) => r.height >= 43.5), `${width}: control height`);
    assert.ok(Math.abs(controls[0].top-controls[1].top) < 1, `${width}: buttons misaligned`);
    if (width > 640) assert.ok(Math.abs(controls[0].top-controls[2].top) < 1, `${width}: search and buttons misaligned`);
    else {
      assert.ok(controls[2].top >= controls[0].bottom, `${width}: search should occupy full next row`);
      const toolbarBox = await toolbar.boundingBox();
      assert.ok(Math.abs(controls[2].width-toolbarBox.width) < 1, `${width}: mobile search not full width`);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    checks.push(`call toolbar aligned and readable at ${width}px`);
  }
  await page.screenshot({ path: `${output}/call-toolbar-mobile.png` });
  await page.goto(`${base}/mailboxes`);
  const senderRefresh = page.getByRole("button", { name: "Refresh mailboxes", exact: true });
  await senderRefresh.waitFor();
  assert.equal((await senderRefresh.innerText()).trim(), "");
  assert.equal(await senderRefresh.locator("svg").count(), 1);
  checks.push("sender refresh icon retains an accessible name without visible text");

  const mobile = await browser.newContext({ viewport: { width: 375, height: 900 }, hasTouch: true, isMobile: true });
  const touch = await mobile.newPage();
  await touch.goto(`${base}/activity`);
  const mobileChart = touch.getByRole("img", { name: "Daily email activity line chart" });
  await mobileChart.waitFor();
  const touchIndex = 21;
  const touchPoint = await mobileChart.evaluate((svg,index) => {
    const point=svg.querySelector('polyline[data-series="sent"]').points.getItem(index);
    const screen=new DOMPoint(point.x,point.y).matrixTransform(svg.getScreenCTM());return {x:screen.x,y:screen.y};
  }, touchIndex);
  await touch.touchscreen.tap(touchPoint.x,touchPoint.y);
  const touchTooltip=touch.locator('[class*="chartTooltip"]');
  await touchTooltip.waitFor();
  assert.equal(await touchTooltip.locator("strong").innerText(), report.daily[touchIndex].date);
  assert.deepEqual((await touchTooltip.locator("b").allTextContents()).map(Number), ["sent", "dryRun", "bounced", "deferred", "failedSuppressed"].map((key) => report.daily[touchIndex][key]));
  assert.equal(await mobileChart.locator("polyline").count(), 5);
  assert.ok(await touch.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const plotHeight = await mobileChart.evaluate((svg) => {
    const lines=[...svg.querySelectorAll('g > line')].filter((line) => line.getAttribute('x1') !== line.getAttribute('x2'));
    const ys=lines.map((line)=>line.getBoundingClientRect().top);return Math.max(...ys)-Math.min(...ys);
  });
  assert.ok(plotHeight >= 180, "Mobile plot is visually compressed");
  const mobileDates = await mobileChart.locator("text").evaluateAll((nodes) => nodes.filter((node) => /^\d\d-\d\d$/.test(node.textContent || "")).map((node) => { const r=node.getBoundingClientRect();return {left:r.left,right:r.right}; }));
  assert.ok(mobileDates.every((label,index) => !index || label.left >= mobileDates[index-1].right), "Mobile chart dates overlap");
  await touch.screenshot({ path: `${output}/line-chart-touch.png` });
  await mobile.close();
  checks.push("touch and hover select the rendered point's exact date and all five values; no overflow");
  assert.deepEqual(errors, []);
  await writeFile(`${output}/interactive-proof.json`, JSON.stringify({ checks, pageErrors: errors }, null, 2));
  console.log(JSON.stringify({ checks, pageErrors: errors }, null, 2));
} catch (error) {
  console.error("Chart/UI proof failure", page.url(), await page.getByRole("alert").allTextContents());
  await page.screenshot({ path: `${output}/failed-proof.png`, fullPage: true });
  throw error;
} finally { await browser.close(); }
