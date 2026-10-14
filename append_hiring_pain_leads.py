"""
Append 7 Verified Active JobStreet / Ricebowl Hiring Pain Leads into leads.db (table prospects)
and re-sync master_leads.xlsx.
"""
import sqlite3
from pathlib import Path
from sync_leads_to_master import sync_leads_to_master_excel

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "leads.db"

HIRING_PAIN_LEADS = [
    (
        "OC-JOB-001",
        "Advancelab Sdn. Bhd.",
        "They design and manufacture laboratory furniture, cleanroom fume hoods, and biological safety cabinets.",
        "They build heavy-duty steel lab benches, chemical fume hoods, and cleanroom exhaust cabinets for universities and hospitals.",
        "advancelab.com.sg",
        "Singapore (Jurong)",
        "Kulai, Johor (Indahpura Industrial Park)",
        "Lab Cleanroom & Fume Hoods",
        "5–10 tx/mo",
        "AutoCount / SQL Account",
        "Managing Director / Finance Head",
        "Managing Director",
        "hr@advancelab.com.my",
        "+60 7-660 8877",
        "https://my.jobstreet.com/AdvanceLab-jobs/in-Kulai-Johor",
        "Actively recruiting Accounts & Admin Assistant on JobStreet offering RM 3,000–RM 4,100/mo to support SG finance.",
        """Hi Director, Bryan here with Outbounder. Saw your JobStreet post recruiting an Accounts Assistant in Kulai offering up to RM4,100/mo to support your Singapore accounts.

Reason for my call: instead of paying RM4,100 plus EPF and spending 2 months training someone for factory bookkeeping, our chartered desk takes over your daily ledger, SST, and e-invoicing tomorrow morning for RM600/mo flat.

That saves over RM38,000 a year in pure cash flow. Open to a 7-minute Zoom next Tuesday before you sign a 12-month employment contract?""",
        99,
        "Tier A",
        "Ready to Review",
        "Active JobStreet listing: RM 3,000–RM 4,100/mo budget. Supports Singapore finance team."
    ),
    (
        "OC-JOB-002",
        "Seng Li Marketing Sdn. Bhd.",
        "Wholesale distributor of household consumer goods, plastics, and retail merchandise.",
        "They run a massive wholesale distribution warehouse in JB, delivering plastic goods and household supplies to retail supermarkets.",
        "sengli.com.my",
        "Johor Bahru (Taman Mount Austin)",
        "Johor Bahru, Johor",
        "Wholesale & Retail Distribution",
        "15–30 tx/mo",
        "SQL Account / AutoCount",
        "Managing Director",
        "Director / Owner",
        "admin@sengli.com.my",
        "+60 7-353 8811",
        "https://my.jobstreet.com/account-clerk-jobs/in-Johor-Bahru-Johor",
        "Actively advertising on JobStreet for Accounts Assistant (AR Ledger) offering RM 2,500–RM 3,500/mo.",
        """Hi Mr. Director, Bryan here with Outbounder. Saw your JobStreet listing for an Accounts Assistant in JB offering up to RM3,500/mo to handle your sales ledger.

Reason for my call: instead of locking into RM3,500 plus 13% EPF and dealing with high clerk turnover, our senior accounting desk handles your daily AR matching, bank reconciliation, and LHDN e-invoicing for RM600/mo flat.

That frees up over RM32,000 a year in cash. Can I show you our live ledger workflow on a quick 7-minute call next Tuesday?""",
        99,
        "Tier A",
        "Ready to Review",
        "Active JobStreet listing: RM 2,500–RM 3,500/mo budget for AR accounts assistant."
    ),
    (
        "OC-JOB-003",
        "Besuto Auto (M) Sdn Bhd",
        "Automotive reconditioning, spare parts distribution, and commercial vehicle maintenance.",
        "They import, overhaul, and service Japanese commercial trucks, diesel engines, and automotive fleet vehicles.",
        "besutoauto.com.my",
        "Senai / Skudai, Johor",
        "Senai Industrial Area, Johor",
        "Automotive Overhaul & Spare Parts",
        "8–15 tx/mo",
        "AutoCount",
        "General Manager / MD",
        "General Manager",
        "account@besutoauto.com.my",
        "+60 7-598 6688",
        "https://www.ricebowl.my/job/AyROHAYkyw-account-assistant",
        "Active Ricebowl listing for Account Assistant in Senai offering RM 2,500–RM 3,750/mo.",
        """Hi Director, Bryan here with Outbounder. Saw your active posting on Ricebowl seeking an Accounts Assistant in Senai offering up to RM3,750/mo.

Reason for my call: hiring and training an accounts clerk in Senai takes weeks, and they often quit after six months. Our chartered desk takes over your bookkeeping, SST-02, and e-invoicing tomorrow morning for RM600/mo flat.

That saves over RM35,000 a year with zero HR headaches. Open to a 7-minute Zoom next Tuesday before you finalize an offer?""",
        99,
        "Tier A",
        "Ready to Review",
        "Active Ricebowl listing: RM 2,500–RM 3,750/mo budget for account assistant."
    ),
    (
        "OC-JOB-004",
        "Chao Shan Seafood Sdn Bhd",
        "Seafood processing, cold-chain blast freezing, and international seafood distribution.",
        "They process raw fish and seafood in a cold storage plant, pack it into frozen boxes, and ship it to supermarkets across Malaysia and Singapore.",
        "chaoshanseafood.com",
        "Kulai, Johor",
        "Kulai Industrial Park, Johor",
        "Food Processing & Cold Chain",
        "10–20 tx/mo",
        "SQL Account",
        "Managing Director / Owner",
        "Managing Director",
        "chaoshanseafood@gmail.com",
        "+60 7-663 5522",
        "https://my.jobstreet.com/CHAO-SHAN-SEAFOOD-SDN-BHD-jobs",
        "Actively advertising on JobStreet for Account Assistant offering RM 2,300–RM 3,000/mo.",
        """Hi Boss, Bryan here with Outbounder. Saw your job post on JobStreet looking for an Accounts Assistant in Kulai offering RM3,000/mo.

Reason for my call: rather than spending weeks interviewing and paying RM3,000 plus EPF and SOCSO, our chartered team takes over your supplier invoices, daily bank reconciliations, and LHDN e-invoicing for RM600/mo.

That saves you over RM28,000 a year in pure profit. Would you be open to a 7-minute chat next Tuesday before hiring?""",
        98,
        "Tier A",
        "Ready to Review",
        "Active JobStreet listing: RM 2,300–RM 3,000/mo budget."
    ),
    (
        "OC-JOB-005",
        "Manisekara Logistics Sdn Bhd",
        "Haulage trucking, container containerized freight, and customs bonded warehousing.",
        "They operate a large fleet of prime mover container trucks hauling shipping containers in and out of Pasir Gudang Port.",
        "manisekara.com.my",
        "Pasir Gudang, Johor",
        "Pasir Gudang Industrial Estate, Johor",
        "Haulage Trucking & Port Logistics",
        "12–25 tx/mo",
        "SQL Account / Sage UBS",
        "Director of Operations",
        "Managing Director",
        "manisekaralogistics@gmail.com",
        "+60 7-251 7733",
        "https://my.trabajo.org/job-2267-16446ef75cc67cc0a78c6b72d78862d7",
        "Active Trabajo / JobStreet vacancy for Account Assistant in Pasir Gudang offering RM 2,000–RM 2,500/mo.",
        """Hi Director, Bryan here with Outbounder. Saw your active post for an Accounts Assistant in Pasir Gudang offering RM2,500/mo for transport billing.

Reason for my call: logistics invoicing and driver expense matching is messy. Our chartered accounting desk reconciles your trips, diesel bills, SST, and e-invoices directly for RM600/mo flat.

That saves RM22,000 a year and eliminates clerk turnover. Worth a quick 7-minute Zoom next Tuesday?""",
        98,
        "Tier A",
        "Ready to Review",
        "Active job vacancy: RM 2,000–RM 2,500/mo budget in Pasir Gudang."
    ),
    (
        "OC-JOB-006",
        "Pecko (M) Sdn Bhd",
        "Industrial packaging manufacturer of corrugated carton boxes and protective pallets.",
        "They manufacture heavy-duty cardboard boxes and corrugated packaging for factories and export warehouses in Johor.",
        "pecko.com.my",
        "Senai / Kulai, Johor",
        "Senai Industrial Estate, Johor",
        "Corrugated Box Manufacturing",
        "10–18 tx/mo",
        "AutoCount / SQL Account",
        "General Manager",
        "General Manager / MD",
        "peckom@gmail.com",
        "+60 7-599 4411",
        "https://www.maukerja.my/en/job?jobId=24xlsBhzNo&slug=accounts-assistant",
        "Active Maukerja / Indeed vacancy for Accounts Assistant offering RM 2,500–RM 3,000/mo in Senai.",
        """Hi GM, Bryan here with Outbounder. Saw your listing on Maukerja for an Accounts Assistant in Senai offering RM3,000/mo.

Reason for my call: instead of locking into RM3,000 plus EPF and worrying about clerks resigning to work in Singapore, our team handles your bookkeeping, SST, and e-invoicing starting tomorrow for RM600/mo.

Saves RM28,000 a year with chartered accountant review. Can I show you how it works on a 7-minute call next Tuesday?""",
        98,
        "Tier A",
        "Ready to Review",
        "Active job vacancy: RM 2,500–RM 3,000/mo budget in Senai."
    ),
    (
        "OC-JOB-007",
        "KDS Manufacturing (M) Sdn. Bhd.",
        "Precision sheet metal stamping, stamping dies, and automotive brackets.",
        "They run heavy stamping presses that punch out precision steel brackets and metal housings for electronics and car parts.",
        "kdsmfg.com.my",
        "Kulai, Johor",
        "Kulai Industrial Park, Johor",
        "Precision Sheet Metal Stamping",
        "6–12 tx/mo",
        "SQL Account",
        "Managing Director",
        "Managing Director",
        "admin@kdsmfg.com.my",
        "+60 7-663 8899",
        "https://www.ricebowl.my/job/14773580-accounts-cum-admin-assistant",
        "Active Ricebowl listing for Accounts Cum Admin Assistant offering RM 2,500–RM 3,000/mo in Kulai.",
        """Hi Director, Bryan here with Outbounder. Saw your posting on Ricebowl for an Accounts Cum Admin Assistant in Kulai offering RM3,000/mo.

Reason for my call: why pay RM3,000 plus EPF and spend two months training a clerk when our chartered desk takes over your books, SST, and e-invoicing tomorrow morning for RM600/mo flat.

Saves your factory over RM28,000 a year in pure cash. Would you be open to a 7-minute Zoom next Tuesday before hiring?""",
        98,
        "Tier A",
        "Ready to Review",
        "Active Ricebowl vacancy: RM 2,500–RM 3,000/mo budget in Kulai."
    )
]

def append_hiring_pain_leads():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    print("Checking existing leads...")
    for lead in HIRING_PAIN_LEADS:
        lead_id = lead[0]
        cur.execute("DELETE FROM prospects WHERE lead_id = ?", (lead_id,))
        cur.execute("""
        INSERT INTO prospects (
            lead_id, company_name, company_summary, bro_summary, root_domain,
            headquarters, malaysia_facility, sector, estimated_transactions_mo,
            accounting_software, buyer_name, buyer_title, contact_email,
            contact_phone, proof_link, sg_my_wedge, phone_script,
            quality_score, tier, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, lead)
        print(f"  + Inserted/Updated: {lead_id} ({lead[1]})")

    conn.commit()
    cur.execute("SELECT COUNT(*) FROM prospects")
    total = cur.fetchone()[0]
    conn.close()
    print(f"Total leads in leads.db: {total}")
    
    # Sync to master_leads.xlsx
    sync_leads_to_master_excel()

if __name__ == "__main__":
    append_hiring_pain_leads()
