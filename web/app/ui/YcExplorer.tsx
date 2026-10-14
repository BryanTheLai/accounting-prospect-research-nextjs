"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDialogFocus } from "./useDialogFocus";
import { Disclosure } from "./Disclosure";
import styles from "./YcExplorer.module.css";

type YcRow = {
  id: number;
  name: string;
  slug: string;
  website: string | null;
  rootDomain: string | null;
  batch: string;
  batchYear: number | null;
  status: string | null;
  stage: string | null;
  topCompany: number;
  isHiring: number;
  teamSize: number;
  industry: string | null;
  location: string | null;
  oneLiner: string | null;
  ycUrl: string | null;
};

type DirectoryResponse = {
  rows: YcRow[];
  total: number;
  batches: string[];
  industries: string[];
  hasMore: boolean;
};

type Filters = {
  q: string;
  batch: string;
  industry: string;
  minTeam: string;
  topOnly: boolean;
  hiringOnly: boolean;
};

type ImportResult = { added: number; skipped: number; selected: number };

const PAGE_SIZE = 50;
const MAX_SELECTED = 200;
const DEFAULT_FILTERS: Filters = {
  q: "",
  batch: "",
  industry: "",
  minTeam: "0",
  topOnly: false,
  hiringOnly: false,
};

function filtersToQuery(filters: Filters) {
  const params = new URLSearchParams({
    q: filters.q,
    batch: filters.batch,
    industry: filters.industry,
    minTeam: filters.minTeam || "0",
    topOnly: String(filters.topOnly),
    hiringOnly: String(filters.hiringOnly),
    limit: String(PAGE_SIZE),
  });
  return params;
}

function companyWebsite(row: YcRow) {
  if (!row.website) return null;
  const candidate = /^https?:\/\//i.test(row.website) ? row.website : `https://${row.website}`;
  return safeExternalUrl(candidate);
}

function safeExternalUrl(value: string | null) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isYcRow(value: unknown): value is YcRow {
  if (!isRecord(value)) return false;
  const nullableString = (field: unknown) => field === null || typeof field === "string";
  const nullableNumber = (field: unknown) => field === null || typeof field === "number";
  return typeof value.id === "number" && typeof value.name === "string" &&
    typeof value.slug === "string" && typeof value.batch === "string" &&
    typeof value.topCompany === "number" && typeof value.isHiring === "number" &&
    typeof value.teamSize === "number" && nullableString(value.website) &&
    nullableString(value.rootDomain) && nullableNumber(value.batchYear) &&
    nullableString(value.status) && nullableString(value.stage) &&
    nullableString(value.industry) && nullableString(value.location) &&
    nullableString(value.oneLiner) && nullableString(value.ycUrl);
}

function isDirectoryResponse(value: unknown): value is DirectoryResponse {
  if (!isRecord(value)) return false;
  return Array.isArray(value.rows) && value.rows.every(isYcRow) &&
    typeof value.total === "number" && Array.isArray(value.batches) &&
    value.batches.every((batch) => typeof batch === "string") &&
    Array.isArray(value.industries) && value.industries.every((industry) => typeof industry === "string") &&
    typeof value.hasMore === "boolean";
}

function isImportResult(value: unknown): value is ImportResult {
  return isRecord(value) && typeof value.added === "number" &&
    typeof value.skipped === "number" && typeof value.selected === "number";
}

