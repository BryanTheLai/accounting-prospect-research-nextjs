"""
Outbounder Outbound Operating System & Pipeline Cockpit
Sales Power-User Interface:
1. 🎯 Outbound Cockpit & Dispatcher: Unified lead review, campaign switcher, live telemetry, interactive checkbox queue, and 1-click live/test sending with Real Email Discovery.
2. 📝 Template Studio & Playbooks: Spintax angle editor, live variation preview, AI agent prompt specs, and follow-up scripts.
3. 🗄️ Master Archive & Tools: 5,074 historical archive search with collapsible reference drawers for DNS & Zero-SaaS economics.
"""
import sqlite3
import urllib.parse
from pathlib import Path
import datetime
import re
from zoneinfo import ZoneInfo
import streamlit as st
import streamlit.components.v1 as components
import pandas as pd
from timezone_utils import evaluate_lead_timezone, normalize_phone_e164
from campaign_database import (
    log_call_disposition,
    get_telephony_stats_today,
    get_lead_call_history,
    init_telephony_tables
)
from yc_ingest import ingest_yc_selection_to_targets

st.set_page_config(
    page_title="Outbounder • Outbound Sales OS",
    page_icon="⚡",
    layout="wide",
    initial_sidebar_state="collapsed"
)

# Custom CSS: Hide Streamlit header entirely, tighten layout for mobile & desktop
st.markdown("""
<style>
    header[data-testid="stHeader"] { display: none !important; }
    #MainMenu { visibility: hidden; }
    footer { visibility: hidden; }
    
    .block-container {
        padding-top: 1.0rem !important;
        padding-bottom: 2rem !important;
        max-width: 98% !important;
    }
    div[data-testid="stMetricValue"] {
        font-size: 1.25rem !important;
        font-weight: 700 !important;
    }
    .stTabs [data-baseweb="tab-list"] {
        gap: 6px;
    }
    .stTabs [data-baseweb="tab"] {
        padding: 8px 14px;
        font-weight: 700;
        font-size: 0.95rem;
    }
    .stButton>button {
        border-radius: 8px;
        font-weight: 600;
        height: 42px;
    }
    @media (max-width: 768px) {
        .block-container {
            padding-top: 0.5rem !important;
            padding-left: 0.5rem !important;
            padding-right: 0.5rem !important;
            padding-bottom: 1.5rem !important;
        }
        .stTabs [data-baseweb="tab"] {
            padding: 8px 10px !important;
            font-size: 0.85rem !important;
        }
        .stButton>button {
            height: 46px !important;
            font-size: 0.95rem !important;
        }
    }
</style>
""", unsafe_allow_html=True)

from config import (
    BASE_DIR,
    DB_PATH,
    ZONE_PATH,
    JSON_PATH,
    MASTER_XLSX_PATH,
    LOGOS_DIR,
    ASSETS_DIR,
    CRM_STAGES,
    PRIMARY_DOMAIN
)

def load_target_leads():
    if not DB_PATH.exists():
        return pd.DataFrame()
    conn = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query("SELECT * FROM prospects ORDER BY quality_score DESC", conn)
    conn.close()
    return df

def load_master_archive():
    if not DB_PATH.exists():
        return pd.DataFrame()
    conn = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query("SELECT * FROM master_archive", conn)
    conn.close()
    return df

@st.cache_data(ttl=300)
def load_yc_5year_directory():
    if not DB_PATH.exists():
        return pd.DataFrame()
    conn = sqlite3.connect(DB_PATH)
    try:
        df = pd.read_sql_query("""
            SELECT yc_id, name, slug, website, root_domain, batch, batch_season, batch_year,
                   status, stage, top_company, is_hiring, team_size, industry, subindustry,
                   tags, all_locations, one_liner, yc_url, small_logo_url
            FROM yc_5year_directory
            ORDER BY top_company DESC, is_hiring DESC, team_size DESC
        """, conn)
    except Exception:
        df = pd.DataFrame()
    finally:
        conn.close()
    return df

def update_lead_status(lead_id, new_status):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("UPDATE prospects SET status = ? WHERE lead_id = ?", (new_status, lead_id))
    conn.commit()
    conn.close()

def update_lead_contact_info(lead_id, new_phone=None, new_email=None, note=None):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    if new_phone and new_phone.strip():
        cur.execute("UPDATE prospects SET contact_phone = ? WHERE lead_id = ?", (new_phone.strip(), lead_id))
    if new_email and new_email.strip():
        cur.execute("UPDATE prospects SET contact_email = ? WHERE lead_id = ?", (new_email.strip(), lead_id))
    if note and note.strip():
        cur.execute("UPDATE prospects SET notes = coalesce(notes || ' | ', '') || ? WHERE lead_id = ?", (note.strip(), lead_id))
    conn.commit()
    conn.close()

def get_linkedin_search_link(buyer_name, company_name):
    query = f"{buyer_name} {company_name}"
    return f"https://www.linkedin.com/search/results/all/?keywords={urllib.parse.quote(query)}"

