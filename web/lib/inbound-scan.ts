type InboundScanRequest = { mailboxId: number; maxMessages: number };

type InboundScanResult = {
  status: "SUCCESS";
  messages_checked: number;
  replies_processed: number;
  bounces_processed: number;
  opt_outs_processed: number;
  unrelated: number;
  already_processed: number;
  oversized_skipped: number;
};

const SAFE_ERRORS = new Set([
  "Confirm the read-only inbound scan in the operator desk.",
  "The selected mailbox is invalid.",
  "Choose between 1 and 20 recent messages.",
  "The selected mailbox was not found.",
  "The selected mailbox has no saved login credential.",
  "Inbound scan requires a Microsoft or Google mailbox provider.",
  "Mailbox authentication failed; no message content was changed.",
  "The inbox did not provide a usable message cursor.",
  "The bounded inbound scan reached its time limit; retry to continue.",
  "The mailbox did not provide a usable message cursor.",
  "The inbox could not be opened in read-only mode.",
  "Recent inbox messages could not be listed.",
  "Local reply and suppression tables are unavailable.",
  "An inbound message exceeded the safe scan size limit.",
  "An inbound scan is already running.",
  "Inbound scan failed. Mailbox credentials and server details were not returned.",
]);

export function normalizeInboundScanRequest(value: unknown): InboundScanRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Request details are required.");
  }
  const body = value as Record<string, unknown>;
  if (body.confirmed !== true) throw new TypeError("Confirm the read-only inbound scan in the operator desk.");
  if (typeof body.mailboxId !== "number" || !Number.isSafeInteger(body.mailboxId) || body.mailboxId < 1) {
    throw new TypeError("The selected mailbox is invalid.");
  }
  const maxMessages = body.maxMessages === undefined ? 15 : body.maxMessages;
  if (typeof maxMessages !== "number" || !Number.isSafeInteger(maxMessages) || maxMessages < 1 || maxMessages > 20) {
    throw new TypeError("Choose between 1 and 20 recent messages.");
  }
  return { mailboxId: body.mailboxId, maxMessages };
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 20 ? value : 0;
}

export function sanitizeInboundScanResult(value: unknown): InboundScanResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (result.status !== "SUCCESS") return null;
  return {
    status: "SUCCESS",
    messages_checked: count(result.messages_checked),
    replies_processed: count(result.replies_processed),
    bounces_processed: count(result.bounces_processed),
    opt_outs_processed: count(result.opt_outs_processed),
    unrelated: count(result.unrelated),
    already_processed: count(result.already_processed),
    oversized_skipped: count(result.oversized_skipped),
  };
}

export function canScanInboundMailbox(providerType: string, credentialConfigured: boolean): boolean {
  return credentialConfigured && ["MICROSOFT", "GOOGLE"].includes(String(providerType || "").toUpperCase());
}

export function formatInboundScanSummary(result: InboundScanResult): string {
  return `Read-only scan checked ${result.messages_checked} messages: ${result.replies_processed} replies, ${result.bounces_processed} bounces, ${result.opt_outs_processed} opt-outs recorded. ${result.already_processed} already processed, ${result.unrelated} unrelated, ${result.oversized_skipped} over the size limit. No email was sent.`;
}

export async function proxyInboundScan(
  rawBody: unknown,
  options: { token?: string; port?: string; fetcher?: typeof fetch } = {},
): Promise<Response> {
  let body: InboundScanRequest;
  try {
    body = normalizeInboundScanRequest(rawBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request details are invalid.";
    return Response.json({ error: message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (!options.token) {
    return Response.json({ error: "Local dispatch service is not running. Start the app with npm run dev." }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
  const port = options.port && /^\d{1,5}$/.test(options.port) && Number(options.port) <= 65535 && Number(options.port) > 0
    ? options.port
    : "8765";
  try {
    const response = await (options.fetcher || fetch)(`http://127.0.0.1:${port}/inbound-scan`, {
      method: "POST",
      cache: "no-store",
      headers: { Authorization: `Bearer ${options.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, confirmed: true }),
      signal: AbortSignal.timeout(90_000),
    });
    let payload: unknown;
    try { payload = await response.json(); }
    catch { payload = null; }
    if (!response.ok) {
      const candidate = payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : "";
      const error = SAFE_ERRORS.has(candidate) ? candidate : "Inbound scan failed. Mailbox credentials and server details were not returned.";
      return Response.json({ error }, { status: response.status, headers: { "Cache-Control": "no-store" } });
    }
    const safe = sanitizeInboundScanResult(payload);
    if (!safe) {
      return Response.json({ error: "Inbound scan returned an invalid result." }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json(safe, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Inbound scan failed. Mailbox credentials and server details were not returned." }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}
