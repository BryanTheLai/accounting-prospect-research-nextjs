"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { isEmailPreflightFresh } from "@/lib/email-preflight-freshness.mjs";
import type { EmailPreflightRecord, MxStatus } from "@/lib/email-preflight-core.mjs";
import type { DiscoveredEmailCandidate, EmailDiscoveryResult } from "@/lib/email-discovery.mjs";

type ProspectOption = { lead_id: string; company_name: string; contact_email: string | null };
type PreflightResponse = { preflight: EmailPreflightRecord | null; label?: string; syntax?: { valid: boolean; reason: string } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProspectOption(value: unknown): value is ProspectOption {
  return isRecord(value) && typeof value.lead_id === "string" && typeof value.company_name === "string" &&
    (value.contact_email === null || typeof value.contact_email === "string");
}

const statusCopy: Record<MxStatus, string> = {
  not_checked: "Not checked yet.",
  mx_present: "MX record found. This does not confirm the mailbox exists.",
  no_mx: "No MX record found. Check the address or use another contact.",
  invalid_syntax: "Invalid email format. Correct it, then check again.",
  lookup_error: "DNS check failed. Retry the check.",
};

function withNextStep(message: string, step: string) {
  return `${message} ${step}`;
}

export default function EmailPreflightClient() {
  const [query, setQuery] = useState("");
  const [prospects, setProspects] = useState<ProspectOption[]>([]);
  const [loadingProspects, setLoadingProspects] = useState(true);
  const [searchError, setSearchError] = useState("");
  const [searchRetry, setSearchRetry] = useState(0);
  const [selected, setSelected] = useState<ProspectOption | null>(null);
  const [returnScope, setReturnScope] = useState("all");
  const [returnToSettings, setReturnToSettings] = useState(true);
  const [email, setEmail] = useState("");
  const [record, setRecord] = useState<EmailPreflightRecord | null>(null);
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [sawPublishedAddress, setSawPublishedAddress] = useState(false);
  const [busy, setBusy] = useState(false);
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [discovery, setDiscovery] = useState<EmailDiscoveryResult | null>(null);
  const [selectedCandidateEmail, setSelectedCandidateEmail] = useState("");
  const [addressUpdatePending, setAddressUpdatePending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const persistedEmail = useRef("");
  const requestedEmail = useRef("");
  const invalidateTimer = useRef<number | null>(null);
  const pendingInvalidate = useRef<Promise<void> | null>(null);
  const loadSequence = useRef(0);
  const userSelectedProspect = useRef(false);
  const recordFresh = record ? isEmailPreflightFresh(record) : false;

  const loadProspects = useCallback(async (term: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ q: term });
    const response = await fetch(`/api/email-preflight?${params}`, { cache: "no-store", signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load prospects");
    if (!signal?.aborted) { setProspects(data.prospects || []); setSearchError(""); }
  }, []);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setLoadingProspects(true);
    const timer = window.setTimeout(() => {
      void loadProspects(query, controller.signal).then(() => {
        if (current) setLoadingProspects(false);
      }).catch((cause) => {
        if (!current) return;
        setLoadingProspects(false);
        setSearchError(cause instanceof Error ? cause.message : "Could not load prospects.");
      });
    }, 180);
    return () => { current = false; window.clearTimeout(timer); controller.abort(); };
  }, [query, loadProspects, searchRetry]);

  const selectProspect = useCallback(async (
    option: ProspectOption,
    fromDeepLink = false,
    prefetched?: { prospect: ProspectOption; preflight: EmailPreflightRecord | null },
  ) => {
    if (!fromDeepLink) userSelectedProspect.current = true;
    if (invalidateTimer.current) window.clearTimeout(invalidateTimer.current);
    loadSequence.current += 1;
    const sequence = loadSequence.current;
    setSelected(option);
    setEmail(option.contact_email || "");
    setRecord(null);
    setError("");
    setNotice("");
    setTypedConfirmation("");
    setSawPublishedAddress(false);
    setAddressUpdatePending(false);
    setDiscovery(null);
    setSelectedCandidateEmail("");
    persistedEmail.current = option.contact_email || "";
    requestedEmail.current = option.contact_email || "";
    try {
      let freshProspect: ProspectOption;
      let stored: EmailPreflightRecord | null;
      if (prefetched) {
        freshProspect = prefetched.prospect;
        stored = prefetched.preflight;
      } else {
        const response = await fetch(`/api/email-preflight?leadId=${encodeURIComponent(option.lead_id)}`, { cache: "no-store" });
        const data: unknown = await response.json();
        if (!response.ok) throw new Error(isRecord(data) && typeof data.error === "string" ? data.error : "Could not load preflight status");
        if (!isRecord(data) || !isProspectOption(data.prospect)) throw new Error("The prospect response was incomplete.");
        freshProspect = data.prospect;
        stored = data.preflight as EmailPreflightRecord | null;
      }
      if (sequence !== loadSequence.current) return;
      const exactEmail = stored?.email ?? freshProspect.contact_email ?? "";
      setSelected(freshProspect);
      setEmail(exactEmail);
      setRecord(stored && stored.email === exactEmail ? stored : null);
      persistedEmail.current = exactEmail;
      requestedEmail.current = exactEmail;
    } catch (cause) {
      if (sequence === loadSequence.current) setError(withNextStep(cause instanceof Error ? cause.message : "Could not load this prospect.", "Select the prospect again to retry."));
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setReturnToSettings(params.get("return") === "settings" || !params.get("leadId"));
    const campaignId = params.get("campaignId");
    if (campaignId && /^[a-z0-9_-]{1,80}$/.test(campaignId)) setReturnScope(campaignId);
    const leadId = params.get("leadId");
    if (!leadId || leadId.length > 120) return;
    let cancelled = false;
    void fetch(`/api/email-preflight?leadId=${encodeURIComponent(leadId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data: unknown = await response.json();
        if (!response.ok) throw new Error(isRecord(data) && typeof data.error === "string" ? data.error : "Could not load this prospect.");
        if (!isRecord(data) || !isProspectOption(data.prospect) || !(data.preflight === null || isRecord(data.preflight))) {
          throw new Error("The prospect response was incomplete.");
        }
        return { prospect: data.prospect, preflight: data.preflight as EmailPreflightRecord | null };
      })
      .then((result) => {
        if (!cancelled && !userSelectedProspect.current) void selectProspect(result.prospect, true, result);
      })
      .catch((cause: unknown) => {
        if (!cancelled && !userSelectedProspect.current) {
          setError(withNextStep(cause instanceof Error ? cause.message : "Could not load this prospect.", "Search for the prospect and select it."));
        }
      });
    return () => { cancelled = true; };
  }, [selectProspect]);

  const invalidateChangedAddress = (leadId: string, exactEmail: string) => {
    const sequence = loadSequence.current;
    setAddressUpdatePending(true);
    setNotice("");
    const previous = pendingInvalidate.current || Promise.resolve();
    const task = previous.then(() => fetch("/api/email-preflight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "invalidate", leadId, email: exactEmail }),
    })).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not invalidate the prior address check");
      if (sequence === loadSequence.current && requestedEmail.current === exactEmail) {
        persistedEmail.current = exactEmail;
        setRecord(data.preflight as EmailPreflightRecord);
      }
    }).catch((cause) => {
      if (sequence === loadSequence.current && requestedEmail.current === exactEmail) {
        setError(withNextStep(cause instanceof Error ? cause.message : "Could not clear the old check.", "Retry the address check before continuing."));
      }
    }).finally(() => {
      if (sequence === loadSequence.current && requestedEmail.current === exactEmail) setAddressUpdatePending(false);
    });
    pendingInvalidate.current = task;
    return task;
  };

  const changeEmail = (nextEmail: string) => {
    setEmail(nextEmail);
    setRecord(null);
    setTypedConfirmation("");
    setSawPublishedAddress(false);
    setError("");
    setNotice("");
    if (!selected || nextEmail === requestedEmail.current) {
      if (invalidateTimer.current) window.clearTimeout(invalidateTimer.current);
      setAddressUpdatePending(false);
      return;
    }
    requestedEmail.current = nextEmail;
    if (invalidateTimer.current) window.clearTimeout(invalidateTimer.current);
    setAddressUpdatePending(true);
    invalidateTimer.current = window.setTimeout(() => {
      void invalidateChangedAddress(selected.lead_id, nextEmail);
    }, 350);
  };

  const postAction = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/email-preflight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Preflight action failed");
    return data as PreflightResponse;
  };

  const checkMx = async () => {
    if (!selected) return;
    if (invalidateTimer.current) window.clearTimeout(invalidateTimer.current);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await pendingInvalidate.current;
      const data = await postAction({ action: "check", leadId: selected.lead_id, email });
      if (!data.preflight) throw new Error("The server returned no saved preflight result");
      setRecord(data.preflight);
      persistedEmail.current = email;
      requestedEmail.current = email;
      setAddressUpdatePending(false);
      setNotice(data.label || statusCopy[data.preflight.mx_status]);
    } catch (cause) {
      setError(withNextStep(cause instanceof Error ? cause.message : "Address check failed.", "Check the address and retry."));
    } finally {
      setBusy(false);
    }
  };

  const confirmSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !record || record.mx_status !== "mx_present") return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await postAction({
        action: "confirm_source",
        leadId: selected.lead_id,
        email,
        confirmationEmail: typedConfirmation,
        sawPublishedAddress,
      });
      if (!data.preflight) throw new Error("The server returned no saved source confirmation");
      setRecord(data.preflight);
      setNotice("Source confirmation recorded for this exact address.");
    } catch (cause) {
      setError(withNextStep(cause instanceof Error ? cause.message : "Could not save the source confirmation.", "Confirm the published address again."));
    } finally {
      setBusy(false);
    }
  };

  const discoverEmailCandidates = async () => {
    if (!selected) return;
    setDiscoveryBusy(true);
    setDiscovery(null);
    setSelectedCandidateEmail("");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/email-discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: selected.lead_id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not search the company website");
      setDiscovery(data as EmailDiscoveryResult);
    } catch (cause) {
      setError(withNextStep(cause instanceof Error ? cause.message : "Could not search the website.", "Check the company domain and retry."));
    } finally {
      setDiscoveryBusy(false);
    }
  };

  const saveDiscoveredCandidate = async (candidate: DiscoveredEmailCandidate) => {
    if (!selected || candidate.kind === "system_or_support") return;
    const target = selected;
    const sequence = loadSequence.current;
    if (invalidateTimer.current) window.clearTimeout(invalidateTimer.current);
    invalidateTimer.current = null;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await pendingInvalidate.current;
      const response = await fetch("/api/contacts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: selected.lead_id, email: candidate.email }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save this contact address");
      if (sequence !== loadSequence.current) return;
      const sameAddress = email === candidate.email;
      setSelected({ ...target, contact_email: candidate.email });
      setEmail(candidate.email);
      requestedEmail.current = candidate.email;
      persistedEmail.current = candidate.email;
      setAddressUpdatePending(false);
      setTypedConfirmation("");
      setSawPublishedAddress(false);
      if (!sameAddress || data.emailPreflightInvalidated) setRecord(null);
      setNotice(data.emailPreflightInvalidated
        ? `Saved ${candidate.email}. Its previous MX check and source confirmation were cleared; run preflight again before outreach.`
        : `Saved ${candidate.email} as the contact address. Discovery is not mailbox verification.`);
    } catch (cause) {
      setError(withNextStep(cause instanceof Error ? cause.message : "Could not save the address.", "Review the selected address and retry."));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => () => {
    if (invalidateTimer.current) window.clearTimeout(invalidateTimer.current);
  }, []);

  return <main className="page-content email-preflight-page" style={{ width: "100%", minHeight: "100vh", overflowWrap: "anywhere" }}>
    <div style={{ maxWidth: 880, margin: "0 auto" }}>
      <a href={returnToSettings ? "/#settings" : `/?campaignId=${encodeURIComponent(returnScope)}${selected ? `&leadId=${encodeURIComponent(selected.lead_id)}` : ""}#prospects`} style={{ display: "inline-flex", alignItems: "center", minHeight: 44, color: "var(--muted)", fontSize: 14 }}>{returnToSettings ? "← Settings" : "← Prospects"}</a>
      <h1 className="sr-only">Email checks</h1>

      {error && <p role="alert" style={{ ...alertStyle, background: "var(--danger-soft)", color: "var(--red)" }}>{error}</p>}
      {notice && <p role="status" style={{ ...alertStyle, background: "var(--good-soft)", color: "var(--forest)" }}>{notice}</p>}

      <section style={cardStyle}>
        <label htmlFor="prospect-search" style={labelStyle}>Search prospects</label>
        <input id="prospect-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company or email" disabled={busy || discoveryBusy} style={inputStyle} />
        {searchError && <div className="panel-feedback" role="alert" style={{ marginTop: 12 }}><p>{searchError}</p><button type="button" style={secondaryButtonStyle} disabled={loadingProspects} onClick={() => setSearchRetry((current) => current + 1)}>Retry prospect search</button></div>}
        <div style={{ maxHeight: 240, overflowY: "auto", marginTop: 10 }}>
          {prospects.map((prospect) => <button key={prospect.lead_id} disabled={busy || discoveryBusy || loadingProspects} onClick={() => void selectProspect(prospect)} style={{ ...optionStyle, background: selected?.lead_id === prospect.lead_id ? "var(--wash)" : "transparent" }}>
            <strong>{prospect.company_name}</strong><span style={{ display: "block", color: "var(--muted)", marginTop: 4 }}>{prospect.contact_email || "No email on record"}</span>
          </button>)}
          {loadingProspects && <p role="status" style={smallNoteStyle}>Searching…</p>}
          {!loadingProspects && !searchError && !prospects.length && <p style={smallNoteStyle}>No prospects found. Try another search.</p>}
        </div>
      </section>

      {selected && <section style={{ ...cardStyle, marginTop: 16 }}>
        <div style={{ fontSize: 12, color: "var(--muted)", letterSpacing: ".08em", textTransform: "uppercase" }}>Selected prospect</div>
        <h2 style={{ fontWeight: 650, fontSize: 24, margin: "6px 0 2px" }}>{selected.company_name}</h2>
        <p style={{ margin: "0 0 18px", color: "var(--muted)", fontSize: 14 }}>Current prospect record: {selected.contact_email || "no address"}</p>

        <details style={{ margin: "0 0 22px", padding: 12, background: "var(--wash)", border: "1px solid var(--line-strong)", borderRadius: 8 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 15 }}>Find a public email candidate</summary>
          <section style={{ paddingTop: 8 }}>
          <p style={{ ...smallNoteStyle, margin: "0 0 12px" }}>Searches a small set of pages on the recorded company website over HTTPS. It does not crawl the proof link or send email. Found addresses are suggestions; mailbox existence is unverified, and nothing is saved until you select a candidate and choose Save.</p>
          <button type="button" onClick={() => void discoverEmailCandidates()} disabled={discoveryBusy || busy} style={secondaryButtonStyle}>{discoveryBusy ? "Searching website…" : "Search company website"}</button>
          {discovery?.status === "invalid_domain" && <p role="status" style={smallNoteStyle}>This prospect has no usable public company domain recorded.</p>}
          {discovery?.status === "unreachable" && <p role="status" style={smallNoteStyle}>No company pages were reachable over HTTPS. No address was saved.</p>}
          {discovery?.status === "no_candidates" && <p role="status" style={smallNoteStyle}>Scanned {discovery.pagesCrawled} page(s); no company-domain email candidates were found.</p>}
          {Boolean(discovery?.candidates.length) && <div style={{ marginTop: 12 }}>
            <p style={{ ...smallNoteStyle, margin: "0 0 8px" }}>Found {discovery!.candidates.length} candidate(s) across {discovery!.pagesCrawled} page(s). These are scraped strings, not verified mailboxes.</p>
            {discovery!.candidates.map((candidate) => <label key={candidate.email} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 4px", minHeight: 44, borderTop: "1px solid var(--line-strong)", opacity: candidate.kind === "system_or_support" ? 0.65 : 1 }}>
              <input type="radio" name="discovered-email-candidate" checked={selectedCandidateEmail === candidate.email} disabled={candidate.kind === "system_or_support" || busy} onChange={() => setSelectedCandidateEmail(candidate.email)} />
              <span style={{ flex: 1, fontSize: 14 }}>
                <strong>{candidate.email}</strong>
                <span style={{ color: "var(--muted)" }}> · {candidate.kind === "system_or_support" ? "system/support address; adoption disabled" : candidate.kind === "generic" ? "generic inbox; review carefully" : "role unclassified; review carefully"}</span>
                <span style={{ display: "block", marginTop: 3 }}>{candidate.sourceUrls.map((sourceUrl, index) => <span key={sourceUrl}>{index > 0 ? " · " : ""}<a href={sourceUrl} target="_blank" rel="noreferrer" style={{ color: "var(--text-accent)" }}>Source page {index + 1} ↗</a></span>)}</span>
              </span>
            </label>)}
            <button type="button" onClick={() => {
              const candidate = discovery?.candidates.find((item) => item.email === selectedCandidateEmail);
              if (candidate) void saveDiscoveredCandidate(candidate);
            }} disabled={busy || !selectedCandidateEmail || discovery!.candidates.find((item) => item.email === selectedCandidateEmail)?.kind === "system_or_support"} style={{ ...primaryButtonStyle, marginTop: 10 }}>{busy ? "Saving…" : "Save selected candidate as contact email"}</button>
          </div>}
          </section>
        </details>

        <label htmlFor="preflight-email" style={labelStyle}>Exact address to check</label>
        <input id="preflight-email" type="email" inputMode="email" value={email} onChange={(event) => changeEmail(event.target.value)} autoComplete="off" spellCheck={false} disabled={busy || discoveryBusy} style={inputStyle} />
        {email !== (selected.contact_email || "") && <p style={{ ...smallNoteStyle, color: "var(--amber)" }}>This address differs from the prospect record. The check and source confirmation apply only to the exact address shown here; this page does not change the prospect’s contact email.</p>}
        {addressUpdatePending && <p role="status" style={smallNoteStyle}>Clearing the prior check and source confirmation for this changed address…</p>}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
          <button onClick={() => void checkMx()} disabled={busy || discoveryBusy || addressUpdatePending || !email} style={primaryButtonStyle}>{busy ? "Checking…" : "Check syntax + MX"}</button>
          <span style={smallNoteStyle}>No email is sent.</span>
        </div>

        {record && record.lead_id === selected.lead_id && record.email === email && <div style={{ marginTop: 20, borderTop: "1px solid var(--line-strong)", paddingTop: 16 }}>
          <div style={{ fontWeight: 700, color: record.mx_status === "mx_present" ? "var(--forest)" : record.mx_status === "lookup_error" ? "var(--amber)" : "var(--red)" }}>{statusCopy[record.mx_status]}</div>
          {record.mx_status === "mx_present" && <p style={{ ...smallNoteStyle, marginTop: 7 }}>MX hosts: {JSON.parse(record.mx_hosts).join(", ") || "No hosts returned"}. Mailbox existence and ownership remain unverified.</p>}
          {record.checked_at && <p style={smallNoteStyle}>Checked {new Date(record.checked_at).toLocaleString()}</p>}
          {record.source_confirmed === 1 && recordFresh && <p role="status" style={{ ...smallNoteStyle, color: "var(--forest)", fontWeight: 700 }}>You confirmed this exact address was published by the company. This is a human source attestation, not mailbox verification.</p>}
          {record.source_confirmed === 1 && !recordFresh && <p role="status" style={{ ...smallNoteStyle, color: "var(--amber)", fontWeight: 700 }}>This preflight is older than 30 days or incomplete. Refresh the MX check and confirm the company source again before a live send.</p>}

          {record.mx_status === "mx_present" && !recordFresh && <form onSubmit={(event) => void confirmSource(event)} style={{ marginTop: 18, padding: 16, background: "var(--wash)", border: "1px solid var(--line-strong)", borderRadius: 8 }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>{record.source_confirmed === 1 ? "Confirm the source again" : "Confirm the published address"}</h3>
            <p style={{ ...smallNoteStyle, marginTop: 0 }}>Continue only if you personally saw <strong>{email}</strong> on the company website or an official company profile. DNS and discovered suggestions do not count.</p>
            <label style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 14, lineHeight: 1.45, margin: "12px 0" }}>
              <input type="checkbox" checked={sawPublishedAddress} onChange={(event) => setSawPublishedAddress(event.target.checked)} />
              <span>I saw this exact address published by the company.</span>
            </label>
            <label htmlFor="confirm-exact-email" style={labelStyle}>Retype the address to confirm</label>
            <input id="confirm-exact-email" type="email" inputMode="email" value={typedConfirmation} onChange={(event) => setTypedConfirmation(event.target.value)} autoComplete="off" spellCheck={false} style={inputStyle} />
            <button type="submit" disabled={busy || !sawPublishedAddress || typedConfirmation !== email} style={{ ...primaryButtonStyle, marginTop: 12 }}>{busy ? "Saving…" : "Record source confirmation"}</button>
          </form>}
        </div>}
      </section>}

      <p style={{ ...smallNoteStyle, marginTop: 20 }}>This preflight stores one exact address per lead. Editing the address clears its previous MX result and source confirmation. No email is sent.</p>
    </div>
  </main>;
}

const cardStyle: CSSProperties = { background: "var(--sheet)", border: "1px solid var(--line-strong)", borderRadius: 12, padding: 20 };
const labelStyle: CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 7 };
const inputStyle: CSSProperties = { width: "100%", minHeight: 48, padding: "10px 12px", borderRadius: 7, border: "1px solid var(--line-strong)", background: "var(--wash)", color: "var(--ink)", fontSize: 16, boxSizing: "border-box" };
const optionStyle: CSSProperties = { display: "block", width: "100%", minHeight: 48, border: 0, borderBottom: "1px solid var(--line)", borderRadius: 6, textAlign: "left", padding: "12px 9px", cursor: "pointer", color: "var(--ink)", fontSize: 14 };
const primaryButtonStyle: CSSProperties = { minHeight: 48, maxWidth: "100%", whiteSpace: "normal", border: "1px solid #dfba35", borderRadius: 7, padding: "11px 16px", color: "#24210f", background: "var(--acid)", fontWeight: 700, cursor: "pointer" };
const secondaryButtonStyle: CSSProperties = { minHeight: 48, maxWidth: "100%", whiteSpace: "normal", border: "1px solid var(--line-strong)", borderRadius: 7, padding: "10px 14px", color: "var(--ink)", background: "var(--wash)", fontWeight: 700, cursor: "pointer" };
const smallNoteStyle: CSSProperties = { fontSize: 13, color: "var(--muted)", lineHeight: 1.5 };
const alertStyle: CSSProperties = { padding: "12px 14px", borderRadius: 8, lineHeight: 1.45 };
