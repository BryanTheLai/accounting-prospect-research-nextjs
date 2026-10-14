import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { coreCallScript } from "../lib/core-call-script.mjs";

const base = process.env.UI_QA_URL || "http://127.0.0.1:3000";
assert.equal(new URL(base).hostname, "127.0.0.1");
const output = "../operations/luna-ui-qa-20261008";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
const checks = [], errors = [];
page.on("request", (request) => assert.equal(request.method(), "GET", "No live data mutations allowed"));
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(`${base}/#dialer`);
  const search = page.getByRole("searchbox", { name: "Search call queue" });
  const script = page.locator(".script-copy");
  for (const [query, id] of [["Advancelab", "OC-JOB-001"], ["FOMO Solution", "OC-JOB-164"]]) {
    const contact = await (await fetch(`${base}/api/prospects?id=${id}`)).json();
    await search.fill(query);
    await page.waitForFunction((label) => document.querySelector(".script-copy")?.textContent.includes(label), id === "OC-JOB-164" ? contact.buyer : contact.company);
    const rendered = await script.textContent();
    const greeting = rendered.match(/Good (?:morning|afternoon|evening|day)/)?.[0];
    assert.ok(greeting);
    assert.equal(rendered, coreCallScript(contact, greeting));
    for (const section of ["[IF RECEPTIONIST / GATEKEEPER ANSWERS]", "[WHEN DECISION MAKER PICKS UP]", '[THE CHRIS VOSS "NO"-ORIENTED CLOSE]', "[POLITE BAILOUT IF THEY ASK DETAILED TAX / AUDIT RULES]", "[IF NOT INTERESTED / BUSY]"]) assert.ok(rendered.includes(section));
    assert.ok(rendered.length > 2000);
    if (id === "OC-JOB-164") assert.equal(rendered, contact.phoneScript.replaceAll("{time_greeting}", greeting));
    await page.locator(".live-call-script").getByRole("button", { name: "Copy", exact: true }).click();
    await page.getByText("Full script copied.", { exact: true }).waitFor();
    assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replaceAll("\r\n", "\n"), rendered.replaceAll("\r\n", "\n"));
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await script.textContent(), rendered);
      assert.equal(await script.evaluate((node) => getComputedStyle(node).maxHeight), "none");
    }
    await script.screenshot({ path: `${output}/long-call-script-${id}.png` });
    checks.push({ id, characters: rendered.length, savedOriginalPreserved: id === "OC-JOB-164", fullCopyMatches: true, desktopMobileUntruncated: true });
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/long-call-script-proof.json`, JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}
