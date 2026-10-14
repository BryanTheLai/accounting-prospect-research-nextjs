import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { test } from "node:test";
import {
  activatePlaybook,
  createPlaybookDraft,
  listPlaybooks,
  PlaybookError,
  updatePlaybook,
} from "../lib/playbooks.ts";

function withTempDb(run) {
  const directory = mkdtempSync(join(tmpdir(), "outbounder-playbooks-test-"));
  const path = join(directory, "playbooks.sqlite");
  const db = new Database(path);
  db.exec(`
    CREATE TABLE campaigns (
      campaign_id TEXT PRIMARY KEY, name TEXT NOT NULL, tagline TEXT, description TEXT,
      target_criteria TEXT, sourcing_strategy TEXT, agent_prompt_spec TEXT, offer_wedge TEXT,
      default_template_name TEXT, status TEXT NOT NULL CHECK(status IN ('ACTIVE','PAUSED','ARCHIVED')),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE outbound_templates (
      template_id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
      subject TEXT NOT NULL, body TEXT NOT NULL, is_default INTEGER DEFAULT 0
    );
    CREATE TABLE prospects (lead_id TEXT PRIMARY KEY, campaign_id TEXT);
    CREATE TABLE campaign_sends (send_id INTEGER PRIMARY KEY, status TEXT NOT NULL);
    INSERT INTO outbound_templates (name, subject, body, is_default) VALUES
      ('YC Angle', 'Books in 48 hours?', 'Hey {{buyer_name}},\n\nA reviewed template body.', 1),
      ('Builder Angle', 'How do you manage books?', 'A second reviewed template body.', 0);
    INSERT INTO campaigns (
      campaign_id, name, tagline, description, target_criteria, sourcing_strategy,
      agent_prompt_spec, offer_wedge, default_template_name, status
    ) VALUES (
      'yc_us_expansion', 'YC expansion', 'Tagline', 'Description', 'YC active companies',
      'YC directory', 'Use verified public company data.', '$800/mo accounting desk', 'YC Angle', 'ACTIVE'
    ), (
      'yc_paused_draft', 'Paused campaign', '', '', 'Seed-stage founders', 'YC batch data',
      'Find only companies matching the criteria.', 'Founder discovery call', 'Builder Angle', 'PAUSED'
    ), (
      'yc_conversational_discovery', 'YC founder discovery', '', '', 'Recent YC founders', 'YC directory',
      'Ask about reconciliation.', 'Founder discovery call', 'Builder Angle', 'ACTIVE'
    );
    INSERT INTO prospects VALUES ('lead-1', 'yc_us_expansion');
    INSERT INTO campaign_sends VALUES (1, 'SENT');
  `);
  try { run(db, path); }
  finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

const validInput = (overrides = {}) => ({
  id: "yc_healthcare_bio",
  name: "YC Healthcare and Bio",
  tagline: "Books for regulated founders",
  description: "A clear draft description.",
  targetCriteria: "Active YC healthcare companies in W24–W26; team size >= 5.",
  sourcingStrategy: "YC directory filtered by healthcare; review company pages and source links.",
  agentPromptSpec: "Find matching public YC profiles. Do not infer founder email addresses.",
  offerWedge: "Flat $800/mo desk with monthly closes in 48 hours.",
  defaultTemplateName: "YC Angle",
  ...overrides,
});

test("lists saved campaign intelligence and templates without competing generated presets", () => {
  withTempDb((db) => {
    const result = listPlaybooks(db);
    assert.equal(result.campaigns.length, 3);
    const ycCampaign = result.campaigns.find((campaign) => campaign.id === "yc_us_expansion");
    assert.equal(ycCampaign.targetCriteria, "YC active companies");
    assert.equal(ycCampaign.sourcingStrategy, "YC directory");
    assert.equal(ycCampaign.offerWedge, "$800/mo accounting desk");
    assert.equal(ycCampaign.defaultTemplateName, "YC Angle");
    assert.equal("streamlitRegistryPrompt" in ycCampaign, false);
    assert.equal(result.templates.find((template) => template.name === "YC Angle").body, "Hey {{buyer_name}},\n\nA reviewed template body.");
    assert.deepEqual(Object.keys(result).sort(), ["campaigns", "templates"]);
  });
});

test("creates a new playbook as PAUSED and leaves campaign send history untouched", () => {
  withTempDb((db) => {
    const before = db.prepare("SELECT COUNT(*) AS count FROM campaign_sends").get().count;
    const created = createPlaybookDraft(db, validInput());
    const stored = db.prepare("SELECT * FROM campaigns WHERE campaign_id = ?").get(created.id);
    assert.deepEqual(created, { id: "yc_healthcare_bio", status: "PAUSED" });
    assert.equal(stored.status, "PAUSED");
    assert.equal(stored.default_template_name, "YC Angle");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM campaign_sends").get().count, before);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM prospects WHERE campaign_id = ?").get(created.id).count, 0);
  });
});

