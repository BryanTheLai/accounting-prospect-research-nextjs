"""
Streamlit UI Component for Campaign Dispatcher, Multi-Mailbox Pool & Template Studio
Path: ui_campaign_manager.py
"""
import os
import time
import smtplib
import pandas as pd
import streamlit as st
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

from campaign_dispatcher import CampaignDispatcher, send_single_email
from campaign_database import (
    get_recent_send_logs,
    get_sends_today_count,
    get_sends_last_hour_count,
    get_all_mailboxes,
    upsert_mailbox,
    delete_mailbox,
    get_all_templates,
    save_template,
    delete_template,
    init_campaign_tables,
    get_all_campaigns,
    get_campaign_by_id,
    upsert_campaign,
    delete_campaign,
    get_campaign_lead_counts,
    get_leads_by_campaign,
    ingest_leads_to_campaign,
    get_email_stats_summary
)
from campaign_framework import STRATEGY_REGISTRY
from email_intelligence import classify_email, analyze_lead_email, generate_email_permutations
from spintax_engine import CAMPAIGN_ANGLES, render_email_template, parse_spintax
from config import (
    PRIMARY_DOMAIN,
    CRM_STAGES,
    FILTER_GOVERNMENT_ENTITIES_DEFAULT,
    is_live_dispatch_enabled,
    set_live_dispatch_enabled
)
from gov_shield import is_government_affiliated, filter_leads_for_government
from warmup_ramper import get_warmup_policy
from inbound_monitor import scan_inbox_for_replies_and_bounces
from blacklist_checker import check_domain_dnsbl_reputation

@st.cache_resource
def get_dispatcher() -> CampaignDispatcher:
    return CampaignDispatcher()

def test_smtp_connection(user: str, password: str, server: str = "smtp.office365.com", port: int = 587) -> tuple[bool, str]:
    """Tests SMTP authentication without sending any email."""
    if not user or not password:
        return False, "Username or password cannot be empty."
    try:
        s = smtplib.SMTP(server, port, timeout=15)
        s.ehlo()
        s.starttls()
        s.ehlo()
        s.login(user, password)
        s.quit()
        return True, f"Connected & Authenticated to {server}:{port}"
    except smtplib.SMTPAuthenticationError as e:
        return False, f"Auth Failed (535): {e}"
    except Exception as e:
        return False, f"Connection Error: {e}"

# Ensure default templates and initial mailbox exist
def ensure_initial_seed():
    init_campaign_tables()
    # Seed templates if empty
    existing_tmpls = get_all_templates()
    if not existing_tmpls:
        for idx, (name, data) in enumerate(CAMPAIGN_ANGLES.items()):
            save_template(name, data["subject"], data["body"], is_default=(1 if idx == 0 else 0))
    
    # Seed initial mailbox from .env if mailboxes table empty
    mailboxes = get_all_mailboxes()
    env_u = os.getenv("SMTP_USER", "")
    env_p = os.getenv("SMTP_PASSWORD", "")
    if not mailboxes and env_u and env_p:
        upsert_mailbox(
            email=env_u,
            smtp_user=env_u,
            smtp_password=env_p,
            sender_name=os.getenv("SENDER_NAME", "Bryan @ Outbounder"),
            daily_limit=50,
            hourly_limit=10
        )

@st.fragment(run_every="1s")
def render_live_telemetry_fragment(dispatcher: CampaignDispatcher):
    """Sub-second reactive telemetry without reloading the full page."""
    snap = dispatcher.get_snapshot()
    sent_today = snap["sent_today"]
    daily_limit = snap["daily_limit"]
    is_running = snap["is_running"]
    is_paused = snap["is_paused"]
    next_ts = snap["next_send_timestamp"]
    status_text = snap["status_text"]

    c1, c2, c3, c4, c5 = st.columns(5)
    with c1:
        st.metric("Sent Today", f"{sent_today} / {daily_limit}")
    with c2:
        st.metric("This Hour", f"{snap.get('sent_this_hour', 0)} / {snap.get('hourly_limit', 10)}")
    with c3:
        st.metric("Queue Pending", snap["queue_pending"])
    with c4:
        if is_running and next_ts > time.time():
            rem = max(0, int(next_ts - time.time()))
            mins, secs = divmod(rem, 60)
            st.metric("Next Dispatch", f"{mins:02d}:{secs:02d}")
        elif is_running and "break" in status_text.lower():
            st.metric("Next Dispatch", "☕ 15m Break")
        else:
            st.metric("Next Dispatch", "--:--")
    with c5:
        badge = "⚪ IDLE" if not is_running else ("🟡 PAUSED" if is_paused else "🟢 DISPATCHING")
        st.metric("Engine Status", badge)

    progress_val = min(1.0, sent_today / max(1, daily_limit))
    st.progress(progress_val, text=f"Fleet Velocity: {int(progress_val * 100)}% ({status_text})")

    if snap.get("last_error"):
        st.error(snap["last_error"])

# ==============================================================================
# MAIN CAMPAIGN DISPATCHER TAB
# ==============================================================================

