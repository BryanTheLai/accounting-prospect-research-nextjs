import assert from "node:assert/strict";
import { test } from "node:test";
import { prospectTimezone } from "../lib/prospect-timezone.mjs";

test("recorded location wins over campaign defaults, including Singapore and Canadian YC leads", () => {
  assert.deepEqual(prospectTimezone("Montreal, QC, Canada", "yc_us_expansion"), { name:"America/Toronto",label:"Eastern",reference:false });
  assert.deepEqual(prospectTimezone("Singapore", "yc_us_expansion"), { name:"Asia/Singapore",label:"Singapore",reference:false });
  assert.equal(prospectTimezone("Delaware, USA", "yc_us_expansion").name,"America/New_York");
  assert.equal(prospectTimezone("Senai, Johor", "hydroball_clones").reference,false);
});
test("unknown and remote-only locations are reference clocks, never verified local time", () => {
  assert.equal(prospectTimezone("Remote", "yc_us_expansion").reference,true);
  assert.equal(prospectTimezone(null, null).reference,true);
  assert.equal(prospectTimezone("London", "yc_us_expansion").reference,true);
});
