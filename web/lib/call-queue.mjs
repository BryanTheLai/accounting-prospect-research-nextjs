import { getProspects, parseProspectFilters, ProspectFilterInputError } from "./prospects.ts";

export class CallQueueFilterError extends Error {}

export function parseCallQueueFilters(params) {
  const category = params.get("category") || "callable";
  if (!["callable", "all_active"].includes(category)) throw new CallQueueFilterError("Choose callable leads or all active targets.");
  const prospectParams = new URLSearchParams();
  for (const key of ["q", "campaignId", "limit", "offset"]) {
    if (params.has(key)) prospectParams.set(key, params.get(key));
  }
  prospectParams.set("callable", category === "callable" ? "1" : "0");
  prospectParams.set("minFit", category === "callable" ? "81" : "0");
  prospectParams.set("status", "call_active");
  try { return { category, scriptStyle: "original", prospects: parseProspectFilters(prospectParams) }; }
  catch (error) {
    if (error instanceof ProspectFilterInputError) throw new CallQueueFilterError(error.message);
    throw error;
  }
}

export function getCallQueue(db, filters) {
  return getProspects(db, filters.prospects);
}
