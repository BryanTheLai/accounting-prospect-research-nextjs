"use client";

import { useCallback, useEffect, useState } from "react";
import type { ActivityReport } from "@/lib/activity";
import styles from "./Activity.module.css";
import ActivityLineChart from "./ActivityLineChart";
import RefreshIcon from "@/app/ui/RefreshIcon";

function formatTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function ActivityClient() {
  const [report, setReport] = useState<ActivityReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/activity", { cache: "no-store" });
      const payload = await response.json() as ActivityReport | { error?: string };
      if (!response.ok) throw new Error("error" in payload ? payload.error || "Activity could not be loaded." : "Activity could not be loaded.");
      setReport(payload as ActivityReport);
      setUpdatedAt(new Date().toLocaleTimeString());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Activity could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return <main className={styles.page}>
    <h1 className="sr-only">Email activity</h1>
    <div className={styles.content}>
      <header className={styles.heading}>
        <div className={styles.headingActions}>
          <button type="button" aria-label="Refresh activity report" title={updatedAt ? `Refresh activity report · updated ${updatedAt}` : "Refresh activity report"} aria-busy={loading} className={styles.refresh} onClick={() => void refresh()} disabled={loading}>
            <RefreshIcon />
          </button>
        </div>
      </header>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {!report && loading && <div className={styles.empty}>Loading activity from the local database…</div>}
      {!report && error && <div className={styles.empty}>The report is unavailable. Refresh to try again.</div>}

      {report && <>
        <ActivityLineChart daily={report.daily} />

        <section className={styles.panel}>
          <div className={styles.sectionHeading}>
            <h2>Recent events</h2>
            <span className={styles.sectionNote}>Latest {report.recentEvents.length} · maximum 100</span>
          </div>
          {report.recentEvents.length === 0 ? <div className={styles.empty}>No outbound events recorded.</div> :
            <div className={styles.tableWrap}>
              <table className={styles.eventTable}>
                <thead><tr><th>Time</th><th>Company</th><th>Subject</th><th>Variant</th><th>Event</th></tr></thead>
                <tbody>{report.recentEvents.map((event, index) => <tr key={`${event.sentAt || "unknown"}-${index}`}>
                  <td data-label="Time" className={styles.timeCell}>{formatTime(event.sentAt)}</td>
                  <td data-label="Company" className={styles.companyCell}>{event.company || "—"}</td>
                  <td data-label="Subject" className={styles.subjectCell}>{event.subject || "—"}</td>
                  <td data-label="Variant">{event.variant || "—"}</td>
                   <td data-label="Event"><span className={`${styles.badge} ${event.dryRun ? styles.badgeDry : event.status === "SENT" ? styles.badgeSent : event.status === "BOUNCED" ? styles.badgeBounced : styles.badgeNeutral}`}>
                     {event.dryRun ? "Dry run" : event.status === "SENT" ? "SMTP accepted" : event.status}
                  </span></td>
                </tr>)}</tbody>
              </table>
            </div>}
          <div className={styles.privacyNote}>Recipient and sender addresses are omitted from this report.</div>
        </section>

          <section className={styles.panel}>
            <div className={styles.sectionHeading}>
              <div><span className={styles.eyebrow}>Suppression</span><h2>Do-not-contact count</h2></div>
            </div>
            <div className={styles.suppressionCount}>{report.suppressionCount.toLocaleString()}</div>
            <p className={styles.suppressionCopy}>Addresses on the local suppression list. The list itself is not exposed here.</p>
            <details><summary>All recorded statuses</summary><ul className={styles.statusList}>{report.statusBreakdown.map((item) => <li key={item.status}><span>{item.status}</span><strong>{item.count.toLocaleString()}</strong></li>)}</ul>
            {report.counts.other > 0 && <p className={styles.suppressionCopy}>{report.counts.other.toLocaleString()} events use other statuses.</p>}</details>
          </section>
        <footer className={styles.footer}>Read-only view. This page does not change campaign, mailbox, or suppression data.</footer>
      </>}
    </div>
  </main>;
}
