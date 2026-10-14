"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";

type Download = { filename: string; available: boolean };
type Check = { service: string; status: "LISTED" | "CLEAN" | "QUERY_TIMEOUT"; return_code?: string };
type Audit = { domain: string; is_listed: boolean; overall_status: "LISTED" | "INCOMPLETE" | "CLEAN"; checks: Check[]; checked_at: string };
type DnsConfig = {
  domain: string | null;
  providers: string[];
  guidance: Array<{ record: string; purpose: string }>;
  downloads: Record<string, Download>;
};

export default function DnsDeliverabilityTools() {
  const [config, setConfig] = useState<DnsConfig | null>(null);
  const [domain, setDomain] = useState("");
  const [audit, setAudit] = useState<Audit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setError("");
    void fetch("/api/dns-tools", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not load DNS settings.");
        if (active) {
          setConfig(payload as DnsConfig);
          setDomain(payload.domain || "");
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load DNS settings.");
      });
    return () => { active = false; };
  }, [retry]);

  async function runAudit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setAudit(null);
    try {
      const response = await fetch("/api/dns-tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check", domain }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "DNSBL check failed.");
      setAudit(payload as Audit);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "DNSBL check failed.");
    } finally {
      setBusy(false);
    }
  }

  const availableDownloads = Object.entries(config?.downloads || {});
  return <section className="settings-section dns-tools" aria-label="Domain and deliverability tools">
    <div className="dns-tools-panel">
      <div className="dns-tools-copy">
        <h3>DNSBL reputation check</h3>
        <p>Queries Spamhaus ZEN and DBL, SpamCop, and Barracuda only after you run a check. The domain is sent to those DNSBL operators. An unavailable provider stays marked as unknown.</p>
      </div>
      <form className="dns-audit-form" onSubmit={(event) => void runAudit(event)}>
        <label htmlFor="dns-audit-domain">Domain</label>
        <div className="dns-audit-input-row">
          <input id="dns-audit-domain" value={domain} onChange={(event) => setDomain(event.target.value)} maxLength={2048} placeholder="openclosehq.com" autoComplete="off" />
          <button className="button secondary" type="submit" disabled={busy || !config || !domain.trim()}>{busy ? "Checking…" : "Run DNSBL check"}</button>
        </div>
      </form>
      {error && <div className="dns-tools-error" role="alert"><p>{error}</p>{!config && <button type="button" className="button secondary" onClick={() => setRetry((current) => current + 1)}>Retry DNS settings</button>}</div>}
      {audit && <div className={`dns-audit-result dns-${audit.overall_status.toLowerCase()}`} role="status" aria-live="polite">
        <div className="dns-audit-result-heading"><strong>{audit.overall_status === "LISTED" ? "Listing found" : audit.overall_status === "CLEAN" ? "No listings found" : "Check incomplete"}</strong><span>{audit.domain} · {new Date(audit.checked_at).toLocaleString()}</span></div>
        <ul>{audit.checks.map((check) => <li key={check.service}><span>{check.service}</span><strong>{check.status === "LISTED" ? `LISTED · ${check.return_code || "A record returned"}` : check.status === "CLEAN" ? "CLEAN" : "UNAVAILABLE"}</strong></li>)}</ul>
        {audit.overall_status === "INCOMPLETE" && <small>At least one provider did not answer. This result does not establish a clean reputation.</small>}
      </div>}
      <div className="dns-record-guide">
        <h3>DNS record guide</h3>
        <ul>{(config?.guidance || []).map((item) => <li key={item.record}><b>{item.record}</b><span>{item.purpose}</span></li>)}</ul>
        <p>The downloadable records are templates. Replace tenant placeholders with values from your mail provider and review the target domain before importing. The BIND template is for <code>openclosehq.com</code>; it is not the default <code>openclose-desk.com</code> domain.</p>
      </div>
      <div className="dns-downloads">
        <h3>DNS configuration files</h3>
        <div className="dns-download-actions">{availableDownloads.map(([key, file]) => file.available
          ? <a className="button secondary" key={key} href={`/api/dns-tools?download=${encodeURIComponent(key)}`}>Download {key === "bind" ? "BIND zone" : "Cloudflare API JSON"} <small>{file.filename}</small></a>
          : <span key={key} className="dns-file-unavailable">{file.filename} is not present in this workspace.</span>)}</div>
        {!config && !error && <span className="dns-file-unavailable">Loading local DNS file availability…</span>}
      </div>
    </div>
  </section>;
}
