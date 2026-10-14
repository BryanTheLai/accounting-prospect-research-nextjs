import { openDatabase } from "@/lib/db";
import { getDispatchCandidateEmailTiers } from "@/lib/dispatch-selection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function control(path: string, method: "GET" | "POST", body?: unknown) {
  const token = process.env.OUTBOUNDER_CONTROL_TOKEN;
  if (!token) return Response.json({ error: "Local dispatch service is not running. Start the app with npm run dev." }, { status: 503 });
  try {
    const response = await fetch(`http://127.0.0.1:${process.env.OUTBOUNDER_DISPATCHER_PORT || "8765"}${path}`, {
      method,
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(4000),
    });
    const result = await response.json();
    return Response.json(result, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Local dispatch service is unreachable. Restart the app to reconnect it." }, { status: 503 });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("mailboxPacing") === "1") {
    if ([...url.searchParams.keys()].some((key) => key !== "mailboxPacing")) {
      return Response.json({ error: "Unsupported mailbox pacing query." }, { status: 400 });
    }
    return control("/mailbox-pacing", "GET");
  }
  const summary = url.searchParams.get("summary") === "1";
  const params = summary
    ? new URLSearchParams({ summary: "1" })
    : new URLSearchParams({ campaignId: url.searchParams.get("campaignId") || "all" });
  if (!summary && url.searchParams.has("offset")) params.set("offset", url.searchParams.get("offset") || "");
  const response = await control(`/status?${params}`, "GET");
  if (summary || !response.ok) return response;

  const payload: unknown = await response.json();
  if (typeof payload !== "object" || payload === null || !("candidates" in payload) || !Array.isArray(payload.candidates)) {
    return Response.json(payload, { status: response.status, headers: { "Cache-Control": "no-store" } });
  }

  const candidates = payload.candidates;
  const candidateIds = candidates.flatMap((candidate) =>
    typeof candidate === "object" && candidate !== null && "id" in candidate && typeof candidate.id === "string"
      ? [candidate.id]
      : [],
  );
  let emailTiers = new Map<string, string>();
  if (candidateIds.length) {
    const db = openDatabase();
    try { emailTiers = getDispatchCandidateEmailTiers(db, candidateIds); }
    finally { db.close(); }
  }
  const enriched = candidates.map((candidate) =>
    typeof candidate === "object" && candidate !== null && "id" in candidate && typeof candidate.id === "string"
      ? { ...candidate, emailTier: emailTiers.get(candidate.id) || "missing" }
      : candidate,
  );
  return Response.json({ ...payload, candidates: enriched }, { status: response.status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid action request." }, { status: 400 }); }
  const action = body.action;
  if (action === "start") {
    return control("/start", "POST", {
      leadIds: body.leadIds,
      campaignId: body.campaignId,
      templateAName: body.templateAName,
      templateBName: body.templateBName,
      liveConfirmed: body.liveConfirmed === true,
    });
  }
  if (action === "pause") return control("/pause", "POST", {});
  if (action === "stop") return control("/stop", "POST", {});
  if (action === "override_schedule") {
    return control("/override-schedule", "POST", {
      confirmed: body.confirmed === true,
      liveConfirmed: body.liveConfirmed === true,
    });
  }
  if (action === "live") {
    return control("/live", "POST", { enabled: body.enabled === true, confirmed: body.confirmed === true });
  }
  if (action === "mailbox_pacing") {
    return control("/mailbox-pacing", "POST", {
      mailboxId: body.mailboxId,
      dailyLimit: body.dailyLimit,
      hourlyLimit: body.hourlyLimit,
      ...(body.inheritDelay === true ? { inheritDelay: true } : {
        minDelaySeconds: body.minDelaySeconds,
        maxDelaySeconds: body.maxDelaySeconds,
      }),
      confirmed: body.confirmed === true,
      ...(typeof body.manualLimits === "boolean" ? { manualLimits: body.manualLimits } : {}),
    });
  }
  return Response.json({ error: "Unknown dispatch action." }, { status: 400 });
}