def render_conversational_studio(yc_df: pd.DataFrame):
    st.markdown("### 🤖 Conversational Campaign Studio (Zero-UI Launchpad)")
    st.caption("Tell the AI agent in chat what to target. Antigravity filters SQLite, creates the campaign, and stages the leads directly.")

    st.markdown("""
    <div style="background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 8px; padding: 12px 16px; margin-bottom: 16px;">
        <div style="font-weight: 700; color: #38bdf8; font-size: 0.95rem;">⚡ How Conversational Onboarding Works:</div>
        <div style="font-size: 0.88rem; color: #cbd5e1; margin-top: 6px; line-height: 1.5;">
            1. <b>Copy a prompt below</b>: Pick a target scenario or tweak the criteria.<br/>
            2. <b>Paste in chat with Antigravity</b>: The agent inspects <code>leads.db</code> and asks 2 quick questions (daily send volume and pitch angle).<br/>
            3. <b>Automatic Staging</b>: The agent creates the campaign, stages the leads into SQLite, generates spintax templates, and shows you 3 live email previews.
        </div>
    </div>
    """, unsafe_allow_html=True)

    # 1. Ready-to-Copy Prompts
    st.markdown("#### 📋 1-Click Copyable Prompts for Chat")
    prompt_choice = st.radio(
        "Choose Target Audience Preset:",
        [
            "🚀 Profitable YC Startups (W24–S25, Team ≥ 5)",
            "🏭 Cross-Border Industrial Clones (SG HQ + Johor Factory)",
            "🔥 JobStreet Accounts Clerk Hiring Reverse-Pitch",
            "⚡ AutoCount / SQL Accounting e-Invoicing Compliance",
            "🎯 Custom Campaign"
        ],
        horizontal=True
    )

    if "Profitable YC Startups" in prompt_choice:
        p_text = """Antigravity, please launch a new campaign targeting profitable YC companies from Batches 2024 and 2025.
Criteria:
- Status: Active
- Batches: W24, S24, W25, S25
- Traction signals: team_size >= 5 OR is_hiring = 1
Offer Wedge:
- Pitch our $800/mo flat dedicated chartered accounting desk vs Pilot clerk turnover + Delaware tax catch-up.
- Set daily send volume cap to 10 leads/day.
Please query leads.db, show me 3 sample resolved emails, and stage the campaign."""
    elif "Cross-Border Industrial" in prompt_choice:
        p_text = """Antigravity, please launch a new campaign targeting Singapore manufacturing and engineering companies with Johor facilities.
Criteria:
- Singapore parent company + Johor factory/assembly in Senai, Kulai, or Pasir Gudang
- Monthly transaction volume: 5 to 20 invoices/month
Offer Wedge:
- Pitch RM800/mo done-for-you ledger vs RM4,000 resident accountant hire + LHDN e-invoicing compliance.
Please stage the campaign in leads.db and show 3 email previews."""
    elif "JobStreet" in prompt_choice:
        p_text = """Antigravity, please launch a campaign targeting companies actively hiring Accounts Assistants on JobStreet in Johor.
Criteria:
- Role: Accounts Assistant / Accounts Clerk (offering RM2,500 - RM4,100/mo)
Offer Wedge:
- Replace the RM3,500 + EPF hiring liability with Outbounder's RM600/mo instant chartered desk.
Please stage the campaign and show 3 email previews."""
    elif "AutoCount" in prompt_choice:
        p_text = """Antigravity, please launch a campaign targeting Malaysian B2B companies on AutoCount or SQL Accounting.
Criteria:
- Running on-premise AutoCount or SQL Account
- Need LHDN MyInvois e-invoicing compliance without expensive ERP migration
Offer Wedge:
- Automated e-invoicing validation + monthly reconciliation middleware for RM600/mo.
Please stage the campaign in leads.db."""
    else:
        p_text = """Antigravity, I want to create a custom campaign:
- Target Audience: [Describe your target companies and location]
- Traction / Filter: [e.g. revenue, employee count, software used]
- Offer Wedge: [Your core pitch, pricing, and why they should care]
- Daily Volume: [e.g. 5, 10, or 20/day]
Query leads.db and draft the spintax template for my review."""

    st.code(p_text, language="markdown")
    st.caption("Copy this prompt and paste it into chat with the agent to stage the campaign in SQLite.")

    st.markdown("---")

    # 2. Active Campaigns in SQLite
    st.markdown("#### 📊 Registered Campaigns in SQLite")
    from campaign_database import get_all_campaigns, get_campaign_lead_counts
    all_cps = get_all_campaigns()
    lead_counts = get_campaign_lead_counts()
    
    if all_cps:
        cp_rows = []
        for cp in all_cps:
            cid = cp["campaign_id"]
            cnt = lead_counts.get(cid, 0)
            cp_rows.append({
                "Campaign ID": cid,
                "Name": cp["name"],
                "Status": cp["status"],
                "Leads Queued": cnt,
                "Offer Wedge": cp["offer_wedge"]
            })
        st.dataframe(pd.DataFrame(cp_rows), use_container_width=True, hide_index=True)

    st.markdown("---")

    # 3. YC 5-Year Directory Explorer
    st.markdown(f"#### 🚀 YC 5-Year Database Explorer ({len(yc_df):,} Startups)")
    st.caption("Search, filter, and ingest YC companies directly into your active target queue in 1 click.")
    
    if not yc_df.empty:
        yf1, yf2, yf3, yf4 = st.columns([2, 1.2, 1.2, 1])
        with yf1:
            yc_search = st.text_input("🔍 Search YC Startups", placeholder="Company name, one-liner, tags...", key="yc_search_inp", label_visibility="collapsed")
        with yf2:
            all_batches = ["All Batches"] + sorted(yc_df["batch"].dropna().unique().tolist())
            sel_batch = st.selectbox("Batch", all_batches, key="yc_batch_sel", label_visibility="collapsed")
        with yf3:
            all_inds = ["All Industries"] + sorted(yc_df["industry"].dropna().unique().tolist())
            sel_ind = st.selectbox("Industry", all_inds, key="yc_ind_sel", label_visibility="collapsed")
        with yf4:
            min_team = st.number_input("Min Team", min_value=0, max_value=2000, value=0, step=5, key="yc_min_team_inp", label_visibility="collapsed")

        preset_c1, preset_c2 = st.columns([3, 2])
        with preset_c1:
            quick_preset = st.radio(
                "Quick View Filter:",
                ["🌐 All YC (4,230)", "🔥 Hiring Now (1,220)", "🏆 Top Companies (4)"],
                horizontal=True,
                key="yc_quick_preset_radio"
            )
        with preset_c2:
            st.write("")

        yt1, yt2 = st.columns(2)
        with yt1:
            filter_top = st.toggle("🏆 Top Companies Only", value=(quick_preset == "🏆 Top Companies (4)"), key="yc_tog_top")
        with yt2:
            filter_hiring = st.toggle("🔥 Actively Hiring Only", value=(quick_preset == "🔥 Hiring Now (1,220)"), key="yc_tog_hiring")

        # Apply filters
        yc_filtered = yc_df.copy()
        if yc_search:
            q = yc_search.lower()
            yc_filtered = yc_filtered[
                yc_filtered["name"].str.lower().str.contains(q, na=False) |
                yc_filtered["one_liner"].str.lower().str.contains(q, na=False) |
                yc_filtered["tags"].str.lower().str.contains(q, na=False) |
                yc_filtered["root_domain"].str.lower().str.contains(q, na=False)
            ]
        if sel_batch != "All Batches":
            yc_filtered = yc_filtered[yc_filtered["batch"] == sel_batch]
        if sel_ind != "All Industries":
            yc_filtered = yc_filtered[yc_filtered["industry"] == sel_ind]
        if min_team > 0:
            yc_filtered = yc_filtered[yc_filtered["team_size"] >= min_team]
        if filter_top:
            yc_filtered = yc_filtered[yc_filtered["top_company"] == 1]
        if filter_hiring:
            yc_filtered = yc_filtered[yc_filtered["is_hiring"] == 1]

        act_c1, act_c2, act_c3 = st.columns([2, 1.5, 1.5])
        with act_c1:
            st.caption(f"Showing **{len(yc_filtered):,}** matching YC companies out of {len(yc_df):,}.")
        with act_c2:
            st.caption("Adds new rows for review. Unknown founder and email fields stay blank; existing prospect edits are preserved.")
            if st.button("📥 Add Filtered Companies for Review", type="primary", use_container_width=True, disabled=yc_filtered.empty, key="btn_ingest_yc_targets"):
                count = ingest_yc_selection_to_targets(yc_filtered, target_campaign="yc_us_expansion")
                st.toast(f"✅ Added {count} new YC companies for review.", icon="🚀")
                st.rerun()
        with act_c3:
            csv_export_bytes = yc_filtered.to_csv(index=False).encode('utf-8')
            st.download_button(
                label=f"📥 Export View ({len(yc_filtered):,})",
                data=csv_export_bytes,
                file_name=f"yc_export_{len(yc_filtered)}_leads.csv",
                mime="text/csv",
                help="Instantly exports currently filtered view to CSV directly from database",
                use_container_width=True,
                key="btn_dl_dynamic_yc_csv"
            )

        st.dataframe(
            yc_filtered[[
                "name", "batch", "top_company", "is_hiring", "team_size",
                "industry", "root_domain", "all_locations", "one_liner"
            ]],
            column_config={
                "name": st.column_config.TextColumn("Company", width="medium"),
                "batch": st.column_config.TextColumn("Batch", width="small"),
                "top_company": st.column_config.CheckboxColumn("Top Co", width="small"),
                "is_hiring": st.column_config.CheckboxColumn("Hiring", width="small"),
                "team_size": st.column_config.NumberColumn("Team", width="small"),
                "industry": st.column_config.TextColumn("Industry", width="small"),
                "root_domain": st.column_config.LinkColumn("Website", width="medium"),
                "all_locations": st.column_config.TextColumn("Location", width="medium"),
                "one_liner": st.column_config.TextColumn("One Liner", width="large")
            },
            hide_index=True,
            height=420,
            use_container_width=True
        )

