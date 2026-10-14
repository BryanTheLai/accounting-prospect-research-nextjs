import type Database from "better-sqlite3";

export type PlaybookTemplate = {
  name: string;
  subject: string;
  body: string;
  isDefault: boolean;
};

export type Playbook = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  targetCriteria: string;
  sourcingStrategy: string;
  agentPromptSpec: string;
  offerWedge: string;
  defaultTemplateName: string;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  createdAt: string | null;
  updatedAt: string | null;
  prospectCount: number;
};

export type PlaybookInput = {
  id?: string;
  name: string;
  tagline: string;
  description: string;
  targetCriteria: string;
  sourcingStrategy: string;
  agentPromptSpec: string;
  offerWedge: string;
  defaultTemplateName: string;
};

export class PlaybookError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "PlaybookError";
    this.status = status;
  }
}

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function asText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") throw new PlaybookError(`${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > maximum) throw new PlaybookError(`${label} must be ${maximum} characters or fewer.`);
  return trimmed;
}

function validateInput(db: Database.Database, input: PlaybookInput, requireId: boolean) {
  const id = requireId ? asText(input.id, "Campaign ID", 80) : "";
  if (requireId && !/^[a-z0-9][a-z0-9_-]{2,79}$/.test(id)) {
    throw new PlaybookError("Campaign ID must be 3–80 lowercase letters, numbers, hyphens, or underscores.");
  }
  const fields = {
    name: asText(input.name, "Name", 140),
    tagline: asText(input.tagline, "Tagline", 240),
    description: asText(input.description, "Description", 1200),
    targetCriteria: asText(input.targetCriteria, "Target criteria", 2400),
    sourcingStrategy: asText(input.sourcingStrategy, "Sourcing strategy", 2400),
    agentPromptSpec: asText(input.agentPromptSpec, "Prompt spec", 6000),
    offerWedge: asText(input.offerWedge, "Offer wedge", 1200),
    defaultTemplateName: asText(input.defaultTemplateName, "Default template", 240),
  };
  if (!fields.name) throw new PlaybookError("Campaign name is required.");
  if (!fields.targetCriteria) throw new PlaybookError("Target criteria are required.");
  if (!fields.sourcingStrategy) throw new PlaybookError("Sourcing strategy is required.");
  if (!fields.agentPromptSpec) throw new PlaybookError("Prompt spec is required.");
  if (!fields.offerWedge) throw new PlaybookError("Offer wedge is required.");
  if (!fields.defaultTemplateName) throw new PlaybookError("Choose a linked default template.");
  if (!tableExists(db, "outbound_templates") || !db.prepare(
    "SELECT 1 FROM outbound_templates WHERE name = ?",
  ).get(fields.defaultTemplateName)) {
    throw new PlaybookError("Choose an existing outbound template.");
  }
  return { id, ...fields };
}

export function listPlaybooks(db: Database.Database) {
  const rows = db.prepare(`
    SELECT c.campaign_id AS id, c.name, c.tagline, c.description,
      c.target_criteria AS targetCriteria, c.sourcing_strategy AS sourcingStrategy,
      c.agent_prompt_spec AS agentPromptSpec, c.offer_wedge AS offerWedge,
      c.default_template_name AS defaultTemplateName, c.status,
      c.created_at AS createdAt, c.updated_at AS updatedAt,
      COUNT(p.lead_id) AS prospectCount
    FROM campaigns c LEFT JOIN prospects p ON p.campaign_id = c.campaign_id
    WHERE c.status<>'ARCHIVED'
    GROUP BY c.campaign_id ORDER BY c.created_at ASC, c.campaign_id ASC
  `).all() as Playbook[];
  const templates = db.prepare(`
    SELECT name, subject, body, is_default AS isDefault
    FROM outbound_templates ORDER BY is_default DESC, template_id ASC
  `).all() as Array<Omit<PlaybookTemplate, "isDefault"> & { isDefault: number }>;
  return {
    campaigns: rows.map((row) => ({
      ...row,
      prospectCount: Number(row.prospectCount || 0),
    })),
    templates: templates.map((template) => ({ ...template, isDefault: Number(template.isDefault) === 1 })),
  };
}

export function createPlaybookDraft(db: Database.Database, input: PlaybookInput) {
  if (!tableExists(db, "campaigns")) throw new PlaybookError("Campaign table is unavailable.", 503);
  const clean = validateInput(db, input, true);
  if (db.prepare("SELECT 1 FROM campaigns WHERE campaign_id = ?").get(clean.id)) {
    throw new PlaybookError("That campaign ID already exists. Select it to edit the existing playbook.", 409);
  }
  db.prepare(`
    INSERT INTO campaigns (
      campaign_id, name, tagline, description, target_criteria, sourcing_strategy,
      agent_prompt_spec, offer_wedge, default_template_name, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PAUSED')
  `).run(
    clean.id, clean.name, clean.tagline, clean.description, clean.targetCriteria,
    clean.sourcingStrategy, clean.agentPromptSpec, clean.offerWedge, clean.defaultTemplateName,
  );
  return { id: clean.id, status: "PAUSED" as const };
}

export function updatePlaybook(db: Database.Database, input: PlaybookInput) {
  if (!tableExists(db, "campaigns")) throw new PlaybookError("Campaign table is unavailable.", 503);
  const clean = validateInput(db, input, true);
  const result = db.prepare(`
    UPDATE campaigns SET name = ?, tagline = ?, description = ?, target_criteria = ?,
      sourcing_strategy = ?, agent_prompt_spec = ?, offer_wedge = ?,
      default_template_name = ?, updated_at = datetime('now', 'localtime')
    WHERE campaign_id = ?
  `).run(
    clean.name, clean.tagline, clean.description, clean.targetCriteria,
    clean.sourcingStrategy, clean.agentPromptSpec, clean.offerWedge,
    clean.defaultTemplateName, clean.id,
  );
  if (!result.changes) throw new PlaybookError("Campaign not found.", 404);
  const status = (db.prepare("SELECT status FROM campaigns WHERE campaign_id = ?").get(clean.id) as { status: Playbook["status"] }).status;
  return { id: clean.id, status };
}

export function activatePlaybook(db: Database.Database, idValue: unknown) {
  const id = asText(idValue, "Campaign ID", 80);
  if (!id) throw new PlaybookError("Campaign ID is required.");
  const campaign = db.prepare(`
    SELECT campaign_id AS id, name, tagline, description,
      target_criteria AS targetCriteria, sourcing_strategy AS sourcingStrategy,
      agent_prompt_spec AS agentPromptSpec, offer_wedge AS offerWedge,
      default_template_name AS defaultTemplateName, status
    FROM campaigns WHERE campaign_id = ?
  `).get(id) as (PlaybookInput & { status: Playbook["status"] }) | undefined;
  if (!campaign) throw new PlaybookError("Campaign not found.", 404);
  if (campaign.status !== "PAUSED") {
    throw new PlaybookError(`Only paused playbooks can be activated; this one is ${campaign.status}.`, 409);
  }
  validateInput(db, campaign, true);
  const result = db.prepare(`
    UPDATE campaigns SET status = 'ACTIVE', updated_at = datetime('now', 'localtime')
    WHERE campaign_id = ? AND status = 'PAUSED'
  `).run(id);
  if (!result.changes) {
    throw new PlaybookError("Campaign status changed before activation. Reload and review it again.", 409);
  }
  return { id, status: "ACTIVE" as const, dispatchStarted: false };
}
