"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { canScanInboundMailbox, formatInboundScanSummary } from "@/lib/inbound-scan";
import styles from "./Mailboxes.module.css";
import RefreshIcon from "@/app/ui/RefreshIcon";
import MailboxActionIcon from "@/app/ui/MailboxActionIcon";
import { mailboxCapacity } from "@/lib/mailbox-capacity";
import type { MailboxPacingCapacity } from "@/lib/mailbox-capacity";

type Mailbox = {
  id: number;
  email: string;
  senderName: string;
  smtpServer: string;
  smtpPort: number;
  dailyLimit: number;
  hourlyLimit: number;
  manualLimits: boolean;
  providerType: string;
  status: string;
  cooldownUntil: string | null;
  sendsToday: number;
  sendsThisHour: number;
  sendsSinceMidnight: number;
  quotaWindowStart: string | null;
  credentialConfigured: boolean;
  health: string;
};
type Suppression = { email: string; reason: string; createdAt: string | null };
type InboundScanResult = {
  status: "SUCCESS"; messages_checked: number; replies_processed: number; bounces_processed: number;
  opt_outs_processed: number; unrelated: number; already_processed: number; oversized_skipped: number;
};
type MailboxForm = {
  email: string; senderName: string; smtpServer: string; smtpPort: string;
  smtpUser: string; smtpPassword: string; dailyLimit: string; hourlyLimit: string; providerType: string;
  manualLimits: boolean;
};

const EMPTY_FORM: MailboxForm = {
  email: "", senderName: "Bryan @ Outbounder", smtpServer: "smtp.office365.com", smtpPort: "587",
  smtpUser: "", smtpPassword: "", dailyLimit: "50", hourlyLimit: "10", providerType: "MICROSOFT",
  manualLimits: true,
};

function healthClass(status: string) {
  if (status === "Available") return styles.good;
  if (status === "Error" || status === "Credential missing") return styles.bad;
  if (status === "At quota" || status === "Cooling down") return styles.warn;
  return "";
}

