"use client";

import { useEffect, useState } from "react";
import styles from "./ImportClient.module.css";
import { useDialogFocus } from "../ui/useDialogFocus";

type Campaign = { id: string; name: string; status: string | null };
type PreviewRow = {
  rowNumber: number;
  company: string;
  summary: string;
  domain: string;
  location: string;
  sector: string;
  buyerName: string;
  buyerTitle: string;
  email: string;
  phone: string;
  source: string;
  notes: string;
  state: "ready" | "existing" | "duplicate" | "invalid";
  reason: string;
};
type Preview = {
  campaign: Campaign;
  mapping: Record<string, string>;
  ignoredHeaders: string[];
  totalRows: number;
  readyRows: number;
  existingRows: number;
  updatedRows: number;
  duplicateRows: number;
  invalidRows: number;
  previewRows: PreviewRow[];
};
type ImportResult = { added: number; updated: number; skipped: number; totalRows: number; campaign: Campaign };

const STATE_STYLES: Record<PreviewRow["state"], string> = {
  ready: styles.ready,
  existing: styles.existing,
  duplicate: styles.duplicate,
  invalid: styles.invalid,
};

const STATE_LABELS: Record<PreviewRow["state"], string> = {
  ready: "Ready to add",
  existing: "Will update",
  duplicate: "Duplicate",
  invalid: "Invalid",
};

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCampaign(value: unknown): value is Campaign {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string" &&
    (value.status === null || typeof value.status === "string");
}

function isPreviewRow(value: unknown): value is PreviewRow {
  if (!isRecord(value)) return false;
  const stringFields = ["company", "summary", "domain", "location", "sector", "buyerName", "buyerTitle", "email", "phone", "source", "notes", "reason"];
  return typeof value.rowNumber === "number" && stringFields.every((field) => typeof value[field] === "string") &&
    ["ready", "existing", "duplicate", "invalid"].includes(String(value.state));
}

function isPreview(value: unknown): value is Preview {
  if (!isRecord(value) || !isCampaign(value.campaign) || !isRecord(value.mapping)) return false;
  return ["totalRows", "readyRows", "existingRows", "updatedRows", "duplicateRows", "invalidRows"].every((field) => typeof value[field] === "number") &&
    Array.isArray(value.ignoredHeaders) && value.ignoredHeaders.every((header) => typeof header === "string") &&
    Object.values(value.mapping).every((header) => typeof header === "string") &&
    Array.isArray(value.previewRows) && value.previewRows.every(isPreviewRow);
}

function isImportResult(value: unknown): value is ImportResult {
  return isRecord(value) && typeof value.added === "number" && typeof value.updated === "number" && typeof value.skipped === "number" &&
    typeof value.totalRows === "number" && isCampaign(value.campaign);
}

function responseError(payload: unknown, fallback: string) {
  return isRecord(payload) && typeof payload.error === "string" ? payload.error : fallback;
}

function withNextStep(message: string, step: string) {
  return `${message} ${step}`;
}

