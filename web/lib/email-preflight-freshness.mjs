/** Browser-safe freshness check shared by UI. */
export function isEmailPreflightFresh(record, now = new Date()) {
  if (!record || Number(record.source_confirmed) !== 1) return false;
  const currentMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(currentMs)) return false;
  const maxAgeMs = 30 * 24 * 60 * 60 * 1000;
  const allowedFutureSkewMs = 5 * 60 * 1000;
  for (const value of [record.checked_at, record.source_confirmed_at]) {
    if (typeof value !== "string" || !value.trim()) return false;
    if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value.trim())) return false;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp) || timestamp > currentMs + allowedFutureSkewMs || currentMs - timestamp > maxAgeMs) {
      return false;
    }
  }
  return true;
}
