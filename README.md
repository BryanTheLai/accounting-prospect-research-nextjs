# Outbounder

The operator app is the Next.js desk in `web/`. Its live data is stored in
`operations/recovered-leads-20261008/leads.sqlite`. Start it with `npm start`
from `web/`; current runtime instructions are in [web/README.md](web/README.md).
Existing sender addresses, domains and business signatures remain Outbounder.

The older CLI/Streamlit notes below are retained as historical reference, not
the current operator workflow.

## System Architecture & Single Source of Truth (SSOT)

To prevent split-brain data corruption and file corruption across autonomous agent sessions, the system follows CQRS (Command Query Responsibility Segregation):

1. **Transactional Store (System of Record): `leads.db`**
   - SQLite database enforcing unique domain constraints, typed schemas, and atomic writes.
   - All AI agents (Codex, Antigravity, Claude Code) and web UI actions write directly here.

2. **Master Presentation Workbook (Read-Only Projection): `master_leads.xlsx`**
   - The single master workbook for the entire project (16 sheets).
   - Contains historical master sheets plus the refreshed `Cross-Border Pipeline` sheet.
   - Synchronized unidirectionally from `leads.db` using `python sync_leads_to_master.py` or via the Streamlit UI.

3. **Operator Cockpit: `app.py`**
   - Streamlit interface (`http://localhost:8501`) featuring dynamic column toggling, live search, 1-click lead approvals, prompt generation, Cloudflare DNS zone downloads, and budget tracking.

## Quickstart

### 1. Launch Operator Cockpit
```powershell
py -m streamlit run app.py
```

### 2. Sync Database to Master Excel
```powershell
py sync_leads_to_master.py
```

### 3. Generate New Cross-Border Batch
```powershell
py generate_cross_border_batch.py
```

## Cloudflare DNS Automation
- `cloudflare_dns.zone`: Standard BIND zone file for 1-click import in the Cloudflare Web Dashboard (*DNS -> Records -> Import and Export*).
- `cloudflare_dns_records.json`: REST API payload for programmatic DNS creation.

## Key Research & System Specifications
- `OUTBOUNDER_MASTER_RUNBOOK_AND_OPERATING_MANUAL.md`: **Canonical System Bible** covering live endpoints, DNS records, M365 setup, economics, mathematical models, deliverability shields, and CLI cheat sheet.
- `OUTBOUND_OS_RESEARCH_REPORT.md`: Comprehensive executive report synthesizing data audit, funnel economics, and architecture.
- `CROSS_BORDER_KNOWLEDGE_BASE.md`: High-priority buyer titles, software footprints (Xero SG/AU), and credentials.
- `HIGH_VELOCITY_LEADGEN_AND_SG_MY_ENGINE.md`: SG-MY corridor filter specifications and scoring algorithms.
- `appendices/A_DATA_INVENTORY_AND_LEAD_QUALITY_AUDIT.md`: Forensic audit of 5,074 historical master leads.
- `appendices/B_FUNNEL_ECONOMICS_AND_CAPACITY_MODELS.md`: Mathematical models of sequence volume and retainer economics.
- `appendices/C_PROVIDER_EVALUATION_AND_COST_MATRIX.md`: Mailbox pricing matrix exposing vendor minimum traps.
- `appendices/D_AGENT_PORTABILITY_AND_HARNESS_SPEC.md`: Agent contracts across Codex, Claude Code, and Antigravity.
- `appendices/E_LEGAL_PRIVACY_AND_DELIVERABILITY_GUIDE.md`: Malaysian PDPA 2010 / 2024 Amendment Act compliance.