def render_settings_tab():
    st.markdown("### ⚙️ Mailbox, Domain & Deliverability Settings")
    st.caption("Manage DNS authentication, mailbox credentials, and email deliverability health.")

    # 1. Cloudflare DNS
    with st.expander("🌐 Cloudflare DNS Configuration (openclose-desk.com)", expanded=True):
        st.markdown("""
        **Essential DNS Records for Cold Email Deliverability:**
        - **MX**: Inbound mail routing to Microsoft 365 or Google Workspace.
        - **SPF (`v=spf1 ... ~all`)**: Authorizes sending servers to prevent spoofing.
        - **DKIM (`s1._domainkey`)**: Cryptographic signature proving email authenticity.
        - **DMARC (`v=DMARC1; p=reject;`)**: Strict policy protecting domain reputation.
        """)
        
        c_z1, c_z2 = st.columns(2)
        with c_z1:
            if ZONE_PATH.exists():
                with open(ZONE_PATH, "r", encoding="utf-8") as f:
                    z_data = f.read()
                st.download_button(
                    "📥 Download BIND Zone File (.zone)",
                    data=z_data,
                    file_name="cloudflare_dns.zone",
                    mime="text/plain",
                    help="Upload directly to Cloudflare DNS Dashboard",
                    use_container_width=True
                )
        with c_z2:
            if JSON_PATH.exists():
                with open(JSON_PATH, "r", encoding="utf-8") as f:
                    j_data = f.read()
                st.download_button(
                    "📥 Download Cloudflare API JSON (.json)",
                    data=j_data,
                    file_name="cloudflare_dns_records.json",
                    mime="application/json",
                    help="For use with Cloudflare REST API",
                    use_container_width=True
                )

    # 2. Inbound IMAP & Bounce Settings
    with st.expander("📥 Inbound Mail & Bounce Quarantine (Stop-on-Reply)", expanded=False):
        st.markdown("""
        **IMAP4_SSL Listener:**
        - Connects to your configured mailboxes on port 993.
        - Detects Delivery Status Notifications (550 NDR bounces) and auto-quarantines invalid emails.
        - Detects prospect replies and immediately halts outbound drip sequences.
        """)
        from inbound_monitor import scan_inbox_for_replies_and_bounces
        if st.button("📥 Run Inbound IMAP Scan Now", use_container_width=True, key="btn_run_imap_scan"):
            with st.spinner("Connecting to IMAP..."):
                res = scan_inbox_for_replies_and_bounces()
                if res.get("error"):
                    st.warning(f"⚠️ {res['error']}")
                else:
                    st.success(f"✅ Inbound scanned: {res.get('replies_processed', 0)} replies, {res.get('bounces_processed', 0)} bounces quarantined.")

    # 3. Suppressed Emails List
    with st.expander("🚫 Suppressed & Quarantined Emails (DNC & Bounces)", expanded=False):
        from campaign_database import get_suppressed_emails
        suppressed = get_suppressed_emails()
        if suppressed:
            s_rows = [{"Email": s[0], "Reason": s[1], "Added At": s[2]} for s in suppressed]
            st.dataframe(pd.DataFrame(s_rows), use_container_width=True, hide_index=True)
        else:
            st.info("No suppressed emails currently registered.")

