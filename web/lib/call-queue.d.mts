import type Database from "better-sqlite3";
import type { ProspectFilters, ProspectResultRow } from "./prospects";

export type CallQueueCategory = "callable" | "hiring_first" | "high_priority" | "all_active";
export class CallQueueFilterError extends Error {}

export function parseCallQueueFilters(params: URLSearchParams): {
  category: CallQueueCategory;
  scriptStyle: "all" | "original";
  prospects: ProspectFilters;
};

export function getCallQueue(
  db: Database.Database,
  filters: { category: CallQueueCategory; scriptStyle?: "all" | "original"; prospects: ProspectFilters },
): { rows: ProspectResultRow[]; total: number; hasMore: boolean };
