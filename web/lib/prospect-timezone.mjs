export function prospectTimezone(location, campaignId) {
  const place = String(location || "").toLowerCase();
  if (/california|san francisco|palo alto|seattle|los angeles|silicon valley|bay area/.test(place)) return { name: "America/Los_Angeles", label: "Pacific", reference: false };
  if (/montreal|montréal|toronto|ottawa/.test(place)) return { name: "America/Toronto", label: "Eastern", reference: false };
  if (/new york|boston|miami|atlanta|charlotte|philadelphia|brooklyn|delaware/.test(place)) return { name: "America/New_York", label: "Eastern", reference: false };
  if (/chicago|austin|dallas|houston/.test(place)) return { name: "America/Chicago", label: "Central", reference: false };
  if (/singapore/.test(place)) return { name: "Asia/Singapore", label: "Singapore", reference: false };
  if (/malaysia|johor|kuala lumpur|selangor|penang|senai|skudai|kulai|pasir gudang/.test(place)) return { name: "Asia/Kuala_Lumpur", label: "Malaysia", reference: false };
  return String(campaignId || "").toLowerCase().includes("yc")
    ? { name: "America/Los_Angeles", label: "Pacific", reference: true }
    : { name: "Asia/Kuala_Lumpur", label: "Malaysia", reference: true };
}
