import type { MxRecord, IPv4Address } from "node:dns";

export function resolveMx(domain: string): Promise<MxRecord[]>;
export function resolve4(hostname: string): Promise<IPv4Address[]>;
export function resetDnsResolverCache(): void;