def render_campaign_manager_tab(prospects_df: pd.DataFrame):
    ensure_initial_seed()
    dispatcher = get_dispatcher()
    snap = dispatcher.get_snapshot()
    # Live Email Performance & Deliverability Strip
    em_stats = get_email_stats_summary()
    em1, em2, em3, em4 = st.columns(4)
    with em1:
        st.metric("Sent Today (Live)", f"{em_stats['sent_today']} / {em_stats['pool_daily_capacity']}", help="Live sends completed today vs current pool capacity")
    with em2:
        st.metric("Total Delivered", f"{em_stats['sent_total']}", help=f"Lifetime live emails sent ({em_stats['dry_run_total']} dry-run simulations)")
    with em3:
        st.metric("Inbound Replies", f"{em_stats['replies_total']} ({em_stats['reply_rate_pct']}%)", help="Prospects in Warm Reply or Booked stage")
    with em4:
        st.metric("Deliverability Health", f"{em_stats['deliverability_rate_pct']}%", help=f"Bounces: {em_stats['bounces_total']} | Suppressed: {em_stats['suppression_total']}")

    st.markdown("<div style='margin-bottom: 8px;'></div>", unsafe_allow_html=True)

    # Live Dispatch Mode Setting (Dry-Run Safety vs Real Sends)
    is_live = is_live_dispatch_enabled()
    mode_card_bg = "rgba(239, 68, 68, 0.12)" if is_live else "rgba(16, 185, 129, 0.12)"
    mode_border = "#ef4444" if is_live else "#10b981"
    mode_title = "🔴 LIVE OUTBOUND ACTIVE" if is_live else "🟢 SAFE DRY-RUN MODE (Zero Real Emails Sent)"
    mode_desc = (
        "Real emails will be delivered to prospect inboxes through your configured mailboxes."
        if is_live else
        "Simulates timing, checks GovShield, evaluates spintax, and logs to database. Zero real SMTP calls."
    )

    col_m1, col_m2 = st.columns([3, 1.4])
    with col_m1:
        st.markdown(
            f"""
            <div style="background:{mode_card_bg}; border:1px solid {mode_border}; border-left:4px solid {mode_border}; border-radius:8px; padding:10px 14px; margin-bottom:12px;">
                <div style="font-weight:800; font-size:0.95rem; color:#f8fafc;">{mode_title}</div>
                <div style="font-size:0.83rem; color:#cbd5e1; margin-top:2px;">{mode_desc}</div>
            </div>
            """,
            unsafe_allow_html=True
        )
    with col_m2:
        new_live_val = st.toggle("Enable Live Dispatch", value=is_live, key="cockpit_live_dispatch_toggle", help="Toggle between Safe Dry-Run (simulated sends) and Live Outbound (real SMTP deliveries).")
        if new_live_val != is_live:
            set_live_dispatch_enabled(new_live_val)
            dispatcher.set_live_dispatch(new_live_val)
            st.toast(f"Mode switched to: {'LIVE OUTBOUND' if new_live_val else 'SAFE DRY-RUN'}", icon="🛡️")
            st.rerun()

    # Minimalist Header & Live Controls
    h_col1, h_col2, h_col3 = st.columns([2.5, 1.2, 1.2])
    with h_col1:
        st.markdown("### 🚀 Campaign Dispatcher")
        st.caption("Multi-mailbox pool with LRU rotation, Poisson jitter, and campaign-local weekday hours.")

    with h_col2:
        if not snap["is_running"]:
            if st.button("▶️ Launch Drip", type="primary", use_container_width=True):
                target_leads = st.session_state.get("selected_dispatch_leads", [])
                active_tmpl = st.session_state.get("active_campaign_template", None)
                if not active_tmpl:
                    # Fallback to default template from DB
                    tmpls = get_all_templates()
                    active_tmpl = tmpls[0] if tmpls else {"subject": "Quick question", "body": "Hi {{buyer_name}}"}
                
                # Double-check Government Shield on target_leads
                clean_target_leads, blocked_gov = filter_leads_for_government(target_leads)
                if blocked_gov:
                    st.toast(f"Shielded: {len(blocked_gov)} government entities suppressed from dispatch.", icon="🛡️")

                if not clean_target_leads:
                    st.warning("No valid private SME leads queued. Filter or select leads below.")
                else:
                    dispatcher.start_campaign(leads=clean_target_leads, subject_tmpl=active_tmpl["subject"], body_tmpl=active_tmpl["body"])
                    st.toast("Campaign launched on background daemon!", icon="🚀")
                    st.rerun()
        else:
            pause_label = "▶️ Resume" if snap["is_paused"] else "⏸️ Pause"
            if st.button(pause_label, use_container_width=True):
                dispatcher.pause_campaign()
                st.rerun()

    with h_col3:
        if snap["is_running"]:
            if st.button("🛑 STOP", type="secondary", use_container_width=True):
                dispatcher.stop_campaign()
                st.toast("Emergency stop executed.", icon="🛑")
                st.rerun()

    # Live Telemetry
    render_live_telemetry_fragment(dispatcher)

    # Automated 30-Day Warmup Ramper Status Card
    mailboxes = get_all_mailboxes()
    active_mb = mailboxes[0] if mailboxes else {"created_at": "", "daily_limit": 50, "hourly_limit": 10}
    warmup_info = get_warmup_policy(active_mb.get("created_at", ""))
    
    st.markdown(
        f"""
        <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 8px; padding: 10px 16px; margin: 8px 0 14px 0; display: flex; justify-content: space-between; align-items: center;">
            <div>
                <span style="font-weight: 700; color: #10B981; font-size: 0.95rem;">🛡️ Tenant Warmup Shield:</span> 
                <span style="font-weight: 600; color: #E2E8F0;">Day {warmup_info['day_number']} of 30</span> • 
                <span style="color: #94A3B8;">{warmup_info['phase_name']}</span> • 
                <span style="font-weight: 600; color: #38BDF8;">Ceiling: {warmup_info['daily_limit']} sends/day</span> (Max {warmup_info['hourly_limit']}/hr) • 
                <span style="color: #A7F3D0;">Jitter: {warmup_info['min_delay_seconds']}s–{warmup_info['max_delay_seconds']}s</span>
            </div>
            <div style="font-size: 0.82rem; font-weight: 600; background: #064E3B; color: #6EE7B7; padding: 3px 8px; border-radius: 4px;">
                Day 1 Active
            </div>
        </div>
        """,
        unsafe_allow_html=True
    )

    # 1-Click Operations Control Center
    with st.expander("⚡ Deliverability & Inbound Health Hub", expanded=False):
        hub_c1, hub_c2, hub_c3 = st.columns(3)
        with hub_c1:
            st.markdown("##### 📥 Inbound & Stop-on-Reply")
            st.caption("Checks IMAP for prospect replies & 550 bounces. Stops drip sequences immediately on reply.")
            if st.button("📥 Scan Inbound (Replies & Bounces)", use_container_width=True):
                with st.spinner("Connecting to IMAP & parsing inbound messages..."):
                    res = scan_inbox_for_replies_and_bounces()
                    if res.get("error"):
                        st.warning(f"⚠️ {res['error']}")
                    else:
                        st.success(f"✅ Inbound scanned: {res.get('replies_processed', 0)} replies detected, {res.get('bounces_processed', 0)} bounces quarantined.")
        with hub_c2:
            st.markdown("##### 🛡️ DNSBL & Blacklist Reputation")
            st.caption("Live check across Spamhaus ZEN/DBL, SpamCop, and Barracuda reputation networks.")
            if st.button("🛡️ Run Blacklist Audit", use_container_width=True):
                with st.spinner("Probing DNSBL DNS nodes..."):
                    bl_res = check_domain_dnsbl_reputation(PRIMARY_DOMAIN)
                    if bl_res.get("is_blacklisted"):
                        st.error(f"⚠️ Flagged on {len(bl_res.get('listings', []))} list(s): {', '.join(bl_res.get('listings', []))}")
                    else:
                        st.success(f"🟢 Clean! Domain `{PRIMARY_DOMAIN}` has 0 listings across all 4 major DNSBLs.")
        with hub_c3:
            st.markdown("##### 💬 AI Campaign Studio")
            st.caption("Zero-UI workflow: tell the AI agent in chat to filter YC/SME leads and launch.")
            st.info("💡 Tell the agent in chat: *'Target profitable YC companies from W25/S25'* — the agent stages it in SQLite.")

    # 1. Multi-Mailbox Pool Section (Instantly Fleet View)
    with st.expander("📫 Multi-Mailbox Pool & Quotas", expanded=False):
        mailboxes = get_all_mailboxes()
        
        m_head1, m_head2 = st.columns([3, 1])
        with m_head1:
            st.markdown(f"**Configured Mailboxes ({len(mailboxes)} Inboxes in Pool)**")
        with m_head2:
            show_add_mb = st.toggle("➕ Add Inbox", value=False, key="toggle_add_inbox_pool")

        if show_add_mb:
            with st.form("add_mailbox_form", clear_on_submit=True):
                c_em, c_u, c_pw = st.columns([1.5, 1.5, 1.5])
                with c_em:
                    new_email = st.text_input("Mailbox Email", placeholder="b.tan@openclose-desk.com")
                with c_u:
                    new_user = st.text_input("SMTP User / UPN", placeholder="b.tan@openclose-desk.com")
                with c_pw:
                    new_pw = st.text_input("Password / App Password", type="password")
                
                c_nm, c_dl, c_hl = st.columns([1.5, 1, 1])
                with c_nm:
                    new_name = st.text_input("Sender Display Name", value="Bryan @ Outbounder")
                with c_dl:
                    new_daily = st.slider("Daily Limit", 5, 25, 20)
                with c_hl:
                    new_hourly = st.slider("Hourly Limit", 2, 5, 4)

                if st.form_submit_button("💾 Save to Mailbox Pool", type="primary", use_container_width=True):
                    if new_email and new_user and new_pw:
                        upsert_mailbox(new_email, new_user, new_pw, new_name, daily_limit=new_daily, hourly_limit=new_hourly)
                        st.toast(f"Added {new_email} to pool!", icon="📫")
                        st.rerun()
                    else:
                        st.error("Please fill in email, username, and password.")

        if mailboxes:
            mb_rows = []
            for b in mailboxes:
                status_icon = "🟢" if b["status"] == "ACTIVE" else ("🟡" if b["status"] == "COOLDOWN" else "🔴")
                mb_rows.append({
                    "ID": b["mailbox_id"],
                    "Status": f"{status_icon} {b['status']}",
                    "Email": b["email"],
                    "Sender": b["sender_name"],
                    "Sent Today": f"{b['sends_today']} / {b['daily_limit']}",
                    "This Hour": f"{b['sends_this_hour']} / {b['hourly_limit']}",
                    "Last Sent": b.get("last_sent_at") or "Never"
                })
            st.dataframe(pd.DataFrame(mb_rows), use_container_width=True, hide_index=True)

            # Quick Test and Delete Actions
            t_col1, t_col2, t_col3 = st.columns([2, 1, 1])
            with t_col1:
                sel_mb_id = st.selectbox("Select Mailbox", [m["mailbox_id"] for m in mailboxes], format_func=lambda x: next((f"{m['email']} (ID {m['mailbox_id']})" for m in mailboxes if m['mailbox_id'] == x), str(x)))
            with t_col2:
                if st.button("⚡ Test Handshake", use_container_width=True):
                    mb_target = next((m for m in mailboxes if m["mailbox_id"] == sel_mb_id), None)
                    if mb_target:
                        ok, msg = test_smtp_connection(mb_target["smtp_user"], mb_target["smtp_password"], mb_target["smtp_server"], mb_target["smtp_port"])
                        if ok:
                            st.success(f"✅ {msg}")
                        else:
                            st.error(f"❌ {msg}")
            with t_col3:
                if st.button("🗑️ Remove", use_container_width=True):
                    delete_mailbox(sel_mb_id)
                    st.toast("Mailbox removed from pool.", icon="🗑️")
                    st.rerun()

    # 2. Schedule & Rate Governors
    with st.expander("🛡️ Smartlead / Instantly Schedule Settings", expanded=False):
        col_limit, col_hour, col_delay, col_biz = st.columns([1, 1, 1.5, 1.3])
        with col_limit:
            daily_limit = st.slider("Daily Send Cap (Per Box)", 5, 50, snap["daily_limit"], 5)
        with col_hour:
            hourly_limit = st.slider("Hourly Cap (Per Box)", 2, 10, snap.get("hourly_limit", 10), 1)
        with col_delay:
            min_d, max_d = st.slider("Poisson Jitter (Seconds)", 60, 360, (snap["min_delay"], snap["max_delay"]), 15)
        with col_biz:
            sched_mode = st.radio("Fallback Hours", ["⚡ Ignore fallback window (testing only)", "🛡️ SGT fallback (Mon-Fri 09:00 - 17:30)"], index=0 if not snap["business_hours_only"] else 1, help="Every assigned campaign's own weekday schedule and timezone is always enforced, including YC's California window. This control only applies when a lead has no campaign schedule.")
            biz_hours_val = "SGT Hours" in sched_mode

        dispatcher.update_settings(daily_limit, hourly_limit, min_d, max_d, biz_hours_val)

    # 2.5 Campaign Playbook Selector & Sourcing Intelligence
    campaigns = get_all_campaigns()
    lead_counts = get_campaign_lead_counts()
    total_leads_assigned = sum(lead_counts.values())

    cp_options = [("all", f"🌐 All Campaigns Combined ({total_leads_assigned} leads)")]
    for cp in campaigns:
        cnt = lead_counts.get(cp["campaign_id"], 0)
        cp_options.append((cp["campaign_id"], f"{cp['name']} ({cnt} leads)"))

    cp_keys = [o[0] for o in cp_options]
    cur_cp = st.session_state.get("active_campaign_id", "jobstreet_hiring_pain")
    default_idx = cp_keys.index(cur_cp) if cur_cp in cp_keys else (1 if len(cp_keys) > 1 else 0)

    st.markdown("#### 🎯 Campaign Playbook & Angle")
    c_sel1, c_sel2, c_sel3 = st.columns([2.6, 1.2, 1.2])
    with c_sel1:
        sel_cp_id = st.selectbox(
            "Select Campaign Playbook",
            cp_keys,
            index=default_idx,
            format_func=lambda k: next((o[1] for o in cp_options if o[0] == k), k),
            label_visibility="collapsed"
        )
        st.session_state["active_campaign_id"] = sel_cp_id

    with c_sel2:
        show_create_cp = st.toggle("➕ New Playbook", value=False, key="toggle_create_new_playbook")
    with c_sel3:
        show_ingest_cp = st.toggle("📥 Ingest Leads", value=False, key="toggle_ingest_leads_pool")

    # Active Playbook Intelligence Dossier
    active_cp_data = get_campaign_by_id(sel_cp_id) if sel_cp_id != "all" else None
    if active_cp_data:
        # Auto-sync active template to campaign default if available
        tmpls = get_all_templates()
        matched_tmpl = next((t for t in tmpls if t["name"] == active_cp_data.get("default_template_name")), None)
        if matched_tmpl and "user_manual_template_override" not in st.session_state:
            st.session_state["active_campaign_template"] = matched_tmpl

        with st.expander(f"🔍 Playbook Strategy & Lead Sourcing: **{active_cp_data['name']}**", expanded=True):
            p_c1, p_c2 = st.columns([1.5, 1])
            with p_c1:
                st.markdown(f"**🎯 Target Criteria:** {active_cp_data['target_criteria']}")
                st.markdown(f"**🔍 Sourcing Channels (How we find users):** {active_cp_data['sourcing_strategy']}")
                st.markdown(f"**⚡ Commercial Wedge:** `{active_cp_data['offer_wedge']}`")
                st.markdown(f"**📝 Linked Template:** `{active_cp_data['default_template_name']}`")
            with p_c2:
                st.markdown("**🤖 AI Agent Sourcing Prompt Spec:**")
                strat = STRATEGY_REGISTRY.get(sel_cp_id)
                prompt_text = strat.get_agent_prompt(target_count=25) if strat else active_cp_data.get("agent_prompt_spec", "")
                st.code(prompt_text, language="markdown")
                st.caption(f"CLI Command: `py campaign_framework.py prompt --campaign {sel_cp_id}`")

    # Expanders for New Playbook Creation
    if show_create_cp:
        with st.form("create_campaign_form"):
            st.markdown("##### ➕ Launch New Campaign Playbook")
            st.caption("Create a new targeting angle, lead sourcing framework, and pitch wedge without touching code.")
            n_c1, n_c2 = st.columns([1, 2])
            with n_c1:
                new_cp_id = st.text_input("Campaign Slug ID", placeholder="sg_crossborder_legal")
                new_cp_name = st.text_input("Display Name", placeholder="⚖️ Cross-Border Law & Patent Desk")
            with n_c2:
                new_cp_tagline = st.text_input("Tagline", placeholder="SG law firms billing SGD but needing Johor corporate filings")
                new_cp_wedge = st.text_input("Offer Wedge", placeholder="Done-for-you RM bookkeeping with certified MIA accountants")

            new_cp_criteria = st.text_area("Target Criteria", placeholder="Boutique Singapore law firms handling cross-border commercial litigation and M&A.")
            new_cp_sourcing = st.text_area("Sourcing Strategy (How we find them)", placeholder="Singapore Law Society directory cross-referenced with Johor SSM agents.")
            new_cp_prompt = st.text_area("Agent Prompt Spec", placeholder="Find 25 boutique law firms in Singapore with active cross-border corporate work...")

            all_avail_tmpls = [t["name"] for t in get_all_templates()]
            new_cp_tmpl = st.selectbox("Linked Outbound Template", all_avail_tmpls if all_avail_tmpls else ["Angle 1"])

            if st.form_submit_button("💾 Save & Launch Playbook", type="primary", use_container_width=True):
                if new_cp_id and new_cp_name:
                    upsert_campaign(
                        campaign_id=new_cp_id,
                        name=new_cp_name,
                        tagline=new_cp_tagline,
                        target_criteria=new_cp_criteria,
                        sourcing_strategy=new_cp_sourcing,
                        agent_prompt_spec=new_cp_prompt,
                        offer_wedge=new_cp_wedge,
                        default_template_name=new_cp_tmpl,
                        status="ACTIVE"
                    )
                    st.session_state["active_campaign_id"] = new_cp_id
                    st.toast(f"Playbook '{new_cp_name}' created successfully!", icon="🎯")
                    st.rerun()
                else:
                    st.error("Campaign ID and Name are required.")

    # Expanders for Lead Ingestion
    if show_ingest_cp:
        with st.form("ingest_leads_form"):
            st.markdown(f"##### 📥 Ingest Leads into Campaign: `{sel_cp_id}`")
            st.caption("Upload CSV or enter records. Ingested leads will be automatically tagged to this campaign.")
            uploaded_file = st.file_uploader("Upload CSV / Excel", type=["csv", "xlsx"])
            csv_paste = st.text_area("Or Paste CSV Text (Columns: company_name, contact_email, buyer_name, sector...)", height=100)
            
            if st.form_submit_button("📥 Ingest Leads into Campaign", type="primary", use_container_width=True):
                parsed_records = []
                if uploaded_file is not None:
                    try:
                        if uploaded_file.name.endswith(".xlsx"):
                            df_up = pd.read_excel(uploaded_file)
                        else:
                            df_up = pd.read_csv(uploaded_file)
                        parsed_records = df_up.to_dict(orient="records")
                    except Exception as e:
                        st.error(f"Error reading file: {e}")
                elif csv_paste.strip():
                    import io
                    import csv
                    reader = csv.DictReader(io.StringIO(csv_paste.strip()))
                    parsed_records = [r for r in reader]

                if parsed_records:
                    target_campaign = sel_cp_id if sel_cp_id != "all" else "jobstreet_hiring_pain"
                    ins, upd = ingest_leads_to_campaign(parsed_records, target_campaign)
                    st.success(f"Ingestion successful! {ins} new leads added, {upd} existing leads updated.")
                    st.toast(f"Ingested {len(parsed_records)} leads into {target_campaign}", icon="📥")
                    st.rerun()
                else:
                    st.warning("No valid records found to ingest.")

    # 3. Interactive Lead Selector & Dispatch Queue
    st.markdown("#### 📋 Target Prospects & Dispatch Selection")
    st.caption("Check or uncheck prospects below to choose exactly who gets dispatched. Use quick action filters to target high-reply decision makers.")

    # Filter Bar
    ctrl1, ctrl2, ctrl3, ctrl4, ctrl5 = st.columns([1.5, 1.1, 0.9, 1.2, 1.3])
    with ctrl1:
        only_jobstreet = st.checkbox("⭐ Prioritize Top JobStreet Leads", value=True)
    with ctrl2:
        tiers = prospects_df["tier"].dropna().unique().tolist()
        tier_filter = st.multiselect("Tier", tiers, default=tiers)
    with ctrl3:
        min_score = st.number_input("Min Score", 50, 100, 75, 5)
    with ctrl4:
        quality_filter = st.selectbox("Email Tier", ["All Tiers", "🟢 Direct Only (Tier 1)", "🔵 Direct + HR (Tier 1 & 2)", "🟡 Generic (info@)"])
    with ctrl5:
        exclude_gov = st.toggle("🛡️ Exclude Govt Bodies", value=True, key="toggle_exclude_gov_cockpit", help="Strictly hides and suppresses municipal councils (Majlis), ministries, statutory boards, and government-linked companies.")

    filtered_df = prospects_df.copy()
    if sel_cp_id != "all" and "campaign_id" in filtered_df.columns:
        filtered_df = filtered_df[filtered_df["campaign_id"] == sel_cp_id]

    if only_jobstreet:
        is_js = filtered_df["proof_link"].str.contains("jobstreet", case=False, na=False)
        filtered_df = pd.concat([filtered_df[is_js], filtered_df[~is_js]])
    if tier_filter:
        filtered_df = filtered_df[filtered_df["tier"].isin(tier_filter)]
    filtered_df = filtered_df[filtered_df["quality_score"] >= min_score]

    # Government Shield Detection
    gov_flags = []
    gov_reasons = []
    for _, r in filtered_df.iterrows():
        is_gov, reason = is_government_affiliated(
            company_name=str(r.get("company_name", "")),
            root_domain=str(r.get("root_domain", "")),
            contact_email=str(r.get("contact_email", ""))
        )
        gov_flags.append(is_gov)
        gov_reasons.append(reason)
    filtered_df["is_gov"] = gov_flags
    filtered_df["gov_reason"] = gov_reasons

    if exclude_gov:
        filtered_df = filtered_df[~filtered_df["is_gov"]]

    # Email Intelligence Enrichment on filtered_df
    email_tiers = []
    for _, r in filtered_df.iterrows():
        if r.get("is_gov", False):
            email_tiers.append(f"⛔ GOV ({r.get('gov_reason', '')[:12]})")
        else:
            em_info = classify_email(r.get("contact_email", ""), r.get("buyer_name", ""))
            email_tiers.append(em_info["badge"])
    filtered_df["Email Tier"] = email_tiers

    if quality_filter == "🟢 Direct Only (Tier 1)":
        filtered_df = filtered_df[filtered_df["Email Tier"].str.contains("Direct", na=False)]
    elif quality_filter == "🔵 Direct + HR (Tier 1 & 2)":
        filtered_df = filtered_df[filtered_df["Email Tier"].str.contains("Direct|HR", na=False)]
    elif quality_filter == "🟡 Generic (info@)":
        filtered_df = filtered_df[filtered_df["Email Tier"].str.contains("Generic", na=False)]

    # Multi-Select Quick Action Buttons
    act1, act2, act3, act4, act5 = st.columns([1.1, 1.3, 1.2, 1, 1])
    valid_p = filtered_df[~filtered_df["is_gov"]] if "is_gov" in filtered_df.columns else filtered_df
    
    if "selected_lead_ids" not in st.session_state:
        st.session_state["selected_lead_ids"] = set(valid_p.head(5)["lead_id"].tolist())

    with act1:
        if st.button("⚡ Pick Top 5", use_container_width=True):
            st.session_state["selected_lead_ids"] = set(valid_p.head(5)["lead_id"].tolist())
            st.rerun()
    with act2:
        if st.button("🟢 Direct Only", use_container_width=True):
            direct_leads = valid_p[valid_p["Email Tier"].str.contains("Direct", na=False)]["lead_id"].tolist()
            st.session_state["selected_lead_ids"] = set(direct_leads)
            st.rerun()
    with act3:
        if st.button("🔵 Direct + HR", use_container_width=True):
            hr_leads = valid_p[valid_p["Email Tier"].str.contains("Direct|HR", na=False)]["lead_id"].tolist()
            st.session_state["selected_lead_ids"] = set(hr_leads)
            st.rerun()
    with act4:
        if st.button("☑️ Select All", use_container_width=True):
            st.session_state["selected_lead_ids"] = set(valid_p["lead_id"].tolist())
            st.rerun()
    with act5:
        if st.button("⬜ Clear", use_container_width=True):
            st.session_state["selected_lead_ids"] = set()
            st.rerun()

    # Interactive Table with Checkboxes
    filtered_df["Send?"] = filtered_df["lead_id"].apply(lambda lid: lid in st.session_state["selected_lead_ids"])
    display_cols = ["Send?", "company_name", "Email Tier", "contact_email", "proof_link", "buyer_name", "buyer_title", "accounting_software", "quality_score", "lead_id"]

    edited_df = st.data_editor(
        filtered_df[display_cols],
        column_config={
            "Send?": st.column_config.CheckboxColumn("Send?", default=False),
            "company_name": st.column_config.TextColumn("Company", width="medium"),
            "Email Tier": st.column_config.TextColumn("Email Quality", width="small"),
            "contact_email": st.column_config.TextColumn("Contact Email", width="medium"),
            "proof_link": st.column_config.LinkColumn("Source / Job Post", display_text="Open Post ↗", width="small"),
            "buyer_name": st.column_config.TextColumn("Decision Maker", width="small"),
            "buyer_title": st.column_config.TextColumn("Title", width="small"),
            "accounting_software": st.column_config.TextColumn("Software", width="small"),
            "quality_score": st.column_config.NumberColumn("Score", width="small"),
            "lead_id": None # Hide internal ID
        },
        disabled=[col for col in display_cols if col != "Send?"],
        hide_index=True,
        height=460,
        key="lead_dispatch_editor"
    )

    # Sync selected rows to dispatch queue
    checked_lead_ids = set(edited_df[edited_df["Send?"]]["lead_id"].tolist())
    st.session_state["selected_lead_ids"] = checked_lead_ids
    final_selected_records = filtered_df[filtered_df["lead_id"].isin(checked_lead_ids)].to_dict(orient="records")
    st.session_state["selected_dispatch_leads"] = final_selected_records

    n_sel = len(final_selected_records)
    if n_sel > 0:
        st.info(f"🎯 **Queue:** **{n_sel} prospects selected** for dispatch out of {len(filtered_df)} available. (Only checked rows will be contacted when you click 'Launch Drip').")
    else:
        st.warning("⚠️ **0 prospects selected.** Check one or more boxes in the table above to queue them for dispatch.")

    # 4. Single Lead Manual Test Send & Email Intelligence Assistant
    with st.expander("👁️ Single Lead Live Preview & Contact Intelligence", expanded=False):
        source_leads = final_selected_records if final_selected_records else filtered_df.to_dict(orient="records")
        if source_leads:
            company_opts = [f"{i+1}. {r['company_name']} ({r.get('contact_email')})" for i, r in enumerate(source_leads[:35])]
            sel_lead_idx = st.selectbox("Choose Prospect", range(len(company_opts)), format_func=lambda x: company_opts[x])
            lead_item = dict(source_leads[sel_lead_idx])

            # Run email intelligence analysis and pre-flight MX verification
            email_audit = analyze_lead_email(lead_item)
            from email_verifier import EmailVerifier
            from email_discovery import discover_emails_for_lead

            verifier = EmailVerifier()
            v_curr = verifier.verify(lead_item.get("contact_email", ""))
            
            # Email Intelligence & Pre-Flight Verification Banner
            stat_col1, stat_col2 = st.columns([1.5, 1])
            with stat_col1:
                st.markdown(f"**Contact Grade:** {email_audit['badge']} *(Quality Score: {email_audit['score']}/100)*")
            with stat_col2:
                st.markdown(f"**Pre-Flight Status:** {v_curr.status_chip}")

            # Zero-Cost Real Email Discovery Crawler
            disc_col1, disc_col2 = st.columns([2.2, 1])
            with disc_col1:
                p_url = str(lead_item.get("proof_link") or "").strip()
                r_dom = str(lead_item.get("root_domain") or "").strip()
                w_url = f"https://{r_dom}" if r_dom and not r_dom.startswith("http") else r_dom
                
                links_items = []
                if p_url:
                    is_j = any(jb in p_url.lower() for jb in ["jobstreet", "ricebowl", "indeed", "maukerja"])
                    l_text = "📄 Open JobStreet Post ↗" if is_j else "📄 Open Proof Link ↗"
                    links_items.append(f"[{l_text}]({p_url})")
                if w_url:
                    links_items.append(f"[🌐 Company Website ↗]({w_url})")
                
                if links_items:
                    st.markdown(" • ".join(links_items))
                else:
                    st.caption("No domain or proof link recorded.")
            with disc_col2:
                disc_key = f"run_disc_{lead_item.get('lead_id')}"
                if st.button("🌐 Discover Real Emails", key=disc_key, use_container_width=True):
                    with st.spinner("Crawling contact hubs & job post..."):
                        discovered_data = discover_emails_for_lead(lead_item)
                        st.session_state[f"disc_res_{lead_item.get('lead_id')}"] = discovered_data

            cached_disc = st.session_state.get(f"disc_res_{lead_item.get('lead_id')}")
            if cached_disc and cached_disc.get("all_discovered"):
                st.success(f"🎉 Discovered {len(cached_disc['all_discovered'])} real email(s) across {cached_disc.get('pages_crawled', 0)} pages crawled:")
                for found_em in cached_disc["all_discovered"]:
                    f_ver = verifier.verify(found_em)
                    f_source = "Job Listing" if found_em in cached_disc.get("job_posting_emails", []) else "Website"
                    f_col1, f_col2 = st.columns([2.5, 1])
                    with f_col1:
                        st.markdown(f"• `{found_em}` — **{f_ver.status_chip}** *(Source: {f_source})*")
                    with f_col2:
                        if st.button("Adopt Email", key=f"adopt_{found_em}_{lead_item.get('lead_id')}", use_container_width=True):
                            lead_item["contact_email"] = found_em
                            st.toast(f"Contact email updated to {found_em}", icon="✅")
                            st.rerun()

            # Permutation Suggestions (Guarded by setting)
            enable_perms = st.toggle("Show Candidate Permutations (Unverified)", value=False, key=f"perm_toggle_{lead_item.get('lead_id')}")
            if enable_perms and email_audit["is_generic"]:
                if email_audit["permutations"]:
                    st.info("🔵 **Candidate Permutations:** Generated from buyer name. Verify before sending live.")
                    perm_choices = [p[0] for p in email_audit["permutations"][:6]]
                    swap_sel = st.selectbox("Select Alternative", ["Keep Current (" + str(lead_item.get('contact_email')) + ")"] + perm_choices)
                    if not swap_sel.startswith("Keep Current"):
                        lead_item["contact_email"] = swap_sel
                        st.success(f"Target email swapped to candidate: `{swap_sel}`")

            tmpls = get_all_templates()
            active_t = tmpls[0] if tmpls else {"subject": "Quick question", "body": "Hi {{buyer_name}}"}
            
            p_sub = render_email_template(active_t["subject"], lead_item)
            p_body = render_email_template(active_t["body"], lead_item)

            c_left, c_right = st.columns([1.6, 1])
            with c_left:
                st.markdown(f"**To:** `{lead_item.get('contact_email')}` | **Subject:** `{p_sub}`")
                st.text_area("Rendered Preview", value=p_body, height=180)
            with c_right:
                test_addr = st.text_input("Send to Personal Email", placeholder="myemail@gmail.com")
                if st.button("📤 Send Personal Test", use_container_width=True, disabled=not bool(test_addr) or not is_live):
                    with st.spinner("Dispatching test..."):
                        ok, msg = send_single_email(test_addr, lead_item['company_name'], f"[PREVIEW] {p_sub}", p_body, lead_id="test_preview", is_personal_preview_test=True)
                        if ok:
                            st.success(f"✅ {msg}")
                        else:
                            st.error(f"❌ {msg}")
                if not is_live:
                    st.caption("Live mode is off. No email, including a personal preview, can be sent.")
                
                st.markdown("<hr style='margin: 8px 0;'>", unsafe_allow_html=True)
                if st.button(f"🚀 Send Live to {lead_item['company_name']}", type="primary", use_container_width=True, disabled=not is_live):
                    with st.spinner("Sending live..."):
                        ok, msg = send_single_email(lead_item.get('contact_email'), lead_item['company_name'], p_sub, p_body, lead_id=str(lead_item.get('lead_id')), is_personal_preview_test=False)
                        if ok:
                            st.success(f"✅ {msg}")
                            st.balloons()
                        else:
                            st.error(f"❌ {msg}")

    # 5. Live Activity Logs
    st.markdown("#### 📜 Live Delivery Logs")
    logs = get_recent_send_logs(limit=10)
    if not logs:
        st.info("No outbound activity logged yet today.")
    else:
        log_rows = []
        for l in logs:
            status = l["status"]
            badge = "🟢 250 OK" if status == "SENT" else ("🟡 DEFERRED" if status == "DEFERRED" else ("🔴 BOUNCED" if status == "BOUNCED" else f"⚪ {status}"))
            log_rows.append({
                "Timestamp": l["sent_at"],
                "Sender": l.get("sender_email") or "Default",
                "Recipient": l["recipient_email"],
                "Company": l["company_name"],
                "Subject": l["subject"],
                "Status": badge,
                "Response": l["response_msg"]
            })
        st.dataframe(pd.DataFrame(log_rows), use_container_width=True, hide_index=True)

