import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { reviewProspects } from "../lib/prospect-review.mjs";

test("automated review approves only evidence-ready leads; fit alone never approves", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE campaigns(campaign_id TEXT,status TEXT); INSERT INTO campaigns VALUES ('yc','ACTIVE');
      CREATE TABLE prospects(lead_id TEXT PRIMARY KEY,company_name TEXT,campaign_id TEXT,status TEXT,quality_score INTEGER,proof_link TEXT,contact_email TEXT,buyer_name TEXT,root_domain TEXT,company_summary TEXT);
      CREATE TABLE email_preflight(lead_id TEXT,email TEXT,mx_status TEXT,source_confirmed INTEGER,checked_at TEXT,source_confirmed_at TEXT);
      CREATE TABLE email_suppression(email TEXT); CREATE TABLE campaign_sends(recipient_email TEXT,response_msg TEXT);`);
    const insert=db.prepare("INSERT INTO prospects VALUES (?,?,'yc','NEW',?,'https://example.test/source',?,'Alex','example.test','Software company')");
    insert.run('ready','Ready',95,'alex@example.test');insert.run('guess','Guess',95,'guessed@example.test');insert.run('low','Low',80,'low@example.test');
    const now=new Date().toISOString();db.prepare("INSERT INTO email_preflight VALUES ('ready','alex@example.test','mx_present',1,?,?)").run(now,now);
    const dry=reviewProspects(db,'all',false);assert.equal(dry.approved,1);assert.equal(dry.held.email,1);assert.equal(dry.held.fit,1);
    assert.equal(db.prepare("SELECT status FROM prospects WHERE lead_id='ready'").get().status,'NEW');
    const applied=reviewProspects(db,'all',true);assert.equal(applied.approved,1);
    assert.equal(db.prepare("SELECT status FROM prospects WHERE lead_id='ready'").get().status,'Approved for Outreach');
    assert.equal(db.prepare("SELECT status FROM prospects WHERE lead_id='guess'").get().status,'Ready to Review');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM campaign_sends").get().n,0);
    assert.equal(reviewProspects(db,'all',false).approved,0);
  } finally { db.close(); }
});
