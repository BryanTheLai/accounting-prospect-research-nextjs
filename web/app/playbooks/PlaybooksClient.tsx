"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Playbook, PlaybookInput, PlaybookTemplate } from "@/lib/playbooks";
import styles from "./Playbooks.module.css";
import { Disclosure } from "@/app/ui/Disclosure";

type Snapshot = { campaigns: Playbook[]; templates: PlaybookTemplate[] };
type FormState = PlaybookInput & { id: string };

const emptyForm = (): FormState => ({
  id: "", name: "", tagline: "", description: "", targetCriteria: "",
  sourcingStrategy: "", agentPromptSpec: "", offerWedge: "", defaultTemplateName: "",
});

function formFromCampaign(campaign: Playbook): FormState {
  return {
    id: campaign.id,
    name: campaign.name,
    tagline: campaign.tagline,
    description: campaign.description,
    targetCriteria: campaign.targetCriteria,
    sourcingStrategy: campaign.sourcingStrategy,
    agentPromptSpec: campaign.agentPromptSpec,
    offerWedge: campaign.offerWedge,
    defaultTemplateName: campaign.defaultTemplateName,
  };
}

export default function PlaybooksClient() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selected = useMemo(
    () => snapshot?.campaigns.find((campaign) => campaign.id === selectedId) || null,
    [snapshot, selectedId],
  );
  const linkedTemplate = snapshot?.templates.find((template) => template.name === form.defaultTemplateName) || null;

  const load = useCallback(async (preferredId = "") => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/playbooks", { cache: "no-store" });
      const payload = await response.json() as Snapshot & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Playbooks could not be loaded.");
      setSnapshot(payload);
      const currentId = preferredId || payload.campaigns[0]?.id || "";
      setSelectedId(currentId);
      const current = payload.campaigns.find((campaign) => campaign.id === currentId);
      if (current) setForm(formFromCampaign(current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Playbooks could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function selectCampaign(id: string) {
    if (id === selectedId || saving || loading) return;
    const campaign = snapshot?.campaigns.find((item) => item.id === id);
    if (!campaign) return;
    const original = selected ? formFromCampaign(selected) : null;
    if (original && Object.keys(original).some((key) => form[key as keyof FormState] !== original[key as keyof FormState]) && !window.confirm("Discard the unsaved changes before switching campaigns?")) return;
    setSelectedId(id);
    setForm(formFromCampaign(campaign));
    setNotice("");
    setError("");
  }

  function change<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (saving || loading) return;
    setError("");
    setNotice("");
    const prompt = `Save the reviewed edits to “${form.name}”? This changes playbook settings only; it will not dispatch or send email.`;
    if (!window.confirm(prompt)) return;
    setSaving(true);
    try {
      const response = await fetch("/api/playbooks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, action: "update", confirmed: true }),
      });
      const payload = await response.json() as { id?: string; status?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "Playbook could not be saved.");
      if (payload.id) setSelectedId(payload.id);
      setNotice("Playbook changes saved. No dispatch was started.");
      await load(payload.id || selectedId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Playbook could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function activate() {
    if (!selected || selected.status !== "PAUSED" || saving || loading) return;
    if (!window.confirm(`Mark “${selected.name}” ACTIVE? This changes campaign status only. It does not start a queue or send email.`)) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/playbooks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate", id: selected.id, confirmed: true }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Campaign could not be activated.");
      setNotice("Campaign marked ACTIVE. No queue was started and no email was sent.");
      await load(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Campaign could not be activated.");
    } finally {
      setSaving(false);
    }
  }

  return <main className={styles.page}>
    <h1 className="sr-only">Campaign settings</h1>
    <div className={styles.content}>
      <header className={styles.heading}>
        <a className={styles.backLink} href="/#settings">← Settings</a>
      </header>

      {error && <div role="alert" className={`${styles.error} panel-feedback`}><p>{error}</p><button className="button secondary" type="button" disabled={loading || saving} onClick={() => void load(selectedId)}>Retry campaign settings</button></div>}
      {notice && <div role="status" className={styles.notice}>{notice}</div>}

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHead}><div><span className={styles.eyebrow}>Campaigns</span><strong>{snapshot?.campaigns.length ?? 0}</strong></div></div>
          {loading && !snapshot ? <p className={styles.muted}>Loading playbooks…</p> : snapshot?.campaigns.length ?
            <div className={styles.campaignList}>{snapshot.campaigns.map((campaign) => <button type="button" key={campaign.id} disabled={saving || loading}
              className={`${styles.campaignItem} ${selectedId === campaign.id ? styles.selected : ""}`}
              onClick={() => selectCampaign(campaign.id)}>
              <span className={styles.campaignTitle}>{campaign.name}</span><span className={styles.campaignMeta}>{campaign.id} · {campaign.prospectCount} leads</span>
              <span className={`${styles.status} ${campaign.status === "ACTIVE" ? styles.active : campaign.status === "PAUSED" ? styles.paused : ""}`}>{campaign.status}</span>
            </button>)}</div> : <p className={styles.muted}>No campaigns found.</p>}
        </aside>

        <section className={styles.editor} aria-label="Campaign playbook editor">
          <div className={styles.editorHead}><h2>{selected?.name || "Select a campaign"}</h2>
            {selected && <span className={`${styles.status} ${selected.status === "ACTIVE" ? styles.active : selected.status === "PAUSED" ? styles.paused : ""}`}>{selected.status}</span>}
          </div>
          {!selected ? <p className={styles.muted}>Choose a campaign.</p> : <>
            <div className={styles.formGrid} aria-busy={saving || loading}>
              <label className={styles.field}><span>Display name</span><input disabled={saving || loading} value={form.name} onChange={(event) => change("name", event.target.value)} maxLength={140} /></label>
              <label className={`${styles.field} ${styles.full}`}><span>Audience</span><textarea disabled={saving || loading} rows={3} value={form.targetCriteria} onChange={(event) => change("targetCriteria", event.target.value)} maxLength={2400} /></label>
              <label className={`${styles.field} ${styles.full}`}><span>Offer</span><textarea disabled={saving || loading} rows={2} value={form.offerWedge} onChange={(event) => change("offerWedge", event.target.value)} maxLength={1200} /></label>
              <label className={`${styles.field} ${styles.full}`}><span>Linked default outbound template</span>
                <select aria-label="Linked default outbound template" disabled={saving || loading} value={form.defaultTemplateName} onChange={(event) => change("defaultTemplateName", event.target.value)}>
                  <option value="">Choose a template</option>
                  {form.defaultTemplateName && !snapshot?.templates.some((template) => template.name === form.defaultTemplateName) && <option value={form.defaultTemplateName}>Missing template: {form.defaultTemplateName}</option>}
                  {snapshot?.templates.map((template) => <option key={template.name} value={template.name}>{template.name}{template.isDefault ? " · default" : ""}</option>)}
                </select>
              </label>
              <Disclosure title="Research & agent instructions" className="playbook-advanced">
                <label className={`${styles.field} ${styles.full}`}><span>Where to find prospects</span><textarea disabled={saving || loading} rows={3} value={form.sourcingStrategy} onChange={(event) => change("sourcingStrategy", event.target.value)} maxLength={2400} /></label>
                <label className={`${styles.field} ${styles.full}`}><span>AI agent prompt spec</span><textarea disabled={saving || loading} rows={7} value={form.agentPromptSpec} onChange={(event) => change("agentPromptSpec", event.target.value)} maxLength={6000} /></label>
              </Disclosure>
              <Disclosure title="Optional description" className="playbook-advanced">
                <label className={styles.field}><span>Tagline</span><input disabled={saving || loading} value={form.tagline} onChange={(event) => change("tagline", event.target.value)} maxLength={240} /></label>
                <label className={`${styles.field} ${styles.full}`}><span>Description</span><textarea disabled={saving || loading} rows={2} value={form.description} onChange={(event) => change("description", event.target.value)} maxLength={1200} /></label>
              </Disclosure>
            </div>

            <Disclosure title="Review draft values"><section className={styles.reviewPanel} aria-label="Review before saving">
              <dl className={styles.reviewGrid}>
                <div><dt>Target criteria</dt><dd>{form.targetCriteria || "Not set"}</dd></div>
                <div><dt>Sourcing strategy</dt><dd>{form.sourcingStrategy || "Not set"}</dd></div>
                <div><dt>Offer wedge</dt><dd>{form.offerWedge || "Not set"}</dd></div>
                <div><dt>Linked template</dt><dd>{form.defaultTemplateName || "Not set"}{linkedTemplate && <small>{linkedTemplate.subject}</small>}</dd></div>
              </dl>
              {linkedTemplate && <details className={styles.templateDetails}><summary>Preview linked email template</summary><div><strong>Subject</strong><p>{linkedTemplate.subject}</p><strong>Body</strong><pre>{linkedTemplate.body}</pre></div></details>}
              <details className={styles.promptDetails}><summary>Review agent prompt spec</summary><pre>{form.agentPromptSpec || "Not set"}</pre></details>
            </section></Disclosure>

            <div className={styles.actions}>
              <button type="button" className={styles.saveButton} onClick={() => void save()} disabled={saving || loading || !snapshot?.templates.length}>{saving ? "Saving…" : "Save reviewed changes"}</button>
              {selected?.status === "PAUSED" && <button type="button" className={styles.activateButton} onClick={() => void activate()} disabled={saving}>Mark ACTIVE</button>}
            </div>
          </>}
        </section>
      </div>

      <footer className={styles.footer}>Saving edits or marking a campaign active does not start a queue or send email.</footer>
    </div>
  </main>;
}
