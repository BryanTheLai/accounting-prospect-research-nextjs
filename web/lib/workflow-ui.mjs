// Display labels retain the existing stored values and API contract.
export const stageLabels = {
  "Ready to Review": "Review",
  "Approved for Outreach": "Approved",
  "In Sequence (Smartlead)": "Contacted",
  "Replied (Warm)": "Replied",
  "Discovery Call Booked": "Meeting",
  "Proposal Sent": "Proposal",
  "Closed Won (Retainer Signed)": "Won",
  "Discovery in progress": "Researching",
  "Nurture / Follow-up": "Follow up",
  "Bounced / 550 Invalid": "Bounced",
  "Discarded / DNC": "Do not contact",
};

export const primaryStages = ["Ready to Review", "Approved for Outreach", "Replied (Warm)", "Discovery Call Booked", "Closed Won (Retainer Signed)", "Discarded / DNC"];
export const primaryCallCodes = ["NO_ANSWER_RING_OUT", "CONNECTED_CALLBACK", "CONNECTED_MEETING_BOOKED", "CONNECTED_NOT_INTERESTED"];

export function stageLabel(value) { return stageLabels[value] || value || "Unassigned"; }
export function pageFromHash(hash) {
  const value = hash.replace(/^#/, "");
  return ["campaigns", "prospects", "dialer", "settings"].includes(value) ? value : "campaigns";
}
export function startBlockReason({ available, busy, selected, templateA, templateB }) {
  if (!available) return "Email service unavailable. Retry the connection.";
  if (busy) return "Starting the queue…";
  if (!selected) return "Select at least one ready recipient above.";
  if (!templateA || !templateB) return "Choose both email templates.";
  if (templateA === templateB) return "Choose two different email templates.";
  return "";
}
