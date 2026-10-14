import streamlitContent from "./streamlit-call-content.json" with { type: "json" };

const roleOnlyBuyer = /^(?:founder|co-founder|ceo|chief executive|managing director|director|owner|manager|head|finance head)\b/i;

export function companyWebsiteUrl(rawDomain) {
  if (typeof rawDomain !== "string") return null;
  const value = rawDomain.trim();
  if (!value || /[\s\\]/.test(value)) return null;

  let url;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
  const hostname = url.hostname.toLowerCase();
  if (!hostname.includes(".") || hostname === "localhost" || /^\d+(?:\.\d+){3}$/.test(hostname)) return null;
  return `${url.protocol}//${url.host}/`;
}

export function linkedinSearchUrl(buyerName, companyName) {
  const query = [buyerName, companyName].map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean).join(" ");
  if (!query) return null;
  const url = new URL("https://www.linkedin.com/search/results/all/");
  url.searchParams.set("keywords", query);
  return url.toString();
}

function cleanLabel(value, fallback) {
  const cleaned = typeof value === "string" ? value.replace(/[\r\n\t]+/g, " ").trim() : "";
  return cleaned || fallback;
}

export function callPlaybook(campaignId = "yc_us_expansion") {
  return campaignId?.toLowerCase().includes("yc") || !campaignId ? streamlitContent.yc : streamlitContent.malaysia;
}

export function formatCallScript(rawScript, greeting) {
  if (typeof rawScript !== "string") return "";
  return rawScript.replaceAll("{time_greeting}", greeting).replace(/\bGood day\b/g, greeting);
}

export function followupSummaryText(companyName, buyerName, campaignId, software) {
  const company = cleanLabel(companyName, "your company");
  const buyer = cleanLabel(buyerName, "");
  const firstToken = buyer.split(/\s+/)[0] || "";
  const playbook = callPlaybook(campaignId);
  const values = {
    firstName: firstToken && !roleOnlyBuyer.test(buyer) ? firstToken : playbook === streamlitContent.yc ? "Founder" : "Director",
    company,
    software: cleanLabel(software, "your accounting system"),
  };
  return playbook.summaryTemplate.replace(/\{(firstName|company|software)\}/g, (_, key) => values[key]);
}

export const CALL_OBJECTIONS = streamlitContent.yc.objections;
