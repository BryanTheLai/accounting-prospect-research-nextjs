"""Safe, add-only import of selected YC directory rows into outbound prospects."""

import sqlite3
from pathlib import Path
from typing import Optional

import pandas as pd

from config import DB_PATH


def ingest_yc_selection_to_targets(
    selected_yc_df: pd.DataFrame,
    target_campaign: str = "yc_us_expansion",
    db_path: Optional[Path | str] = None,
) -> int:
    """Add companies as Ready to Review without inventing contacts or overwriting edits."""
    if selected_yc_df.empty:
        return 0

    inserted = 0
    with sqlite3.connect(str(db_path or DB_PATH)) as conn:
        cur = conn.cursor()
        for _, row in selected_yc_df.iterrows():
            slug = str(row.get("slug") or "").strip()
            if not slug:
                continue
            lead_id = f"yc_{slug.replace('-', '_')}"
            company_name = str(row.get("name") or "")
            root_domain = str(row.get("root_domain") or "")
            batch = str(row.get("batch") or "")
            team_size = int(row.get("team_size") or 0)
            top_company = int(row.get("top_company") or 0)
            hiring = int(row.get("is_hiring") or 0)
            one_liner = str(row.get("one_liner") or "")
            yc_url = str(row.get("yc_url") or f"https://www.ycombinator.com/companies/{slug}")
            score = 95 if top_company else (85 if hiring else (75 if team_size >= 10 else 60))

            cur.execute("""
                INSERT INTO prospects (
                    lead_id, company_name, company_summary, root_domain, headquarters,
                    malaysia_facility, sector, estimated_transactions_mo, accounting_software,
                    buyer_name, buyer_title, contact_email, contact_phone, sg_my_wedge,
                    quality_score, tier, status, notes, bro_summary, proof_link, phone_script, campaign_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(lead_id) DO NOTHING
            """, (
                lead_id, company_name, one_liner or f"{company_name} - YC {batch}",
                root_domain, str(row.get("all_locations") or "United States / Remote"),
                "US Delaware C-Corp / Remote", str(row.get("industry") or "Technology"),
                "Dynamic Ledger", "QuickBooks / Xero / Stripe Sync",
                "", "", "", "",
                "Pilot/Kruze Fatigue & Oct 15 Extension Catch-Up ($800/mo Dedicated Desk)",
                score, "Tier 1 (YC Backed)", "Ready to Review",
                f"Batch: {batch} | Team: {team_size} | Top Co: {top_company} | Hiring: {hiring}",
                f"{company_name}: YC {batch} company. Flat $800/mo dedicated chartered desk vs Pilot.",
                yc_url,
                f"Hi Founder, quick question regarding {company_name}'s month-end books vs Pilot...",
                target_campaign,
            ))
            inserted += int(cur.rowcount == 1)
    return inserted
