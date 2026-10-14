"""
Generate High-Impact Visual PDF Flyer:
'Why Hire a RM3,000/mo In-House Accounts Clerk When You Can Outsource for RM600/mo?'
Renders via WeasyPrint directly to C:\\Users\\wbrya\\Downloads\\Why_Hire_When_You_Can_Outsource_SME_Ledger_v2.pdf
"""

from pathlib import Path
import weasyprint

OUTPUT_PDF = Path(r"C:\Users\wbrya\Downloads\Why_Hire_When_You_Can_Outsource_SME_Ledger_v2.pdf")

HTML_CONTENT = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Why Hire When You Can Outsource?</title>
    <style>
        @page {
            size: A4 portrait;
            margin: 12mm 15mm;
        }
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        body {
            color: #1A202C;
            background-color: #FFFFFF;
            line-height: 1.35;
        }
        .header {
            text-align: center;
            border-bottom: 2px solid #E2E8F0;
            padding-bottom: 12px;
            margin-bottom: 16px;
        }
        .header h1 {
            font-size: 24pt;
            font-weight: 900;
            letter-spacing: -0.5px;
            color: #0F172A;
            text-transform: uppercase;
        }
        .header .subtitle {
            font-size: 11.5pt;
            font-weight: 600;
            color: #475569;
            margin-top: 4px;
        }
        .badge-savings {
            background: #ECFDF5;
            border: 2px solid #059669;
            border-radius: 8px;
            padding: 8px 14px;
            text-align: center;
            margin-bottom: 18px;
            display: flex;
            justify-content: space-around;
            align-items: center;
        }
        .badge-item {
            text-align: center;
        }
        .badge-val {
            font-size: 17pt;
            font-weight: 900;
            color: #047857;
            display: block;
        }
        .badge-lbl {
            font-size: 8pt;
            font-weight: 700;
            color: #065F46;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .comparison-grid {
            display: flex;
            gap: 16px;
            margin-bottom: 18px;
        }
        .card {
            flex: 1;
            border-radius: 10px;
            padding: 16px;
        }
        .card-red {
            background-color: #FFF5F5;
            border: 2px solid #FEB2B2;
        }
        .card-green {
            background-color: #F0FDF4;
            border: 2px solid #86EFAC;
        }
        .card-title {
            font-size: 13.5pt;
            font-weight: 800;
            margin-bottom: 4px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .card-red .card-title {
            color: #9B2C2C;
        }
        .card-green .card-title {
            color: #166534;
        }
        .card-desc {
            font-size: 8.5pt;
            color: #64748B;
            margin-bottom: 14px;
            font-weight: 500;
        }
        .price-box {
            border-radius: 6px;
            padding: 10px;
            text-align: center;
            margin-bottom: 14px;
        }
        .card-red .price-box {
            background: #FED7D7;
            border: 1px solid #FC8181;
        }
        .card-green .price-box {
            background: #DCFCE7;
            border: 1px solid #4ADE80;
        }
        .price-num {
            font-size: 19pt;
            font-weight: 900;
            display: block;
        }
        .card-red .price-num { color: #C53030; }
        .card-green .price-num { color: #15803D; }
        .price-sub {
            font-size: 8.5pt;
            font-weight: 600;
        }
        .card-red .price-sub { color: #742A2A; }
        .card-green .price-sub { color: #14532D; }

        .items-list {
            list-style: none;
        }
        .items-list li {
            font-size: 9pt;
            margin-bottom: 9px;
            padding-left: 22px;
            position: relative;
            line-height: 1.3;
        }
        .card-red .items-list li::before {
            content: "✗";
            position: absolute;
            left: 0;
            color: #E53E3E;
            font-weight: 900;
            font-size: 11pt;
        }
        .card-green .items-list li::before {
            content: "✓";
            position: absolute;
            left: 0;
            color: #16A34A;
            font-weight: 900;
            font-size: 11pt;
        }
        .highlight-bold {
            font-weight: 700;
            color: #0F172A;
        }
        
        .software-strip {
            background: #F8FAFC;
            border: 1px solid #E2E8F0;
            border-radius: 8px;
            padding: 10px 14px;
            text-align: center;
            margin-bottom: 16px;
        }
        .software-strip .lbl {
            font-size: 8pt;
            font-weight: 800;
            color: #475569;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            margin-bottom: 6px;
        }
        .pills {
            display: flex;
            justify-content: center;
            gap: 8px;
            flex-wrap: wrap;
        }
        .pill {
            background: #FFFFFF;
            border: 1px solid #CBD5E1;
            border-radius: 4px;
            padding: 3px 10px;
            font-size: 8.5pt;
            font-weight: 700;
            color: #1E293B;
        }

        .cta-footer {
            background: #0F172A;
            color: #FFFFFF;
            border-radius: 8px;
            padding: 14px 18px;
            text-align: center;
        }
        .cta-footer h3 {
            font-size: 12pt;
            font-weight: 800;
            color: #38BDF8;
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.4px;
        }
        .cta-footer p {
            font-size: 9pt;
            color: #E2E8F0;
            margin-bottom: 10px;
        }
        .contact-box {
            display: flex;
            justify-content: center;
            gap: 24px;
            font-size: 10pt;
            font-weight: 700;
            color: #F8FAFC;
        }
        .contact-item {
            background: rgba(255,255,255,0.1);
            padding: 4px 14px;
            border-radius: 4px;
            border: 1px solid rgba(255,255,255,0.2);
        }
    </style>
</head>
<body>

    <div class="header">
        <h1>Why Hire When You Can Outsource?</h1>
        <div class="subtitle">A 45-Second Financial & Operational Reality Check for Managing Directors</div>
    </div>

    <div class="badge-savings">
        <div class="badge-item">
            <span class="badge-val">RM 35,400</span>
            <span class="badge-lbl">Net Annual Cash Savings</span>
        </div>
        <div style="font-size: 20pt; color: #10B981; font-weight: 300;">|</div>
        <div class="badge-item">
            <span class="badge-val">83%</span>
            <span class="badge-lbl">Immediate Cost Reduction</span>
        </div>
        <div style="font-size: 20pt; color: #10B981; font-weight: 300;">|</div>
        <div class="badge-item">
            <span class="badge-val">Day 1</span>
            <span class="badge-lbl">Zero-Lag Deployment</span>
        </div>
    </div>

    <div class="comparison-grid">
        <!-- RED CARD: IN-HOUSE CLERK -->
        <div class="card card-red">
            <div class="card-title">❌ In-House Accounts Clerk</div>
            <div class="card-desc">Standard Full-Time Hire on JobStreet / Indeed</div>

            <div class="price-box">
                <span class="price-num">RM 42,600 / yr</span>
                <span class="price-sub">True Cost: ~RM 3,550 / month</span>
            </div>

            <ul class="items-list">
                <li><span class="highlight-bold">Base Salary:</span> RM 36,000 / yr (RM 3,000 / mo cash salary)</li>
                <li><span class="highlight-bold">Mandatory EPF (13%):</span> +RM 4,680 / yr employer liability</li>
                <li><span class="highlight-bold">SOCSO & EIS:</span> +RM 720 / yr compulsory statutory contributions</li>
                <li><span class="highlight-bold">Software License:</span> +RM 1,200 / yr (User seat on SQL / AutoCount)</li>
                <li><span class="highlight-bold">Hiring & Training Drag:</span> 4–6 weeks filtering CVs + 2 months training</li>
                <li><span class="highlight-bold">High Turnover Risk:</span> Quits in 6–9 months for a job in Singapore; hiring cycle restarts</li>
                <li><span class="highlight-bold">Year-End Audit Stress:</span> Auditors charge thousands extra to clean up junior bookkeeping errors</li>
            </ul>
        </div>

        <!-- GREEN CARD: CHARTERED REVIEW DESK -->
        <div class="card card-green">
            <div class="card-title">✅ Chartered Accounting Desk</div>
            <div class="card-desc">Full-Service Bookkeeping + Statutory Tax Compliance</div>

            <div class="price-box">
                <span class="price-num">RM 7,200 / yr</span>
                <span class="price-sub">Fixed Retainer: RM 600 / month flat</span>
            </div>

            <ul class="items-list">
                <li><span class="highlight-bold">Flat Predictable Fee:</span> RM 600 / month flat (Zero hidden charges)</li>
                <li><span class="highlight-bold">Zero HR Liabilities:</span> RM 0 EPF, RM 0 SOCSO, RM 0 annual leave downtime</li>
                <li><span class="highlight-bold">Daily Bookkeeping:</span> AP/AR, bank reconciliation, expense matching</li>
                <li><span class="highlight-bold">LHDN e-Invoicing:</span> Direct MyInvois validation & UUID verification</li>
                <li><span class="highlight-bold">Bi-Monthly SST-02:</span> Accurate computation & Kastam tax returns</li>
                <li><span class="highlight-bold">Senior Chartered Review:</span> Every monthly ledger verified by ACCA / CA Malaysia accountants</li>
                <li><span class="highlight-bold">Day-1 Operational:</span> Plugged straight into your existing ledger tomorrow morning</li>
            </ul>
        </div>
    </div>

    <div class="software-strip">
        <div class="lbl">Native Integration With Your Existing Accounting Software</div>
        <div class="pills">
            <span class="pill">AutoCount</span>
            <span class="pill">SQL Account</span>
            <span class="pill">Xero</span>
            <span class="pill">Bukku</span>
            <span class="pill">QuickBooks Online</span>
            <span class="pill">Sage UBS</span>
            <span class="pill">Million</span>
        </div>
    </div>

    <div class="cta-footer">
        <h3>Ready to Stop Interviewing & Save RM 35,000?</h3>
        <p>Before locking into a 12-month employment contract, take 7 minutes on Zoom to see our live ledger workflow.</p>
        <div class="contact-box">
            <div class="contact-item">📞 Direct Phone / WhatsApp: +60 11-1234 5678</div>
            <div class="contact-item">✉️ Email: desk@openclose.sh</div>
            <div class="contact-item">🌐 Web: openclose.sh</div>
        </div>
    </div>

</body>
</html>
"""

def generate_pdf():
    print(f"Generating PDF to: {OUTPUT_PDF}...")
    html = weasyprint.HTML(string=HTML_CONTENT)
    html.write_pdf(str(OUTPUT_PDF))
    print(f"SUCCESS: Created {OUTPUT_PDF} ({OUTPUT_PDF.stat().st_size:,} bytes)")

if __name__ == "__main__":
    generate_pdf()
