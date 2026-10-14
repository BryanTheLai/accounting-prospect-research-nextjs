"use client";

import { useEffect, useState } from "react";
import { renderEmailTemplatePreview } from "@/lib/email-template-preview.mjs";
import type { PreviewLead } from "@/lib/email-template-preview.mjs";

type Template = { name: string; subject: string; body: string };
type Recipient = { id: string; company: string; status: string | null };

export default function CampaignEmailPreview({ campaignId, templateAName, templateBName, selectedRecipients = [] }: {
  campaignId: string; templateAName: string; templateBName: string; selectedRecipients?: Recipient[];
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [recipientId, setRecipientId] = useState("");
  const [lead, setLead] = useState<PreviewLead | null>(null);
  const [error, setError] = useState("");
  const [templateError, setTemplateError] = useState("");
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templateRetry, setTemplateRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setTemplatesLoading(true);
    setTemplateError("");
    fetch("/api/playbooks", { cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("Templates unavailable"); return response.json(); })
      .then((data) => setTemplates(data.templates || []))
      .catch((cause) => { if (!controller.signal.aborted) setTemplateError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setTemplatesLoading(false); });
    return () => controller.abort();
  }, [templateRetry]);
  useEffect(() => {
    setRecipientId((current) => selectedRecipients.some((row) => row.id === current) ? current : selectedRecipients[0]?.id || "");
  }, [campaignId, selectedRecipients]);
  useEffect(() => {
    setLead(null);
    setError("");
    if (!recipientId) return;
    const controller = new AbortController();
    fetch(`/api/prospects?id=${encodeURIComponent(recipientId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("Recipient unavailable"); return response.json(); })
      .then((recipient) => { setLead({ ...recipient, company_name: recipient.company, buyer_name: recipient.buyer || "there", contact_email: recipient.email }); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [recipientId]);

  return <section className="campaign-email-preview" aria-label="Both email templates">
    {selectedRecipients.length > 0 && <label className="preview-recipient-picker"><span>Preview recipient</span><select aria-label="Preview recipient" value={recipientId} onChange={(event) => setRecipientId(event.target.value)}>{selectedRecipients.map((recipient) => <option key={recipient.id} value={recipient.id}>{recipient.company}</option>)}</select></label>}
    {error && <p role="alert">{error}</p>}
    {templateError && <div className="panel-feedback" role="alert"><p>{templateError}</p><button type="button" className="button secondary" onClick={() => setTemplateRetry((current) => current + 1)}>Retry templates</button></div>}
    <div className="email-template-pair">{[templateAName, templateBName].map((name, index) => {
      const template = templates.find((item) => item.name === name);
      if (!template) return <article key={index}><strong>Variant {index ? "B" : "A"}</strong><p>{templatesLoading ? "Loading template…" : name ? "Template unavailable." : "Choose a template above."}</p></article>;
      let subject = template.subject, body = template.body;
      if (lead) {
        try { subject = renderEmailTemplatePreview(subject, lead, () => 0); body = renderEmailTemplatePreview(body, lead, () => 0); }
        catch { return <article key={index}><p role="alert">Template cannot be rendered.</p></article>; }
      }
      return <article className="email-template-card" key={index} aria-label={`Variant ${index ? "B" : "A"} message`}><strong>Variant {index ? "B" : "A"}</strong><p className="template-subject">{subject}</p><pre>{body}</pre></article>;
    })}</div>
  </section>;
}
