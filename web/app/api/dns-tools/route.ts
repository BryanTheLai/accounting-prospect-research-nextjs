import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolve4 } from "@/lib/dns-resolver.mjs";
import {
  checkDomainDnsblReputation,
  DNSBL_SERVICES,
  DNS_DOWNLOADS,
  DNS_RECORD_GUIDANCE,
  normalizeDnsDomain,
} from "@/lib/dns-tools.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dnsDataDirectory = resolve(process.cwd(), "..");

async function sourceFileExists(filename: string) {
  try {
    await access(resolve(dnsDataDirectory, filename));
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const downloadKey = url.searchParams.get("download");
  if (downloadKey !== null) {
    const source = DNS_DOWNLOADS[downloadKey];
    if (!source) return Response.json({ error: "Choose bind or cloudflare." }, { status: 400 });
    try {
      const content = await readFile(resolve(dnsDataDirectory, source.filename));
      return new Response(new Uint8Array(content), {
        headers: {
          "Content-Type": `${source.mimeType}; charset=utf-8`,
          "Content-Disposition": `attachment; filename="${source.filename}"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return Response.json({ error: "That DNS source file is not available in this workspace." }, { status: 404 });
    }
  }

  const configuredDomain = normalizeDnsDomain(process.env.PRIMARY_DOMAIN || "openclose-desk.com");
  const downloads = Object.fromEntries(await Promise.all(
    Object.entries(DNS_DOWNLOADS).map(async ([key, source]) => [
      key,
      { filename: source.filename, available: await sourceFileExists(source.filename) },
    ]),
  ));
  return Response.json({
    domain: configuredDomain,
    providers: DNSBL_SERVICES.map(({ name }) => name),
    guidance: DNS_RECORD_GUIDANCE,
    downloads,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON request." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Request body must be an object." }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  if (input.action !== "check") {
    return Response.json({ error: "DNSBL lookups require an explicit check action." }, { status: 400 });
  }
  const domain = normalizeDnsDomain(input.domain);
  if (!domain) return Response.json({ error: "Enter a valid domain name, such as openclose-desk.com." }, { status: 400 });

  const result = await checkDomainDnsblReputation(domain, resolve4);
  if ("error" in result) return Response.json(result, { status: 400 });
  return Response.json({ ...result, checked_at: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
