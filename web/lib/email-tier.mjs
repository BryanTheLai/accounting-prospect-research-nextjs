const tierOneRoles = new Set(["md", "director", "managing.director", "ceo", "cfo", "coo", "cto", "founder", "owner", "partner", "principal", "general.manager", "gm"]);
const tierTwoRoles = new Set(["hr", "careers", "recruitment", "jobs", "talent", "hiring", "humanresources", "human.resources", "finance", "accounts", "accounting", "account", "acc"]);
const tierThreeRoles = new Set(["info", "admin", "contact", "enquiry", "enquiries", "general", "mail", "office", "sales", "marketing", "customer", "customercare", "reception", "desk", "inquiry", "inquiries"]);
const tierFourRoles = new Set(["support", "billing", "help", "noreply", "no-reply", "donotreply", "newsletter", "alerts", "notifications", "service", "ticketing", "webmaster"]);
const honorifics = new Set(["mr", "ms", "mrs", "dr", "prof", "esq", "rev"]);

export function classifyEmailTier(email, buyerName) {
  if (!email || !email.includes("@")) return "missing";
  const local = email.trim().toLowerCase().split("@", 1)[0];
  if (tierFourRoles.has(local) || ["noreply", "support", "billing"].some((prefix) => local.startsWith(prefix))) return "system";
  if (tierOneRoles.has(local)) return "direct";
  if (tierTwoRoles.has(local) || ["hr", "career", "recruit", "finance", "account"].some((prefix) => local.startsWith(prefix))) return "department";
  if (tierThreeRoles.has(local)) return "generic";

  const nameTokens = (buyerName || "")
    .replace(/\(.*?\)/g, "")
    .replace(/[\/\\].*/, "")
    .toLowerCase()
    .match(/[a-z]+/g)
    ?.filter((token) => !honorifics.has(token) && token.length > 1) || [];
  const normalizedLocal = local.replace(/[._-]/g, "");
  const first = nameTokens[0] || "";
  const last = nameTokens.at(-1) || "";
  if ((first && normalizedLocal.includes(first)) || (last && normalizedLocal.includes(last)) || local.includes(".")) return "direct";
  if (local.includes("_") || local.includes(".")) return "direct";
  return "department";
}
