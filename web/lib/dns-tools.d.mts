export const DNSBL_SERVICES: Array<{ host: string; name: string }>;
export const DNS_DOWNLOADS: Record<string, { filename: string; mimeType: string }>;
export const DNS_RECORD_GUIDANCE: Array<{ record: string; purpose: string }>;
export function normalizeDnsDomain(value: unknown): string | null;
export function checkDomainDnsblReputation(
  value: unknown,
  lookup: (queryTarget: string) => Promise<string[]>,
): Promise<
  | { error: string }
  | { domain: string; is_listed: boolean; overall_status: "LISTED" | "INCOMPLETE" | "CLEAN"; checks: Array<{ service: string; status: "LISTED" | "QUERY_TIMEOUT" | "CLEAN"; return_code?: string }> }
>;
