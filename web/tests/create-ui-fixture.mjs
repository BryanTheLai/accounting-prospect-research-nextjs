import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync } from "node:fs";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDirectory = resolve(repositoryRoot, "operations/ui-qa");
const fixturePath = resolve(fixtureDirectory, "fixture.db");

mkdirSync(fixtureDirectory, { recursive: true });
rmSync(fixturePath, { force: true });

const db = new Database(fixturePath);
try {
  db.pragma("journal_mode = DELETE");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE campaigns (
      campaign_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tagline TEXT,
      description TEXT,
      target_criteria TEXT,
      sourcing_strategy TEXT,
      agent_prompt_spec TEXT,
      offer_wedge TEXT,
      default_template_name TEXT,
      status TEXT DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'PAUSED', 'ARCHIVED')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      schedule_timezone TEXT NOT NULL DEFAULT 'Asia/Singapore',
      schedule_start_minute INTEGER NOT NULL DEFAULT 540,
      schedule_end_minute INTEGER NOT NULL DEFAULT 1050,
      schedule_configured INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE prospects (
      lead_id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      company_summary TEXT,
      root_domain TEXT NOT NULL,
      headquarters TEXT,
      malaysia_facility TEXT,
      sector TEXT,
      estimated_transactions_mo TEXT,
      accounting_software TEXT,
      buyer_name TEXT,
      buyer_title TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      sg_my_wedge TEXT,
      quality_score INTEGER,
      tier TEXT,
      status TEXT,
      notes TEXT,
      bro_summary TEXT,
      proof_link TEXT,
      phone_script TEXT,
      campaign_id TEXT DEFAULT 'hydroball_clones',
      phone_e164 TEXT,
      lead_timezone TEXT DEFAULT 'Asia/Kuala_Lumpur',
      call_attempts_count INTEGER DEFAULT 0,
      last_called_at TIMESTAMP,
      last_disposition TEXT
    );

    CREATE TABLE outbound_templates (
      template_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE mailboxes (
      mailbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      sender_name TEXT NOT NULL DEFAULT 'Synthetic QA Sender',
      smtp_server TEXT NOT NULL DEFAULT 'smtp.example.test',
      smtp_port INTEGER NOT NULL DEFAULT 587,
      smtp_user TEXT NOT NULL,
      smtp_password TEXT NOT NULL,
      daily_limit INTEGER NOT NULL DEFAULT 50,
      hourly_limit INTEGER NOT NULL DEFAULT 6,
      status TEXT NOT NULL DEFAULT 'PAUSED' CHECK(status IN ('ACTIVE', 'COOLDOWN', 'PAUSED', 'ERROR')),
      cooldown_until TIMESTAMP,
      last_sent_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      provider_type TEXT DEFAULT 'SYNTHETIC',
      min_delay_seconds INTEGER,
      max_delay_seconds INTEGER
    );

    CREATE TABLE email_preflight (
      lead_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      mx_status TEXT NOT NULL CHECK(mx_status IN ('not_checked', 'mx_present', 'no_mx', 'invalid_syntax', 'lookup_error')),
      mx_hosts TEXT NOT NULL DEFAULT '[]',
      checked_at TEXT NOT NULL,
      source_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(source_confirmed IN (0, 1)),
      source_confirmed_at TEXT
    );

    CREATE TABLE call_logs (
      call_id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL,
      caller_name TEXT NOT NULL DEFAULT 'Bryan',
      target_phone TEXT NOT NULL DEFAULT '',
      target_name TEXT,
      company_name TEXT,
      campaign_id TEXT,
      disposition TEXT NOT NULL,
      duration_seconds INTEGER DEFAULT 0,
      call_notes TEXT,
      next_followup_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE campaign_sends (
      send_id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      company_name TEXT,
      subject TEXT NOT NULL,
      body TEXT,
      status TEXT NOT NULL,
      smtp_code INTEGER,
      response_msg TEXT,
      sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      duration_delay_sec REAL,
      sender_email TEXT,
      run_id TEXT,
      variant_name TEXT,
      template_id INTEGER
    );

    CREATE TABLE email_suppression (
      email TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const seed = db.transaction(() => {
    db.prepare(`INSERT INTO campaigns (
      campaign_id, name, tagline, description, target_criteria, sourcing_strategy,
      agent_prompt_spec, offer_wedge, default_template_name, status, schedule_configured
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      "yc_us_expansion", "Synthetic YC expansion", "Fixture campaign", "Synthetic campaign for local UI checks.",
      "Synthetic example.test companies", "Use only synthetic fixture records.",
      "Do not send or contact anyone. This is a synthetic QA prompt.", "Synthetic bookkeeping offer", "QA template A", "ACTIVE", 0,
      "ui_qa_paused", "Synthetic paused campaign", "Fixture campaign", "Synthetic campaign for paused-state checks.",
      "Synthetic example.test companies", "Use only synthetic fixture records.",
      "Do not send or contact anyone. This is a synthetic QA prompt.", "Synthetic bookkeeping offer", "QA template B", "PAUSED", 0,
    );

    const insertTemplate = db.prepare("INSERT INTO outbound_templates (name, subject, body, is_default) VALUES (?, ?, ?, ?)");
    insertTemplate.run("QA template A", "Synthetic QA subject A", "Hi {{buyer_name}}, this synthetic message is only for local preview at {{company_name}}.", 1);
    insertTemplate.run("QA template B", "Synthetic QA subject B", "Hello {{buyer_name}}, this is the second synthetic preview for {{company_name}}.", 0);

    const insertProspect = db.prepare(`INSERT INTO prospects (
      lead_id, company_name, company_summary, root_domain, headquarters, sector, buyer_name,
      buyer_title, contact_email, contact_phone, sg_my_wedge, quality_score, tier, status,
      notes, proof_link, phone_script, campaign_id, phone_e164
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insertProspect.run(
      "uiqa_lead_001", "Synthetic Acorn Labs", "Synthetic QA company record one.", "acorn.example.test",
      "Example City", "Synthetic software", "Alex Example", "Founder", "alex@acorn.example.test",
      "+12025550101", "Synthetic close-process signal", 82, "Tier 1", "Ready to Review",
      "Synthetic fixture record. No real prospect data.", "https://acorn.example.test/source", "Synthetic QA call script for Alex.",
      "yc_us_expansion", "+12025550101",
    );
    insertProspect.run(
      "uiqa_lead_002", "Synthetic Birch Works", "Synthetic QA company record two.", "birch.example.test",
      "Sample Borough", "Synthetic software", "Casey Sample", "Finance Head", "casey@birch.example.test",
      "+12025550102", "Synthetic reconciliation signal", 71, "Tier 2", "Approved for Outreach",
      "Synthetic fixture record. No real prospect data.", "https://birch.example.test/source", "Synthetic QA call script for Casey.",
      "yc_us_expansion", "+12025550102",
    );
    insertProspect.run(
      "uiqa_lead_003", "Synthetic Cedar Systems", "Synthetic QA company record three.", "cedar.example.test",
      "Demo District", "Synthetic software", "Taylor Demo", "Managing Director / Finance Head", "taylor@cedar.example.test",
      "+12025550103", "Synthetic reporting signal", 65, "Tier 3", "Nurture / Follow-up",
      "Synthetic fixture record. No real prospect data.", "https://cedar.example.test/source", "Synthetic QA call script for Taylor.",
      "ui_qa_paused", "+12025550103",
    );

    db.prepare(`INSERT INTO mailboxes (
      email, sender_name, smtp_server, smtp_port, smtp_user, smtp_password, status, provider_type
    ) VALUES (?, ?, ?, ?, ?, ?, 'PAUSED', 'SYNTHETIC')`).run(
      "qa-sender@example.test", "Synthetic QA Sender", "smtp.example.test", 2525,
      "qa-user@example.test", "FAKE-ONLY-NOT-A-SECRET",
    );

    db.prepare(`INSERT INTO email_preflight (
      lead_id, email, mx_status, mx_hosts, checked_at, source_confirmed, source_confirmed_at
    ) VALUES (?, ?, 'not_checked', '[]', '', 0, NULL)`).run("uiqa_lead_001", "alex@acorn.example.test");
  });

  seed();
  db.pragma("user_version = 1");
} catch (error) {
  db.close();
  rmSync(fixturePath, { force: true });
  throw error;
}

db.close();
process.stdout.write(`Synthetic UI fixture created: ${fixturePath}\n`);
