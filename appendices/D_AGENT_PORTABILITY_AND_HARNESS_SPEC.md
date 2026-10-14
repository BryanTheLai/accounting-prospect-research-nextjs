# Appendix D: AI Agent Portability, Authentication & Harness Specification

**Date of Specification:** 2026-10-01  
**Project:** Outbounder Malaysian SME Accounting Outbound OS  
**Target Environments:** OpenAI Codex CLI, Claude Code, OpenCode, Google Antigravity

---

## 1. The "Universal Subscription Token" Myth: Research & Boundaries

A common design misconception is assuming that an operator's monthly AI subscription (e.g. ChatGPT Plus/Pro at $20–$200/mo, Claude Pro/Team at $20–$30/mo, or Gemini Advanced at $20/mo) acts as a universal API token that can be extracted and plugged into any third-party background scraper, cron daemon, or external script.

### Official Provider Authentication & Entitlement Realities (2026):

| Environment / Provider | Interactive / Desktop Login | Local CLI Authentication | Headless / Background API | Subscription Quota Terms & Fair Use |
| :--- | :--- | :--- | :--- | :--- |
| **OpenAI Codex / ChatGPT** | Unified ChatGPT Desktop & Web login | `codex` CLI signs in via browser OAuth to ChatGPT account. | OpenAI Platform API requires **metered API billing** (`sk-...` keys funded via credit balance). | Plan quotas (Plus/Pro) cover interactive app and official Codex CLI usage. Headless third-party automation requires API keys or Codex Cloud. Reverse-engineering web tokens violates OpenAI Terms of Service. |
| **Claude Code (Anthropic)** | Web / Desktop Claude chat | `claude` CLI authenticates via Anthropic console or browser OAuth. | Anthropic API requires **metered API billing** (`sk-ant-...` keys funded via credit balance). | Claude Pro/Team subscriptions cover interactive chat and official CLI sessions. Automated long-running scripts typically draw from Anthropic Console API credits. |
| **OpenCode** | Web / Local terminal app | Interactive `/connect` stores provider credentials in `~/.local/share/opencode/auth.json`. | Uses provider API endpoints configured in `opencode.json`. | OpenCode is a client harness; it does not supply free frontier models. It connects to OpenAI, Anthropic, OpenRouter, or local Ollama servers using user-supplied API keys. |
| **Google Antigravity** | Antigravity IDE / Desktop app login | `agy` CLI authenticates via Google Cloud ADC or interactive OAuth. | Google Cloud Vertex AI / Gemini API keys (`GEMINI_API_KEY`). | Interactive coding sessions leverage Gemini subscription quotas. Headless background automation uses Google Cloud IAM / API billing. |

