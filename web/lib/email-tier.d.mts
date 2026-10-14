export type ClassifiedEmailTier = "direct" | "department" | "generic" | "system" | "missing";
export function classifyEmailTier(email: string | null, buyerName: string | null): ClassifiedEmailTier;
