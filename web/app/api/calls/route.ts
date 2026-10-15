import { dbError, openDatabase } from "@/lib/db";
import { CallInputError, getCallDashboard, parseCallInput, saveCallOutcome } from "@/lib/calls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let db;
  try {
    const url = new URL(request.url);
    const campaignId = (url.searchParams.get("campaignId") || "all").trim();
    if (!campaignId || campaignId.length > 120) {
      return Response.json({ error: "Choose a valid campaign scope." }, { status: 400 });
    }
    db = openDatabase();
    return Response.json(getCallDashboard(db, campaignId));
  } catch (error) {
    return dbError(error);
  } finally {
    db?.close();
  }
}

export async function POST(request: Request) {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON request." }, { status: 400 });
  }

  let input;
  try {
    input = parseCallInput(parsed);
  } catch (error) {
    return Response.json({ error: error instanceof CallInputError ? error.message : "Invalid call outcome." }, { status: 400 });
  }

  let db;
  try {
    db = openDatabase(false);
    const callId = saveCallOutcome(db, input);
    if (callId === null) return Response.json({ error: "Prospect not found." }, { status: 404 });
    return Response.json({ ok: true, callId }, { status: 201 });
  } catch (error) {
    return dbError(error);
  } finally {
    db?.close();
  }
}
