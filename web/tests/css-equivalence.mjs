import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.UI_QA_URL || "http://127.0.0.1:3001";
assert.equal(new URL(base).hostname, "127.0.0.1");
assert.equal(new URL(base).port, "3001", "Isolated fixture only");
const path = resolve("../operations/ui-qa/mobile-20261007/css-contract.json");
const capture = process.argv.includes("--capture");
const browser = await chromium.launch();
const snapshots = [];
try {
  for (const width of [320, 390, 1280]) {
    for (const route of ["/#campaigns", "/#prospects", "/#dialer", "/#settings", "/playbooks", "/activity", "/mailboxes", "/email-preflight?leadId=uiqa_lead_001", "/import", "/yc"]) {
      const page = await browser.newPage({ reducedMotion: "reduce", viewport: { width, height: 844 } });
      await page.goto(base + route, { waitUntil: "networkidle" });
      const navLabel = route.includes("#prospects") || route === "/import" || route === "/yc" ? "Prospects" : route.includes("#dialer") ? "Call" : route.includes("#settings") || route === "/mailboxes" ? "Settings" : route === "/playbooks" ? "Setup" : route === "/activity" ? "Activity" : "Email";
      await page.getByRole("link", { name: navLabel, exact: true }).and(page.locator('[aria-current="page"]')).waitFor();
      await page.evaluate(() => document.querySelectorAll("details").forEach((element) => { element.open = true; }));
      if (route === "/#dialer") {
        await page.getByLabel("Call script style").selectOption("all");
        await page.locator("#call-notes").waitFor();
        await page.evaluate(() => document.querySelectorAll("details").forEach((element) => { element.open = true; }));
      }
      await page.waitForLoadState("networkidle");
      if (route === "/#settings") await page.locator(".dns-record-guide li").first().waitFor();
      await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
      await page.waitForFunction(() => {
        document.documentElement.getBoundingClientRect();
        return document.getAnimations().every((animation) => animation.playState !== "running");
      });
      const styles = await page.evaluate(() => {
        const properties = ["display", "color", "background-color", "font-size", "font-weight", "line-height", "min-height", "max-height", "padding", "margin", "border", "border-radius", "box-shadow", "grid-template-columns", "gap", "overflow-x", "overflow-y", "position", "inset", "outline", "transform"];
        return [...document.querySelectorAll("main *")].filter((element) => element.checkVisibility() && element.tagName !== "OPTION")
          .map((element) => {
            const style = getComputedStyle(element);
            return { element: element.tagName, class: element.getAttribute("class"), values: Object.fromEntries(properties.map((property) => [property, style.getPropertyValue(property)])) };
          });
      });
      snapshots.push({ width, route, styles });
      await page.close();
    }
  }
  if (capture) {
    writeFileSync(path, JSON.stringify(snapshots));
    console.log(`Pinned ${snapshots.length} main-content rendered-style contracts for this build. Navigation behavior is covered separately by mobile-ui.mjs.`);
  }
  if (!capture) {
    const baseline = JSON.parse(readFileSync(path, "utf8"));
    for (let index = 0; index < snapshots.length; index++) {
      const actual = snapshots[index];
      const expected = baseline[index];
      assert.equal(actual.styles.length, expected.styles.length, `${actual.route} at ${actual.width}px element count`);
      for (let element = 0; element < actual.styles.length; element++) assert.deepEqual(actual.styles[element], expected.styles[element], `${actual.route} at ${actual.width}px element ${element} (${actual.styles[element].class})`);
    }
    console.log(`${snapshots.length} rendered-style contracts match the selected baseline.`);
  }
} finally { await browser.close(); }
