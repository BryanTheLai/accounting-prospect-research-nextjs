export function companyWebsiteUrl(rawDomain: string | null | undefined): string | null;
export function linkedinSearchUrl(buyerName: string | null | undefined, companyName: string | null | undefined): string | null;
export function followupSummaryText(companyName: string | null | undefined, buyerName: string | null | undefined, campaignId?: string | null, software?: string | null): string;
export function formatCallScript(rawScript: string | null | undefined, greeting: string): string;
export function callPlaybook(campaignId?: string | null): { objections: { objection: string; response: string }[]; summaryTemplate: string };
export const CALL_OBJECTIONS: readonly { objection: string; response: string }[];
