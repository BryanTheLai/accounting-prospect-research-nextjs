import type Database from "better-sqlite3";
export function reviewProspects(db: Database.Database, campaignId?: string, apply?: boolean): { reviewed: number; qualified: number; approved: number; held: Record<string, number>; decisions: Array<{ id: string; company: string; reason: string; nextStatus: string }> };
