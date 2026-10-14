import type Database from "better-sqlite3";
import { classifyEmailTier } from "./email-tier.mjs";

export type DispatchCandidateTier = "direct" | "department" | "generic" | "system" | "missing";
export type DispatchQuickPick = "top5" | "direct" | "direct_and_department" | "clear";
export type DispatchPickCandidate = { id: string; emailTier?: DispatchCandidateTier | null };

export function selectDispatchCandidateIds(candidates: readonly DispatchPickCandidate[], pick: DispatchQuickPick): Set<string> {
  switch (pick) {
    case "top5": return new Set(candidates.slice(0, 5).map((candidate) => candidate.id));
    case "direct": return new Set(candidates.filter((candidate) => candidate.emailTier === "direct").map((candidate) => candidate.id));
    case "direct_and_department": return new Set(candidates.filter((candidate) => candidate.emailTier === "direct" || candidate.emailTier === "department").map((candidate) => candidate.id));
    case "clear": return new Set();
    default: {
      const exhaustive: never = pick;
      return exhaustive;
    }
  }
}

export function getDispatchCandidateEmailTiers(db: Database.Database, candidateIds: readonly string[]) {
  const ids = [...new Set(candidateIds.filter((id) => id.length > 0))];
  if (ids.length === 0) return new Map<string, DispatchCandidateTier>();
  const placeholders = ids.map(() => "?").join(", ");
  const rawRows: unknown[] = db.prepare(`SELECT lead_id AS id, contact_email AS email, buyer_name AS buyer
    FROM prospects WHERE lead_id IN (${placeholders})`).all(...ids);
  const tiers = new Map<string, DispatchCandidateTier>();
  for (const value of rawRows) {
    if (typeof value !== "object" || value === null || !("id" in value) || typeof value.id !== "string") continue;
    const email = "email" in value && typeof value.email === "string" ? value.email : null;
    const buyer = "buyer" in value && typeof value.buyer === "string" ? value.buyer : null;
    tiers.set(value.id, classifyEmailTier(email, buyer));
  }
  return tiers;
}
