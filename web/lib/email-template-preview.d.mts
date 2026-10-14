export type PreviewLead = Record<string, string | number | boolean | null | undefined>;

export class EmailTemplatePreviewError extends Error {}

export function renderEmailTemplatePreview(
  template: string,
  lead: PreviewLead,
  random?: () => number,
): string;