### Architectural Invariant:
**Never attempt to spoof, scrape, or proxy session cookies, OAuth bearer tokens, or JWTs across environments.**  
Any portable design must decouple the **instructions and data contracts** (which are 100% portable) from the **model execution engine** (which uses each environment's native, officially supported authentication).

---

## 2. Decoupled Portable Architecture: Core vs. Adapters

To ensure Bryan can run the outbound prospecting system across Codex, Claude Code, OpenCode, or Google Antigravity without rewriting the logic, the architecture is split into two layers:

```
┌─────────────────────────────────────────────────────────────┐
│                 PORTABLE REUSABLE CORE                      │
│ - Canonical Instructions: .agents/AGENTS.md, SKILL.md       │
│ - Data Schemas: prospect_schema.json, route_result.json     │
│ - Durable Persistence: SQLite (leads.db) + JSON Batch Logs  │
│ - Human Approval Gates: Explicit CLI syntax                │
│ - Deterministic Scripts: audit.py, dedupe.py, export.py    │
└────────────────────────────┬────────────────────────────────┘
                             │
       ┌─────────────────────┼─────────────────────┐
       ▼                     ▼                     ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│ OpenAI Codex │      │ Claude Code  │      │ Antigravity  │
│ Adapter      │      │ Adapter      │      │ Adapter      │
│ - codex CLI  │      │ - claude CLI │      │ - agy / IDE  │
│ - OAuth auth │      │ - API / auth │      │ - Gemini auth│
└──────────────┘      └──────────────┘      └──────────────┘
```

### The 4 Portable Core Components:
1. **Instruction Contracts (`AGENTS.md` / `SKILL.md`):** Written in clean, platform-agnostic Markdown. Specifies role boundaries, prompt-injection fences, acceptance criteria, and exact output formats.
2. **Data Model (`prospect_schema.json` & `leads.db`):** Standard relational tables and JSON schemas readable by native Python (`sqlite3`, `json`, `openpyxl`). No vendor-specific database dependencies.
3. **Execution Scripts (`bin/*.py`):** Pure Python 3 standard library scripts that perform deterministic checks:
   - `bin/audit_leads.py`: Validates schema, counts, and required URL proofs.
   - `bin/dedupe_check.py`: Checks new candidates against seen domains and suppression tables.
   - `bin/export_view.py`: Dumps current pipeline state into Excel for operator inspection.
4. **Hard Human Approval Protocol:** The non-negotiable approval gate:
   ```text
   Approved: <action> <record_id>
   ```
   No message is drafted, scheduled, or sent without this explicit string logged in the execution audit trail.

---

## 3. Practical Portable Activation Workflow

Bryan can invoke the prospecting operating system in any of the four environments using their native capabilities:

### Mode 1: OpenAI Codex Environment
- **Execution:** Run via terminal in workspace root:
  ```bash
  codex "Run the accounting research coordinator for Batch R30 against 25 new accounts."
  ```
- **Harness Behavior:** Codex reads `lead-routes/OPEN_CLOSE_LEAD_GEN_GOAL_PROMPT.md`, launches subagents or executes python discovery scripts, outputs `R30.json`, and pauses for operator review.

### Mode 2: Claude Code Environment
- **Execution:** Run via terminal in workspace root:
  ```bash
  claude "Follow .agents/skills/scout/SKILL.md to research 25 qualified SME accounts in Klang Valley."
  ```
- **Harness Behavior:** Claude Code loads local instructions, executes research via headless web searches, generates candidate JSON, and stops at the draft gate.

### Mode 3: OpenCode Environment
- **Execution:** Open workspace in OpenCode. Configure active provider in `~/.config/opencode/opencode.json`.
- **Harness Behavior:** Executes coordinator prompt using user's configured model provider (e.g. Anthropic Claude 3.5 Sonnet or OpenAI GPT-4o).

### Mode 4: Google Antigravity Environment
- **Execution:** In the Antigravity IDE chat or CLI (`agy`):
  ```bash
  agy "Execute the lead research scout skill for Outbounder against Malaysian trading SMEs."
  ```
- **Harness Behavior:** Antigravity loads the project instructions, leverages registered MCP tools (`read_url_content`, `search_web`), performs live evidence verification, and writes outputs directly to `accounting-prospect-research/lead-routes/`.

---

## 4. Long-Running Autonomous Execution & Failure Recovery

Drawing from Anthropic's research on *Effective Harnesses for Long-Running Agents*:
1. **The Stateless Agent Principle:** Every agent run starts with zero memory amnesia. The agent must never rely on conversation context to know what happened yesterday.
2. **Files as State:** State exists solely on disk in:
   - `leads.db` (canonical records and state transitions).
   - `runs/YYYY-MM-DD-<role>.md` (reasoning, hypothesis, rejected options, and error logs).
   - `MEMORY.md` (compact 15-line current-state summary).
3. **Recovery After Crashes / Timeouts:**
   - If an agent process crashes or is killed midway through a batch, the next agent run reads `runs/` and `leads.db`.
   - Any record in stage `drafting` or `researching` without an output is automatically rolled back to `raw_candidate` or flagged for retry.
   - Idempotency keys (`hash(domain + company_name)`) prevent duplicate row creation upon retry.
