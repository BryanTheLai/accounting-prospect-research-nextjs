import { callPlaybook } from "./call-aids.mjs";

export function coreCallScript(contact, greeting) {
  const saved = String(contact?.phoneScript || "");
  if (/is this a bad time to talk|did i catch you at a bad time/i.test(saved)) return saved.replaceAll("{time_greeting}", greeting);
  const buyer = String(contact?.buyer || "").trim();
  const hasName = buyer && !/^(?:founder|co-founder|ceo|chief executive|managing director|director|owner|manager|head|finance head)\b/i.test(buyer);
  const company = contact?.company || "your company";
  const playbook = contact?.campaignId ? callPlaybook(contact.campaignId) : null;
  const scope = playbook?.objections.find((item) => item.objection === "What does your service actually cover?")?.response
    || "We help founders and business owners with monthly bookkeeping, bank reconciliations and month-end reporting.";
  const pricing = playbook?.objections.find((item) => item.objection === "How much does it cost?")?.response;
  return `[IF RECEPTIONIST / GATEKEEPER ANSWERS]
"${greeting}, thank you for taking my call!
My name is Bryan with Outbounder. May I please speak with ${hasName ? buyer : "the person who handles your accounts"}?

(If asked what it's regarding):
'Certainly! Just a quick courtesy note regarding the accounting setup at ${company} - we partner with finance teams to help with bookkeeping and month-end reconciliations.'"

[WHEN DECISION MAKER PICKS UP]
"${greeting}${hasName ? ` ${buyer}` : ""}, Bryan here with Outbounder.
Is this a bad time to talk, or do you have 60 seconds?"
(Wait for: "No, what's this about?" or "Make it quick")

"Thank you so much, I'll be completely straight with you and keep this under a minute.
Reason I'm reaching out: we help business owners keep their books and reconciliations up to date, without adding more work to their team.

${scope}${pricing ? `\n\n${pricing}` : ""}

I'm not sure if that's even a headache for your setup right now, but may I check how that sounds to you?"
(Wait for response / acknowledge with calm curiosity)

[UNDERSTAND THEIR CURRENT SETUP]
"May I ask how you're handling the books at ${company} today - is that managed in-house or by an outside accountant?
Which accounting system are you using, and is there anything around bookkeeping or month-end that you'd like to take off your team's plate?"
(Listen first. Use their answer rather than assuming they have a hiring or accounting problem.)

[THE CHRIS VOSS "NO"-ORIENTED CLOSE]
"I really appreciate your time. I'm certainly not asking you to change your accounting setup today.
Would you be entirely against a brief 10-minute chat next Tuesday just to see whether we could be useful as a backup desk?"
(If interested, agree a convenient time and confirm the best contact details.)

[POLITE BAILOUT IF THEY ASK DETAILED TAX / AUDIT RULES]
"I truly appreciate the question, and I want to respect your time - I manage our partner desk so I wouldn't want to guess on technical tax rules off the top of my head. Let me have one of our senior accountants take a look at your exact setup during a quick 10-minute chat. Would next Tuesday morning be convenient for you?"

[IF NOT INTERESTED / BUSY]
"Completely understand! Thank you so much for your time and courtesy today. Wishing you and your team a wonderful day ahead!"`;
}
