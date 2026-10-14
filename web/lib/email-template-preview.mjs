export class EmailTemplatePreviewError extends Error {}

function resolveSpintax(text, random) {
  let rendered = text;
  let match = /\{([^{}]+)\}/.exec(rendered);
  while (match) {
    const options = match[1].split("|");
    const sample = random();
    const index = Number.isFinite(sample)
      ? Math.min(options.length - 1, Math.max(0, Math.floor(sample * options.length)))
      : 0;
    rendered = `${rendered.slice(0, match.index)}${options[index]}${rendered.slice(match.index + match[0].length)}`;
    match = /\{([^{}]+)\}/.exec(rendered);
  }
  return rendered;
}

/** Mirrors spintax_engine.render_email_template for a read-only local preview. */
export function renderEmailTemplatePreview(template, lead, random = Math.random) {
  if (typeof template !== "string") throw new EmailTemplatePreviewError("Template text is missing.");
  let rendered = template;
  for (const [key, rawValue] of Object.entries(lead || {})) {
    let value = rawValue == null ? "" : String(rawValue).trim();
    if (key === "buyer_name" && !value) value = "there";
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  }

  let depth = 0;
  for (const char of rendered) {
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth < 0) throw new EmailTemplatePreviewError("Template has invalid brace syntax.");
  }
  if (depth !== 0) throw new EmailTemplatePreviewError("Template has invalid brace syntax.");
  return resolveSpintax(rendered, random);
}
