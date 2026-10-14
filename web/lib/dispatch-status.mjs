const reasons = Object.freeze({
  spacing: "Waiting between messages",
  hourly_quota: "Waiting for hourly sender capacity",
  daily_quota: "Waiting for tomorrow's sender capacity",
  provider_cooldown: "Waiting for provider cooldown",
  mailbox_unavailable: "No available sender; checking again shortly",
  schedule: "Waiting for the campaign send window",
  sending: "Sending a message",
  recovering: "Recovering the saved queue",
  worker_error: "Sender stopped; saved queue needs review",
  completed: "Queue completed",
  stopped: "Queue stopped",
});

export function dispatchStatusLabel(snapshot) {
  if (!snapshot) return "Email service unavailable";
  if (snapshot.has_error) return reasons.worker_error;
  if (snapshot.is_paused) return "Queue paused";
  if (!snapshot.is_running) return reasons[snapshot.wait_reason] || "Queue idle";
  return reasons[snapshot.wait_reason] || "Queue active";
}
