import assert from "node:assert/strict";
import { test } from "node:test";
import { mailboxCapacity } from "../lib/mailbox-capacity.ts";

const mailbox = { status: "ACTIVE", health: "Available", manualLimits: false, dailyLimit: 30, hourlyLimit: 5, sendsToday: 10, sendsThisHour: 0 };
test("sender cards use effective warmup capacity, not a misleading configured quota", () => {
  assert.deepEqual(mailboxCapacity(mailbox, { mailboxId: 1, effectiveDailyLimit: 10, effectiveHourlyLimit: 3 }), { dailyLimit: 10, hourlyLimit: 3, health: "At quota" });
  assert.equal(mailboxCapacity({ ...mailbox, sendsToday: 0, sendsThisHour: 3 }, { mailboxId: 1, effectiveDailyLimit: 10, effectiveHourlyLimit: 3 }).health, "At quota");
});
test("manual quotas remain exact; unavailable warmup data is unknown, not available", () => {
  assert.deepEqual(mailboxCapacity({ ...mailbox, manualLimits: true }), { dailyLimit: 30, hourlyLimit: 5, health: "Available" });
  assert.deepEqual(mailboxCapacity(mailbox), { dailyLimit: null, hourlyLimit: null, health: "Unknown" });
  assert.equal(mailboxCapacity({ ...mailbox, status: "PAUSED", health: "Paused" }).health, "Paused");
  assert.equal(mailboxCapacity({ ...mailbox, status: "COOLDOWN", health: "Cooling down" }).health, "Cooling down");
  assert.equal(mailboxCapacity({ ...mailbox, manualLimits: true, credentialConfigured: false }).health, "Credential missing");
});