test("updates an existing campaign's strategy without changing status or send history", () => {
  withTempDb((db) => {
    const updated = updatePlaybook(db, validInput({
      id: "yc_us_expansion", name: "YC US expansion, reviewed", targetCriteria: "Active YC only; team size >= 4.",
      sourcingStrategy: "YC directory API, then verify source URLs.", offerWedge: "Dedicated $800/month accounting desk.",
      defaultTemplateName: "Builder Angle",
    }));
    assert.equal(updated.status, "ACTIVE");
    const stored = db.prepare("SELECT * FROM campaigns WHERE campaign_id = 'yc_us_expansion'").get();
    assert.equal(stored.target_criteria, "Active YC only; team size >= 4.");
    assert.equal(stored.sourcing_strategy, "YC directory API, then verify source URLs.");
    assert.equal(stored.offer_wedge, "Dedicated $800/month accounting desk.");
    assert.equal(stored.default_template_name, "Builder Angle");
    assert.equal(stored.status, "ACTIVE");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM campaign_sends").get().count, 1);
  });
});

test("activation requires an explicit call and changes status only", () => {
  withTempDb((db) => {
    db.prepare("UPDATE campaigns SET agent_prompt_spec = '' WHERE campaign_id = 'yc_paused_draft'").run();
    assert.throws(() => activatePlaybook(db, "yc_paused_draft"), /Prompt spec is required/);
    assert.equal(db.prepare("SELECT status FROM campaigns WHERE campaign_id = 'yc_paused_draft'").get().status, "PAUSED");
    db.prepare("UPDATE campaigns SET agent_prompt_spec = 'Complete spec.' WHERE campaign_id = 'yc_paused_draft'").run();
    const result = activatePlaybook(db, "yc_paused_draft");
    assert.deepEqual(result, { id: "yc_paused_draft", status: "ACTIVE", dispatchStarted: false });
    assert.equal(db.prepare("SELECT status FROM campaigns WHERE campaign_id = 'yc_paused_draft'").get().status, "ACTIVE");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM campaign_sends").get().count, 1);
  });
});

test("rejects unknown templates, duplicate IDs, invalid IDs, and implicit activation", () => {
  withTempDb((db) => {
    assert.throws(() => createPlaybookDraft(db, validInput({ defaultTemplateName: "Missing" })), PlaybookError);
    assert.throws(() => createPlaybookDraft(db, validInput({ id: "YC Bad ID" })), /Campaign ID/);
    createPlaybookDraft(db, validInput());
    assert.throws(() => createPlaybookDraft(db, validInput()), /already exists/);
    const paused = updatePlaybook(db, validInput({
      id: "yc_paused_draft", name: "Edited but still paused", defaultTemplateName: "Builder Angle",
    }));
    assert.equal(paused.status, "PAUSED");
    assert.equal(db.prepare("SELECT status FROM campaigns WHERE campaign_id = 'yc_paused_draft'").get().status, "PAUSED");
  });
});
