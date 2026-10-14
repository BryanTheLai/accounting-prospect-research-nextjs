"""
Master 5-Year YC Universe Harvester (2020-2026 Batches)
Harvests 100% of all YC companies across the 5-year window with ALL badges,
tags, team sizes, and industry classifications.
Zero Hallucinations: Missing fields remain strictly empty ("").

Path: harvest_yc_5year_master.py
"""
import sys
import os
import re
import json
import time
import sqlite3
import urllib.request
from typing import Dict, Any, List, Optional
import pandas as pd
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

import config

DATASET_URL = "https://yc-oss.github.io/api/companies/all.json"
EXCEL_OUTPUT_PATH = "master_yc_5year_all_batches_and_badges.xlsx"

TARGET_YEARS = ["2020", "2021", "2022", "2023", "2024", "2025", "2026"]

def clean_domain(url_str: str) -> str:
    """Extracts clean root domain from website URL."""
    if not url_str:
        return ""
    clean = str(url_str).lower().strip()
    clean = re.sub(r'^https?://', '', clean)
    clean = re.sub(r'^www\.', '', clean)
    return clean.split('/')[0].split('?')[0].strip()

def init_yc_5year_tables(db_path: Optional[str] = None) -> None:
    """Initializes dedicated table for the complete 5-year YC universe with all badges."""
    target_db = db_path or config.DB_PATH
    conn = sqlite3.connect(target_db)
    cur = conn.cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS yc_5year_directory (
        yc_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE,
        website TEXT,
        root_domain TEXT,
        batch TEXT NOT NULL,
        batch_season TEXT,
        batch_year INTEGER,
        status TEXT,
        stage TEXT,
        top_company INTEGER DEFAULT 0,
        is_hiring INTEGER DEFAULT 0,
        nonprofit INTEGER DEFAULT 0,
        team_size INTEGER DEFAULT 0,
        industry TEXT,
        subindustry TEXT,
        tags TEXT,
        tags_highlighted TEXT,
        all_locations TEXT,
        regions TEXT,
        one_liner TEXT,
        long_description TEXT,
        yc_url TEXT,
        small_logo_url TEXT,
        app_video_public INTEGER DEFAULT 0,
        demo_day_video_public INTEGER DEFAULT 0,
        contact_email TEXT DEFAULT '',
        contact_phone TEXT DEFAULT '',
        ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_yc5_batch ON yc_5year_directory(batch);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_yc5_status ON yc_5year_directory(status);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_yc5_top ON yc_5year_directory(top_company);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_yc5_hiring ON yc_5year_directory(is_hiring);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_yc5_domain ON yc_5year_directory(root_domain);")
    conn.commit()
    conn.close()

def parse_batch_components(batch_str: str) -> tuple[str, int]:
    """Extracts season and year from batch string, e.g. 'Winter 2024' -> ('Winter', 2024)."""
    if not batch_str:
        return "", 0
    parts = str(batch_str).strip().split()
    if len(parts) >= 2 and parts[-1].isdigit():
        return parts[0], int(parts[-1])
    # Fallback regex
    match = re.search(r'(Winter|Summer|Spring|Fall)\s*(\d{4})', batch_str, re.IGNORECASE)
    if match:
        return match.group(1).capitalize(), int(match.group(2))
    return batch_str, 0

def fetch_and_ingest_all_yc_5year(db_path: Optional[str] = None) -> Dict[str, Any]:
    """Fetches, parses, and ingests all 2020-2026 YC companies without team size pruning."""
    init_yc_5year_tables(db_path=db_path)
    print("Fetching authoritative YC dataset from yc-oss...")
    req = urllib.request.Request(
        DATASET_URL,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Outbounder/1.0"}
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        all_companies = json.loads(resp.read().decode("utf-8"))

    print(f"Total historical YC records fetched: {len(all_companies):,}")

    target_db = db_path or config.DB_PATH
    conn = sqlite3.connect(target_db)
    cur = conn.cursor()

    inserted = 0
    updated = 0
    records = []

    for c in all_companies:
        batch = str(c.get("batch") or "").strip()
        if not any(y in batch for y in TARGET_YEARS):
            continue

        yc_id = c.get("id")
        name = str(c.get("name") or "").strip()
        slug = str(c.get("slug") or "").strip()
        website = str(c.get("website") or "").strip()
        domain = clean_domain(website)
        season, year = parse_batch_components(batch)
        status = str(c.get("status") or "").strip()
        stage = str(c.get("stage") or "").strip()
        top_co = 1 if bool(c.get("top_company")) else 0
        hiring = 1 if bool(c.get("isHiring")) else 0
        nonprofit = 1 if bool(c.get("nonprofit")) else 0
        team_size = int(c.get("team_size") or 0)
        industry = str(c.get("industry") or "").strip()
        subind = str(c.get("subindustry") or "").strip()
        
        tags_list = c.get("tags") or []
        tags_str = ", ".join(tags_list) if isinstance(tags_list, list) else str(tags_list)

        tags_hi_list = c.get("tags_highlighted") or []
        tags_hi_str = ", ".join(tags_hi_list) if isinstance(tags_hi_list, list) else str(tags_hi_list)

        locations = str(c.get("all_locations") or "").strip()
        regions_list = c.get("regions") or []
        regions_str = ", ".join(regions_list) if isinstance(regions_list, list) else str(regions_list)

        one_liner = str(c.get("one_liner") or "").strip()
        long_desc = str(c.get("long_description") or "").strip()
        yc_url = str(c.get("url") or f"https://www.ycombinator.com/companies/{slug}").strip()
        logo_url = str(c.get("small_logo_thumb_url") or "").strip()
        app_vid = 1 if bool(c.get("app_video_public")) else 0
        demo_vid = 1 if bool(c.get("demo_day_video_public")) else 0

        # ZERO HALLUCINATION: Phone and email left empty
        rec = {
            "yc_id": yc_id,
            "name": name,
            "slug": slug,
            "website": website,
            "root_domain": domain,
            "batch": batch,
            "batch_season": season,
            "batch_year": year,
            "status": status,
            "stage": stage,
            "top_company": top_co,
            "is_hiring": hiring,
            "nonprofit": nonprofit,
            "team_size": team_size,
            "industry": industry,
            "subindustry": subind,
            "tags": tags_str,
            "tags_highlighted": tags_hi_str,
            "all_locations": locations,
            "regions": regions_str,
            "one_liner": one_liner,
            "long_description": long_desc,
            "yc_url": yc_url,
            "small_logo_url": logo_url,
            "app_video_public": app_vid,
            "demo_day_video_public": demo_vid
        }
        records.append(rec)

        cur.execute("""
        INSERT INTO yc_5year_directory (
            yc_id, name, slug, website, root_domain, batch, batch_season, batch_year,
            status, stage, top_company, is_hiring, nonprofit, team_size,
            industry, subindustry, tags, tags_highlighted, all_locations, regions,
            one_liner, long_description, yc_url, small_logo_url,
            app_video_public, demo_day_video_public
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(yc_id) DO UPDATE SET
            name = excluded.name,
            slug = excluded.slug,
            website = excluded.website,
            root_domain = excluded.root_domain,
            batch = excluded.batch,
            batch_season = excluded.batch_season,
            batch_year = excluded.batch_year,
            status = excluded.status,
            stage = excluded.stage,
            top_company = excluded.top_company,
            is_hiring = excluded.is_hiring,
            nonprofit = excluded.nonprofit,
            team_size = excluded.team_size,
            industry = excluded.industry,
            subindustry = excluded.subindustry,
            tags = excluded.tags,
            tags_highlighted = excluded.tags_highlighted,
            all_locations = excluded.all_locations,
            regions = excluded.regions,
            one_liner = excluded.one_liner,
            long_description = excluded.long_description,
            yc_url = excluded.yc_url,
            small_logo_url = excluded.small_logo_url,
            app_video_public = excluded.app_video_public,
            demo_day_video_public = excluded.demo_day_video_public
        """, (
            yc_id, name, slug, website, domain, batch, season, year,
            status, stage, top_co, hiring, nonprofit, team_size,
            industry, subind, tags_str, tags_hi_str, locations, regions_str,
            one_liner, long_desc, yc_url, logo_url,
            app_vid, demo_vid
        ))
        inserted += 1

    conn.commit()
    conn.close()

    print(f"Committed {len(records):,} companies from 2020-2026 into table yc_5year_directory.")
    return export_master_excel(records)

def export_master_excel(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Generates an executive, beautifully formatted multi-sheet Excel workbook with full filters."""
    print("Exporting master 5-year YC Excel workbook...")
    df = pd.DataFrame(records)

    # Sanitize illegal characters for openpyxl
    from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
    for col in df.columns:
        if df[col].dtype == object:
            df[col] = df[col].apply(lambda x: ILLEGAL_CHARACTERS_RE.sub('', str(x)) if pd.notnull(x) else '')

    with pd.ExcelWriter(EXCEL_OUTPUT_PATH, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="All YC Companies (2020-2026)", index=False)
        
        # Breakdown Summary Sheet
        batch_summary = df.groupby(["batch", "status"]).size().unstack(fill_value=0)
        batch_summary["Total"] = batch_summary.sum(axis=1)
        batch_summary.to_excel(writer, sheet_name="Batch Breakdown")

        # Top Companies / High Value Sheet
        top_df = df[(df["top_company"] == 1) | (df["team_size"] >= 15) | (df["is_hiring"] == 1)]
        top_df.to_excel(writer, sheet_name="Top & Traction Companies", index=False)

    # Style the Excel Workbook with Stripe-level clean formatting
    import openpyxl
    wb = openpyxl.load_workbook(EXCEL_OUTPUT_PATH)
    ws_main = wb["All YC Companies (2020-2026)"]

    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    center_align = Alignment(horizontal="center", vertical="center")
    left_align = Alignment(horizontal="left", vertical="center")
    thin_border = Border(
        left=Side(style='thin', color='E2E8F0'),
        right=Side(style='thin', color='E2E8F0'),
        top=Side(style='thin', color='E2E8F0'),
        bottom=Side(style='thin', color='E2E8F0')
    )

    # Header styling & auto-filter
    ws_main.auto_filter.ref = ws_main.dimensions
    for cell in ws_main[1]:
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center_align

    # Column widths auto-fit
    for col in ws_main.columns:
        max_len = 0
        col_letter = get_column_letter(col[0].column)
        for cell in col[:100]: # Sample first 100 rows for speed
            val = str(cell.value or '')
            if len(val) > max_len:
                max_len = len(val)
        ws_main.column_dimensions[col_letter].width = min(45, max(12, max_len + 3))

    wb.save(EXCEL_OUTPUT_PATH)
    print(f"Master Excel saved successfully to: {EXCEL_OUTPUT_PATH}")

    return {
        "total_harvested": len(records),
        "excel_path": EXCEL_OUTPUT_PATH,
        "batches_count": df["batch"].nunique(),
        "top_companies": int(df["top_company"].sum()),
        "is_hiring": int(df["is_hiring"].sum()),
        "active_companies": int((df["status"] == "Active").sum())
    }

if __name__ == "__main__":
    stats = fetch_and_ingest_all_yc_5year()
    print("Execution complete:")
    print(json.dumps(stats, indent=2))
