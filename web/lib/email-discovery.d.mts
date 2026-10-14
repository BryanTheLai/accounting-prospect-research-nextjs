export type DiscoveredEmailKind = "system_or_support" | "generic" | "unclassified";

export type DiscoveredEmailCandidate = {
  email: string;
  kind: DiscoveredEmailKind;
  sourceUrls: string[];
};

export type EmailDiscoveryResult = {
  status: "found" | "no_candidates" | "unreachable" | "invalid_domain";
  pagesCrawled: number;
  candidates: DiscoveredEmailCandidate[];
};

export function isPublicIpv4(address: string): boolean;
export function normalizeCompanyDomain(value: unknown): string | null;
export function classifyDiscoveredAddress(email: string): DiscoveredEmailKind;
export function discoverEmailsForDomain(
  value: unknown,
  options?: {
    resolveHost?: (hostname: string) => Promise<string[]>;
    fetchHtml?: (url: URL, pinnedAddress: string) => Promise<string | null>;
  },
): Promise<EmailDiscoveryResult>;