target_df = load_target_leads()
yc_df = load_yc_5year_directory()
archive_df = load_master_archive()

has_phone_mask = target_df["contact_phone"].astype(str).str.strip().ne("") if not target_df.empty else pd.Series([], dtype=bool)
callable_count = int(has_phone_mask.sum()) if not target_df.empty else 0

# --- TOP ACTION BAR ---
col_title, col_btns = st.columns([3, 1.5])

with col_title:
    st.markdown("### ⚡ Outbounder • Outbound Sales Desk")
    st.caption(f"Active Queue: **{len(target_df)}** leads | YC Universe: **{len(yc_df):,}** startups | Single Source of Truth: `leads.db`")

with col_btns:
    if not target_df.empty:
        csv_data = target_df.to_csv(index=False).encode('utf-8')
        st.download_button(
            label="📥 Export Active Leads (CSV)",
            data=csv_data,
            file_name="outbounder_active_leads.csv",
            mime="text/csv",
            help="Instant in-memory CSV export directly from SQLite",
            use_container_width=True
        )

# --- WORKSPACE TABS (4 CONSOLIDATED PURPOSE-BUILT TABS) ---
tab_email, tab_ai_campaigns, tab_dialer, tab_settings = st.tabs([
    f"🚀 Outbound Cockpit ({len(target_df)})",
    "🤖 Conversational Campaign Studio",
    f"📞 Phone & WhatsApp ({callable_count})",
    "⚙️ Mailboxes & Settings"
])

# ==========================================
# TAB 1: 🚀 OUTBOUND EMAIL COCKPIT
# ==========================================
with tab_email:
    from ui_campaign_manager import render_campaign_manager_tab
    render_campaign_manager_tab(target_df)

# ==========================================
# TAB 2: 🤖 CONVERSATIONAL CAMPAIGN STUDIO
# ==========================================
with tab_ai_campaigns:
    render_conversational_studio(yc_df)