export default function YcExplorer() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [rows, setRows] = useState<YcRow[]>([]);
  const [total, setTotal] = useState(0);
  const [batches, setBatches] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [importing, setImporting] = useState(false);

  const query = useMemo(() => filtersToQuery(filters), [filters]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (offset === 0) setLoading(true);
      else setLoadingMore(true);
      setError("");
      fetch(`/api/yc?${query}&offset=${offset}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const payload: unknown = await response.json();
          if (!response.ok) {
            const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
              ? payload.error : "The YC directory could not be loaded.";
            throw new Error(message);
          }
          if (!isDirectoryResponse(payload)) throw new Error("The YC directory returned an unexpected response.");
          return payload;
        })
        .then((data) => {
          setRows((current) => offset === 0 ? data.rows : [...current, ...data.rows]);
          setTotal(data.total);
          setBatches(data.batches);
          setIndustries(data.industries);
          setHasMore(data.hasMore);
        })
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === "AbortError") return;
          setError(caught instanceof Error ? caught.message : "The YC directory could not be loaded.");
          if (offset === 0) setRows([]);
        })
        .finally(() => {
          setLoading(false);
          setLoadingMore(false);
        });
    }, filters.q ? 180 : 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [filters.q, offset, query, reload]);

  const changeFilter = useCallback((next: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...next }));
    setOffset(0);
    setRows([]);
    setSelected(new Set());
    setNotice("");
  }, []);

  function toggleSelected(id: number, checked: boolean) {
    if (checked && !selected.has(id) && selected.size >= MAX_SELECTED) {
      setNotice(`You can add up to ${MAX_SELECTED} selected companies at a time.`);
      return;
    }
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    setSelected(next);
    setNotice("");
  }

  function selectPage() {
    const next = new Set(selected);
    const available = rows.filter((row) => row.slug && !next.has(row.id));
    for (const row of available.slice(0, Math.max(0, MAX_SELECTED - next.size))) next.add(row.id);
    setSelected(next);
    setNotice(available.length > MAX_SELECTED - selected.size
      ? `Selection is capped at ${MAX_SELECTED}; clear some checked companies to select more.`
      : "");
  }

  async function addSelected() {
    if (selected.size === 0 || importing) return;
    setImporting(true);
    setError("");
    try {
      const response = await fetch("/api/yc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected] }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
          ? payload.error : "The selected companies could not be added.";
        throw new Error(message);
      }
      if (!isImportResult(payload)) throw new Error("The import returned an unexpected response.");
      const result = payload;
      setNotice(`${result.added} added as Ready to Review; ${result.skipped} existing record${result.skipped === 1 ? "" : "s"} left unchanged. Contact emails were left blank. Nothing was sent.`);
      setSelected(new Set());
      setConfirming(false);
      setOffset(0);
      setReload((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The selected companies could not be added.");
      setConfirming(false);
    } finally {
      setImporting(false);
    }
  }

  const exportQuery = filtersToQuery(filters);
  exportQuery.set("format", "csv");
  exportQuery.delete("limit");

  useDialogFocus(confirming, importing, () => setConfirming(false));

  return (
    <main className={styles.page}>
      <h1 className="sr-only">YC directory</h1>
      <header className={styles.heading}>
        <div>
          <a className={styles.back} href="/#prospects">← Prospects</a>
        </div>
        <a className={styles.export} aria-label="Export filtered YC companies" title="Export CSV" href={`/api/yc?${exportQuery.toString()}`}><span aria-hidden="true">↓</span><span>Export</span></a>
      </header>

      <p className={styles.safetyNote} role="note">
        Import adds checked companies to the local database as <strong>Ready to Review</strong>. Email, buyer name, and phone stay blank until sourced. Import never sends email.
      </p>

        <label className={styles.search}>
          Search companies
          <input value={filters.q} onChange={(event) => changeFilter({ q: event.target.value })} placeholder="e.g. accounting, Stripe, company name" />
        </label>
      <Disclosure title={<>Directory filters{(filters.batch || filters.industry || filters.minTeam !== "0" || filters.topOnly || filters.hiringOnly) && " · active"}</>} className="yc-directory-filters"><section className={styles.filters} aria-label="Filter YC directory">

        <label>
          Batch
          <select value={filters.batch} onChange={(event) => changeFilter({ batch: event.target.value })}>
            <option value="">All batches</option>
            {batches.map((batch) => <option key={batch} value={batch}>{batch}</option>)}
          </select>
        </label>
        <label>
          Industry
          <select value={filters.industry} onChange={(event) => changeFilter({ industry: event.target.value })}>
            <option value="">All industries</option>
            {industries.map((industry) => <option key={industry} value={industry}>{industry}</option>)}
          </select>
        </label>
        <label className={styles.teamFilter}>
          Minimum team size
          <input type="number" inputMode="numeric" min="0" max="2000" value={filters.minTeam} onChange={(event) => changeFilter({ minTeam: event.target.value })} />
        </label>
         <div className={styles.signalFilters} role="group" aria-label="YC directory signals">
           <label className={styles.checkFilter}><input type="checkbox" checked={filters.topOnly} onChange={(event) => changeFilter({ topOnly: event.target.checked })} /> Top companies</label>
           <label className={styles.checkFilter}><input type="checkbox" checked={filters.hiringOnly} onChange={(event) => changeFilter({ hiringOnly: event.target.checked })} /> Actively hiring</label>
         </div>
       </section></Disclosure>

      <section className={styles.directory} aria-label="YC company results">
        <div className={styles.resultsBar}>
          <div>
            <strong>{loading && rows.length === 0 ? "Loading directory…" : `${total.toLocaleString()} matching companies`}</strong>
            <span>{rows.length.toLocaleString()} shown · {selected.size.toLocaleString()} checked</span>
          </div>
          <div className={styles.selectionActions}>
            <button type="button" onClick={selectPage} disabled={loading || rows.length === 0 || selected.size >= MAX_SELECTED}>Select shown</button>
            <button type="button" onClick={() => { setSelected(new Set()); setNotice(""); }} disabled={selected.size === 0}>Clear checked</button>
          </div>
        </div>

        {error && <p className={styles.error} role="alert">{error}</p>}
        {notice && <p className={styles.notice} role="status">{notice}</p>}

        <div className={styles.tableScroll}>
          <table>
            <thead><tr>
              <th scope="col"><span className={styles.srOnly}>Select</span></th>
              <th scope="col">Company</th><th scope="col">Batch</th><th scope="col">Team</th><th scope="col">Industry</th><th scope="col">Location</th><th scope="col">Signals</th>
            </tr></thead>
            <tbody>
              {rows.map((row) => {
                const website = companyWebsite(row);
                const profile = safeExternalUrl(row.ycUrl);
                return <tr key={row.id}>
                <td><label className={styles.rowSelect}><input aria-label={`Select ${row.name}`} type="checkbox" checked={selected.has(row.id)} disabled={!row.slug || loading || importing} onChange={(event) => toggleSelected(row.id, event.target.checked)} /></label></td>
                <td className={styles.companyCell}>
                  <strong>{row.name}</strong>
                  {row.oneLiner && <small>{row.oneLiner}</small>}
                  <span>{row.rootDomain || "No domain on file"}{website && <> · <a href={website} target="_blank" rel="noreferrer">Website</a></>}{profile && <> · <a href={profile} target="_blank" rel="noreferrer">YC profile</a></>}{!row.slug && " · Missing YC slug; cannot import"}</span>
                </td>
                <td data-label="Batch">{row.batch}</td><td data-label="Team">{row.teamSize || "—"}</td><td data-label="Industry">{row.industry || "—"}</td><td data-label="Location">{row.location || "—"}</td>
                <td data-label="Signals" className={styles.signals}>{row.topCompany === 1 && <span>Top company</span>}{row.isHiring === 1 && <span>Hiring</span>}{row.topCompany !== 1 && row.isHiring !== 1 && "—"}</td>
              </tr>;
              })}
              {!loading && rows.length === 0 && <tr><td colSpan={7} className={styles.empty}>{error ? "" : "No YC companies match these filters."}</td></tr>}
            </tbody>
          </table>
        </div>

        {hasMore && <button type="button" className={styles.more} onClick={() => setOffset(rows.length)} disabled={loadingMore}>{loadingMore ? "Loading…" : `Load next ${PAGE_SIZE}`}</button>}
        <div className={styles.footer}>
          <span>Only checked companies will be added. Existing records with the same YC lead ID are left unchanged.</span>
          <button type="button" className={styles.addButton} onClick={() => setConfirming(true)} disabled={selected.size === 0 || importing}>
            Add {selected.size} checked {selected.size === 1 ? "company" : "companies"} to Prospects
          </button>
        </div>
      </section>

      {confirming && <div className={styles.modalBackdrop} role="presentation">
        <section className={styles.confirm} role="alertdialog" aria-modal="true" aria-labelledby="yc-confirm-title" aria-describedby="yc-confirm-description">
          <span className={styles.eyebrow}>Explicit import</span>
          <h2 id="yc-confirm-title">Add {selected.size} selected companies?</h2>
          <p id="yc-confirm-description">New records will be set to Ready to Review. Email, buyer name, and phone fields remain blank. Matching YC lead IDs already in Prospects will be skipped without changing existing data. No email is sent.</p>
          <div className={styles.modalActions}>
            <button type="button" onClick={() => setConfirming(false)} disabled={importing}>Cancel</button>
            <button type="button" className={styles.addButton} onClick={() => void addSelected()} disabled={importing}>{importing ? "Adding…" : "Confirm import"}</button>
          </div>
        </section>
      </div>}
    </main>
  );
}
