"""
Sync Leads from SQLite (leads.db) to Master Excel (master_leads.xlsx)
Enforces Single Source of Truth architecture:
- SQLite (leads.db) is the canonical transactional database.
- master_leads.xlsx is the single master workbook containing all historical sheets
  plus the fresh 'Cross-Border Pipeline' sheet with 'What It Does' summary.
"""
import sqlite3
from pathlib import Path
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "leads.db"
MASTER_XLSX_PATH = BASE_DIR / "master_leads.xlsx"

def sync_leads_to_master_excel():
    if not DB_PATH.exists():
        raise FileNotFoundError(f"Database not found: {DB_PATH}")
    if not MASTER_XLSX_PATH.exists():
        raise FileNotFoundError(f"Master Excel not found: {MASTER_XLSX_PATH}")

    # 1. Fetch leads from SQLite
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
    SELECT 
        lead_id, company_name, bro_summary, company_summary, root_domain, headquarters, malaysia_facility,
        sector, estimated_transactions_mo, accounting_software, buyer_name,
        buyer_title, contact_email, contact_phone, proof_link, sg_my_wedge,
        quality_score, tier, status, notes
    FROM prospects 
    WHERE lead_id LIKE 'OC-%'
    ORDER BY quality_score DESC
    """)
    rows = cur.fetchall()
    conn.close()

    print(f"Loaded {len(rows)} leads from {DB_PATH.name}")

    # 2. Load Master Excel Workbook
    print(f"Loading {MASTER_XLSX_PATH.name}...")
    wb = openpyxl.load_workbook(MASTER_XLSX_PATH)

    sheet_name = "Cross-Border Pipeline"
    if sheet_name in wb.sheetnames:
        del wb[sheet_name]

    # Create sheet right after 'Overview' or as second sheet
    if "Overview" in wb.sheetnames:
        idx = wb.sheetnames.index("Overview") + 1
        ws = wb.create_sheet(title=sheet_name, index=idx)
    else:
        ws = wb.create_sheet(title=sheet_name, index=0)

    ws.views.sheetView[0].showGridLines = True

    headers = [
        "Lead ID", "Company Name", "Plain English Summary", "Technical Summary", "Root Domain", "Headquarters", "Malaysia Facility",
        "Sector", "Est. Transactions / Mo", "Accounting Software", "Decision Maker",
        "Job Title", "Contact Email", "Contact Phone", "Proof / Source", "Cross-Border Arbitrage Wedge",
        "Quality Score", "Tier", "Status", "Internal Notes"
    ]

    # Styles
    header_fill = PatternFill(start_color="1F4E79", end_color="1F4E79", fill_type="solid")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    tier_a_fill = PatternFill(start_color="E2EFDA", end_color="E2EFDA", fill_type="solid")
    border_thin = Border(
        left=Side(style='thin', color='D9D9D9'),
        right=Side(style='thin', color='D9D9D9'),
        top=Side(style='thin', color='D9D9D9'),
        bottom=Side(style='thin', color='D9D9D9')
    )

    # Write Headers
    ws.append(headers)
    for col_num in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_num)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    # Write Data
    for row_idx, r in enumerate(rows, start=2):
        ws.append(list(r))
        tier_cell = ws.cell(row=row_idx, column=18)  # Tier is column 18
        if tier_cell.value == "Tier A":
            tier_cell.fill = tier_a_fill
            tier_cell.font = Font(name="Calibri", size=10, bold=True, color="276A3C")

        for col_num in range(1, len(headers) + 1):
            cell = ws.cell(row=row_idx, column=col_num)
            cell.border = border_thin
            if col_num in [1, 17, 18, 19]:
                cell.alignment = Alignment(horizontal="center", vertical="center")
            else:
                cell.alignment = Alignment(vertical="center")

    # Column Widths
    col_widths = {
        1: 14, 2: 32, 3: 45, 4: 40, 5: 20, 6: 24, 7: 24,
        8: 28, 9: 18, 10: 20, 11: 20, 12: 22,
        13: 26, 14: 22, 15: 35, 16: 45, 17: 14, 18: 12,
        19: 18, 20: 30
    }
    for col_idx, width in col_widths.items():
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    # Excel Grouping (Outline levels to collapse/expand details)
    ws.column_dimensions.group('E', 'J', outline_level=1, hidden=False)
    ws.column_dimensions.group('M', 'P', outline_level=1, hidden=False)

    # Enable AutoFilter
    ws.auto_filter.ref = f"A1:{get_column_letter(len(headers))}{len(rows) + 1}"

    # Freeze Header & Key Identifiers (A to C: ID, Company, Plain English Summary)
    ws.freeze_panes = "D2"

    print(f"Saving updated {MASTER_XLSX_PATH.name}...")
    wb.save(MASTER_XLSX_PATH)
    print(f"SUCCESS: Synced {len(rows)} leads into sheet '{sheet_name}' in {MASTER_XLSX_PATH.name}")

if __name__ == "__main__":
    sync_leads_to_master_excel()
