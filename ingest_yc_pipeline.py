"""
Production-Grade High-Performance YC Pipeline Ingestion & Enrichment Engine
Fetches 2020-2025 YC companies from yc-oss, enriches them with founder data,
MX resolution, and ESP provider detection, then saves to SQLite (leads.db)
and exports an interactive, formatted Excel workbook for deep filtering.

Path: ingest_yc_pipeline.py
"""

import sys
import os
import json
import re
import html
import time
import urllib.request
from typing import Dict, Any, List, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed
import sqlite3
import pandas as pd
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

from config import DB_PATH
from email_verifier import detect_domain_esp, EmailVerifier

DATASET_URL = "https://yc-oss.github.io/api/companies/all.json"
EXCEL_OUTPUT_PATH = "master_yc_revenue_leads_w20_s25.xlsx"

def fetch_yc_universe(min_team_size: int = 4) -> List[Dict[str, Any]]:
    """Fetches and filters all active 2020-2025 YC companies with traction/revenue signals."""
    print("Fetching master YC dataset from yc-oss...")
    req = urllib.request.Request(DATASET_URL, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    with urllib.request.urlopen(req, timeout=15) as r:
        all_cos = json.loads(r.read().decode("utf-8"))

    target_years = ["2020", "2021", "2022", "2023", "2024", "2025"]
    qualified = []

    for c in all_cos:
        batch = str(c.get("batch") or "")
        if not any(y in batch for y in target_years):
            continue
        if c.get("status") != "Active":
            continue
        if c.get("nonprofit", False):
            continue

        team_size = c.get("team_size") or 0
        is_hiring = bool(c.get("isHiring"))

        if team_size < min_team_size and not is_hiring:
            continue

        qualified.append(c)

    print(f"Qualified {len(qualified):,} revenue/traction YC companies (Batches 2020-2025).")
    return qualified

def extract_founder_from_yc(slug: str, timeout: int = 6) -> Tuple[str, str]:
    """Scrapes structured founder data from YC profile page."""
    url = f"https://www.ycombinator.com/companies/{slug}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            html_text = r.read().decode("utf-8")
        match = re.search(r'data-page="([^"]+)"', html_text)
        if match:
            raw_json = html.unescape(match.group(1))
            data = json.loads(raw_json)
            founders = data.get("props", {}).get("company", {}).get("founders", [])
            if founders:
                f0 = founders[0]
                name = f0.get("full_name") or f0.get("name") or "Founder"
                title = f0.get("title") or "Co-Founder / CEO"
                return name.strip(), title.strip()
    except Exception:
        pass
    return "Founder", "Co-Founder / CEO"

def clean_domain(url_str: str) -> str:
    """Extracts clean root domain from website URL."""
    if not url_str:
        return ""
    clean = url_str.lower().strip()
    clean = re.sub(r'^https?://', '', clean)
    clean = re.sub(r'^www\.', '', clean)
    return clean.split('/')[0].split('?')[0].strip()

def enrich_single_company(company: Dict[str, Any], scrape_founders: bool = True) -> Dict[str, Any]:
    """Enriches a YC company with public profile/domain metadata; never infers a contact email."""
    slug = company.get("slug") or ""
    name = company.get("name") or ""
    website = company.get("website") or ""
    domain = clean_domain(website)

    founder_name = "Founder"
    founder_title = "Co-Founder / CEO"
    if scrape_founders and slug:
        founder_name, founder_title = extract_founder_from_yc(slug)

    # Domain routing metadata does not prove any individual mailbox exists.
    esp_provider = "UNKNOWN"
    primary_mx = ""
    candidate_email = ""
    deliverability_score = 0

    if domain:
        esp_provider = detect_domain_esp(domain)
        mx_records = EmailVerifier.resolve_mx_records(domain)
        if mx_records:
            primary_mx = mx_records[0]


    locations = company.get("all_locations") or ""
    if isinstance(locations, list):
        locations = ", ".join(locations)

    tags = company.get("tags") or []
    if isinstance(tags, list):
        tags = ", ".join(tags)

    return {
        "lead_id": f"yc_{slug.replace('-', '_')}",
        "slug": slug,
        "company_name": name,
        "batch": company.get("batch") or "",
        "team_size": company.get("team_size") or 0,
        "is_hiring": "YES" if company.get("isHiring") else "NO",
        "industry": company.get("industry") or (company.get("industries", [""])[0] if company.get("industries") else ""),
        "subindustry": company.get("subindustry") or "",
        "locations": locations,
        "stage": company.get("stage") or "Early",
        "top_company": "YES" if company.get("top_company") else "NO",
        "website": website,
        "root_domain": domain,
        "one_liner": company.get("one_liner") or "",
        "long_description": company.get("long_description") or "",
        "tags": tags,
        "founder_name": founder_name,
        "founder_title": founder_title,
        "contact_email": candidate_email,
        "esp_provider": esp_provider,
        "primary_mx": primary_mx,
        "deliverability_score": deliverability_score,
        "yc_url": f"https://www.ycombinator.com/companies/{slug}",
        "campaign_id": "yc_us_expansion",
        "status": "NEW"
    }

def init_yc_directory_table(conn: sqlite3.Connection) -> None:
    """Creates dedicated yc_directory table in SQLite with extensive metadata."""
    conn.execute("""
    CREATE TABLE IF NOT EXISTS yc_directory (
        lead_id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        company_name TEXT NOT NULL,
        batch TEXT,
        team_size INTEGER DEFAULT 0,
        is_hiring TEXT,
        industry TEXT,
        subindustry TEXT,
        locations TEXT,
        stage TEXT,
        top_company TEXT,
        website TEXT,
        root_domain TEXT,
        one_liner TEXT,
        long_description TEXT,
        tags TEXT,
        founder_name TEXT,
        founder_title TEXT,
        contact_email TEXT,
        esp_provider TEXT,
        primary_mx TEXT,
        deliverability_score INTEGER,
        yc_url TEXT,
        campaign_id TEXT DEFAULT 'yc_us_expansion',
        status TEXT DEFAULT 'NEW',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_yc_batch ON yc_directory(batch);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_yc_industry ON yc_directory(industry);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_yc_esp ON yc_directory(esp_provider);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_yc_team ON yc_directory(team_size);")
    conn.commit()

def save_to_database(enriched_records: List[Dict[str, Any]]) -> None:
    """Saves enriched records into both yc_directory and prospects tables in leads.db."""
    print(f"\nPersisting {len(enriched_records):,} records to SQLite leads.db...")
    conn = sqlite3.connect(str(DB_PATH), timeout=20.0)
    init_yc_directory_table(conn)

    cur = conn.cursor()
    for r in enriched_records:
        # 1. Upsert into yc_directory
        cur.execute("""
        INSERT INTO yc_directory (
            lead_id, slug, company_name, batch, team_size, is_hiring,
            industry, subindustry, locations, stage, top_company,
            website, root_domain, one_liner, long_description, tags,
            founder_name, founder_title, contact_email, esp_provider,
            primary_mx, deliverability_score, yc_url, campaign_id, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(lead_id) DO UPDATE SET
            company_name = excluded.company_name,
            batch = excluded.batch,
            team_size = excluded.team_size,
            is_hiring = excluded.is_hiring,
            industry = excluded.industry,
            subindustry = excluded.subindustry,
            locations = excluded.locations,
            website = excluded.website,
            root_domain = excluded.root_domain,
            one_liner = excluded.one_liner,
            founder_name = excluded.founder_name,
            founder_title = excluded.founder_title,
            contact_email = excluded.contact_email,
            esp_provider = excluded.esp_provider,
            primary_mx = excluded.primary_mx,
            deliverability_score = excluded.deliverability_score
        """, (
            r["lead_id"], r["slug"], r["company_name"], r["batch"], r["team_size"], r["is_hiring"],
            r["industry"], r["subindustry"], r["locations"], r["stage"], r["top_company"],
            r["website"], r["root_domain"], r["one_liner"], r["long_description"], r["tags"],
            r["founder_name"], r["founder_title"], r["contact_email"], r["esp_provider"],
            r["primary_mx"], r["deliverability_score"], r["yc_url"], r["campaign_id"], r["status"]
        ))

        # 2. Upsert into prospects table for Campaign Dispatcher integration
        cur.execute("""
        INSERT INTO prospects (
            lead_id, company_name, company_summary, root_domain, headquarters,
            malaysia_facility, sector, estimated_transactions_mo, accounting_software,
            buyer_name, buyer_title, contact_email, contact_phone, sg_my_wedge,
            quality_score, tier, status, notes, bro_summary, proof_link, phone_script, campaign_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(lead_id) DO UPDATE SET
            company_name = excluded.company_name,
            company_summary = excluded.company_summary,
            root_domain = excluded.root_domain,
            buyer_name = excluded.buyer_name,
            buyer_title = excluded.buyer_title,
            contact_email = excluded.contact_email,
            status = excluded.status,
            campaign_id = excluded.campaign_id
        """, (
            r["lead_id"],
            r["company_name"],
            r["one_liner"] or f"{r['company_name']} - YC {r['batch']}",
            r["root_domain"],
            r["locations"] or "United States / Remote",
            "US Delaware C-Corp / Remote",
            r["industry"] or "Technology",
            "Dynamic Ledger",
            "QuickBooks / Xero / Stripe Sync",
            r["founder_name"],
            r["founder_title"],
            r["contact_email"],
            "",
            "Pilot/Kruze Fatigue & Oct 15 Extension Catch-Up ($800/mo Dedicated Chartered Desk)",
            r["deliverability_score"],
            "Tier 1 (YC Backed)",
            "NEW",
            f"Batch: {r['batch']} | Team: {r['team_size']} | Hiring: {r['is_hiring']} | ESP: {r['esp_provider']}",
            f"{r['company_name']}: YC {r['batch']} company. Flat $800/mo dedicated chartered desk vs Pilot delay.",
            r["yc_url"],
            f"Hi {r['founder_name']}, quick question regarding {r['company_name']}'s month-end books vs Pilot...",
            "yc_us_expansion"
        ))

    conn.commit()
    conn.close()
    print("Database commit complete.")

def export_to_excel(enriched_records: List[Dict[str, Any]], output_path: str = EXCEL_OUTPUT_PATH) -> str:
    """Exports enriched records to a formatted Excel workbook with auto-fit and filters."""
    print(f"\nGenerating formatted Excel workbook: {output_path}...")
    
    excel_cols = [
        ("company_name", "Company Name"),
        ("batch", "YC Batch"),
        ("team_size", "Team Size"),
        ("is_hiring", "Is Hiring"),
        ("industry", "Industry"),
        ("subindustry", "Subindustry"),
        ("locations", "Location"),
        ("stage", "Stage"),
        ("top_company", "Top Co"),
        ("founder_name", "Founder Name"),
        ("founder_title", "Founder Title"),
        ("contact_email", "Candidate Email"),
        ("esp_provider", "ESP Provider"),
        ("primary_mx", "Primary Mail Host"),
        ("deliverability_score", "Email Evidence Score (Not Mailbox Verification)"),
        ("website", "Website"),
        ("root_domain", "Domain"),
        ("one_liner", "One Liner"),
        ("tags", "Tags"),
        ("yc_url", "YC Profile URL")
    ]

    data = []
    for r in enriched_records:
        row = {label: r.get(key, "") for key, label in excel_cols}
        data.append(row)

    df = pd.DataFrame(data)

    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="YC_Revenue_Startups")
        ws = writer.sheets["YC_Revenue_Startups"]

        # Professional Header Styling
        header_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
        header_font = Font(name="Segoe UI", size=11, bold=True, color="FFFFFF")
        regular_font = Font(name="Segoe UI", size=10)
        border = Border(
            left=Side(style="thin", color="E2E8F0"),
            right=Side(style="thin", color="E2E8F0"),
            top=Side(style="thin", color="E2E8F0"),
            bottom=Side(style="thin", color="E2E8F0")
        )

        for col_idx in range(1, len(excel_cols) + 1):
            cell = ws.cell(row=1, column=col_idx)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center")

        # Enable Auto-Filter on top row
        ws.auto_filter.ref = ws.dimensions

        # Freeze Header Row
        ws.freeze_panes = "A2"

        # Apply cell fonts, borders, and auto-fit column widths
        for col_idx, col in enumerate(ws.columns, start=1):
            max_len = 0
            col_letter = get_column_letter(col_idx)
            for cell in col:
                if cell.row > 1:
                    cell.font = regular_font
                    cell.border = border
                val_str = str(cell.value or "")
                if len(val_str) > max_len:
                    max_len = len(val_str)
            # Auto-fit width with safety padding
            ws.column_dimensions[col_letter].width = min(max(max_len + 3, 12), 45)

    print(f"Excel export complete: {output_path} ({len(df):,} rows)")
    return output_path

def run_yc_pipeline(max_records: Optional[int] = None, scrape_concurrency: int = 8) -> None:
    """Full execution pipeline."""
    universe = fetch_yc_universe(min_team_size=4)
    if max_records:
        universe = universe[:max_records]

    print(f"\nStarting parallel enrichment for {len(universe):,} companies (Concurrency = {scrape_concurrency})...")
    enriched = []
    t0 = time.time()

    with ThreadPoolExecutor(max_workers=scrape_concurrency) as executor:
        future_to_co = {executor.submit(enrich_single_company, co, True): co for co in universe}
        completed = 0
        total = len(universe)

        for future in as_completed(future_to_co):
            completed += 1
            try:
                rec = future.result()
                enriched.append(rec)
            except Exception as e:
                co = future_to_co[future]
                print(f"Error enriching {co.get('name')}: {e}")

            if completed % 50 == 0 or completed == total:
                elapsed = time.time() - t0
                rate = completed / max(0.1, elapsed)
                print(f"Progress: [{completed:4d}/{total:4d}] ({completed/total*100:5.1f}%) | {rate:.1f} cos/sec | Elapsed: {int(elapsed)}s")

    # Sort deterministically by team size descending, then batch
    enriched.sort(key=lambda r: (r["team_size"], r["batch"]), reverse=True)

    # Save to SQLite
    save_to_database(enriched)

    # Export to Excel
    export_to_excel(enriched)

    print(f"\n=================================================================")
    print(f" [*] YC INGESTION & ENRICHMENT PIPELINE COMPLETED")
    print(f"=================================================================")
    print(f" - Total Records Processed : {len(enriched):,}")
    print(f" - Database Destination    : {DB_PATH} (yc_directory & prospects)")
    print(f" - Excel Workbook Created  : {EXCEL_OUTPUT_PATH}")
    print(f" - Elapsed Wall-Clock Time : {round(time.time() - t0, 1)}s")
    print(f"=================================================================\n")

if __name__ == "__main__":
    limit = None
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        limit = int(sys.argv[1])
    concurrency = 8
    if len(sys.argv) > 2 and sys.argv[2].isdigit():
        concurrency = int(sys.argv[2])
    run_yc_pipeline(max_records=limit, scrape_concurrency=concurrency)
