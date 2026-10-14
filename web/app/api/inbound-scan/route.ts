import { proxyInboundScan } from "@/lib/inbound-scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  return proxyInboundScan(body, {
    token: process.env.OUTBOUNDER_CONTROL_TOKEN,
    port: process.env.OUTBOUNDER_DISPATCHER_PORT,
  });
}
