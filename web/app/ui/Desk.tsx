"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDialogFocus } from "@/app/ui/useDialogFocus";
import CampaignEmailPreview from "@/app/ui/CampaignEmailPreview";
import { stageLabel, primaryStages, pageFromHash, startBlockReason } from "@/lib/workflow-ui.mjs";
import { selectDispatchCandidateIds } from "@/lib/dispatch-selection";
import { dispatchStatusLabel } from "@/lib/dispatch-status.mjs";
import DnsDeliverabilityTools from "@/app/ui/DnsDeliverabilityTools";
import { Disclosure } from "@/app/ui/Disclosure";

type Page = "prospects" | "campaigns" | "settings";
type Prospect = {
  id: string; company: string; location: string | null; sector: string | null;
  status: string | null; fit: number | null; campaignId: string | null;
  hasPhone?: number; hiringSignal?: boolean; emailTier?: string;
  emailCheckStatus?: string; leadTier?: string | null; isGovernment?: boolean;
  signal: string | null; source?: string | null; summary?: string | null;
  rootDomain?: string | null;
  buyer?: string | null; title?: string | null; email?: string | null;
  phone?: string | null;
};
type Campaign = { id: string; name: string; tagline: string | null; audience: string | null; status: string; draft: boolean; prospects: number; createdAt: string; scheduleTimezone: string; scheduleStartMinute: number; scheduleEndMinute: number };
type StatusCount = { status: string; count: number };
type DispatchCampaign = { id: string; name: string; count: number; templateName?: string; scheduleTimezone?: string | null; scheduleStartMinute?: number | null; scheduleEndMinute?: number | null };
type DispatchTemplate = { name: string; isDefault: boolean };
type DispatchCandidate = { id: string; company: string; status: string; fit: number | null; campaignId: string; autoApprovalEligible?: boolean; emailTier?: "direct" | "department" | "generic" | "system" | "missing" };
type MailboxPacing = {
  mailboxId: number; status: string; sendsToday: number; sendsThisHour: number;
  configuredDailyLimit: number; configuredHourlyLimit: number; effectiveDailyLimit: number; effectiveHourlyLimit: number;
  manualLimits: boolean;
  minDelaySeconds: number; maxDelaySeconds: number; hasDelayOverride: boolean;
  effectiveMinDelaySeconds: number; effectiveMaxDelaySeconds: number;
  warmup: { dayNumber: number; phaseName: string; recommendedDailyLimit: number; recommendedHourlyLimit: number; recommendedMinDelaySeconds: number; recommendedMaxDelaySeconds: number };
};
type MailboxPacingDraft = { dailyLimit: string; hourlyLimit: string; minDelaySeconds: string; maxDelaySeconds: string; manualLimits: boolean };
type DispatchSnapshot = {
  is_running: boolean; is_paused: boolean; daily_limit: number; hourly_limit: number;
  min_delay: number; max_delay: number; business_hours_only: boolean; sent_today: number;
  sent_this_hour: number; queue_pending: number; live_dispatch: boolean;
  schedule_override_active?: boolean; schedule_override_supported?: boolean;
  has_error?: boolean; next_send_timestamp?: number;
  wait_reason?: string; run_id?: string | null; accepted_count?: number; run_total?: number; uncertain_count?: number;
};
type DispatchState = { snapshot: DispatchSnapshot; templates: DispatchTemplate[]; campaigns: DispatchCampaign[]; candidates: DispatchCandidate[]; eligibleCount: number; hasMore: boolean; heldCounts?: { needs_approval: number; needs_email_check: number; sent_or_suppressed: number; government: number } };
type Notice = { text: string; tone: "ok" | "error" } | null;
type SenderSummary = { id: number; email: string; status: string; health: string };

const stageOptions = ["Ready to Review", "Approved for Outreach", "In Sequence (Smartlead)", "Replied (Warm)", "Discovery Call Booked", "Proposal Sent", "Closed Won (Retainer Signed)", "Discovery in progress", "Nurture / Follow-up", "Bounced / 550 Invalid", "Discarded / DNC"];

function Icon({ path, size = 18 }: { path: string; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>;
}

function Glyph({ name }: { name: "plus" | "search" | "download" | "arrow" | "close" | "external" | "check" }) {
  const paths = {
    plus: "M12 5v14 M5 12h14", search: "m20 20-4.2-4.2 M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z",
    download: "M12 3v12 M7 10l5 5 5-5 M4 19v2h16v-2", arrow: "M5 12h14 M13 6l6 6-6 6", close: "M6 6l12 12 M18 6 6 18",
    external: "M14 4h6v6 M20 4l-9 9 M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5", check: "m5 12 4 4L19 6",
  };
  return <Icon path={paths[name]} size={16} />;
}

function stageTone(status: string | null) {
  if (status?.includes("Approved") || status?.includes("Closed Won")) return "tone-green";
  if (status?.includes("Ready") || status?.includes("Review")) return "tone-lime";
  if (status?.includes("Replied") || status?.includes("Discovery")) return "tone-blue";
  if (status?.includes("Bounced") || status?.includes("Discarded")) return "tone-red";
  return "tone-neutral";
}

function minuteToTime(value: number) {
  const safe = Math.min(1439, Math.max(0, Number.isFinite(value) ? value : 0));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function timeToMinute(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]); const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
}

function timezoneLabel(timezone: string) {
  const labels: Record<string, string> = {
    "America/Los_Angeles": "California · Pacific Time",
    "America/Denver": "US Mountain Time",
    "America/Chicago": "US Central Time",
    "America/New_York": "US Eastern Time",
    "Europe/London": "London",
    "Asia/Singapore": "Singapore",
    "Asia/Kuala_Lumpur": "Malaysia",
  };
  return labels[timezone] || timezone;
}

