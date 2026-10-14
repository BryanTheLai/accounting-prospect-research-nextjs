import { dbError, openDatabase } from "@/lib/db";
import {
  applyMailboxAction,
  listMailboxes,
  listSuppressions,
  MailboxInputError,
  MailboxNotFoundError,
  MailboxSchemaError,
} from "@/lib/mailboxes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function responseError(error: unknown) {
  if (error instanceof MailboxInputError) return Response.json({ error: error.message }, { status: 400 });
  if (error instanceof MailboxNotFoundError) return Response.json({ error: error.message }, { status: 404 });
  if (error instanceof MailboxSchemaError) return Response.json({ error: error.message }, { status: 503 });
  return dbError(error);
}

export async function GET() {
  let db;
  try {
    db = openDatabase();
    return Response.json({ mailboxes: listMailboxes(db), suppressions: listSuppressions(db) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return responseError(error);
  } finally {
    db?.close();
  }
}

export async function POST(request: Request) {
  let db;
  try {
    const body = await request.json();
    db = openDatabase(false);
    const { result, status } = applyMailboxAction(db, body);
    let senderNotified = false;
    if (process.env.OUTBOUNDER_CONTROL_TOKEN && body.action !== "suppress") {
      try {
        const response = await fetch(`http://127.0.0.1:${process.env.OUTBOUNDER_DISPATCHER_PORT || "8765"}/limits-changed`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OUTBOUNDER_CONTROL_TOKEN}` },
          body: "{}", signal: AbortSignal.timeout(1500),
        });
        senderNotified = response.ok;
      } catch { /* Saved settings are durable; an offline sender reads them on recovery. */ }
    }
    return Response.json({ ...result, senderNotified }, { status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
    return responseError(error);
  } finally {
    db?.close();
  }
}
