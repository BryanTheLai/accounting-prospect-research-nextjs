import type Database from "better-sqlite3";

export type MxStatus = "not_checked" | "mx_present" | "no_mx" | "invalid_syntax" | "lookup_error";
export type EmailPreflightRecord = {
  lead_id: string;
  email: string;
  mx_status: MxStatus;
  mx_hosts: string;
  checked_at: string;
  source_confirmed: number;
  source_confirmed_at: string | null;
};
export const MX_STATUSES: Readonly<Record<string, MxStatus>>;
export const MX_PRESENT_LABEL: string;
export function validateEmailSyntax(value: unknown): { valid: boolean; domain: string; reason: string };
export function classifyMxLookup(records: unknown, errorCode?: string): { mx_status: MxStatus; hosts: string[] };
export function mxStatusLabel(status: MxStatus): string;
export function isEmailPreflightFresh(record: Pick<EmailPreflightRecord, "checked_at" | "source_confirmed" | "source_confirmed_at"> | null, now?: Date | number): boolean;
export function ensureEmailPreflightTable(db: Database.Database): void;
export function getEmailPreflight(db: Database.Database, leadId: string): EmailPreflightRecord | null;
export function invalidateEmailPreflight(db: Database.Database, leadId: string, exactEmail: string): EmailPreflightRecord;
export function saveMxCheck(db: Database.Database, input: { leadId: string; exactEmail: string; status: MxStatus; hosts: string[]; checkedAt: string }): EmailPreflightRecord;
export function confirmEmailSource(db: Database.Database, input: { leadId: string; exactEmail: string; confirmationEmail: string; sawPublishedAddress: boolean; confirmedAt: string }): EmailPreflightRecord;