# ==========================================
# TAB 3: 📞 PHONE & WHATSAPP DIALER
# ==========================================
with tab_dialer:
    if target_df.empty:
        st.info("No leads available in target database.")
    else:
        # Telephony Metrics Strip
        t_stats = get_telephony_stats_today()
        tk1, tk2, tk3, tk4 = st.columns(4)
        with tk1: st.metric("Dials Today", f"{t_stats['dials_today']}")
        with tk2: st.metric("Live Connects", f"{t_stats['connects_today']} ({t_stats['connect_rate_pct']}%)")
        with tk3: st.metric("Meetings Booked", f"{t_stats['meetings_booked_today']} ({t_stats['meeting_conversion_pct']}%)")
        with tk4: st.metric("Gatekeeper Blocks", f"{t_stats['gatekeeper_blocks']}")

        # Separate callable leads (with real phone) from email-only leads
        has_phone_mask = target_df["contact_phone"].astype(str).str.strip().ne("")
        callable_count = int(has_phone_mask.sum())

        # Compact Filter Bar
        f_c1, f_c2 = st.columns([1.5, 1])
        with f_c1:
            lead_category = st.selectbox(
                "Filter Leads",
                [
                    f"📞 Callable Leads Only ({callable_count} with phone)",
                    "🔥 JobStreet Hiring Leads First",
                    "⭐ High Priority (Score ≥ 80)",
                    f"All Active Targets ({len(target_df)})"
                ],
                key="dialer_cat_filter"
            )
        with f_c2:
            dialer_stage = st.selectbox("Stage", ["All Stages"] + CRM_STAGES, key="dialer_stg_filter")

        d_search = st.text_input("🔍 Quick Search (Company, Director, or City)", placeholder="Type to filter instantly...", key="dialer_search_box")

        d_filtered = target_df.copy()
        if "Callable Leads Only" in lead_category:
            d_filtered = d_filtered[has_phone_mask]
        elif "JobStreet" in lead_category:
            d_filtered["is_job"] = d_filtered["lead_id"].str.startswith("OC-JOB")
            d_filtered = d_filtered.sort_values(by=["is_job", "quality_score"], ascending=[False, False])
        elif "Score ≥ 80" in lead_category:
            d_filtered = d_filtered[d_filtered["quality_score"] >= 80]
            
        if dialer_stage != "All Stages":
            d_filtered = d_filtered[d_filtered["status"] == dialer_stage]

        if d_search:
            sq = d_search.lower()
            d_filtered = d_filtered[
                d_filtered["company_name"].str.lower().str.contains(sq, na=False) |
                d_filtered["buyer_name"].str.lower().str.contains(sq, na=False) |
                d_filtered["malaysia_facility"].str.lower().str.contains(sq, na=False) |
                d_filtered["contact_phone"].str.lower().str.contains(sq, na=False)
            ]

        if d_filtered.empty:
            st.warning("No contacts match the selected filter.")
        else:
            if "dialer_idx" not in st.session_state:
                st.session_state.dialer_idx = 0
            if st.session_state.dialer_idx >= len(d_filtered):
                st.session_state.dialer_idx = max(0, len(d_filtered) - 1)

            cur_lead = d_filtered.iloc[st.session_state.dialer_idx]

            # Progress & Navigation Top Bar
            cur_pos = st.session_state.dialer_idx + 1
            total_leads = len(d_filtered)
            
            p_bar_col, nav_prev_col, nav_next_col = st.columns([2.5, 1, 1])
            with p_bar_col:
                st.caption(f"Contact **{cur_pos} of {total_leads}** • Quality Score: `{cur_lead['quality_score']}/100`")
                st.progress(cur_pos / total_leads)
            with nav_prev_col:
                if st.button("⏮️ Prev", disabled=(st.session_state.dialer_idx == 0), key="d_nav_prev", use_container_width=True):
                    st.session_state.dialer_idx -= 1
                    st.rerun()
            with nav_next_col:
                if st.button("Next ⏭️", disabled=(st.session_state.dialer_idx >= total_leads - 1), key="d_nav_next", use_container_width=True):
                    st.session_state.dialer_idx += 1
                    st.rerun()

            # Time Zone Evaluation
            tz_info = evaluate_lead_timezone(
                str(cur_lead.get("headquarters", "")),
                str(cur_lead.get("malaysia_facility", ""))
            )
            st.markdown(f"""
            <div style="background:{tz_info['bg_color']}; border:1px solid {tz_info['border_color']}; border-radius:8px; padding:8px 12px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <span style="font-weight:700; color:#f8fafc;">📍 {tz_info['label']}:</span>
                    <span style="color:#cbd5e1; margin-left:8px; font-weight:600;">{tz_info['local_time_str']}</span>
                </div>
                <div style="font-weight:800; font-size:0.85rem; color:#f8fafc;">
                    {tz_info['badge_text']}
                </div>
            </div>
            """, unsafe_allow_html=True)

            # The Lead Card
            is_job_lead = str(cur_lead["lead_id"]).startswith("OC-JOB")
            proof_url = str(cur_lead.get("proof_link") or "").strip()
            raw_domain = str(cur_lead.get("root_domain") or "").strip()
            domain_url = f"https://{raw_domain}" if raw_domain and not raw_domain.startswith("http") else raw_domain

            if is_job_lead and proof_url:
                job_badge = f'<a href="{proof_url}" target="_blank" rel="noopener noreferrer" style="color:#fbbf24; text-decoration:underline; font-weight:700;">🔥 Actively Hiring Accounts Clerk (JobStreet ↗)</a>'
            elif is_job_lead:
                job_badge = "🔥 <b>Actively Hiring Accounts Clerk (JobStreet)</b>"
            else:
                job_badge = f"🏢 {cur_lead.get('sector', 'SME')}"

            cur_status_badge = f"📋 Status: {cur_lead['status']}"
            wedge_text = str(cur_lead.get('sg_my_wedge') or "").strip()
            
            # Pain / Vacancy Box - Clickable if proof_url exists
            if wedge_text and proof_url:
                pain_html = (
                    f'<a href="{proof_url}" target="_blank" rel="noopener noreferrer" style="text-decoration:none; display:block; margin:8px 0;">'
                    f'<div style="background:#0f172a; border:1px solid #f59e0b; border-left:4px solid #f59e0b; padding:10px 14px; border-radius:8px; font-size:0.92rem; color:#fef3c7; display:flex; justify-content:space-between; align-items:center;">'
                    f'<div style="line-height:1.4;">🎯 <b>Target Vacancy / Pain:</b> {wedge_text}</div>'
                    f'<div style="background:#f59e0b; color:#0f172a; font-weight:800; font-size:0.78rem; padding:6px 10px; border-radius:6px; white-space:nowrap; margin-left:12px; flex-shrink:0;">Open Post ↗</div>'
                    f'</div></a>'
                )
            elif wedge_text:
                pain_html = f'<div style="background:#0f172a; border-left:3px solid #f59e0b; padding:8px 10px; border-radius:4px; font-size:0.85rem; color:#fef3c7; margin-top:6px; margin-bottom:6px;">🎯 <b>Target Pain:</b> {wedge_text}</div>'
            else:
                pain_html = ""

            card_html = (
                f'<div style="background:#1e293b; border:1px solid #334155; border-radius:12px; padding:16px; margin-bottom:12px;">'
                f'<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">'
                f'<span style="font-size:1.25rem; font-weight:800; color:#f8fafc;">{cur_lead["company_name"]}</span>'
                f'<span style="background:#0369a1; color:#e0f2fe; padding:2px 8px; border-radius:6px; font-size:0.8rem; font-weight:600;">Score: {cur_lead["quality_score"]}</span>'
                f'</div>'
                f'<div style="color:#38bdf8; font-weight:600; font-size:1.05rem; margin-bottom:8px;">'
                f'👤 {cur_lead["buyer_name"]} <span style="color:#94a3b8; font-weight:400; font-size:0.95rem;">— {cur_lead["buyer_title"]}</span>'
                f'</div>'
                f'<div style="display:flex; flex-wrap:wrap; gap:8px; font-size:0.85rem; color:#cbd5e1; margin-bottom:6px;">'
                f'<span>📍 {cur_lead["malaysia_facility"]}</span>'
                f'<span>•</span>'
                f'<span>⚙️ {cur_lead["accounting_software"]}</span>'
                f'<span>•</span>'
                f'<span>{job_badge}</span>'
                f'</div>'
                f'{pain_html}'
                f'<div style="font-size:0.8rem; color:#94a3b8; margin-top:4px;">'
                f'<span style="background:#0f172a; padding:2px 8px; border-radius:4px; border:1px solid #334155;">{cur_status_badge}</span>'
                f'</div>'
                f'</div>'
            )
            st.markdown(card_html, unsafe_allow_html=True)

            # Clean phone for tel: and wa.me:
            raw_phone = str(cur_lead.get("contact_phone", "")).strip()
            is_yc_lead = "yc" in str(cur_lead.get("campaign_id", "")).lower()
            default_country = "US" if is_yc_lead else "MY"
            e164_phone = normalize_phone_e164(raw_phone, default_country=default_country)

            clean_digits = "".join(filter(str.isdigit, e164_phone))
            wa_phone = clean_digits
            wa_msg = f"Hi {cur_lead['buyer_name']}, Bryan here from Outbounder. Just tried your line regarding {cur_lead['company_name']}'s bookkeeping desk. If having certified accountants handle your daily books for RM800 to RM1,200/mo flat is relevant, let me know and I'll share our 1-page overview here. Cheers!"
            wa_url = f"https://wa.me/{wa_phone}?text={urllib.parse.quote(wa_msg)}"
            tel_url = f"tel:{e164_phone}" if e164_phone else "#"
            li_url = get_linkedin_search_link(cur_lead['buyer_name'], cur_lead['company_name'])

            # 1. LIVE SCRIPT (PROMINENT - READ IMMEDIATELY WHILE CALLING)
            time_greet = tz_info["time_greeting"]
            raw_script_text = str(cur_lead.get("phone_script", ""))
            if raw_script_text:
                script_text = raw_script_text.replace("{time_greeting}", time_greet)
                script_text = re.sub(r'\bGood day\b', time_greet, script_text)
                st.markdown(f"""
                <div style="background:#0f172a; border:1px solid #334155; border-left:4px solid #10b981; border-radius:8px; padding:12px 14px; margin-bottom:12px; color:#f8fafc; font-size:0.95rem; line-height:1.6; white-space:pre-wrap;">
<div style="font-size:0.8rem; font-weight:700; color:#10b981; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.05em;">🗣️ Live Call Script ({time_greet} • {tz_info['label']})</div>{script_text}
                </div>
                """, unsafe_allow_html=True)

            # Source Proof & Website button HTML snippets
            if proof_url:
                btn_label = "📄 Open JobStreet Job Post ↗" if is_job_lead else "📄 Open Proof / Source Link ↗"
                proof_btn_html = f'<a href="{proof_url}" target="_blank" rel="noopener noreferrer" style="flex:1; display:flex; align-items:center; justify-content:center; box-sizing:border-box; background:#78350f; color:#fef3c7; border:1px solid #d97706; border-radius:8px; padding:12px 8px; text-decoration:none; font-weight:700; font-size:0.92rem; text-align:center; -webkit-tap-highlight-color:transparent;">{btn_label}</a>'
            else:
                proof_btn_html = '<div style="flex:1; display:flex; align-items:center; justify-content:center; box-sizing:border-box; background:#1e293b; color:#64748b; border:1px solid #334155; border-radius:8px; padding:12px 8px; font-size:0.85rem; text-align:center;">No proof link</div>'

            if domain_url:
                web_btn_html = f'<a href="{domain_url}" target="_blank" rel="noopener noreferrer" style="flex:1; display:flex; align-items:center; justify-content:center; box-sizing:border-box; background:#0f172a; color:#cbd5e1; border:1px solid #334155; border-radius:8px; padding:12px 8px; text-decoration:none; font-weight:600; font-size:0.92rem; text-align:center; -webkit-tap-highlight-color:transparent;">🌐 Visit Company Website ↗</a>'
            else:
                web_btn_html = '<div style="flex:1; display:flex; align-items:center; justify-content:center; box-sizing:border-box; background:#1e293b; color:#64748b; border:1px solid #334155; border-radius:8px; padding:12px 8px; font-size:0.85rem; text-align:center;">No website</div>'

            # 2. TOUCH ACTION BUTTONS
            if not e164_phone:
                buttons_html = (
                    f'<div style="background:#451a03; border:1px solid #b45309; border-radius:8px; padding:10px; margin-bottom:8px; text-align:center; color:#fef3c7; font-size:0.9rem;">'
                    f'⚠️ <b>No Phone Number on File.</b> Capture direct mobile below or run email campaign.'
                    f'</div>'
                    f'<div style="display:flex; gap:8px; margin-bottom:8px;">'
                    f'{proof_btn_html}'
                    f'{web_btn_html}'
                    f'</div>'
                    f'<a href="{li_url}" target="_blank" rel="noopener noreferrer" style="display:block; width:100%; box-sizing:border-box; background:#0369a1; color:white; border:1px solid #0284c7; border-radius:8px; padding:10px; text-decoration:none; text-align:center; font-weight:600; font-size:0.88rem; margin-bottom:12px; -webkit-tap-highlight-color:transparent;">🔗 Search {cur_lead["buyer_name"]} on LinkedIn ↗</a>'
                )
            else:
                buttons_html = (
                    f'<div style="display:flex; gap:8px; margin-bottom:8px;">'
                    f'<a href="{tel_url}" style="flex:1; display:flex; align-items:center; justify-content:center; box-sizing:border-box; background:#16a34a; color:white; border-radius:10px; padding:14px 10px; text-decoration:none; font-weight:700; font-size:1.05rem; text-align:center; box-shadow:0 2px 4px rgba(0,0,0,0.2); -webkit-tap-highlight-color:transparent;">📞 Call {e164_phone}</a>'
                    f'<a href="{wa_url}" target="_blank" rel="noopener noreferrer" style="flex:1; display:flex; align-items:center; justify-content:center; box-sizing:border-box; background:#25D366; color:#0f172a; border-radius:10px; padding:14px 10px; text-decoration:none; font-weight:700; font-size:1.05rem; text-align:center; box-shadow:0 2px 4px rgba(0,0,0,0.2); -webkit-tap-highlight-color:transparent;">💬 1-Tap WhatsApp</a>'
                    f'</div>'
                    f'<div style="display:flex; gap:8px; margin-bottom:8px;">'
                    f'{proof_btn_html}'
                    f'{web_btn_html}'
                    f'</div>'
                    f'<a href="{li_url}" target="_blank" rel="noopener noreferrer" style="display:block; width:100%; box-sizing:border-box; background:#0369a1; color:white; border:1px solid #0284c7; border-radius:8px; padding:10px; text-decoration:none; text-align:center; font-weight:600; font-size:0.88rem; margin-bottom:12px; -webkit-tap-highlight-color:transparent;">🔗 Search {cur_lead["buyer_name"]} on LinkedIn ↗</a>'
                )
            st.markdown(buttons_html, unsafe_allow_html=True)

            # 3. HIGH-VELOCITY 2x2 OUTCOME THUMB-PAD (Fitts's Law Optimized)
            st.markdown("##### ⚡ Log Disposition (Advances queue):")
            d_r1_c1, d_r1_c2 = st.columns(2)
            with d_r1_c1:
                if st.button("📅 Booked Meeting", type="primary", use_container_width=True, key=f"d_bk_{cur_lead['lead_id']}"):
                    log_call_disposition(
                        lead_id=cur_lead["lead_id"],
                        target_phone=e164_phone or raw_phone,
                        target_name=cur_lead.get("buyer_name", ""),
                        company_name=cur_lead.get("company_name", ""),
                        campaign_id=cur_lead.get("campaign_id", ""),
                        disposition="CONNECTED_MEETING_BOOKED"
                    )
                    st.toast(f"✅ Booked with {cur_lead['company_name']}!", icon="📅")
                    st.session_state.dialer_idx = min(total_leads - 1, st.session_state.dialer_idx + 1)
                    st.rerun()
            with d_r1_c2:
                if st.button("🔄 Callback Req.", use_container_width=True, key=f"d_cb_{cur_lead['lead_id']}"):
                    log_call_disposition(
                        lead_id=cur_lead["lead_id"],
                        target_phone=e164_phone or raw_phone,
                        target_name=cur_lead.get("buyer_name", ""),
                        company_name=cur_lead.get("company_name", ""),
                        campaign_id=cur_lead.get("campaign_id", ""),
                        disposition="CONNECTED_CALLBACK"
                    )
                    st.toast(f"🔄 Callback logged for {cur_lead['company_name']}", icon="🔄")
                    st.session_state.dialer_idx = min(total_leads - 1, st.session_state.dialer_idx + 1)
                    st.rerun()

            d_r2_c1, d_r2_c2 = st.columns(2)
            with d_r2_c1:
                if st.button("🚫 Gatekeeper Block", use_container_width=True, key=f"d_gk_{cur_lead['lead_id']}"):
                    log_call_disposition(
                        lead_id=cur_lead["lead_id"],
                        target_phone=e164_phone or raw_phone,
                        target_name=cur_lead.get("buyer_name", ""),
                        company_name=cur_lead.get("company_name", ""),
                        campaign_id=cur_lead.get("campaign_id", ""),
                        disposition="GATEKEEPER_BLOCKED"
                    )
                    st.toast(f"🚫 Gatekeeper block logged", icon="🚫")
                    st.session_state.dialer_idx = min(total_leads - 1, st.session_state.dialer_idx + 1)
                    st.rerun()
            with d_r2_c2:
                if st.button("📵 Voicemail / NA", use_container_width=True, key=f"d_na_{cur_lead['lead_id']}"):
                    log_call_disposition(
                        lead_id=cur_lead["lead_id"],
                        target_phone=e164_phone or raw_phone,
                        target_name=cur_lead.get("buyer_name", ""),
                        company_name=cur_lead.get("company_name", ""),
                        campaign_id=cur_lead.get("campaign_id", ""),
                        disposition="NO_ANSWER_VOICEMAIL"
                    )
                    st.toast(f"📵 Marked as Voicemail / No Answer", icon="📵")
                    st.session_state.dialer_idx = min(total_leads - 1, st.session_state.dialer_idx + 1)
                    st.rerun()

            if st.button("⏭️ Skip Lead", use_container_width=True, key=f"d_sk_{cur_lead['lead_id']}"):
                st.session_state.dialer_idx = min(total_leads - 1, st.session_state.dialer_idx + 1)
                st.rerun()

            # 4. COLLAPSIBLE DRAWERS
            with st.expander("📝 Got their Mobile / Email? (Tap to update & activate 1-Tap WhatsApp)", expanded=False):
                with st.form(key=f"cap_form_{cur_lead['lead_id']}"):
                    c_f1, c_f2 = st.columns(2)
                    with c_f1:
                        new_mob = st.text_input("Direct Mobile / WhatsApp", value="", placeholder="e.g. 012-345 6789 or +1 415 555 0199")
                    with c_f2:
                        new_em = st.text_input("Direct Email", value="", placeholder="e.g. boss@company.com")
                    c_note = st.text_input("Meeting Note / Time Booked", placeholder="e.g. Booked Tuesday 2:30 PM via Google Meet")
                    
                    if st.form_submit_button("💾 Save Direct Contact & Activate WhatsApp", use_container_width=True):
                        if new_mob or new_em or c_note:
                            update_lead_contact_info(cur_lead['lead_id'], new_mob, new_em, c_note)
                            st.toast("✅ Direct contact updated! 1-Tap WhatsApp is now live.", icon="💾")
                            st.rerun()


            # Quick Objection Cheat Sheet
            with st.expander("💡 Instant Objection Handlers & Cheat Sheet (Tap to view)", expanded=False):
                st.markdown("""
                * **"Who? Which companies do you work with?":**  
                  > *"Because we manage confidential financial ledgers and tax records under strict NDAs, I can't disclose client names on an unrecorded line—just like we protect your financial privacy.*  
                  > *What I can share is that we primarily work with Malaysian and cross-border manufacturing, engineering, and trading firms in Senai, Pasir Gudang, and Klang Valley running on AutoCount or SQL Account.*  
                  > *For example, one precision engineering facility in Senai had their clerk resign right before their annual audit and SST deadline. Within 48 hours, our chartered desk took over their AutoCount ledger, caught up all reconciliations, and keeps their books audit-ready for a flat monthly fee."*
                * **"What does your service actually cover?":**  
                  > *"We handle 4 core areas: (1) Daily/monthly bank reconciliations & invoice entry in your AutoCount/SQL/Xero, (2) Monthly P&L and Balance Sheet reports, (3) Bi-monthly SST-02 filing and LHDN e-invoicing compliance, and (4) Year-end audit schedule preparation for your auditor."*
                * **"How much does it cost?":**  
                  > *"For a standard SME setup, our flat retainer is RM800 to RM1,200 a month with zero hidden fees. That includes dedicated ACCA review on every file with zero hiring or software seat overhead."*
                * **"Send me an email / WhatsApp first":**  
                  > *"Gladly. Are you guys running on AutoCount, SQL, or Xero right now? ... Got it, I'll WhatsApp you our 1-page pricing sheet directly."*
                * **"We already have an in-house clerk / accountant":**  
                  > *"Totally understand. Most owners we work with already have someone handling the day-to-day. We usually come in as the backup desk if someone leaves or month-end is backlogged so you don't scramble. If your clerk resigns tomorrow, would having a backup team on standby be useful?"*
                * **"Not interested / Too busy":**  
                  > *"No problem at all! If hiring or retraining ever becomes a headache, keep us in mind. Have a great day!"*
                """)

            # 1-Page Executive Overview & Post-Call PDF Asset
            overview_pdf_path = BASE_DIR / "OUTBOUNDER_1_PAGE_OVERVIEW.pdf"
            with st.expander("📄 1-Page Executive Overview & PDF Asset (Tap to send to prospect)", expanded=False):
                st.markdown("##### 📌 Send to Prospect after Call / on WhatsApp:")
                
                lead_fname = cur_lead['buyer_name'].split()[0] if cur_lead['buyer_name'] and not any(k in cur_lead['buyer_name'].lower() for k in ['director', 'owner', 'manager', 'head']) else 'Director'
                wa_summary_text = (
                    f"Hi {lead_fname}, Bryan here from Outbounder following our quick call.\n\n"
                    f"Here is our 1-page summary for {cur_lead['company_name']}:\n\n"
                    f"🏢 Outbounder Chartered Accounting Desk\n"
                    f"• Retainer: RM800 – RM1,200/mo flat (zero hidden fees, zero EPF/SOCSO liability)\n"
                    f"• Scope: Daily bookkeeping & bank reconciliations in {cur_lead['accounting_software']}\n"
                    f"• Compliance: Bi-monthly SST-02 filing & LHDN MyInvois e-invoicing ready\n"
                    f"• Year-End: Complete audit schedules prepared directly for your auditor\n"
                    f"• Oversight: Reviewed by senior Chartered Accountants (ACCA / CA Malaysia)\n"
                    f"• Guarantee: 30-Day zero-risk trial — cancel anytime if not completely satisfied.\n\n"
                    f"I've attached our 1-page PDF brief. Looking forward to our 10-min chat next Tuesday! Cheers."
                )
                
                st.text_area("📋 Personalized WhatsApp Follow-up Text (Copy & send):", value=wa_summary_text, height=180)
                
                if overview_pdf_path.exists():
                    with open(overview_pdf_path, "rb") as f_pdf:
                        st.download_button(
                            label="📥 Download 1-Page PDF Brief (A4 Vector PDF)",
                            data=f_pdf.read(),
                            file_name=f"Outbounder_Accounting_Desk_{cur_lead['company_name'].replace(' ', '_')}.pdf",
                            mime="application/pdf",
                            use_container_width=True
                        )
                else:
                    st.caption("PDF asset ready on disk.")

# ==========================================
# TAB 4: ⚙️ MAILBOXES & SETTINGS
# ==========================================
with tab_settings:
    render_settings_tab()
