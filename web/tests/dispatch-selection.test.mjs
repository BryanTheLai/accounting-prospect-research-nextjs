import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { test } from "node:test";
import { getDispatchCandidateEmailTiers, selectDispatchCandidateIds } from "../lib/dispatch-selection.ts";

test("dispatch quick picks replace selection with their exact visible eligible subset", () => {
  const candidates = [
    { id: "one", emailTier: "direct" },
    { id: "two", emailTier: "department" },
    { id: "three", emailTier: "generic" },
    { id: "four", emailTier: "direct" },
    { id: "five", emailTier: "system" },
    { id: "six", emailTier: "direct" },
  ];
  assert.deepEqual([...selectDispatchCandidateIds(candidates, "top5")], ["one", "two", "three", "four", "five"]);
  assert.deepEqual([...selectDispatchCandidateIds(candidates, "direct")], ["one", "four", "six"]);
  assert.deepEqual([...selectDispatchCandidateIds(candidates, "direct_and_department")], ["one", "two", "four", "six"]);
  assert.deepEqual([...selectDispatchCandidateIds(candidates, "clear")], []);
});

test("email-tier lookup decorates only IDs in the dispatcher-provided candidate page", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE prospects (lead_id TEXT PRIMARY KEY, contact_email TEXT, buyer_name TEXT);
      INSERT INTO prospects VALUES ('eligible_direct', 'ada@company.test', 'Ada Founder');
      INSERT INTO prospects VALUES ('eligible_hr', 'careers@company.test', '');
      INSERT INTO prospects VALUES ('not_in_dispatch_page', 'info@company.test', '');`);
    const tiers = getDispatchCandidateEmailTiers(db, ["eligible_direct", "eligible_hr"]);
    assert.deepEqual([...tiers.entries()], [["eligible_direct", "direct"], ["eligible_hr", "department"]]);
    assert.equal(tiers.has("not_in_dispatch_page"), false);
    assert.deepEqual(getDispatchCandidateEmailTiers(db, []), new Map());
  } finally {
    db.close();
  }
});