export default function MailboxesClient() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [suppressions, setSuppressions] = useState<Suppression[]>([]);
  const [capacities, setCapacities] = useState<MailboxPacingCapacity[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState<MailboxForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [suppressionEmail, setSuppressionEmail] = useState("");
  const [suppressionReason, setSuppressionReason] = useState("");
  const [inboundScanningId, setInboundScanningId] = useState<number | null>(null);
  const refreshRequest = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++refreshRequest.current;
    setLoading(true);
    setError("");
    try {
      const [response, pacing] = await Promise.all([
        fetch("/api/mailboxes", { cache: "no-store" }),
        fetch("/api/dispatch?mailboxPacing=1", { cache: "no-store", signal: AbortSignal.timeout(4000) })
          .then(async (result) => result.ok ? (await result.json() as { mailboxes?: MailboxPacingCapacity[] }).mailboxes || [] : [])
          .catch(() => [] as MailboxPacingCapacity[]),
      ]);
      const payload = await response.json() as { mailboxes?: Mailbox[]; suppressions?: Suppression[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Mailbox settings could not be loaded.");
      if (request !== refreshRequest.current) return;
      setMailboxes(payload.mailboxes || []);
      setSuppressions(payload.suppressions || []);
      setCapacities(pacing);
    } catch (cause) {
      if (request === refreshRequest.current) setError(cause instanceof Error ? cause.message : "Mailbox settings could not be loaded.");
    } finally {
      if (request === refreshRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function mutate(action: string, payload: Record<string, unknown>, confirmation: string): Promise<Record<string, unknown> | null> {
    if (!window.confirm(confirmation)) return null;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/mailboxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload, confirmed: true }),
      });
      const result = await response.json() as { error?: string; [key: string]: unknown };
      if (!response.ok) throw new Error(result.error || "Change could not be saved.");
      setNotice(action === "suppress" && result.added === false
        ? "That address was already on the suppression list."
        : action === "activate" ? "Sender enabled. An active queue can now use it."
        : action === "pause" ? "Sender paused. A message already in flight may finish."
        : action === "delete" ? "Local sender settings deleted. Send history is retained."
        : action === "reset-quota" ? "Daily send counter reset. Send history and lifetime totals are unchanged."
        : "Saved to the local suppression list. No email was sent.");
      await refresh();
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Change could not be saved.");
      return null;
    } finally {
      setSaving(false);
    }
  }

  function beginAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
    setAdvancedOpen(true);
    setNotice("");
  }

  function beginEdit(mailbox: Mailbox) {
    setEditingId(mailbox.id);
    setForm({
      email: mailbox.email, senderName: mailbox.senderName, smtpServer: mailbox.smtpServer,
      smtpPort: String(mailbox.smtpPort), smtpUser: "", smtpPassword: "",
      dailyLimit: String(mailbox.dailyLimit), hourlyLimit: String(mailbox.hourlyLimit), providerType: mailbox.providerType,
      manualLimits: mailbox.manualLimits,
    });
    setFormOpen(true);
    setAdvancedOpen(false);
    setError("");
    setNotice("");
  }

  async function saveMailbox(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const editing = editingId !== null;
    const mailbox = {
      ...form,
      smtpPort: Number(form.smtpPort),
      dailyLimit: Number(form.dailyLimit),
      hourlyLimit: Number(form.hourlyLimit),
      ...(editing && !form.smtpPassword ? {} : { smtpPassword: form.smtpPassword }),
    };
    const accepted = window.confirm(editing
      ? `Save settings for ${form.email}? The current SMTP password is kept unless you enter a replacement.`
      : `Add ${form.email} as a paused mailbox? Its SMTP password will be stored in the local database. No connection test will run.`);
    if (!accepted) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/mailboxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: editing ? "update" : "create", id: editingId, mailbox, confirmed: true }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Mailbox could not be saved.");
      setFormOpen(false);
      setForm(EMPTY_FORM);
      setEditingId(null);
      setNotice(editing ? "Mailbox settings updated." : "Mailbox added paused. Activate it only after you are ready to use it.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mailbox could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function addSuppression(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await mutate("suppress", { suppression: { email: suppressionEmail, reason: suppressionReason } },
      `Add ${suppressionEmail} to the permanent suppression list?`);
    if (!result) return;
    setSuppressionEmail("");
    setSuppressionReason("");
  }

  async function scanInbound(mailbox: Mailbox) {
    const provider = mailbox.providerType.toUpperCase();
    if (provider !== "MICROSOFT" && provider !== "GOOGLE") {
      setError("Inbound scan supports Microsoft and Google mailboxes only.");
      return;
    }
    if (!mailbox.credentialConfigured) {
      setError("Add a mailbox login credential before running an inbound scan.");
      return;
    }
    const confirmed = window.confirm(
      `Run a read-only IMAP scan of up to 15 recent messages for ${mailbox.email}? This will leave message read/unread state unchanged and update only local reply, bounce, and opt-out records. It cannot send email or change live dispatch.`,
    );
    if (!confirmed) return;
    setInboundScanningId(mailbox.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/inbound-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mailboxId: mailbox.id, maxMessages: 15, confirmed: true }),
      });
      const payload = await response.json() as InboundScanResult & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Inbound scan could not be completed.");
      setNotice(formatInboundScanSummary(payload));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Inbound scan could not be completed.");
    } finally {
      setInboundScanningId(null);
    }
  }

  return <main className={styles.page}>
    <h1 className="sr-only">Senders</h1>
    <div className={styles.content}>
      <header className={styles.heading}>
        <div className={styles.actions}><a className={styles.secondary} href="/#settings">Settings</a><button className={styles.primary} type="button" disabled={saving} onClick={beginAdd}>Add sender</button></div>
      </header>

      {error && <div role="alert" className={styles.error}>{error}</div>}
      {notice && <div role="status" className={styles.notice}>{notice}</div>}

      {formOpen && <section className={styles.formPanel} aria-labelledby="mailbox-form-title">
        <div className={styles.panelHeading}><div><span className={styles.eyebrow}>{editingId === null ? "New sender" : `Mailbox ${editingId}`}</span><h2 id="mailbox-form-title">{editingId === null ? "Add a mailbox" : "Edit mailbox"}</h2></div><button className={styles.textButton} type="button" disabled={saving} onClick={() => setFormOpen(false)}>Close</button></div>
        <form className={styles.form} onSubmit={(event) => void saveMailbox(event)} onInvalidCapture={(event) => {
          const details = (event.target as HTMLElement).closest("details");
          if (details) { details.open = true; setAdvancedOpen(true); }
        }}>
          <label>Email address<input type="email" required disabled={saving} maxLength={254} autoComplete="off" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
          <label>Sender name<input required disabled={saving} maxLength={160} value={form.senderName} onChange={(event) => setForm({ ...form, senderName: event.target.value })} /></label>
          <details className={styles.advanced} open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
            <summary>Connection and sending limits</summary>
            <div className={styles.advancedFields}>
          <label>SMTP server<input required disabled={saving} maxLength={253} autoComplete="off" value={form.smtpServer} onChange={(event) => setForm({ ...form, smtpServer: event.target.value })} /></label>
          <label>SMTP port<input type="number" required disabled={saving} min={1} max={65535} step={1} value={form.smtpPort} onChange={(event) => setForm({ ...form, smtpPort: event.target.value })} /></label>
          <label>SMTP username<input disabled={saving} required={editingId === null} maxLength={254} autoComplete="off" placeholder={editingId === null ? "Required" : "Leave blank to keep current username"} value={form.smtpUser} onChange={(event) => setForm({ ...form, smtpUser: event.target.value })} /></label>
          <label>SMTP password<input type="password" disabled={saving} required={editingId === null} maxLength={1000} autoComplete="new-password" placeholder={editingId === null ? "Required" : "Leave blank to keep current password"} value={form.smtpPassword} onChange={(event) => setForm({ ...form, smtpPassword: event.target.value })} /></label>
          <label>Provider<select aria-label="Provider" disabled={saving} value={form.providerType} onChange={(event) => setForm({ ...form, providerType: event.target.value })}><option value="MICROSOFT">Microsoft</option><option value="GOOGLE">Google</option><option value="ANY">Any</option><option value="OTHER">Other</option></select></label>
          <label>Daily quota<input type="number" required disabled={saving} min={1} step={1} value={form.dailyLimit} onChange={(event) => setForm({ ...form, dailyLimit: event.target.value, manualLimits: true })} /></label>
          <label>Hourly quota<input type="number" required disabled={saving} min={1} step={1} value={form.hourlyLimit} onChange={(event) => setForm({ ...form, hourlyLimit: event.target.value, manualLimits: true })} /></label>
          <label className="warmup-choice"><input type="checkbox" disabled={saving} checked={!form.manualLimits} onChange={(event) => setForm({ ...form, manualLimits: !event.target.checked })} />Use recommended warmup caps</label>
            </div>
          </details>
          <p className={styles.formNote}>Your quotas apply when warmup caps are off. Provider throttling still applies. Changing quotas updates the active run; new senders are saved paused.</p>
          <div className={styles.formActions}><button className={styles.secondary} type="button" disabled={saving} onClick={() => setFormOpen(false)}>Cancel</button><button className={styles.primary} type="submit" disabled={saving}>{saving ? "Saving…" : editingId === null ? "Add paused mailbox" : "Save changes"}</button></div>
        </form>
      </section>}

      <div className={styles.columns}>
        <section className={styles.panel} aria-labelledby="pool-title">
          <div className={styles.panelHeading}><div><span className={styles.eyebrow}>Sender pool</span><h2 id="pool-title">Mailboxes</h2></div><button type="button" aria-label="Refresh mailboxes" title="Refresh mailboxes" aria-busy={loading} className={`${styles.textButton} icon-action`} onClick={() => void refresh()} disabled={loading}><RefreshIcon /></button></div>
          {loading && mailboxes.length === 0 ? <div className={styles.empty}>Loading local mailbox records…</div> : mailboxes.length === 0 ? <div className={styles.empty}>{error ? "Sender records unavailable. Use refresh to retry." : "No mailboxes are configured."}</div> :
            <div className={styles.mailboxes}>{mailboxes.map((mailbox) => {
              const capacity = mailboxCapacity(mailbox, capacities.find((item) => item.mailboxId === mailbox.id));
              return <article className={styles.mailbox} key={mailbox.id}>
              <div className={styles.mailboxHead}><div><strong>{mailbox.email}</strong><small>{mailbox.senderName} · {mailbox.providerType}</small></div><span className={`${styles.health} ${healthClass(capacity.health)}`}>{capacity.health}</span></div>
              <div className={styles.host}>{mailbox.smtpServer}:{mailbox.smtpPort} · {mailbox.credentialConfigured ? "Credential saved" : "Credential missing"}</div>
              <div className={styles.quota}><div><span>Today</span><strong>{mailbox.sendsToday} / {capacity.dailyLimit ?? "—"}</strong></div><div className={styles.track}><i style={{ width: `${Math.min(100, capacity.dailyLimit ? mailbox.sendsToday / capacity.dailyLimit * 100 : 0)}%` }} /></div><div><span>Last hour</span><strong>{mailbox.sendsThisHour} / {capacity.hourlyLimit ?? "—"}</strong></div></div>
                {mailbox.quotaWindowStart && <p className={styles.quotaNote}>Counter reset {mailbox.quotaWindowStart}. {mailbox.sendsSinceMidnight} actually sent today.</p>}
              {!mailbox.manualLimits && <p className={styles.quotaNote}>Warmup on · configured {mailbox.dailyLimit}/day, {mailbox.hourlyLimit}/hour{capacity.dailyLimit === null ? " · Effective limits unavailable" : ""}</p>}
              <div className={styles.mailboxFoot}><span className={styles.status} title={mailbox.status === "ERROR" ? "Authentication failed. This mailbox cannot send until you update its credentials." : undefined}>{mailbox.status === "ERROR" ? "Login failed · update credentials" : mailbox.status}{mailbox.cooldownUntil ? ` · until ${mailbox.cooldownUntil}` : ""}</span><div className={styles.rowActions}>
                <button className="icon-action" type="button" aria-label={`Scan inbound for ${mailbox.email}`} title={`Scan inbound for ${mailbox.email}`} onClick={() => void scanInbound(mailbox)} disabled={inboundScanningId !== null || saving || !canScanInboundMailbox(mailbox.providerType, mailbox.credentialConfigured)}><MailboxActionIcon action="scan" /></button>
                <button className="icon-action" type="button" aria-label={`Reset daily send count for ${mailbox.email}`} title={`Reset daily send count for ${mailbox.email}`} onClick={() => void mutate("reset-quota", { id: mailbox.id }, `Start a fresh daily send window for ${mailbox.email}?\n\n${mailbox.sendsToday} of today's ${capacity.dailyLimit ?? "?"} allowance is used. The counter returns to 0 and an active queue can send again immediately.\n\nNothing is deleted: all ${mailbox.sendsSinceMidnight} sends from today still count toward lifetime totals, bounces and deliverability. The per-hour limit still applies.`)} disabled={saving}><MailboxActionIcon action="reset" /></button>
                <button className="icon-action" type="button" aria-label={`Edit ${mailbox.email}`} title={`Edit ${mailbox.email}`} onClick={() => beginEdit(mailbox)} disabled={saving}><MailboxActionIcon action="edit" /></button>
                {mailbox.status === "PAUSED" ? <button className="icon-action" type="button" aria-label={`Activate ${mailbox.email}`} title={`Activate ${mailbox.email}`} onClick={() => void mutate("activate", { id: mailbox.id }, `Activate ${mailbox.email}? An active live queue may use this sender immediately.`)} disabled={saving}><MailboxActionIcon action="activate" /></button> : <button className="icon-action" type="button" aria-label={`Pause ${mailbox.email}`} title={`Pause ${mailbox.email}`} onClick={() => void mutate("pause", { id: mailbox.id }, `Pause ${mailbox.email}? It will be excluded from new sender selections; a message already in flight may finish.`)} disabled={saving}><MailboxActionIcon action="pause" /></button>}
                <button aria-label={`Delete ${mailbox.email}`} title={`Delete ${mailbox.email}`} className={`${styles.dangerText} icon-action`} type="button" onClick={() => void mutate("delete", { id: mailbox.id }, `Permanently delete the local mailbox settings for ${mailbox.email}?`)} disabled={saving}><MailboxActionIcon action="delete" /></button>
              </div></div>
            </article>; })}</div>}
          <p className={styles.privacyNote}>SMTP passwords are never returned by the API. Quotas use local send history. The manual inbound scan uses read-only IMAP for Microsoft or Google only, leaves messages unread, and never sends or queues mail.</p>
        </section>

        <section className={styles.panel} aria-labelledby="suppression-title">
          <div className={styles.panelHeading}><div><span className={styles.eyebrow}>Do not contact</span><h2 id="suppression-title">Suppression list</h2></div><span className={styles.count}>{suppressions.length.toLocaleString()}</span></div>
          <form className={styles.suppressionForm} onSubmit={(event) => void addSuppression(event)}>
            <label>Email to suppress<input type="email" required maxLength={254} value={suppressionEmail} onChange={(event) => setSuppressionEmail(event.target.value)} /></label>
            <label>Reason<input required maxLength={500} value={suppressionReason} onChange={(event) => setSuppressionReason(event.target.value)} placeholder="Opt-out, bounce, manual request…" /></label>
            <button className={styles.primary} type="submit" disabled={saving}>Add to suppression list</button>
          </form>
          {suppressions.length === 0 ? <div className={styles.empty}>No suppressed addresses are registered.</div> : <div className={styles.suppressionList}>
            {suppressions.map((item) => <article className={styles.suppression} key={`${item.email}-${item.createdAt}`}><strong>{item.email}</strong><span>{item.reason}</span><small>{item.createdAt || "Date not recorded"}</small></article>)}
          </div>}
          <p className={styles.privacyNote}>Adding an address is permanent in the local suppression list. No email or external lookup is triggered.</p>
        </section>
      </div>
    </div>
  </main>;
}
