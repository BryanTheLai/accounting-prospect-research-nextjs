"use client";

import { useState } from "react";

export function CallScript({ script }: { script: string }) {
  const [status, setStatus] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(script);
      setStatus("Full script copied.");
    } catch {
      setStatus("Select the script below to copy it. Clipboard access is unavailable.");
    }
  }
  return <section className="live-call-script" aria-labelledby="call-script-title">
    <div className="call-script-heading"><h3 id="call-script-title">Script</h3>{script && <button type="button" className="button secondary" onClick={() => void copy()}>Copy</button>}</div>
    <div className="script-copy">{script || "No call script is saved for this contact."}</div>
    {status && <p className="call-copy-status" role="status">{status}</p>}
  </section>;
}