export default function ImportClient() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [csvText, setCsvText] = useState("");
  const [xlsxFile, setXlsxFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [readingFile, setReadingFile] = useState(false);
  const sourceBusy = loadingCampaigns || readingFile || previewing || importing || confirming;

  useDialogFocus(confirming, importing, () => setConfirming(false));

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/import", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error(responseError(payload, "Campaigns could not be loaded."));
        if (!isRecord(payload) || !Array.isArray(payload.campaigns) || !payload.campaigns.every(isCampaign)) {
          throw new Error("Campaign service returned an unexpected response.");
        }
        return payload.campaigns;
      })
      .then((items) => setCampaigns(items))
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(withNextStep(caught instanceof Error ? caught.message : "Campaigns could not be loaded.", "Refresh the page and try again."));
      })
      .finally(() => setLoadingCampaigns(false));
    return () => controller.abort();
  }, []);

  function changeCsv(value: string) {
    setCsvText(value);
    setXlsxFile(null);
    setPreview(null);
    setResult(null);
    setConfirming(false);
    setError("");
  }

  async function loadImportFile(file: File | undefined) {
    if (!file || sourceBusy) return;
    const extension = file.name.toLowerCase().split(".").pop();
    if (extension !== "csv" && extension !== "xlsx") {
      changeCsv("");
      setError("Choose a .csv or .xlsx file, then preview it.");
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      changeCsv("");
      setError("File is over 2 MB. Choose a smaller file, then preview it.");
      return;
    }
    if (extension === "xlsx") {
      setCsvText("");
      setXlsxFile(file);
      setPreview(null);
      setResult(null);
      setConfirming(false);
      setError("");
      return;
    }
    setReadingFile(true);
    setPreview(null);
    try {
      changeCsv(await file.text());
    } catch {
      changeCsv("");
      setError("This CSV file could not be read. Choose another file or paste its contents.");
    } finally {
      setReadingFile(false);
    }
  }

  function requestBody(action: "preview" | "import", confirmed = false): { body: BodyInit; headers?: HeadersInit } {
    if (xlsxFile) {
      const body = new FormData();
      body.set("action", action);
      body.set("campaignId", campaignId);
      if (confirmed) body.set("confirmed", "true");
      body.set("file", xlsxFile);
      return { body };
    }
    return {
      body: JSON.stringify({ action, confirmed, campaignId, csvText }),
      headers: { "Content-Type": "application/json" },
    };
  }

  async function requestPreview() {
    if (sourceBusy) return;
    if (!campaignId) {
      setError("Choose an existing campaign, then preview the import.");
      return;
    }
    if (!xlsxFile && !csvText.trim()) {
      setError("Choose a file or paste CSV text before previewing.");
      return;
    }
    if ((xlsxFile?.size ?? new TextEncoder().encode(csvText).length) > MAX_IMPORT_BYTES) {
      setError("Import is over 2 MB. Choose a smaller file or paste fewer rows.");
      return;
    }
    setPreviewing(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/import", {
        method: "POST",
        ...requestBody("preview"),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(responseError(payload, "Import preview failed."));
      if (!isPreview(payload)) throw new Error("Import service returned an unexpected preview.");
      setPreview(payload);
    } catch (caught) {
      setError(withNextStep(caught instanceof Error ? caught.message : "Import preview failed.", "Check the campaign and file, then preview again."));
    } finally {
      setPreviewing(false);
    }
  }

  function confirmLabel(next: Preview) {
    const parts: string[] = [];
    if (next.readyRows > 0) parts.push(`${next.readyRows} new`);
    if (next.updatedRows > 0) parts.push(`${next.updatedRows} updated`);
    return parts.length ? parts.join(" and ") : "nothing";
  }

  function dialogTitle(next: Preview) {
    if (next.readyRows > 0 && next.updatedRows > 0) {
      return `Add ${next.readyRows} and update ${next.updatedRows}?`;
    }
    if (next.updatedRows > 0) {
      return `Update ${next.updatedRows} existing ${next.updatedRows === 1 ? "record" : "records"}?`;
    }
    return `Insert ${next.readyRows} ${next.readyRows === 1 ? "record" : "records"}?`;
  }

  async function confirmImport() {
    if (!preview || (preview.readyRows === 0 && preview.updatedRows === 0) || !campaignId || importing) return;
    setImporting(true);
    setError("");
    try {
      const response = await fetch("/api/import", {
        method: "POST",
        ...requestBody("import", true),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(responseError(payload, "Import failed."));
      if (!isImportResult(payload)) throw new Error("Import service returned an unexpected result.");
      setResult(payload);
      setPreview(null);
      setConfirming(false);
    } catch (caught) {
      setError(withNextStep(caught instanceof Error ? caught.message : "Import failed.", "Review the preview and try confirming again."));
      setConfirming(false);
    } finally {
      setImporting(false);
    }
  }

  return (
    <main className={styles.page}>
      <h1 className="sr-only">Import prospects</h1>
      <header className={styles.heading}>
        <div>
          <a className={styles.back} href="/#prospects">← Prospects</a>
        </div>
      </header>

      <p className={styles.safetyNote} role="note">
        Only mapped values are imported. New prospects need review; nothing is sent.
      </p>

      <section className={styles.importPanel} aria-labelledby="import-source-title">
        <div className={styles.sectionHead}>
          <h2 id="import-source-title">Choose a campaign and file</h2>
        </div>
        <label className={styles.field}>
          Existing campaign
          <select aria-label="Existing campaign" value={campaignId} onChange={(event) => { setCampaignId(event.target.value); setPreview(null); setResult(null); }} disabled={sourceBusy}>
            <option value="">{loadingCampaigns ? "Loading campaigns…" : "Choose a campaign"}</option>
            {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name} · {campaign.status || "Unspecified"}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          Upload CSV or XLSX file <span className={styles.fieldHint}>Maximum 2 MB · XLSX reads the first worksheet</span>
          <input type="file" disabled={sourceBusy} accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void loadImportFile(event.target.files?.[0])} />
        </label>
        <details>
          <summary>Or paste CSV text</summary>
          <label className={styles.field}>
            CSV rows
            <textarea disabled={sourceBusy} value={csvText} onChange={(event) => changeCsv(event.target.value)} rows={6} placeholder={'company_name,location,industry,email\nAcme,San Francisco,Software,contact@example.com'} spellCheck={false} />
          </label>
        </details>
        <div className={styles.sourceFooter}>
          <span>{xlsxFile ? `${xlsxFile.name} · ${xlsxFile.size.toLocaleString()} bytes · up to 5,000 rows` : csvText ? `${new TextEncoder().encode(csvText).length.toLocaleString()} bytes · up to 5,000 rows` : "Known headers are matched by alias; unknown columns are ignored."}</span>
          <button type="button" className={styles.primaryButton} onClick={() => void requestPreview()} disabled={sourceBusy || !campaignId || (!xlsxFile && !csvText.trim())}>{readingFile ? "Reading file…" : previewing ? "Preparing preview…" : "Preview import"}</button>
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {result && <p className={styles.success} role="status">Added {result.added}; updated {result.updated}; skipped {result.skipped}; campaign: {result.campaign.name}. New rows need review; no email was sent.</p>}
      </section>

      {preview && <section className={styles.importPanel} aria-labelledby="preview-title">
        <div className={styles.sectionHead}>
          <span className={styles.eyebrow}>02 / Review before import</span>
          <h2 id="preview-title">Preview for {preview.campaign.name}</h2>
        </div>
        <div className={styles.counts} style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
          <div><strong>{preview.readyRows}</strong><span>will be added</span></div><div><strong>{preview.updatedRows}</strong><span>will be updated</span></div>
          <div><details><summary>Other rows: {preview.duplicateRows + preview.invalidRows}</summary>
            <span>{preview.duplicateRows} repeated in file · {preview.invalidRows} invalid</span>
          </details></div>
        </div>
        <div className={styles.mappings}>
          <strong>Column mapping</strong>
          <div>{Object.entries(preview.mapping).map(([field, header]) => <span key={field}>{field.replaceAll("_", " ")} ← <b>{header}</b></span>)}</div>
          {preview.ignoredHeaders.length > 0 && <small>Ignored columns: {preview.ignoredHeaders.join(", ")}</small>}
          <details><summary>Import rules</summary>
            <small>Values are used only from the mapped columns. No email, name, or phone is inferred. Existing prospects are updated in place; empty file cells leave stored values untouched.</small>
            {xlsxFile && <small>Spreadsheet formulas are not calculated. Review the displayed values before confirming.</small>}
          </details>
        </div>
        <div className={styles.tableScroll}>
          <table>
            <thead><tr><th>File row</th><th>Company</th><th>Email from file</th><th>Contact name</th><th>Phone from file</th><th>Import state</th></tr></thead>
            <tbody>{preview.previewRows.map((row) => <tr key={row.rowNumber}>
              <td data-label="Row">{row.rowNumber}</td><td data-label="Company" className={styles.companyCell}>{row.company || "—"}</td><td data-label="Email">{row.email || "—"}</td><td data-label="Contact">{row.buyerName || "—"}</td><td data-label="Phone">{row.phone || "—"}</td>
              <td data-label="Status"><span className={`${styles.state} ${STATE_STYLES[row.state]}`}>{STATE_LABELS[row.state]}</span>{row.reason && <small className={styles.reason}>{row.reason}</small>}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {preview.totalRows > preview.previewRows.length && <p className={styles.previewLimit}>Showing the first {preview.previewRows.length} of {preview.totalRows.toLocaleString()} rows. Counts above cover the full file.</p>}
        <div className={styles.confirmBar}>
          <span>Import rechecks for existing companies inside one database transaction. Existing records are updated in place, without touching their pipeline stage or identity.</span>
          <button type="button" className={styles.primaryButton} onClick={() => setConfirming(true)} disabled={(preview.readyRows === 0 && preview.updatedRows === 0) || sourceBusy}>Confirm {confirmLabel(preview)}</button>
        </div>
      </section>}

      {confirming && preview && <div className={styles.modalBackdrop} role="presentation">
        <section className={styles.confirmDialog} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description">
          <span className={styles.eyebrow}>Final check</span>
          <h2 id="confirm-title">{dialogTitle(preview)}</h2>
          <p id="confirm-description">This adds new company records and updates existing ones in {preview.campaign.name}. New rows will be Ready to Review. Existing rows keep their stage and identity, and empty file cells do not erase stored values. Contact values come only from mapped file columns; no email is generated, checked, or sent.</p>
          <div className={styles.dialogActions}>
            <button type="button" onClick={() => setConfirming(false)} disabled={importing}>Go back</button>
            <button type="button" className={styles.primaryButton} onClick={() => void confirmImport()} disabled={importing}>{importing ? "Importing…" : "Confirm import"}</button>
          </div>
        </section>
      </div>}
    </main>
  );
}
