import test from "node:test";
import assert from "node:assert/strict";
import { dispatchStatusLabel } from "../lib/dispatch-status.mjs";

test("running distinguishes real sending from quota, schedule and spacing waits", () => {
  const running = { is_running: true, is_paused: false };
  assert.equal(dispatchStatusLabel({ ...running, wait_reason: "hourly_quota" }), "Waiting for hourly sender capacity");
  assert.equal(dispatchStatusLabel({ ...running, wait_reason: "daily_quota" }), "Waiting for tomorrow's sender capacity");
  assert.equal(dispatchStatusLabel({ ...running, wait_reason: "spacing" }), "Waiting between messages");
  assert.equal(dispatchStatusLabel({ ...running, wait_reason: "sending" }), "Sending a message");
  assert.equal(dispatchStatusLabel({ ...running, wait_reason: "schedule" }), "Waiting for the campaign send window");
});

test("disconnected, paused and failed workers never claim active sending", () => {
  assert.equal(dispatchStatusLabel(null), "Email service unavailable");
  assert.equal(dispatchStatusLabel({ is_running: true, is_paused: true }), "Queue paused");
  assert.equal(dispatchStatusLabel({ is_running: false, is_paused: false, has_error: true }), "Sender stopped; saved queue needs review");
});
