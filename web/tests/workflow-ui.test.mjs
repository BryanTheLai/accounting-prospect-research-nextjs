import assert from "node:assert/strict";
import { test } from "node:test";
import { pageFromHash, stageLabel, primaryStages, primaryCallCodes, startBlockReason } from "../lib/workflow-ui.mjs";

test("home, old overview links and unknown routes open email campaigns", () => {
  for (const hash of ["", "#overview", "#unknown"]) assert.equal(pageFromHash(hash), "campaigns");
  for (const page of ["campaigns", "prospects", "dialer", "settings"]) assert.equal(pageFromHash(`#${page}`), page);
});
test("short stage labels preserve stored values and unfamiliar imported stages", () => {
  assert.equal(stageLabel("Approved for Outreach"), "Approved");
  assert.equal(stageLabel("Discarded / DNC"), "Do not contact");
  assert.equal(stageLabel("Custom imported stage"), "Custom imported stage");
  assert.equal(stageLabel(null), "Unassigned");
  assert.equal(primaryStages.length, 6);
  assert.equal(primaryCallCodes.length, 4);
});
test("disabled send controls explain all blockers without allowing an invalid run", () => {
  const ready = { available: true, busy: false, selected: 20, templateA: "A", templateB: "B" };
  assert.equal(startBlockReason(ready), "");
  assert.match(startBlockReason({ ...ready, available: false }), /unavailable/);
  assert.match(startBlockReason({ ...ready, busy: true }), /Starting/);
  assert.match(startBlockReason({ ...ready, selected: 0 }), /Select at least/);
  assert.match(startBlockReason({ ...ready, templateA: "" }), /both/);
  assert.match(startBlockReason({ ...ready, templateB: "A" }), /different/);
});
