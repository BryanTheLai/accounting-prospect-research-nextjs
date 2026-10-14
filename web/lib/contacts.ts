import type Database from "better-sqlite3";
import { invalidateEmailPreflight, validateEmailSyntax } from "./email-preflight-core.mjs";

export class ContactInputError extends Error {}

export type ContactUpdate = {
  leadId: string;
  buyer?: string;
  title?: string;
  email?: string;
  phone?: string;
};

function textField(input: Record<string, unknown>, field: string, maxLength: number) {
  if (!(field in input)) return undefined;
  const value = input[field];
  if (value !== null && typeof value !== "string") throw new ContactInputError(`${field} must be text.`);
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized.length > maxLength) throw new ContactInputError(`${field} must be ${maxLength} characters or fewer.`);
  return normalized;
}

export function parseContactUpdate(body: unknown): ContactUpdate {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ContactInputError("Request body must be an object.");
  const input = body as Record<string, unknown>;
  const leadId = typeof input.leadId === "string" ? input.leadId.trim() : "";
  if (!leadId || leadId.length > 240) throw new ContactInputError("A valid prospect id is required.");

  const buyer = textField(input, "buyer", 160);
  const title = textField(input, "title", 160);
  const email = textField(input, "email", 254);
  const phone = textField(input, "phone", 120);
  if ([buyer, title, email, phone].every((value) => value === undefined)) {
    throw new ContactInputError("Include at least one contact field to update.");
  }
  if (email && !validateEmailSyntax(email).valid) throw new ContactInputError("Enter a syntactically valid email address or leave it blank.");
  return { leadId, buyer, title, email, phone };
}

export function updateProspectContact(db: Database.Database, input: ContactUpdate) {
  const assignments: string[] = [];
  const values: string[] = [];
  if (input.buyer !== undefined) { assignments.push("buyer_name = ?"); values.push(input.buyer); }
  if (input.title !== undefined) { assignments.push("buyer_title = ?"); values.push(input.title); }
  if (input.email !== undefined) { assignments.push("contact_email = ?"); values.push(input.email); }
  if (input.phone !== undefined) { assignments.push("contact_phone = ?"); values.push(input.phone); }

  return db.transaction(() => {
    const prior = db.prepare("SELECT lead_id, contact_email FROM prospects WHERE lead_id = ?").get(input.leadId) as {
      lead_id: string; contact_email: string | null;
    } | undefined;
    if (!prior) return null;

    const exactEmailChanged = input.email !== undefined && input.email !== (prior.contact_email || "");
    db.prepare(`UPDATE prospects SET ${assignments.join(", ")} WHERE lead_id = ?`).run(...values, input.leadId);
    if (exactEmailChanged) invalidateEmailPreflight(db, input.leadId, input.email!);

    const contact = db.prepare(`SELECT lead_id AS leadId, buyer_name AS buyer, buyer_title AS title,
      contact_email AS email, contact_phone AS phone FROM prospects WHERE lead_id = ?`).get(input.leadId);
    return { contact, emailPreflightInvalidated: exactEmailChanged };
  })();
}
