import { readFile } from "node:fs/promises";

export async function readLocalEnv(path) {
  try {
    const values = {};
    for (const line of (await readFile(path, "utf8")).split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      const [, key, raw] = match;
      if (!["OUTBOUNDER_DB_PATH", "OUTBOUNDER_DISPATCHER_PORT", "ENABLE_LIVE_DISPATCH", "SMTP_USER", "SMTP_PASSWORD", "SMTP_SERVER", "SMTP_PORT", "SENDER_NAME", "PRIMARY_DOMAIN"].includes(key)) continue;
      const value = raw.trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        values[key] = value.slice(1, -1).replace(/\\([\\"nrt])/g, (_, escaped) => ({ "\\": "\\", '"': '"', n: "\n", r: "\r", t: "\t" })[escaped]);
      } else if (value.startsWith("'") && value.endsWith("'")) values[key] = value.slice(1, -1);
      else values[key] = value.replace(/\s+#.*$/, "").trim();
    }
    return values;
  } catch { return {}; }
}
