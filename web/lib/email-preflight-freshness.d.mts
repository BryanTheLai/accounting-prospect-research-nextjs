export type EmailPreflightFreshnessRecord = {
  checked_at: string;
  source_confirmed: number;
  source_confirmed_at: string | null;
};

export function isEmailPreflightFresh(
  record: EmailPreflightFreshnessRecord | null,
  now?: Date | number,
): boolean;
