"use client";

import { useState } from "react";
import { callPlaybook, companyWebsiteUrl, followupSummaryText, linkedinSearchUrl } from "@/lib/call-aids.mjs";

export function CallAids({ company, buyer, rootDomain, campaignId, software }: { company: string; buyer: string | null; rootDomain: string | null; campaignId: string | null; software: string | null }) {
  const [summary, setSummary] = useState(() => followupSummaryText(company, buyer, campaignId, software));
  const objections = callPlaybook(campaignId).objections;
  const [copyStatus, setCopyStatus] = useState("");
  const website = companyWebsiteUrl(rootDomain);
  const linkedin = linkedinSearchUrl(buyer, company);

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summary);
      setCopyStatus("Summary copied. Review it before sharing.");
    } catch {
      setCopyStatus("Clipboard access is unavailable. Select and copy the draft above.");
    }
  }

  return <section className="call-aids" aria-label="Call research and follow-up aids">
    {(website || linkedin) && <div className="call-actions" aria-label="Research shortcuts">
      {website && <a className="button secondary" href={website} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Company website <span aria-hidden="true">↗</span></a>}
      {linkedin && <a className="button secondary" href={linkedin} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Search on LinkedIn <span aria-hidden="true">↗</span></a>}
    </div>}

    <section className="call-objection-guide" aria-label="Full objection guide">
      <h3>Objection guide</h3>
      <div>
        {objections.map((item) => <details className="script-fold" key={item.objection}><summary>{item.objection}</summary><div className="script-copy">{item.response}</div></details>)}
      </div>
    </section>

    <details className="script-fold">
      <summary>Follow-up draft <span>Editable · copy to share</span></summary>
      <textarea aria-label="Editable follow-up summary" className="call-notes" maxLength={5000} rows={12} value={summary} onChange={(event) => { setSummary(event.target.value); setCopyStatus(""); }} />
      <button className="quiet-link copy-script" type="button" onClick={() => void copySummary()} aria-label="Copy follow-up draft">Copy draft</button>
      {copyStatus && <p className="call-notes-label" role="status">{copyStatus}</p>}
    </details>
  </section>;
}