export default function Desk() {
  const [page, setPage] = useState<Page>("campaigns");
  const previousPage = useRef<Page>("campaigns");
  const restoreDetailOnEntry = useRef(false);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [statuses, setStatuses] = useState<StatusCount[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignScope, setCampaignScope] = useState("mysg_consumer_retail_accounting");
  const [scheduleTimezone, setScheduleTimezone] = useState("America/Los_Angeles");
  const [scheduleStart, setScheduleStart] = useState("09:00");
  const [scheduleEnd, setScheduleEnd] = useState("18:00");
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [mailboxPacing, setMailboxPacing] = useState<MailboxPacing[]>([]);
  const [mailboxPacingDrafts, setMailboxPacingDrafts] = useState<Record<number, MailboxPacingDraft>>({});
  const [mailboxPacingLoading, setMailboxPacingLoading] = useState(false);
  const [mailboxPacingError, setMailboxPacingError] = useState("");
  const [mailboxPacingSaving, setMailboxPacingSaving] = useState<number | null>(null);
  const [dispatch, setDispatch] = useState<DispatchState | null>(null);
  const [dispatchSelected, setDispatchSelected] = useState<Set<string>>(new Set());
  const [templateAName, setTemplateAName] = useState("YC A/B — Commercial Burn Cut");
  const [templateBName, setTemplateBName] = useState("YC A/B — Conversational Builder");
  const [dispatchBusy, setDispatchBusy] = useState(false);
  const [dispatchPaging, setDispatchPaging] = useState(false);
  const [dispatchSelectingAll, setDispatchSelectingAll] = useState(false);
  const [confirmLiveStart, setConfirmLiveStart] = useState(false);
  const [confirmScheduleOverride, setConfirmScheduleOverride] = useState(false);
  const [confirmLiveMode, setConfirmLiveMode] = useState<boolean | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailRetry, setDetailRetry] = useState(0);
  const [stageSaving, setStageSaving] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<Prospect | null>(null);
  const [query, setQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [founderFilter, setFounderFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [phoneFilter, setPhoneFilter] = useState("");
  const [stage, setStage] = useState("all");
  const [prospectTierOptions, setProspectTierOptions] = useState<string[]>([]);
  const [selectedProspectTiers, setSelectedProspectTiers] = useState<string[]>([]);
  const [minFit, setMinFit] = useState("0");
  const [maxFit, setMaxFit] = useState("100");
  const [hiringOnly, setHiringOnly] = useState(false);
  const [callableOnly, setCallableOnly] = useState(false);
  const emailTier = "all";
  const emailCheckStatus = "all";
  const [excludeGovernment, setExcludeGovernment] = useState(true);
  const [totalProspects, setTotalProspects] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);
  const [mobileLayout, setMobileLayout] = useState(false);
  const [modal, setModal] = useState<"prospect" | "campaign" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [dispatchError, setDispatchError] = useState("");
  const dispatchRequest = useRef(0);
  const prospectRequest = useRef(0);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dbAvailable, setDbAvailable] = useState(false);
  const [mailboxCount, setMailboxCount] = useState(0);
  const [senders, setSenders] = useState<SenderSummary[]>([]);

  const selectedCampaign = campaigns.find((campaign) => campaign.id === campaignScope) || null;
  const dispatchControlsDisabled = dispatchBusy || !dispatch || Boolean(dispatchError);
  const pacingControlsDisabled = mailboxPacingSaving !== null || mailboxPacingLoading;
  const prospectView = useRef("");
  const prospectViewKey = JSON.stringify([campaignScope, query, stage, companyFilter, founderFilter, locationFilter, phoneFilter, minFit, maxFit, hiringOnly, callableOnly, emailTier, emailCheckStatus, selectedProspectTiers, excludeGovernment]);
  prospectView.current = prospectViewKey;
  const dispatchScope = useRef(campaignScope);
  dispatchScope.current = campaignScope;
  const filterStages = [...new Set([...stageOptions, ...statuses.map((item) => item.status)])];
  const previewRecipients = useMemo(() => (dispatch?.candidates || []).filter((row) => dispatchSelected.has(row.id)), [dispatch?.candidates, dispatchSelected]);

  useEffect(() => {
    if (!selectedCampaign) return;
    setScheduleTimezone(selectedCampaign.scheduleTimezone || "Asia/Singapore");
    setScheduleStart(minuteToTime(selectedCampaign.scheduleStartMinute ?? 540));
    setScheduleEnd(minuteToTime(selectedCampaign.scheduleEndMinute ?? 1050));
  }, [selectedCampaign?.id, selectedCampaign?.scheduleTimezone, selectedCampaign?.scheduleStartMinute, selectedCampaign?.scheduleEndMinute]);

  const notify = useCallback((text: string, tone: "ok" | "error" = "ok") => {
    setNotice({ text, tone });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), tone === "ok" ? 4500 : 9000);
  }, []);


  const loadWorkspace = useCallback(async () => {
    const [campaignsResponse, settingsResponse] = await Promise.all([
      fetch("/api/campaigns", { cache: "no-store" }),
      fetch("/api/mailboxes", { cache: "no-store" }),
    ]);
    if (!campaignsResponse.ok || !settingsResponse.ok) throw new Error("Could not load the local workspace. Retry the connection.");
    const [campaignData, settingData] = await Promise.all([
      campaignsResponse.json(), settingsResponse.json(),
    ]);
    setCampaigns(campaignData.campaigns || []);
    setSenders(settingData.mailboxes || []);
    setMailboxCount(settingData.mailboxes?.length || 0);
    setDbAvailable(true);
  }, []);

  const loadDispatch = useCallback(async (summary = false) => {
    const request = summary ? dispatchRequest.current : ++dispatchRequest.current;
    const params = new URLSearchParams({ campaignId: campaignScope });
    if (summary) params.set("summary", "1");
    const response = await fetch(`/api/dispatch?${params}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Dispatcher is unavailable");
    if (request !== dispatchRequest.current) return;
    setDispatchError("");
    if (summary) setDispatch((current) => current ? { ...current, snapshot: data.snapshot } : current);
    else {
      setDispatch(data);
      setDispatchSelected((current) => new Set([...current].filter((id) => data.candidates.some((row: DispatchCandidate) => row.id === id))));
      const variantA = "YC A/B — Commercial Burn Cut";
      const variantB = "YC A/B — Conversational Builder";
      setTemplateAName((current) => data.templates.some((row: DispatchTemplate) => row.name === current) ? current : data.templates.find((row: DispatchTemplate) => row.name === variantA)?.name || data.templates[0]?.name || "");
      setTemplateBName((current) => data.templates.some((row: DispatchTemplate) => row.name === current) ? current : data.templates.find((row: DispatchTemplate) => row.name === variantB)?.name || data.templates[1]?.name || "");
    }
  }, [campaignScope]);

  const loadMailboxPacing = useCallback(async () => {
    setMailboxPacingLoading(true);
    setMailboxPacingError("");
    try {
      const response = await fetch("/api/dispatch?mailboxPacing=1", { cache: "no-store" });
      const data = await response.json() as { mailboxes?: MailboxPacing[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Mailbox pacing could not be loaded");
      const rows = data.mailboxes || [];
      setMailboxPacing(rows);
      setMailboxPacingDrafts(Object.fromEntries(rows.map((row) => [row.mailboxId, {
        dailyLimit: String(row.configuredDailyLimit),
        hourlyLimit: String(row.configuredHourlyLimit),
        manualLimits: row.manualLimits,
        minDelaySeconds: String(Math.max(60, Math.min(3600, row.minDelaySeconds))),
        maxDelaySeconds: String(Math.max(90, Math.min(3600, row.maxDelaySeconds))),
      }])));
    } catch (error) {
      setMailboxPacingError(error instanceof Error ? error.message : "Sender limits could not be loaded");
      throw error;
    } finally {
      setMailboxPacingLoading(false);
    }
  }, []);

  const loadProspects = useCallback(async (signal?: AbortSignal) => {
    if (prospectViewKey !== prospectView.current) return;
    const request = ++prospectRequest.current;
    const params = new URLSearchParams({ limit: "100", offset: "0", q: query, status: stage, campaignId: campaignScope,
      company: companyFilter, founder: founderFilter, location: locationFilter, phone: phoneFilter, minFit, maxFit,
      hiringOnly: hiringOnly ? "1" : "0", callable: callableOnly ? "1" : "0", emailTier, emailCheckStatus, excludeGovernment: excludeGovernment ? "1" : "0" });
    selectedProspectTiers.forEach((tier) => params.append("tier", tier));
    const response = await fetch(`/api/prospects?${params}`, { cache: "no-store", signal });
    if (!response.ok) throw new Error((await response.json()).error || "Could not load prospects");
    const data = await response.json();
    if (request !== prospectRequest.current || prospectViewKey !== prospectView.current || signal?.aborted) return;
    setProspects(data.rows || []);
    setHasMore(Boolean(data.hasMore));
    setStatuses(data.statuses || []);
    setProspectTierOptions(data.tiers || []);
    setTotalProspects(Number(data.total) || 0);
  }, [prospectViewKey, query, companyFilter, founderFilter, locationFilter, phoneFilter, stage, campaignScope, minFit, maxFit, hiringOnly, callableOnly, emailTier, emailCheckStatus, excludeGovernment, selectedProspectTiers]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await loadWorkspace();
      await loadProspects();
    } catch (error) {
      setDbAvailable(false);
      notify(error instanceof Error ? error.message : "Could not reach the local database", "error");
    } finally {
      setLoading(false);
    }
  }, [loadWorkspace, loadProspects, notify]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const scope = params.get("campaignId");
    if (scope && /^[a-z0-9_-]{1,80}$/.test(scope)) setCampaignScope(scope);
    const leadId = params.get("leadId");
    if (leadId && leadId.length <= 120) {
      setSelectedId(leadId); setDetailOpen(true);
      restoreDetailOnEntry.current = pageFromHash(window.location.hash) === "prospects";
    }
    const syncPage = () => setPage(pageFromHash(window.location.hash));
    syncPage();
    if (!window.location.hash || window.location.hash === "#overview") window.history.replaceState(null, "", "#campaigns");
    window.addEventListener("popstate", syncPage);
    window.addEventListener("hashchange", syncPage);
    return () => {
      window.removeEventListener("popstate", syncPage);
      window.removeEventListener("hashchange", syncPage);
    };
  }, []);

  useEffect(() => {
    if (previousPage.current === page) return;
    previousPage.current = page;
    setDetailOpen(restoreDetailOnEntry.current && page === "prospects");
    restoreDetailOnEntry.current = false;
    window.scrollTo({ top: 0, behavior: "instant" });
    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [page]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const sync = () => setMobileLayout(media.matches);
    sync(); media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const dialogKind = modal || (confirmLiveStart ? "live-start" : confirmScheduleOverride ? "override" : confirmLiveMode !== null ? "mode" : page === "prospects" && mobileLayout && detailOpen ? "prospect" : "");
  useDialogFocus(dialogKind, saving || dispatchBusy || stageSaving, () => {
    setModal(null); setConfirmLiveStart(false); setConfirmScheduleOverride(false); setConfirmLiveMode(null); setDetailOpen(false);
  });

  useEffect(() => {
    let current = true;
    setLoading(true);
    loadWorkspace()
      .catch((error) => {
        if (!current) return;
        setDbAvailable(false);
        notify(error instanceof Error ? error.message : "Could not reach the local database", "error");
      })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [loadWorkspace, notify]);

  useEffect(() => {
    if (!dbAvailable) return;
    let current = true;
    const controller = new AbortController();
    setLoading(true);
    setProspects([]);
    const timer = window.setTimeout(() => {
      void loadProspects(controller.signal)
        .catch((error) => { if (current) notify(error instanceof Error ? error.message : "Could not load prospects", "error"); })
        .finally(() => { if (current) setLoading(false); });
    }, query || companyFilter || founderFilter || locationFilter || phoneFilter ? 200 : 0);
    return () => { current = false; controller.abort(); window.clearTimeout(timer); };
  }, [dbAvailable, loadProspects, notify]);

  useEffect(() => {
    if (!dbAvailable || !["campaigns", "settings"].includes(page)) return;
    let current = true;
    setDispatchError("");
    setDispatch(null);
    setDispatchSelected(new Set());
    loadDispatch().catch((error) => { if (current) setDispatchError(error instanceof Error ? error.message : "Email service unavailable"); });
    loadMailboxPacing().catch(() => {});
    return () => { current = false; };
  }, [dbAvailable, page, loadDispatch, loadMailboxPacing, notify]);

  useEffect(() => {
    if (page !== "campaigns" || !dbAvailable) return;
    let polling = false;
    const timer = window.setInterval(() => {
      if (polling) return;
      polling = true;
      void loadDispatch(Boolean(dispatch)).catch((error) => {
        setDispatchError(error instanceof Error ? error.message : "Email service unavailable");
      }).finally(() => { polling = false; });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [page, dbAvailable, Boolean(dispatch), loadDispatch]);

  useEffect(() => {
    if (!selectedId || !dbAvailable) { setSelected(null); return; }
    setSelected(null);
    setDetailError("");
    const controller = new AbortController();
    fetch(`/api/prospects?id=${encodeURIComponent(selectedId)}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load contact details.");
        return data;
      })
      .then((data) => { if (data) setSelected(data); })
      .catch((error) => { if (!controller.signal.aborted) setDetailError(error instanceof Error ? error.message : "Could not load contact details."); });
    return () => controller.abort();
  }, [selectedId, dbAvailable, detailRetry]);

  const visibleCount = prospects.length;

  async function loadMore() {
    const view = prospectView.current;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: "100", offset: String(prospects.length), q: query, status: stage, campaignId: campaignScope,
        company: companyFilter, founder: founderFilter, location: locationFilter, phone: phoneFilter, minFit, maxFit,
        hiringOnly: hiringOnly ? "1" : "0", callable: callableOnly ? "1" : "0", emailTier, emailCheckStatus, excludeGovernment: excludeGovernment ? "1" : "0" });
      selectedProspectTiers.forEach((tier) => params.append("tier", tier));
      const response = await fetch(`/api/prospects?${params}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load more prospects");
      if (view !== prospectView.current) return;
      setProspects((current) => [...current, ...(data.rows || [])]);
      setHasMore(Boolean(data.hasMore));
      setTotalProspects(Number(data.total) || 0);
    } catch (error) { notify(error instanceof Error ? error.message : "Could not load more prospects", "error"); }
    finally { setLoadingMore(false); }
  }


  async function dispatchAction(body: Record<string, unknown>) {
    setDispatchBusy(true);
    try {
      const response = await fetch("/api/dispatch", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Dispatch action failed");
      if (data.snapshot) setDispatch((current) => current ? { ...current, snapshot: data.snapshot } : current);
      try { await loadDispatch(); }
      catch (error) { setDispatchError(error instanceof Error ? error.message : "Control accepted; service status could not be refreshed."); }
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Dispatch action failed", "error");
      return false;
    } finally { setDispatchBusy(false); }
  }

  async function saveMailboxPacing(mailbox: MailboxPacing, inheritDelay = false) {
    const draft = mailboxPacingDrafts[mailbox.mailboxId];
    if (!draft || mailboxPacingSaving !== null) return;
    const dailyLimit = Number(draft.dailyLimit);
    const hourlyLimit = Number(draft.hourlyLimit);
    const minDelaySeconds = Number(draft.minDelaySeconds);
    const maxDelaySeconds = Number(draft.maxDelaySeconds);
    if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 1 ||
        !Number.isSafeInteger(hourlyLimit) || hourlyLimit < 1 || hourlyLimit > dailyLimit ||
        (!inheritDelay && (!Number.isInteger(minDelaySeconds) || minDelaySeconds < 60 || minDelaySeconds > 3600 ||
        !Number.isInteger(maxDelaySeconds) || maxDelaySeconds > 3600 || maxDelaySeconds - minDelaySeconds < 30))) {
      notify("Use positive whole-number quotas, hourly no higher than daily, and a spacing range of at least 30 seconds between 60 and 3,600.", "error");
      return;
    }
    const changeSummary = inheritDelay ? "Save the displayed caps and use the app's default delay" : "Save pacing";
    if (!window.confirm(`${changeSummary} for mailbox #${mailbox.mailboxId}? ${draft.manualLimits ? 'Your quotas will be used without a warmup cap.' : 'Recommended warmup caps remain active.'} Changes apply to the current queue; provider throttling still applies.`)) return;
    setMailboxPacingSaving(mailbox.mailboxId);
    try {
      const response = await fetch("/api/dispatch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mailbox_pacing", mailboxId: mailbox.mailboxId, dailyLimit, hourlyLimit, manualLimits: draft.manualLimits,
          ...(inheritDelay ? { inheritDelay: true } : { minDelaySeconds, maxDelaySeconds }), confirmed: true }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Mailbox pacing could not be saved");
      await loadMailboxPacing().catch(() => {});
      notify("Sender limits saved. The current queue will recheck its available capacity.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Mailbox pacing could not be saved", "error");
    } finally {
      setMailboxPacingSaving(null);
    }
  }

  async function startDispatch(liveConfirmed = false) {
    const started = await dispatchAction({
      action: "start", campaignId: campaignScope, leadIds: Array.from(dispatchSelected),
      templateAName, templateBName, liveConfirmed,
    });
    if (started) {
      setConfirmLiveStart(false);
      setDispatchSelected(new Set());
      notify(liveConfirmed ? "Live queue started" : "Dry run started");
    }
  }

  async function overrideCurrentSchedule() {
    const applied = await dispatchAction({ action: "override_schedule", confirmed: true, liveConfirmed: true });
    if (applied) {
      setConfirmScheduleOverride(false);
      notify("Schedule override applied to this run. Recipient checks and mailbox limits remain active.");
    }
  }

  async function saveCampaignSchedule() {
    if (!selectedCampaign || scheduleSaving) return;
    const startMinute = timeToMinute(scheduleStart);
    const endMinute = timeToMinute(scheduleEnd);
    if (startMinute === null || endMinute === null || startMinute >= endMinute) {
      notify("Choose a valid local time window.", "error");
      return;
    }
    setScheduleSaving(true);
    try {
      const response = await fetch("/api/campaigns", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedCampaign.id, scheduleTimezone, scheduleStartMinute: startMinute, scheduleEndMinute: endMinute }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save the campaign schedule");
      notify("Campaign local-time schedule saved.");
      const refreshed = await Promise.allSettled([loadWorkspace(), loadDispatch()]);
      if (refreshed.some((result) => result.status === "rejected")) notify("Campaign schedule saved. Reload Settings to refresh the displayed state.", "error");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not save the campaign schedule", "error");
    } finally { setScheduleSaving(false); }
  }

  async function setLiveMode(enabled: boolean) {
    const changed = await dispatchAction({ action: "live", enabled, confirmed: true });
    if (changed) { setConfirmLiveMode(null); notify(enabled ? "Live sending enabled" : "Dry run restored"); }
  }

  function requestLiveMode(enabled: boolean) {
    setConfirmLiveMode(enabled);
  }

  async function loadMoreDispatchCandidates() {
    const scope = campaignScope;
    if (!dispatch || dispatchPaging || !dispatch.hasMore) return;
    setDispatchPaging(true);
    try {
      const params = new URLSearchParams({ campaignId: campaignScope, offset: String(dispatch.candidates.length) });
      const response = await fetch(`/api/dispatch?${params}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load more recipients");
      if (scope !== dispatchScope.current) return;
      setDispatch((current) => current ? { ...current, candidates: [...current.candidates, ...data.candidates], hasMore: Boolean(data.hasMore) } : current);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load more recipients", "error");
    } finally { setDispatchPaging(false); }
  }

  async function selectAllEligible() {
    const scope = campaignScope;
    if (!dispatch || dispatchSelectingAll) return;
    if (dispatch.eligibleCount > 5000) {
      notify("This scope exceeds the 5,000-recipient run limit. Choose one campaign or select a smaller group.", "error");
      return;
    }
    setDispatchSelectingAll(true);
    try {
      const ids = new Set<string>();
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const params = new URLSearchParams({ campaignId: campaignScope, offset: String(offset) });
        const response = await fetch(`/api/dispatch?${params}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not select recipients");
        if (scope !== dispatchScope.current) return;
        for (const candidate of data.candidates as DispatchCandidate[]) ids.add(candidate.id);
        offset += (data.candidates as DispatchCandidate[]).length;
        hasMore = Boolean(data.hasMore);
        if (hasMore && offset === 0) throw new Error("Recipient pagination did not advance");
      }
      if (scope !== dispatchScope.current) return;
      setDispatchSelected(ids);
      notify(`${ids.size.toLocaleString()} eligible recipients selected`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not select all recipients", "error");
    } finally { setDispatchSelectingAll(false); }
  }

  function go(next: Page) {
    setPage(next);
    setDetailOpen(false);
    window.history.pushState(null, "", `#${next}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }

  async function exportCsv() {
    const params = new URLSearchParams({ q: query, company: companyFilter, founder: founderFilter, location: locationFilter, phone: phoneFilter,
      status: stage, campaignId: campaignScope, minFit, maxFit,
      hiringOnly: hiringOnly ? "1" : "0", callable: callableOnly ? "1" : "0", emailTier, emailCheckStatus, excludeGovernment: excludeGovernment ? "1" : "0" });
    selectedProspectTiers.forEach((tier) => params.append("tier", tier));
    const response = await fetch(`/api/export?${params}`);
    if (!response.ok) { notify("Export failed. Check the local database.", "error"); return; }
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "outbounder-prospects.csv";
    link.click();
    URL.revokeObjectURL(link.href);
    notify("Filtered prospects exported");
  }

  async function submitForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const body = modal === "campaign"
      ? { name: form.get("name"), audience: form.get("audience") }
      : { company: form.get("company"), location: form.get("location"), sector: form.get("sector") };
    try {
      const response = await fetch(modal === "campaign" ? "/api/campaigns" : "/api/prospects", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save");
      const kind = modal;
      setModal(null);
      if (kind === "prospect") setPage("prospects");
      await refresh();
      notify(kind === "campaign" ? "Campaign draft saved" : "Prospect added to the database");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not save", "error");
    } finally { setSaving(false); }
  }

  async function updateStage(next: string) {
    if (!selected || stageSaving) return;
    setStageSaving(true);
    try {
      const response = await fetch("/api/prospects", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, status: next }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Stage update failed");
      setSelected({ ...selected, status: next });
      await refresh();
      notify("Stage updated");
    } catch (error) { notify(error instanceof Error ? error.message : "Could not update stage. Try again.", "error"); }
    finally { setStageSaving(false); }
  }

  async function reviewBacklog() {
    setReviewing(true);
    try {
      const response = await fetch("/api/prospects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "review", campaignId: campaignScope, confirmed: true }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Review failed");
      notify(`${result.reviewed} reviewed · ${result.approved} approved · ${result.held.email} need exact email-source evidence`);
      await refresh();
    } catch (error) { notify(error instanceof Error ? error.message : "Review failed", "error"); }
    finally { setReviewing(false); }
  }

  const sendingSettings = <>
    <CampaignScopeSelect campaigns={campaigns} value={campaignScope} onChange={setCampaignScope} />
    {selectedCampaign && <Disclosure title="Send window"><div className="campaign-schedule-editor"><label>Time zone<select value={scheduleTimezone} onChange={(event) => setScheduleTimezone(event.target.value)} disabled={scheduleSaving || dispatch?.snapshot.is_running}>{["America/Los_Angeles", "America/New_York", "Asia/Singapore", "Asia/Kuala_Lumpur"].map((zone) => <option key={zone} value={zone}>{timezoneLabel(zone)}</option>)}</select></label><label>From<input type="time" value={scheduleStart} onChange={(event) => setScheduleStart(event.target.value)} disabled={scheduleSaving || dispatch?.snapshot.is_running} /></label><label>Until<input type="time" value={scheduleEnd} onChange={(event) => setScheduleEnd(event.target.value)} disabled={scheduleSaving || dispatch?.snapshot.is_running} /></label><button className="button secondary" disabled={scheduleSaving || dispatch?.snapshot.is_running} onClick={() => void saveCampaignSchedule()}>Save hours</button></div></Disclosure>}
    <Disclosure title="Sender limits">
      {mailboxPacingLoading && <p role="status">Loading sender limits…</p>}
      {mailboxPacingError && <div className="panel-feedback" role="alert"><p>{mailboxPacingError}</p><button className="button secondary" disabled={mailboxPacingLoading} onClick={() => void loadMailboxPacing().catch(() => {})}>Retry sender limits</button></div>}
      {!mailboxPacingLoading && !mailboxPacingError && !mailboxPacing.length && <p className="empty-state">No senders configured. <a href="/mailboxes">Add a sender</a></p>}
      <div className="mailbox-pacing-list">{mailboxPacing.map((mailbox) => {
      const draft = mailboxPacingDrafts[mailbox.mailboxId];
      if (!draft) return null;
      return <article className="mailbox-pacing-row" key={mailbox.mailboxId} aria-busy={mailboxPacingSaving === mailbox.mailboxId}>
        <strong>{senders.find((sender) => sender.id === mailbox.mailboxId)?.email || `Sender ${mailbox.mailboxId}`}</strong>
        <div className="mailbox-pacing-fields">{([['dailyLimit', 'Daily cap'], ['hourlyLimit', 'Hourly cap'], ['minDelaySeconds', 'Minimum spacing (s)'], ['maxDelaySeconds', 'Maximum spacing (s)']] as const).map(([field, label]) => <label key={field}>{label}<input type="number" value={draft[field]} disabled={pacingControlsDisabled} onChange={(event) => setMailboxPacingDrafts((current) => ({ ...current, [mailbox.mailboxId]: { ...draft, [field]: event.target.value, manualLimits: field === 'dailyLimit' || field === 'hourlyLimit' ? true : draft.manualLimits } }))} /></label>)}</div>
        <label><input type="checkbox" disabled={pacingControlsDisabled} checked={!draft.manualLimits} onChange={(event) => setMailboxPacingDrafts((current) => ({ ...current, [mailbox.mailboxId]: { ...draft, manualLimits: !event.target.checked } }))} />Use recommended warmup caps</label>
        <p>{mailboxPacingError ? "Effective limits unavailable." : mailboxPacingLoading ? "Refreshing effective limits…" : `${mailbox.effectiveDailyLimit}/day · ${mailbox.effectiveHourlyLimit}/hour effective`}</p>
        <button className="button secondary" disabled={pacingControlsDisabled} onClick={() => void saveMailboxPacing(mailbox)}>{mailboxPacingSaving === mailbox.mailboxId ? "Saving…" : "Save limits"}</button>
      </article>;
    })}</div></Disclosure>
  </>;
  return (
    <div className="app-shell">
      <main id="main-content" className="main-area" tabIndex={-1}>
        {(dbAvailable || loading) && <h1 className="sr-only">{page === "campaigns" ? "Email campaigns" : page === "settings" ? "Settings" : "Prospects"}</h1>}
        {!dbAvailable && !loading ? <section className="page-content"><div className="error-panel"><span className="eyebrow">Local setup</span><h1>Couldn’t open your workspace.</h1><p>Check the database path in <code>OUTBOUNDER_DB_PATH</code>, then restart the app.</p><button className="button secondary" onClick={() => void refresh()}>Try again <Glyph name="arrow" /></button></div></section> : (
          <>
            {page === "prospects" && <section className="page-content" aria-label="Prospects">
              <div className="compact-actions"><a className="button secondary" href="/yc">YC directory</a><a className="button secondary" href="/import">Import</a><button className="button secondary" onClick={() => setModal("prospect")}>Add prospect</button><button className="button primary" disabled={reviewing} onClick={() => void reviewBacklog()}>{reviewing ? "Reviewing…" : "Review leads"}</button></div>
              <CampaignScopeSelect campaigns={campaigns} value={campaignScope} onChange={setCampaignScope} />
              <div className="toolbar">
                <label className="search-box"><Glyph name="search" /><span className="sr-only">Search prospects</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search prospects" /></label>
                <label className="filter-label"><span className="sr-only">Prospect view</span><select aria-label="Prospect view" value={stage} onChange={(event) => setStage(event.target.value)}><option value="all">All prospects</option><option value="needs_review">To review · {statuses.filter((item) => ['NEW','Ready to Review','Target Identified'].includes(item.status)).reduce((sum,item) => sum+item.count,0)}</option>{filterStages.filter((item) => item === stage || (statuses.find((entry) => entry.status === item)?.count || 0) > 0).map((item) => <option key={item} value={item}>{stageLabel(item)} · {statuses.find((entry) => entry.status === item)?.count || 0}</option>)}</select></label>
                <button className="button secondary export-button" aria-label="Export filtered prospects" title="Export CSV" onClick={() => void exportCsv()}><Glyph name="download" /></button>
              </div>
              <details className="simple-disclosure prospect-filters"><summary>Filters {Boolean(companyFilter || founderFilter || locationFilter || phoneFilter || minFit !== "0" || maxFit !== "100" || hiringOnly || callableOnly || emailTier !== "all" || emailCheckStatus !== "all" || selectedProspectTiers.length || !excludeGovernment) && <span>· active</span>}</summary><div className="prospect-filter-grid" aria-label="Additional prospect filters">
                <label><span>Company contains</span><input aria-label="Filter by company" type="search" value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)} /></label>
                <label><span>Founder / contact</span><input aria-label="Filter by founder or contact" type="search" value={founderFilter} onChange={(event) => setFounderFilter(event.target.value)} /></label>
                <label><span>Location contains</span><input aria-label="Filter by location" type="search" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} /></label>
                <label><span>Phone contains</span><input aria-label="Filter by phone number" type="search" value={phoneFilter} onChange={(event) => setPhoneFilter(event.target.value)} /></label>
                <label><span>Fit from</span><input aria-label="Minimum fit score" type="number" min="0" max="100" value={minFit} onChange={(event) => setMinFit(event.target.value)} /></label>
                <label><span>Fit to</span><input aria-label="Maximum fit score" type="number" min="0" max="100" value={maxFit} onChange={(event) => setMaxFit(event.target.value)} /></label>
                <div className="prospect-tier-field"><span>Prospect tier</span><details className="prospect-tier-filter"><summary>{selectedProspectTiers.length ? `${selectedProspectTiers.length} selected` : "All tiers"}</summary><div>{prospectTierOptions.length ? prospectTierOptions.map((tier) => <label key={tier}><input type="checkbox" checked={selectedProspectTiers.includes(tier)} onChange={(event) => setSelectedProspectTiers((current) => event.target.checked ? [...current, tier] : current.filter((item) => item !== tier))} /><span>{tier}</span></label>) : <span>No prospect tiers saved</span>}</div></details></div>
                <div className="prospect-filter-options" role="group" aria-label="Prospect eligibility filters">
                <label className="prospect-check-filter" title="Uses explicit notes and source markers only. Prospects do not have a stored hiring flag, so this can miss unrecorded job postings."><input type="checkbox" checked={hiringOnly} onChange={(event) => setHiringOnly(event.target.checked)} /><span>Has hiring evidence</span></label>
                <label className="prospect-check-filter"><input type="checkbox" checked={callableOnly} onChange={(event) => setCallableOnly(event.target.checked)} /><span>Callable · phone on file</span></label>
                <label className="prospect-check-filter"><input type="checkbox" checked={excludeGovernment} onChange={(event) => setExcludeGovernment(event.target.checked)} /><span>Exclude government</span></label>
                <button className="button secondary" type="button" onClick={() => { setCompanyFilter(""); setFounderFilter(""); setLocationFilter(""); setPhoneFilter(""); setMinFit("0"); setMaxFit("100"); setHiringOnly(false); setCallableOnly(false); setSelectedProspectTiers([]); setExcludeGovernment(true); }}>Reset filters</button>
                </div>
              </div></details>
              <div className="list-count">{loading ? "Loading…" : `Showing ${visibleCount}${hasMore ? "+" : ""} of ${totalProspects} matching`} <span>·</span> Sorted by fit</div>
              <div className="work-area prospect-work-area">
                <ProspectList rows={prospects} selectedId={selectedId} onSelect={(row) => { setSelectedId(row.id); setDetailOpen(true); }} empty={loading ? "Loading your prospects…" : "No matches. Try another search or stage."} hasMore={hasMore} loadingMore={loadingMore} onMore={() => void loadMore()} />
                <DetailPanel prospect={selected} campaignScope={campaignScope} loading={Boolean(selectedId && !selected && !detailError)} error={detailError} onRetry={() => setDetailRetry((value) => value + 1)} onStage={updateStage} saving={stageSaving} onClose={() => setDetailOpen(false)} mobileOpen={detailOpen} mobileLayout={mobileLayout} />
              </div>
            </section>}

            {page === "campaigns" && <section className="page-content" aria-label="Email campaigns">
              <div className="dispatch-layout">
                <div className="dispatch-main">
                  <div className="dispatch-panel">
                    <div className="dispatch-panel-head"><h2>Recipients</h2><span className={`dispatch-state${!dispatchError && dispatch?.snapshot.is_running ? " running" : ""}`}><i />{dispatchError ? "Unavailable" : !dispatch ? "Connecting…" : dispatch.snapshot.is_running ? dispatch.snapshot.is_paused ? "Paused" : "Running" : "Idle"}</span></div>
                    <div className="dispatch-controls">
                      <CampaignScopeSelect campaigns={campaigns} value={campaignScope} onChange={setCampaignScope} />
                    </div>
                    <small className="dispatch-footnote">Auto-approval follows the selected campaign. MY/SG consumer retail is selected by default; switch campaigns here when ready.</small>
                    <div className="dispatch-candidate-heading"><div><strong>{dispatch?.eligibleCount.toLocaleString() ?? "—"}</strong><span>send-ready · {(selectedCampaign?.prospects ?? campaigns.reduce((sum, campaign) => sum + campaign.prospects, 0)).toLocaleString()} total prospects</span></div><div className="candidate-tools"><button className="button secondary" onClick={() => setDispatchSelected(new Set((dispatch?.candidates || []).slice(0, 20).map((row) => row.id)))} disabled={!dispatch?.candidates.length || dispatch?.snapshot.is_running}>Select first {Math.min(20, dispatch?.candidates.length || 20)}</button><button className="quiet-link" onClick={() => setDispatchSelected(new Set(dispatch?.candidates.map((row) => row.id) || []))} disabled={!dispatch?.candidates.length || dispatch?.snapshot.is_running}>Shown only</button></div></div>
                    <Disclosure title="Quick selection"><div className="dispatch-quick-picks" aria-label="Quick select loaded eligible prospects">
                      <span>Quick pick loaded eligible</span>
                      <div>
<button className="quiet-link" onClick={() => void selectAllEligible()} disabled={!dispatch?.eligibleCount || dispatch?.snapshot.is_running || dispatchSelectingAll}>{dispatchSelectingAll ? "Selecting…" : "Select all"}</button>
                        <button type="button" className="quiet-link" onClick={() => setDispatchSelected(selectDispatchCandidateIds(dispatch?.candidates || [], "top5"))} disabled={!dispatch?.candidates.length || dispatch?.snapshot.is_running}>Top 5</button>
                        <button type="button" className="quiet-link" onClick={() => setDispatchSelected(selectDispatchCandidateIds(dispatch?.candidates || [], "direct"))} disabled={!dispatch?.candidates.length || dispatch?.snapshot.is_running}>Direct only</button>
                        <button type="button" className="quiet-link" onClick={() => setDispatchSelected(selectDispatchCandidateIds(dispatch?.candidates || [], "direct_and_department"))} disabled={!dispatch?.candidates.length || dispatch?.snapshot.is_running}>Direct + department</button>
                        <button type="button" className="quiet-link" onClick={() => setDispatchSelected(selectDispatchCandidateIds(dispatch?.candidates || [], "clear"))} disabled={!dispatchSelected.size || dispatch?.snapshot.is_running}>Clear</button>
                      </div>
                      <small>Quick picks use loaded candidates only; load more before selecting from later eligible rows.</small>
                    </div></Disclosure>
                    {dispatchError && dispatch && <div className="panel-feedback" role="alert"><p>{dispatchError}</p><button type="button" className="button secondary" onClick={() => { setDispatchError(""); void loadDispatch().catch((error) => setDispatchError(error.message)); }}>Retry connection</button></div>}
                    <div className="dispatch-candidates" role="group" aria-label="Choose prospects for the email queue">
                      {!dispatch && <div className="empty-state" role={dispatchError ? "alert" : "status"}>{dispatchError || "Connecting to the email service…"}{dispatchError && <button className="button secondary" onClick={() => { setDispatchError(""); void loadDispatch().catch((error) => setDispatchError(error.message)); }}>Retry connection</button>}</div>}
                      {dispatch && dispatch.candidates.length === 0 && (
                        <div className="empty-state">
                          <div className="empty-state-copy">
                            <p className="empty-state-title">No recipients ready to queue</p>
                            <p className="empty-state-desc">Check approved prospects’ emails, or approve more prospects from your working list to populate the sending queue.</p>
                            {dispatch.heldCounts && (
                              <div className="held-counts-grid">
                                <div className="held-count-item"><strong>{dispatch.heldCounts.needs_approval.toLocaleString()}</strong><span>Need review approval</span></div>
                                <div className="held-count-item"><strong>{dispatch.heldCounts.needs_email_check.toLocaleString()}</strong><span>Need email/MX checks</span></div>
                                <div className="held-count-item"><strong>{dispatch.heldCounts.sent_or_suppressed.toLocaleString()}</strong><span>Sent or suppressed</span></div>
                                <div className="held-count-item"><strong>{dispatch.heldCounts.government.toLocaleString()}</strong><span>Government excluded</span></div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      {dispatch?.candidates.map((row) => <label className={`dispatch-candidate${dispatchSelected.has(row.id) ? " selected" : ""}`} key={row.id}><input type="checkbox" checked={dispatchSelected.has(row.id)} disabled={dispatch.snapshot.is_running} onChange={(event) => setDispatchSelected((current) => { const next = new Set(current); event.target.checked ? next.add(row.id) : next.delete(row.id); return next; })} /><span className="company-monogram">{row.company.slice(0, 1).toUpperCase()}</span><span className="company-copy"><strong>{row.company}</strong><small>{campaigns.find((campaign) => campaign.id === row.campaignId)?.name || row.status || "Prospect"}{row.emailTier ? ` · ${row.emailTier === "department" ? "HR / department" : row.emailTier}` : ""}{row.autoApprovalEligible ? " · auto-approval eligible" : ""}</small></span><span className="fit-cell">{row.fit ?? "—"}</span></label>)}
                    </div>
                    {dispatch?.hasMore && <button className="load-more dispatch-load-more" disabled={dispatchPaging || dispatch.snapshot.is_running} onClick={() => void loadMoreDispatchCandidates()}>{dispatchPaging ? "Loading…" : `Load next 100 · ${dispatch.candidates.length} of ${dispatch.eligibleCount.toLocaleString()}`}<Glyph name="arrow" /></button>}
                    <div className="dispatch-footer"><span>{dispatch?.hasMore ? `${dispatch.candidates.length} of ${dispatch.eligibleCount.toLocaleString()} shown` : "Only selected recipients will be queued"}</span><span>{dispatchSelected.size.toLocaleString()} selected</span></div>
                    <section className="message-step" aria-labelledby="message-step-title"><h3 id="message-step-title">Messages</h3><div className="dispatch-message-controls">
                      <label className="dispatch-template"><span>Variant A</span><select aria-label="Variant A" value={templateAName} onChange={(event) => setTemplateAName(event.target.value)} disabled={!dispatch?.templates.length || dispatch.snapshot.is_running}><option value="">Choose template A</option>{dispatch?.templates.map((template) => <option key={template.name} value={template.name}>{template.name}{template.isDefault ? " · default" : ""}</option>)}</select></label>
                      <label className="dispatch-template"><span>Variant B</span><select aria-label="Variant B" value={templateBName} onChange={(event) => setTemplateBName(event.target.value)} disabled={!dispatch?.templates.length || dispatch.snapshot.is_running}><option value="">Choose template B</option>{dispatch?.templates.map((template) => <option key={template.name} value={template.name}>{template.name}{template.isDefault ? " · default" : ""}</option>)}</select></label>
</div>                    <CampaignEmailPreview campaignId={campaignScope} templateAName={templateAName} templateBName={templateBName} selectedRecipients={previewRecipients} />
</section>

                  </div>
                  <div className="dispatch-panel run-panel">
                    <div className="dispatch-panel-head"><h2>Sending</h2><span className={`mode-chip${!dispatchError && dispatch?.snapshot.live_dispatch ? " live" : ""}`}>{dispatchError ? "UNAVAILABLE" : !dispatch ? "CONNECTING" : dispatch.snapshot.live_dispatch ? "LIVE MODE" : "DRY RUN"}</span></div>
                    <div className="sender-summary" aria-label="Sender configuration">{senders.map((sender) => <a key={sender.id} href="/mailboxes"><span>{sender.email}</span><strong className={sender.status === "ERROR" ? "send-error" : ""}>{sender.status === "ACTIVE" ? "Enabled" : sender.health}</strong></a>)}{!senders.length && <a href="/mailboxes">Set up a sender <Glyph name="arrow" /></a>}</div>
                    <div className="run-status-row"><span><i className={`status-dot${!dispatchError && dispatch?.snapshot.is_running ? " connected" : ""}`} />{dispatchStatusLabel(dispatchError ? null : dispatch?.snapshot)}{!dispatchError && dispatch?.snapshot.is_running && dispatch.snapshot.schedule_override_active ? " · Window override active" : ""}</span><span>{dispatchError ? "—" : dispatch?.snapshot.queue_pending ?? "—"} queued · {dispatchError ? "—" : dispatch?.snapshot.sent_today ?? "—"} accepted today</span></div>
                    {Boolean(dispatch?.snapshot.uncertain_count) && <p role="alert" className="send-error">{dispatch?.snapshot.uncertain_count} message(s) held after an uncertain SMTP attempt. Review Activity before retrying; these are not automatically resent.</p>}
                    {dispatch?.snapshot.has_error && <p role="alert" className="send-error">Sending stopped with an error. <a href="/activity">Check Activity</a> before retrying.</p>}
                    {!dispatchError && dispatch?.snapshot.is_running && !dispatch.snapshot.is_paused && Boolean(dispatch.snapshot.next_send_timestamp) && <p className="next-send" role="status">Next eligible attempt: {new Date(dispatch.snapshot.next_send_timestamp! * 1000).toLocaleString()}</p>}
                    <div className="run-actions">{dispatch?.snapshot.is_running ? <>
                      <button className="button primary" disabled={dispatchControlsDisabled} onClick={() => void dispatchAction({ action: "pause" })}>{dispatchBusy ? "Working…" : dispatch.snapshot.is_paused ? "Resume schedule" : "Pause schedule"}</button>
                      {dispatch.snapshot.live_dispatch && dispatch.snapshot.schedule_override_supported && !dispatch.snapshot.schedule_override_active && <button className="button danger-button" disabled={dispatchControlsDisabled || dispatch.snapshot.is_paused} onClick={() => setConfirmScheduleOverride(true)}>Send pending now</button>}
                      <button className="button stop-button" disabled={dispatchControlsDisabled} onClick={() => void dispatchAction({ action: "stop" })}>Stop run</button>
                    </> : <button className="button primary" disabled={Boolean(startBlockReason({ available: Boolean(dispatch) && !dispatchError, busy: dispatchBusy, selected: dispatchSelected.size, templateA: templateAName, templateB: templateBName }))} aria-describedby="send-help" onClick={() => dispatch?.snapshot.live_dispatch ? setConfirmLiveStart(true) : void startDispatch(false)}>{dispatchBusy ? "Starting…" : `Start ${dispatch?.snapshot.live_dispatch ? "sending" : "dry run"} · ${dispatchSelected.size}`}</button>}
                      <label className="live-setting"><span><strong>Live delivery</strong><small>{dispatchError || !dispatch ? "Delivery status unavailable" : dispatch.snapshot.live_dispatch ? "Real emails can be sent" : "Dry run only · no emails sent"}</small></span><button type="button" className={`switch${dispatch?.snapshot.live_dispatch ? " on" : ""}`} role="switch" aria-checked={Boolean(dispatch?.snapshot.live_dispatch)} aria-label="Live email delivery" disabled={dispatchControlsDisabled || dispatch?.snapshot.is_running} onClick={() => requestLiveMode(!dispatch?.snapshot.live_dispatch)}><i /></button></label>
                    </div>
                    {!dispatchError && !dispatch?.snapshot.is_running && <p id="send-help" className="dispatch-footnote" role="status">{startBlockReason({ available: Boolean(dispatch), busy: dispatchBusy, selected: dispatchSelected.size, templateA: templateAName, templateB: templateBName })}</p>}

                  </div>
                </div>

              </div>
            </section>}

            {page === "settings" && <section className="page-content" aria-label="Settings">
              <div className="settings-columns">
                <div className="setup-links">
                  <a href="/mailboxes"><Icon path="M3 5h18v14H3z M3 5l9 7 9-7" size={24} /><span><strong>Senders</strong><small>{mailboxCount} saved</small></span><Glyph name="arrow" /></a>
                  <a href="/playbooks"><Icon path="M4 5h16 M4 12h16 M4 19h10 M7 2v6 M17 9v6" size={24} /><span><strong>Campaign setup</strong></span><Glyph name="arrow" /></a>
                  <a href="/email-preflight?return=settings"><Glyph name="check" /><span><strong>Email checks</strong></span><Glyph name="arrow" /></a>
                </div>
                <Disclosure title="Domain & deliverability tools"><DnsDeliverabilityTools /></Disclosure>
                {sendingSettings}
              </div>
            </section>}
          </>
        )}
      </main>

      {modal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setModal(null); }}>
        <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div className="modal-heading"><div><span className="eyebrow">{modal === "campaign" ? "A clear audience first" : "One company at a time"}</span><h2 id="modal-title">{modal === "campaign" ? "New campaign" : "Add a prospect"}</h2></div><button className="icon-button" disabled={saving} onClick={() => setModal(null)} aria-label="Close dialog"><Glyph name="close" /></button></div>
          <form onSubmit={(event) => void submitForm(event)}>
            {modal === "campaign" ? <><label htmlFor="campaign-name">Campaign name</label><input id="campaign-name" name="name" required maxLength={140} data-autofocus placeholder="e.g. Singapore manufacturers" /><label htmlFor="campaign-audience">Who is it for?</label><textarea id="campaign-audience" name="audience" rows={3} maxLength={240} placeholder="A short description of the audience" /><p className="form-note">This saves a draft only. Nothing sends.</p></> : <><label htmlFor="prospect-company">Company name</label><input id="prospect-company" name="company" required maxLength={160} data-autofocus placeholder="Company name" /><div className="form-grid"><div><label htmlFor="prospect-location">Location</label><input id="prospect-location" name="location" maxLength={120} placeholder="City or region" /></div><div><label htmlFor="prospect-sector">Sector</label><input id="prospect-sector" name="sector" maxLength={120} placeholder="Industry" /></div></div><p className="form-note">Added as Ready to Review. Verify the source before outreach.</p></>}
            <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setModal(null)} disabled={saving}>Cancel</button><button type="submit" className="button primary" disabled={saving}>{saving ? "Saving…" : modal === "campaign" ? "Save draft" : "Add prospect"}<Glyph name="arrow" /></button></div>
          </form>
        </section>
      </div>}

      {confirmLiveStart && <div className="modal-backdrop" role="presentation"><section className="modal-card confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="live-start-title"><div className="modal-heading"><div><span className="eyebrow">Final check</span><h2 id="live-start-title">Send real emails?</h2></div><button className="icon-button" onClick={() => setConfirmLiveStart(false)} aria-label="Close dialog"><Glyph name="close" /></button></div><p>This will randomly assign {dispatchSelected.size} selected prospects as evenly as possible: {templateAName} vs. {templateBName}. Each recipient keeps its variant through retries in this run. Delivery follows the campaign’s local weekday schedule and existing per-mailbox limits.</p><div className="modal-actions"><button className="button secondary" onClick={() => setConfirmLiveStart(false)}>Go back</button><button className="button danger-button" disabled={dispatchBusy} onClick={() => void startDispatch(true)}>Confirm and start</button></div></section></div>}
      {confirmScheduleOverride && <div className="modal-backdrop" role="presentation"><section className="modal-card confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="schedule-override-title"><div className="modal-heading"><div><span className="eyebrow">Active run · final check</span><h2 id="schedule-override-title">Send pending recipients now?</h2></div><button className="icon-button" onClick={() => setConfirmScheduleOverride(false)} aria-label="Close dialog"><Glyph name="close" /></button></div><p>This skips the saved weekday and local-hour window for the remaining {dispatch?.snapshot.queue_pending ?? 0} recipients in this run. Live delivery can begin immediately. Approval, current email/source checks, suppression, A/B assignment, warmup, and mailbox daily/hourly limits still apply. Saved campaign hours will not change.</p><div className="modal-actions"><button className="button secondary" onClick={() => setConfirmScheduleOverride(false)}>Keep schedule</button><button className="button danger-button" disabled={dispatchBusy || !dispatch?.snapshot.live_dispatch || !dispatch.snapshot.is_running || dispatch.snapshot.is_paused} onClick={() => void overrideCurrentSchedule()}>Confirm send now</button></div></section></div>}
      {confirmLiveMode !== null && <div className="modal-backdrop" role="presentation"><section className="modal-card confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="live-mode-title"><div className="modal-heading"><div><span className="eyebrow">Delivery mode</span><h2 id="live-mode-title">{confirmLiveMode ? "Enable real email delivery?" : "Return to dry run?"}</h2></div><button className="icon-button" onClick={() => setConfirmLiveMode(null)} aria-label="Close dialog"><Glyph name="close" /></button></div><p>{confirmLiveMode ? "Runs can send external email to every selected prospect. A separate confirmation will still be required each time you start a live run." : "Future runs will simulate delivery and will not send emails."}</p><div className="modal-actions"><button className="button secondary" onClick={() => setConfirmLiveMode(null)}>Cancel</button><button className={`button${confirmLiveMode ? " danger-button" : " primary"}`} disabled={dispatchBusy} onClick={() => void setLiveMode(confirmLiveMode)}>{confirmLiveMode ? "Enable live mode" : "Use dry run"}</button></div></section></div>}

      {notice && <div className={`toast${notice.tone === "error" ? " toast-error" : ""}`} role={notice.tone === "error" ? "alert" : "status"} aria-live={notice.tone === "error" ? "assertive" : "polite"}><Glyph name={notice.tone === "ok" ? "check" : "close"} />{notice.text}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><Glyph name="close" /></button></div>}
      <div className={`mobile-detail-backdrop${page === "prospects" && detailOpen ? " visible" : ""}`} aria-hidden="true" onClick={() => !stageSaving && setDetailOpen(false)} />
    </div>
  );
}

function CampaignScopeSelect({ campaigns, value, onChange, disabled = false }: { campaigns: Campaign[]; value: string; onChange: (id: string) => void; disabled?: boolean }) {
  return <label className="campaign-scope"><span>Campaign scope</span><select aria-label="Campaign scope" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="all">All campaigns</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>;
}

function ProspectList({ rows, selectedId, onSelect, empty, hasMore = false, loadingMore = false, onMore }: { rows: Prospect[]; selectedId: string; onSelect: (row: Prospect) => void; empty: string; hasMore?: boolean; loadingMore?: boolean; onMore?: () => void }) {
  return <div className="prospect-list">
    <div className="list-head"><span>Company</span><span>Signal</span><span>Stage</span><span>Fit</span></div>
    {rows.length === 0 ? <div className="empty-state">{empty}</div> : rows.map((row) => <button key={row.id} className={`prospect-row${row.id === selectedId ? " selected" : ""}`} onClick={() => onSelect(row)} aria-label={`Open ${row.company}`} aria-description={`${stageLabel(row.status)}. ${row.location || "Location unknown"}. Fit ${row.fit ?? "unknown"}.`}>
      <span className="company-cell"><span className="company-monogram">{row.company.trim().charAt(0).toUpperCase()}</span><span className="company-copy"><strong>{row.company}</strong>{(row.location || row.sector) && <small>{row.location || row.sector}</small>}<small className="prospect-row-meta">{row.hiringSignal && <span title="Recorded hiring signal; current hiring not confirmed">Hiring signal · </span>}{row.emailTier === "missing" ? "No email" : row.emailTier === "direct" ? "Personal-address pattern" : "Company email"}{row.isGovernment ? " · Public sector" : ""}</small></span></span>
      {(row.signal || row.sector) && <span className="signal-cell">{row.signal || row.sector}</span>}
      <span className={`stage-badge ${stageTone(row.status)}`}><i />{stageLabel(row.status)}</span>
      <span className="fit-cell">{row.fit ?? "—"}</span>
      <span className="mobile-row-arrow" aria-hidden="true"><Glyph name="arrow" /></span>
    </button>)}
    {hasMore && onMore && <button className="load-more" onClick={onMore} disabled={loadingMore}>{loadingMore ? "Loading more…" : "Load next 100 prospects"}<Glyph name="arrow" /></button>}
  </div>;
}

function DetailPanel({ prospect, campaignScope, loading, error, onRetry, onStage, onClose, mobileOpen, mobileLayout, saving }: { prospect: Prospect | null; campaignScope: string; loading: boolean; error: string; onRetry: () => void; onStage: (stage: string) => void; onClose: () => void; mobileOpen: boolean; mobileLayout: boolean; saving: boolean }) {
  return <aside className={`detail-panel${mobileOpen ? " detail-mobile-open" : ""}`} aria-label="Selected prospect details" role={mobileLayout && mobileOpen ? "dialog" : undefined} aria-modal={mobileLayout && mobileOpen ? true : undefined}>
    <div className="detail-head"><span className="eyebrow">Prospect detail</span><button className="icon-button detail-close" disabled={saving} onClick={onClose} aria-label="Close prospect details"><Glyph name="close" /></button></div>
    {loading ? <p role="status">Loading contact details…</p> : error ? <div role="alert"><p>{error}</p><button className="button secondary" onClick={onRetry}>Retry contact</button></div> : !prospect ? (
      <div className="detail-placeholder">
        <div className="placeholder-icon-wrap">
          <Glyph name="search" />
        </div>
        <h3>No prospect selected</h3>
        <p>Select a company to review its contact, email-source evidence and recorded signals.</p>
      </div>
    ) : <>
      <span className={`stage-badge ${stageTone(prospect.status)}`}><i />{stageLabel(prospect.status)}</span>
      <h2 className="detail-company">{prospect.company}</h2>
      <p className="detail-location">{[prospect.location, prospect.sector].filter(Boolean).join(" · ") || "Location not set"}{prospect.fit != null ? ` · Fit ${prospect.fit}` : ""}</p>
      <div className="detail-rule" />
      <dl className="detail-facts">
        <dt>Signal</dt><dd>{prospect.signal || prospect.summary || "No signal recorded yet."}</dd>
        <dt>Contact</dt><dd>{prospect.buyer ? `${prospect.buyer}${prospect.title ? ` · ${prospect.title}` : ""}` : "No contact recorded"}</dd>
        {prospect.email && <><dt>Email</dt><dd><a href={`mailto:${prospect.email}`}>{prospect.email}</a></dd></>}
        {prospect.phone && <><dt>Phone</dt><dd><a href={`tel:${prospect.phone}`}>{prospect.phone}</a></dd></>}
        {prospect.source && <><dt>Recorded source</dt><dd><a className="source-link" href={prospect.source} target="_blank" rel="noreferrer">Open evidence <Glyph name="external" /></a></dd></>}
      </dl>
      <label className="stage-label" htmlFor="prospect-stage">Status</label>
       <select id="prospect-stage" className="stage-select" disabled={saving} value={prospect.status || "Ready to Review"} onChange={(event) => void onStage(event.target.value)}>{prospect.status && !stageOptions.includes(prospect.status) && <option value={prospect.status}>{stageLabel(prospect.status)} · imported</option>}{primaryStages.map((item) => <option key={item} value={item}>{stageLabel(item)}</option>)}<optgroup label="Other stages">{stageOptions.filter((item) => !primaryStages.includes(item)).map((item) => <option key={item} value={item}>{stageLabel(item)}</option>)}</optgroup></select>
      {prospect.status === "Ready to Review" && <button className="button primary" disabled={saving} onClick={() => void onStage("Approved for Outreach")}>Approve for outreach <Glyph name="check" /></button>}
    </>}
  </aside>;
}