# ==============================================================================
# DEDICATED TEMPLATE STUDIO TAB
# ==============================================================================

def render_template_studio_tab(prospects_df: pd.DataFrame):
    ensure_initial_seed()
    st.markdown("### 📝 Template Studio")
    st.caption("Manage pitch angles, test spintax variations live, and edit dynamic lead tokens. Agent can also edit via CLI: `py campaign_framework.py template update`.")

    templates = get_all_templates()
    tmpl_map = {t["name"]: t for t in templates}

    t_col1, t_col2, t_col3 = st.columns([1.8, 1, 1])
    with t_col1:
        sel_name = st.selectbox("Select Active Template", list(tmpl_map.keys()))
        selected_tmpl = tmpl_map[sel_name]
    with t_col2:
        st.markdown("<div style='height: 28px;'></div>", unsafe_allow_html=True)
        set_active = st.button("⭐ Set as Active", type="primary", use_container_width=True)
        if set_active:
            st.session_state["active_campaign_template"] = selected_tmpl
            st.session_state["user_manual_template_override"] = True
            st.toast(f"'{sel_name}' is now active for campaigns!", icon="⭐")
    with t_col3:
        st.markdown("<div style='height: 28px;'></div>", unsafe_allow_html=True)
        show_create_tmpl = st.toggle("➕ New Template", value=False, key="toggle_create_new_template")

    # Store in session state
    if "active_campaign_template" not in st.session_state:
        st.session_state["active_campaign_template"] = selected_tmpl

    # Form to create new template
    if show_create_tmpl:
        with st.form("create_new_template_form"):
            st.markdown("##### ➕ Create New Pitch Angle Template")
            new_t_name = st.text_input("Template Name", placeholder="🏭 Angle 4: SST Tax Season Overflow")
            new_t_sub = st.text_input("Subject Line", placeholder="{Quick question for|Reaching out to} {{company_name}}")
            new_t_body = st.text_area("Body (Plain Text & Spintax)", placeholder="{Hi|Hello} {{buyer_name}},\n\nSaw your operations in Johor...", height=150)
            new_t_def = st.checkbox("Set as Default", value=False)

            if st.form_submit_button("💾 Save New Template", type="primary", use_container_width=True):
                if new_t_name and new_t_sub and new_t_body:
                    save_template(new_t_name, new_t_sub, new_t_body, is_default=1 if new_t_def else 0)
                    st.toast(f"Template '{new_t_name}' created!", icon="💾")
                    st.rerun()
                else:
                    st.error("Please fill in all template fields.")

    st.markdown("---")

    # Template Editor
    with st.form("edit_template_form"):
        st.markdown(f"**Editing: `{selected_tmpl['name']}`**")
        subject_in = st.text_input("Subject Line (Supports Spintax & {{company_name}})", value=selected_tmpl["subject"])
        body_in = st.text_area("Body (Plain Text, Spintax, Dynamic Tokens)", value=selected_tmpl["body"], height=220)

        # Quick Token Insert Pills
        st.caption("Available Tokens: `{{company_name}}`, `{{buyer_name}}`, `{{accounting_software}}`, `{{sg_my_wedge}}`")

        b1, b2 = st.columns([1, 1])
        with b1:
            save_clicked = st.form_submit_button("💾 Save Template Changes", type="primary", use_container_width=True)
            if save_clicked:
                save_template(selected_tmpl["name"], subject_in, body_in, is_default=selected_tmpl.get("is_default", 0))
                st.session_state["active_campaign_template"] = {"name": selected_tmpl["name"], "subject": subject_in, "body": body_in}
                st.toast("Template saved successfully!", icon="💾")
                st.rerun()
        with b2:
            if selected_tmpl.get("is_default") == 0:
                del_clicked = st.form_submit_button("🗑️ Delete Template", type="secondary", use_container_width=True)
                if del_clicked:
                    delete_template(selected_tmpl["template_id"])
                    st.toast(f"Deleted '{selected_tmpl['name']}'", icon="🗑️")
                    st.rerun()

    st.markdown("---")

    # Live Spintax Tester
    st.markdown("#### 🎲 Live Spintax Randomizer")
    sample_lead = prospects_df.iloc[0].to_dict() if not prospects_df.empty else {
        "company_name": "Advancelab Sdn Bhd",
        "buyer_name": "Michael Tan",
        "accounting_software": "AutoCount",
        "sg_my_wedge": "JB assembly plant with 12 transactions/mo"
    }

    t_btn, t_lead = st.columns([1, 2])
    with t_btn:
        reroll = st.button("🎲 Generate Fresh Variation", use_container_width=True)
    with t_lead:
        st.caption(f"Testing against prospect: **{sample_lead.get('company_name')}**")

    # Render variation
    test_sub = render_email_template(subject_in, sample_lead)
    test_body = render_email_template(body_in, sample_lead)

    v_c1, v_c2 = st.columns([1, 1])
    with v_c1:
        st.markdown("**Rendered Subject:**")
        st.code(test_sub, language="text")
    with v_c2:
        st.markdown("**Rendered Body:**")
        st.code(test_body, language="text")
