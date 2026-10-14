import sqlite3

# Pre-insert validation: assert no em dashes and check for conflicts
BATCH_LEADS = [
    # ---- ARCHETYPE A: OC-JOB-188 to OC-JOB-202 ----
    {
        "lead_id": "OC-JOB-188",
        "company_name": "Gemilang Coachwork Sdn. Bhd.",
        "company_summary": "Designs and manufactures electric and conventional bus bodies for transit operators across Southeast Asia, listed on HKEX under Gemilang International Limited.",
        "bro_summary": "They build bus bodies for public transport fleets in Malaysia and export regionally - one of the biggest bus coachbuilders in Johor.",
        "root_domain": "gml.com.my",
        "headquarters": "Senai, Johor",
        "malaysia_facility": "PTD 42326, Jalan Seelong, Mukim Senai, 81400 Senai, Johor",
        "sector": "Commercial Vehicle Manufacturing",
        "estimated_transactions_mo": "30-60 tx/mo",
        "accounting_software": "AutoCount",
        "buyer_name": "Pang Chong Yong",
        "buyer_title": "Co-founder and Managing Director",
        "contact_email": "gml@gml.com.my",
        "contact_phone": "+607-599 6666",
        "proof_link": "https://www.jobstreet.com.my/en/companies/gemilang-coachwork-sdn-bhd/jobs",
        "sg_my_wedge": "Actively recruiting Accounts Executive on JobStreet Senai - advertised RM 3,500 budget; outsourcing to Outbounder saves RM 30,000/yr vs full-time hire",
        "phone_script": """[IF GATEKEEPER / RECEPTIONIST ANSWERS]
"Hi, may I check who I'm speaking with? ... Hi [Name], Bryan here. Could you put me through to Mr. Pang or whoever oversees the finance and operations side?"
(If asked why): "Just a quick note regarding your Senai facility. We actually partner with local finance teams to take the messy month-end backlog and e-invoicing off their plate so nobody has to work overtime."

[WHEN DECISION MAKER PICKS UP]
"Hi Chong Yong, Bryan here. Did I catch you at a bad time?"
(Wait for response)

"Thanks. Saw your team is growing the Senai plant - you guys are one of the most recognised bus coachbuilders in the region, supplying transit fleets all the way to Singapore and beyond.

Reason I'm calling: a lot of manufacturing MDs running operations in Johor tell me they only have 30 to 60 Malaysian payables a month, but end up paying 3,500 plus EPF, SOCSO, and software licenses for a full-time accounts person. And with staff always eyeing Singapore wages, you're constantly retraining someone.

What if I told you that instead of that 3,500 headache, our chartered desk takes over your daily bookkeeping, SST filings, and audit prep for 600 to 1,000 a month, reviewed by senior ACCA accountants?

How does that sound?"
(Wait for response)

[THE CLOSE]
"Would you be against a quick 10-minute chat next Tuesday just to see if this makes sense for your Senai setup?"

[NATURAL BAILOUT]
"Look, I run our partner desk so I don't want to guess on technical tax rules off the top of my head. Let me have one of our senior chartered accountants take a look at your exact AutoCount setup during a quick 10-minute call. Are you guys on AutoCount or something else currently?"
""",
        "quality_score": 97,
        "tier": "Tier A",
        "status": "Ready to Review",
        "notes": "Listed on HKEX (6163). Actively recruiting Accounts Executive on JobStreet for Senai facility. Pang Chong Yong is co-founder and MD - confirmed via gml.com.my corporate page. High-volume manufacturing with complex cross-border billing."
    },
    {
        "lead_id": "OC-JOB-189",
        "company_name": "Finecables (Malaysia) Sdn. Bhd.",
        "company_summary": "Imports and exports industrial cables and electrical wiring products, operating from I-Park SAC industrial zone in Senai with recorded 2025-2026 trade turnover of USD 444k.",
        "bro_summary": "They trade industrial cables and electrical wiring in Senai - small cross-border importer/exporter with active operations.",
        "root_domain": "finecables.my",
        "headquarters": "Senai, Johor",
        "malaysia_facility": "No. 76, Jalan I-Park SAC 6, Taman Perindustrian I-Park SAC, 81400 Senai, Johor",
        "sector": "Electrical Cable Import/Export",
        "estimated_transactions_mo": "10-20 tx/mo",
        "accounting_software": "SQL Account",
        "buyer_name": "General Manager",
        "buyer_title": "Operations Director",
        "contact_email": "info@finecables.my",
        "contact_phone": "+607-599 6090",
        "proof_link": "https://www.ricebowl.my/jobs/finecables-malaysia-sdn-bhd-accounts-admin-executive-senai",
        "sg_my_wedge": "Recruiting Admin cum Accounts Executive in Senai at RM 3,500-4,500/mo on Ricebowl - Outbounder replaces that headcount for RM 600-1,000/mo flat",
        "phone_script": """[IF GATEKEEPER / RECEPTIONIST ANSWERS]
"Hi, may I check who I'm speaking with? ... Hi [Name], Bryan here. Could you put me through to whoever oversees the factory operations or finance?"
(If asked why): "Just a quick note regarding your Senai facility. We partner with finance teams at industrial companies to take the monthly bookkeeping and e-invoicing off their plate."

[WHEN DECISION MAKER PICKS UP]
"Hi, Bryan here. Did I catch you at a bad time?"
(Wait for response)

"Thanks. Saw your facility out at I-Park SAC in Senai - you guys handle cable imports and exports across the region.

Reason I'm calling: a lot of operations directors at trading companies in Johor tell me they only have 10 to 20 invoices a month, but end up paying 3,500 plus EPF and SOCSO for a full-time accounts person. And with people always jumping to Singapore, you're always retraining someone.

What if I told you that instead of that 3,500 headache, our chartered desk takes over your daily bookkeeping, SST filings, and audit prep for 600 to 1,000 a month?

How does that sound?"
(Wait for response)

[THE CLOSE]
"Would you be against a quick 10-minute chat next Tuesday just to see if this makes sense for your setup?"

[NATURAL BAILOUT]
"Look, I run our partner desk so I don't want to guess on technical tax rules. Let me have one of our senior chartered accountants take a look at your exact setup during a quick 10-minute call. Are you guys on SQL Account or AutoCount?"
""",
        "quality_score": 95,
        "tier": "Tier A",
        "status": "Ready to Review",
        "notes": "Active Ricebowl posting for Accounts cum Admin Executive, RM 3,500-4,500, Senai. MarketInside confirms USD 444k import/export turnover 2025-2026. Domain finecables.my confirmed via company website."
    },
    {
        "lead_id": "OC-JOB-190",
        "company_name": "Hawk Filtration (SEA) Sdn. Bhd.",
        "company_summary": "Manufactures and distributes air purifiers and industrial filtration accessories from its Iskandar Puteri plant, serving commercial and household segments across Southeast Asia.",
        "bro_summary": "They make air filters and purifiers in Iskandar Puteri and sell across Southeast Asia - a Chinese-owned manufacturer operating out of Johor.",
        "root_domain": "hawkfilter.com",
        "headquarters": "China",
        "malaysia_facility": "PTD 201588 Block B, Jalan SILC 1, Kawasan Perindustrian SILC, 79200 Bandar Nusajaya, Iskandar Puteri, Johor",
        "sector": "Air Filtration Manufacturing",
        "estimated_transactions_mo": "10-25 tx/mo",
        "accounting_software": "AutoCount",
        "buyer_name": "Zhu Naifeng",
        "buyer_title": "Director",
        "contact_email": "info@hawkfilter.com",
        "contact_phone": "+6018-399 3500",
        "proof_link": "https://www.jobstreet.com.my/en/companies/hawk-filtration-sea-sdn-bhd/jobs",
        "sg_my_wedge": "Actively recruiting Account Assistant on JobStreet in Iskandar Puteri - Chinese-owned MNC subsidiary using Johor as ASEAN base, classic cross-border arbitrage play",
        "phone_script": """[IF GATEKEEPER / RECEPTIONIST ANSWERS]
"Hi, may I check who I'm speaking with? ... Hi [Name], Bryan here. Could you put me through to Mr. Zhu or whoever looks after the finance and operations?"
(If asked why): "Just a quick note regarding your Iskandar Puteri facility. We partner with manufacturing teams to take the monthly bookkeeping and e-invoicing off their plate."

[WHEN DECISION MAKER PICKS UP]
"Hi Naifeng, Bryan here. Did I catch you at a bad time?"
(Wait for response)

"Thanks. Saw your filtration plant out in SILC Iskandar Puteri - you guys supply air purifiers across Southeast Asia from there.

Reason I'm calling: a lot of directors at Chinese-owned subsidiaries in Johor tell me they only have 10 to 25 Malaysian invoices a month, but end up paying 3,500 plus EPF and SOCSO for a full-time accounts person. With staff constantly comparing offers versus Singapore, you're always retraining someone new.

What if I told you that instead of that 3,500 headache, our chartered desk takes over your daily bookkeeping, SST filings, and audit prep for 600 to 1,000 a month, reviewed by senior ACCA accountants?

How does that sound?"
(Wait for response)

[THE CLOSE]
"Would you be against a quick 10-minute chat next Tuesday to see if this makes sense for your Iskandar Puteri setup?"

[NATURAL BAILOUT]
"Look, I run our partner desk so I don't want to guess on technical tax rules. Let me have one of our senior chartered accountants take a look at your exact accounting setup during a quick 10-minute call. What platform are you guys currently on?"
""",
        "quality_score": 95,
        "tier": "Tier A",
        "status": "Ready to Review",
        "notes": "Chinese-owned manufacturer at SILC Iskandar Puteri. Director Zhu Naifeng confirmed via sipermit.id registry. Active JobStreet hiring for accounts assistant. Phone +6018-399 3500 confirmed."
    },
    {
        "lead_id": "OC-JOB-191",
        "company_name": "Fitson Sdn. Bhd.",
        "company_summary": "Designs and manufactures precision industrial components and mechanical parts for the electrical, electronics, and automotive sectors from its dual I-Park SAC plants in Senai, Johor.",
        "bro_summary": "They make precision parts and components for electrical and automotive clients from two factories in Senai - a Johor manufacturer with cross-border supply chain billing.",
        "root_domain": "fitson.com",
        "headquarters": "Senai, Johor",
        "malaysia_facility": "19, Jalan I-Park SAC 3, Taman Perindustrian I-Park SAC, 81400 Senai, Johor",
        "sector": "Precision Industrial Manufacturing",
        "estimated_transactions_mo": "20-40 tx/mo",
        "accounting_software": "SQL Account",
        "buyer_name": "Chan Ching",
        "buyer_title": "Managing Director",
        "contact_email": "chanching@fitson.com",
        "contact_phone": "+607-595 5918",
        "proof_link": "https://www.fitson.com",
        "sg_my_wedge": "Precision parts manufacturer with two Senai I-Park plants - complex cross-border component billing to automotive and electronics OEMs makes Outbounder at RM 600-1,000/mo far cheaper than a full-time hire",
        "phone_script": """[IF GATEKEEPER / RECEPTIONIST ANSWERS]
"Hi, may I check who I'm speaking with? ... Hi [Name], Bryan here. Could you put me through to Mr. Chan Ching or whoever oversees finance and operations?"
(If asked why): "Just a quick note regarding your Senai facility. We partner with manufacturing teams to take the monthly bookkeeping and e-invoicing off their plate so nobody has to work overtime."

[WHEN DECISION MAKER PICKS UP]
"Hi Chan Ching, Bryan here. Did I catch you at a bad time?"
(Wait for response)

"Thanks. Saw your two I-Park SAC plants in Senai - Fitson does precision industrial components for electrical and automotive clients, which means a pretty steady flow of cross-border invoices every month.

Reason I'm calling: a lot of manufacturing MDs running operations in Johor tell me they only have 20 to 40 Malaysian transactions a month, but end up paying 3,500 plus EPF, SOCSO, and software licenses for a full-time accounts person. And with people always eyeing Singapore wages, you're constantly retraining someone.

What if I told you that instead of that 3,500 headache, our chartered desk takes over your daily bookkeeping, SST filings, and audit prep for 600 to 1,000 a month, reviewed by senior ACCA accountants?

How does that sound?"
(Wait for response)

[THE CLOSE]
"Would you be against a quick 10-minute chat next Tuesday just to see if this makes sense for your Senai setup?"

[NATURAL BAILOUT]
"Look, I run our partner desk so I don't want to guess on technical tax rules. Let me have one of our senior chartered accountants take a look at your exact SQL Account setup during a quick 10-minute call."
""",
        "quality_score": 96,
        "tier": "Tier A",
        "status": "Ready to Review",
        "notes": "Two Senai I-Park SAC plants. MD Chan Ching confirmed via fitson.com contact page. Phone +607-595 5918 and email chanching@fitson.com confirmed. Active JobStreet posting for Projects and Products Costing Analyst - signals growing finance headcount needs."
    },
    {
        "lead_id": "OC-JOB-192",
        "company_name": "Guan Chong Cocoa Manufacturer Sdn. Bhd.",
        "company_summary": "Processes raw cocoa beans into cocoa products including cocoa butter, cocoa powder, and cocoa liquor at its Pasir Gudang industrial plant, a subsidiary of Guan Chong Berhad (BURSA: GUAN).",
        "bro_summary": "They grind cocoa beans into cocoa butter and powder at a big factory in Pasir Gudang - one of the largest cocoa processors in Asia.",
        "root_domain": "gcbcocoa.com",
        "headquarters": "Pasir Gudang, Johor",
        "malaysia_facility": "PLO 273, Jalan Timah Dua, Pasir Gudang Industrial Estate, 81700 Pasir Gudang, Johor",
        "sector": "Food Processing - Cocoa Manufacturing",
        "estimated_transactions_mo": "40-80 tx/mo",
        "accounting_software": "SAP/SQL Account",
        "buyer_name": "Finance Director",
        "buyer_title": "Finance Director",
        "contact_email": "info@gcbcocoa.com",
        "contact_phone": "+607-251 1588",
        "proof_link": "https://ricebowl.my/jobs/guan-chong-cocoa-manufacturer-sdn-bhd-accounts-clerk-pasir-gudang",
        "sg_my_wedge": "Active Ricebowl vacancy for Accounts Clerk at RM 2,000-2,800 in Pasir Gudang - Bursa-listed group subsidiary shows governance demands driving outsourcing potential",
        "phone_script": """[IF GATEKEEPER / RECEPTIONIST ANSWERS]
"Hi, may I check who I'm speaking with? ... Hi [Name], Bryan here. Could you put me through to the Finance Director or whoever oversees the finance team?"
(If asked why): "Just a quick note regarding your Pasir Gudang plant. We partner with finance teams at manufacturing companies to handle bookkeeping and e-invoicing compliance."

[WHEN DECISION MAKER PICKS UP]
"Hi, Bryan here. Did I catch you at a bad time?"
(Wait for response)

"Thanks. Saw your plant in Pasir Gudang Industrial Estate - Guan Chong is one of the biggest cocoa processors in Asia, and I know you'd have quite a volume of Malaysian payables and receivables to manage every month.

Reason I'm calling: a lot of MDs at manufacturing subsidiaries tell me they only have 40 to 80 local transactions a month, but the admin overhead of managing a full-time accounts team plus EPF and SOCSO is a real drain. And with LHDN e-invoicing mandates rolling out, the compliance pressure is only going up.

What if I told you our chartered desk handles your daily bookkeeping, SST filings, and audit prep for a flat 600 to 1,000 a month, reviewed by senior ACCA accountants with deep manufacturing experience?

How does that sound?"
(Wait for response)

[THE CLOSE]
"Would you be against a quick 10-minute chat next Tuesday just to see if this makes sense for your Pasir Gudang setup?"

[NATURAL BAILOUT]
"Look, I run our partner desk so I don't want to guess on technical tax rules. Let me have one of our senior chartered accountants take a look at your exact accounting platform during a quick 10-minute call. Are you guys on SAP or SQL Account?"
""",
        "quality_score": 96,
        "tier": "Tier A",
        "status": "Ready to Review",
        "notes": "Bursa-listed parent (GUAN). Active Ricebowl posting RM 2,000-2,800 Accounts Clerk, Pasir Gudang, closing Dec 6 2026. Factory phone +607-251 1588 confirmed via gcbcocoa.com. High-volume cocoa processing operations with complex compliance."
    },
    {
        "lead_id": "OC-JOB-193",
        "company_name": "Furvit Pet Industries Sdn. Bhd.",
        "company_summary": "Manufactures and distributes pet food products and treats under the Pulut's Tail and Cat Candy brands, operating a production facility in Shah Alam, Selangor.",
        "bro_summary": "They make pet food snacks and treats under their own brands in Shah Alam - a growing local manufacturer actively hiring admin staff.",
        "root_domain": "furvitpet.com",
        "headquarters": "Shah Alam, Selangor",
        "malaysia_facility": "Shah Alam, Selangor, Malaysia",
        "sector": "Pet Food Manufacturing",
        "estimated_transactions_mo": "10-25 tx/mo",
        "accounting_software": "AutoCount",
        "buyer_name": "Managing Director",
        "buyer_title": "Managing Director",
        "contact_email": "meow@furvitpet.com",
        "contact_phone": "+6013-737 7383",
        "proof_link": "https://www.jobstreet.com.my/en/companies/furvit-pet-industries/jobs",
        "sg_my_wedge": "Active JobStreet vacancy for Accounts Cum Admin Clerk in Shah Alam, RM 2,000-2,500 - outsourcing to Outbounder saves up to RM 24,000/yr vs full-time hire",
        "phone_script": """[IF GATEKEEPER / RECEPTIONIST ANSWERS]
"Hi, may I check who I'm speaking with? ... Hi [Name], Bryan here. Could you put me through to the MD or owner?"
(If asked why): "Just a quick note for your Shah Alam facility. We partner with manufacturing teams to handle bookkeeping and e-invoicing so they don't have to worry about hiring admin staff."

[WHEN DECISION MAKER PICKS UP]
"Hi, Bryan here. Did I catch you at a bad time?"
(Wait for response)

"Thanks. Saw you guys are behind the Pulut's Tail and Cat Candy brands - solid local pet food brands growing across Malaysia.

Reason I'm calling: a lot of founders at product companies in Shah Alam tell me they only have 10 to 25 invoices a month, but end up paying 2,500 plus EPF and SOCSO for an accounts clerk. And when the hire doesn't work out, you're back to square one.

What if I told you that instead of that 2,500 headache, our chartered desk takes over your daily bookkeeping, SST filings, and audit prep for 600 to 1,000 a month, reviewed by senior ACCA accountants?

How does that sound?"
(Wait for response)

[THE CLOSE]
"Would you be against a quick 10-minute chat next Tuesday just to see if this makes sense for your Shah Alam setup?"

[NATURAL BAILOUT]
"Look, I run our partner desk so I don't want to guess on technical tax rules. Let me have one of our senior chartered accountants take a look at your exact accounting setup during a quick 10-minute call. What platform are you guys currently on?"
""",
        "quality_score": 95,
        "tier": "Tier A",
        "status": "Ready to Review",
        "notes": "Active JobStreet posting for Accounts Cum Admin Clerk, Shah Alam, RM 2,000-2,500 as of late Sept 2026. General inquiry phone +6013-737 7383 and email meow@furvitpet.com confirmed via furvitpet.com."
    },
    {
        "lead_id": "OC-JOB-194",
        "company_name": "Haven Highland Sdn. Bhd.",
        "company_summary": "Operates hospitality and accommodation services in the Seri Setia area of Petaling Jaya, managing guest bookings, room operations, and property rental income.",
        "bro_summary": "They run a hospitality and accommodation business in Petaling Jaya - an SME with regular monthly billing cycles and compliance needs.",
        "root_domain": "havenhighland.com.my",
        "headquarters": "Petaling Jaya, Selangor",
        "malaysia_facility": "No. 206, Level 2, Plaza Seri Setia, No. 1, Jalan SS 9/2, Seri Setia, 47300 Petaling Jaya, Selangor",
        "sector": "Hospitality and Accommodation",
        "estimated_transactions_mo": "15-30 tx/mo",
        "accounting_software": "Xero",
        "buyer_name": "Lim Ee Jiun",
        "buyer_title": "Director",
        "contact_email": "admin@havenhighland.com.my",
        "contact_phone": "+6012-594 7933",
        "proof_link": "https://www.jobstreet.com.my/en/companies/haven-highland-sdn-bhd/jobs",
        "sg_my_wedge": "Active JobStreet vacancy for Accounts Cum Admin Executive in Sungai Way, RM 2,800-4,200 - saves RM 30,000/yr vs mid-band full-time hire",
        "phone_script": """[IF GATEKEEPER / RECEPTIONIST ANSWERS]
"Hi, may I check who I'm speaking with? ... Hi [Name], Bryan here. Could you put me through to Mr. Lim or whoever oversees the finance and operations?"
(If asked why): "Just a quick note for your Petaling Jaya office. We partner with hospitality operators to take the monthly accounts and e-invoicing off their plate."

[WHEN DECISION MAKER PICKS UP]
"Hi Ee Jiun, Bryan here. Did I catch you at a bad time?"
(Wait for response)

"Thanks. Saw you guys run accommodation and hospitality operations in the Seri Setia area.

Reason I'm calling: a lot of property and hospitality owners in PJ tell me they have steady monthly billing cycles but end up paying 3,500 plus EPF and SOCSO for an accounts person. And with LHDN e-invoicing now mandatory, keeping up with compliance is a real drain.

What if I told you our chartered desk handles your bookkeeping, SST filings, and audit prep for 600 to 1,000 a month, reviewed by senior ACCA accountants?

How does that sound?"
(Wait for response)

[THE CLOSE]
"Would you be against a quick 10-minute chat next Tuesday just to see if this makes sense for your setup?"

[NATURAL BAILOUT]
"Look, I run our partner desk so I don't want to guess on technical tax rules. Let me have one of our senior chartered accountants take a look at your Xero or accounting setup during a quick 10-minute call. What platform are you guys on?"
""",
        "quality_score": 95,
        "tier": "Tier A",
        "status": "Ready to Review",
        "notes": "Active JobStreet vacancy for Accounts Cum Admin Executive, Sungai Way, RM 2,800-4,200. Director Lim Ee Jiun confirmed via sipermit.id registry. Phone +6012-594 7933 confirmed. Incorporated 2017."
    },
    {
        "lead_id": "OC-JOB-195",
        "company_name": "Prestige Elite Sdn. Bhd.",
        "company_summary": "Provides estate planning, trust management, and legacy services to high-net-worth individuals through a network of consultants operating from Petaling Jaya.",
        "bro_summary": "They help wealthy families set up wills and trusts in Petaling Jaya - a financial services SME with steady monthly admin and billing.",
        "root_domain": "pesb.asia",
        "headquarters": "Petaling Jaya, Selangor",
        "malaysia_facility": "100-5.025, Block J, 129 Offices, Jaya One, No. 72A, Jalan Universiti, 46200 Petaling Jaya, Selangor",
        "sector": "Financial Advisory and Estate Planning",
        "estimated_transactions_mo": "10-20 tx/mo",
        "accounting_software": "SQL Account",
        "buyer_name": "Managing Director",
        "buyer_title": "Managing Director",
        "contact_email": "info@pesb.asia",
        "contact_phone": "+603-4217 9191",
        "proof_link": "https://www.jobstreet.com.my/en/companies/prestige-elite-sdn-bhd/jobs",
        "sg_my_wedge": "Active JobStreet vacancy for Junior Accounts and Admin Assistant in PJ, RM 3,000-4,000 - Outbounder replaces that hire at RM 600-1,000/mo saving RM 26,000/yr",
        "phone_script": """[IF GATEKEEPER / RECEPTIONIST ANSWERS]
"Hi, may I check who I'm speaking with? ... Hi [Name], Bryan here. Could you put me through to the MD or whoever oversees the operations?"
(If asked why): "Just a quick note for your Jaya One office. We partner with professional services firms to handle bookkeeping and compliance so the team can focus on clients."

[WHEN DECISION MAKER PICKS UP]
"Hi, Bryan here. Did I catch you at a bad time?"
(Wait for response)

"Thanks. Saw you guys do estate planning and trust management out of Jaya One - it's a growing market with a lot of HNW clients looking at succession planning.

Reason I'm calling: a lot of professional services firm owners in PJ tell me they only have 10 to 20 invoices a month, but end up paying 3,000 to 4,000 plus EPF and SOCSO for a junior accounts person. And with LHDN e-invoicing now in play, compliance is getting more complex.

What if I told you our chartered desk handles your bookkeeping, SST filings, and audit prep for 600 to 1,000 a month, reviewed by senior ACCA accountants?

How does that sound?"
(Wait for response)

[THE CLOSE]
"Would you be against a quick 10-minute chat next Tuesday just to see if this makes sense for your Jaya One setup?"

[NATURAL BAILOUT]
"Look, I run our partner desk so I don't want to guess on technical tax rules. Let me have one of our senior chartered accountants take a look at your exact accounting platform during a quick 10-minute call. What software are you guys on?"
""",
        "quality_score": 95,
        "tier": "Tier A",
        "status": "Ready to Review",
        "notes": "Active JobStreet vacancy for Junior Accounts and Admin Assistant, Petaling Jaya, RM 3,000-4,000. Phone +603-4217 9191 and email info@pesb.asia confirmed via pesb.asia. Registered 2023."
    },
    {
        "lead_id": "OC-JOB-196",
        "company_name": "Ledgen Malaysia Sdn. Bhd.",
        "company_summary": "Provides corporate secretarial, shared service accounting, and business process outsourcing solutions to SMEs and MNCs from its Petaling Jaya Damansara Utama office.",
        "bro_summary": "They do outsourced accounting and corporate secretarial work for other companies in PJ - an accounts shared services firm that ironically still hires its own accounts staff.",
        "root_domain": "ledgengroup.com",
        "headquarters": "Petaling Jaya, Selangor",
        "malaysia_facility": "Unit 1203, Level 12, Uptown 1, 1 Jalan SS 21/58, Damansara Utama, 47400 Petaling Jaya, Selangor",
        "sector": "Accounting and Corporate Services",
        "estimated_transactions_mo": "20-40 tx/mo",
        "accounting_software": "Xero",
        "buyer_name": "Mok Heng Wah",
        "buyer_title": "Group CEO",
        "contact_email": "malaysia@ledgengroup.com",
        "contact_phone": "+603-7733 5665",
        "proof_link": "https://www.jobstreet.com.my/en/companies/ledgen-malaysia-sdn-bhd/jobs",
        "sg_my_wedge": "Ironically hiring Accounts Assistants on JobStreet PJ, RM 2,800-3,300 - positioning Outbounder as a white-label chartered desk to supplement their own capacity, not replace them",
        "phone_script": """[IF GATEKEEPER / RECEPTIONIST ANSWERS]
"Hi, may I check who I'm speaking with? ... Hi [Name], Bryan here. Could you put me through to Mr. Mok or the CEO's office?"
(If asked why): "Just a quick note regarding a partnership opportunity relevant to your accounting services group."

[WHEN DECISION MAKER PICKS UP]
"Hi Heng Wah, Bryan here. Did I catch you at a bad time?"
(Wait for response)

"Thanks. I know you guys at Ledgen run a shared service accounting operation out of Damansara Utama - I actually wanted to explore a white-label or referral angle with you.

Reason I'm calling: we run a chartered desk with ACCA-reviewed bookkeeping and e-invoicing compliance for SMEs at RM 600 to 1,000 a month. A lot of service providers like Ledgen actually refer clients who need execution capacity rather than strategic advisory.

Is there a fit here where we could serve some of your overflow or smaller ticket clients who need pure bookkeeping rather than full corporate secretary work?"
(Wait for response)

[THE CLOSE]
"Would you be against a quick 10-minute chat next Tuesday just to see if there's a referral or white-label angle that makes sense?"

[NATURAL BAILOUT]
"Look, I run our partner desk so I don't want to overclaim the fit. Let me have one of our senior chartered accountants walk you through our tech stack - we're fully integrated with Xero and AutoCount. What platforms do most of your clients run?"
""",
        "quality_score": 95,
        "tier": "Tier A",
        "status": "Ready to Review",
        "notes": "Corporate shared services firm actively hiring Accounts Assistants at RM 2,800-3,300 on JobStreet PJ. Group CEO Mok Heng Wah confirmed via sme100.asia. Phone +603-7733 5665 and email malaysia@ledgengroup.com confirmed via ledgengroup.com."
    },
    {
        "lead_id": "OC-JOB-197",
        "company_name": "Primerite Sdn. Bhd.",
        "company_summary": "Supplies industrial marking, coding, and packaging systems including inkjet printers, laser coders, and thermal transfer overprinters to manufacturing clients across Malaysia.",
        "bro_summary": "They sell date-coding and printing machines to factories in Malaysia from their Puchong office - a B2B equipment supplier with regular invoice cycles.",
        "root_domain": "primerite.com",
        "headquarters": "Puchong, Selangor",
        "malaysia_facility": "No. 39, Jalan Rajawali 2, Bandar Puchong Jaya, 47100 Puchong, Selangor",
        "sector": "Industrial Equipment Distribution",
        "estimated_transactions_mo": "15-30 tx/mo",
        "accounting_software": "SQL Account",
        "buyer_name": "CS Wong",
        "buyer_title": "Founder and Director",
        "contact_email": "inquiry@primerite.com",
        "contact_phone": "+603-8075 6768",
        "proof_link": "https://ricebowl.my/jobs/primerite-sdn-bhd-accounts-assistant-puchong",
        "sg_my_wedge": "Active Ricebowl vacancy for Accounts Assistant in Puchong, RM 2,900-3,500 - outsourcing to Outbounder saves RM 26,000/yr vs full-time hire at top of band",
        "phone_script": """[IF GATEKEEPER / RECEPTIONIST ANSWERS]
"Hi, may I check who I'm speaking with? ... Hi [Name], Bryan here. Could you put me through to Mr. Wong or whoever handles the finance and operations?"
(If asked why): "Just a quick note for your Puchong office. We partner with equipment suppliers to take the monthly bookkeeping and e-invoicing off their plate."

[WHEN DECISION MAKER PICKS UP]
"Hi CS, Bryan here. Did I catch you at a bad time?"
(Wait for response)

"Thanks. Saw you guys at Primerite supply coding and marking systems to manufacturers across Malaysia - solid B2B setup out of Puchong.

Reason I'm calling: a lot of equipment distributors tell me they have 15 to 30 invoices a month but end up paying 3,000 to 3,500 plus EPF and SOCSO for a full-time accounts person. And chasing payment terms from manufacturing clients is already a headache without managing payroll too.

What if I told you our chartered desk takes over your daily bookkeeping, SST filings, and audit prep for 600 to 1,000 a month, reviewed by senior ACCA accountants?

How does that sound?"
(Wait for response)

[THE CLOSE]
"Would you be against a quick 10-minute chat next Tuesday just to see if this makes sense for your Puchong operation?"

[NATURAL BAILOUT]
"Look, I run our partner desk so I don't want to guess on technical tax rules. Let me have one of our senior chartered accountants take a look at your SQL Account setup during a quick 10-minute call."
""",
        "quality_score": 95,
        "tier": "Tier A",
        "status": "Ready to Review",
        "notes": "Active Ricebowl posting Accounts Assistant, Puchong, RM 2,900-3,500. Founder CS Wong confirmed via primerite.com About page. Phone +603-8075 6768 and email inquiry@primerite.com confirmed via primerite.com. Founded 1996."
    },
    {
        "lead_id": "OC-JOB-198",
        "company_name": "CT Services (M) Sdn. Bhd.",
        "company_summary": "Provides calibration, testing, and measurement services for industrial instruments and equipment to manufacturing and engineering clients in Puchong, Selangor.",
        "bro_summary": "They calibrate industrial testing instruments for factories in Puchong - a technical services company with a steady billing cycle.",
        "root_domain": "caltek.com.my",
        "headquarters": "Puchong, Selangor",
        "malaysia_facility": "No. 17, Jalan MJ 16, Taman Industri Meranti Jaya, 47120 Puchong, Selangor",
        "sector": "Industrial Calibration and Testing Services",
        "estimated_transactions_mo": "10-20 tx/mo",
        "accounting_software": "SQL Account",
        "buyer_name": "Managing Director",
        "buyer_title": "Managing Director",
        "contact_email": "caltek@caltek.com.my",
        "contact_phone": "+603-8076 6691",
        "proof_link": "https://ricebowl.my/jobs/ct-services-m-sdn-bhd-accounts-clerk-puchong",
        "sg_my_wedge": "Active Ricebowl vacancy for Accounts Clerk in Puchong, up to RM 3,300 - Outbounder replaces full-time headcount at RM 600-1,000/mo saving RM 28,000/yr",
        "phone_script": """[IF GATEKEEPER / RECEPTIONIST ANSWERS]
"Hi, may I check who I'm speaking with? ... Hi [Name], Bryan here. Could you put me through to the MD or whoever oversees the operations?"
(If asked why): "Just a quick note for your Puchong office. We partner with technical services firms to take the monthly bookkeeping and e-invoicing off their plate."

[WHEN DECISION MAKER PICKS UP]
"Hi, Bryan here. Did I catch you at a bad time?"
(Wait for response)

"Thanks. Saw you guys provide calibration services to manufacturing clients out of Meranti Jaya, Puchong.

Reason I'm calling: a lot of technical services company owners tell me they have 10 to 20 invoices a month but end up paying 3,000 to 3,500 plus EPF and SOCSO for a full-time accounts person. And keeping up with LHDN e-invoicing compliance on top of that is becoming a real headache.

What if I told you our chartered desk takes over your daily bookkeeping, SST filings, and audit prep for 600 to 1,000 a month, reviewed by senior ACCA accountants?

How does that sound?"
(Wait for response)

[THE CLOSE]
"Would you be against a quick 10-minute chat next Tuesday just to see if this makes sense for your setup?"

[NATURAL BAILOUT]
"Look, I run our partner desk so I don't want to guess on technical tax rules. Let me have one of our senior chartered accountants take a look at your exact SQL Account setup during a quick 10-minute call."
""",
        "quality_score": 95,
        "tier": "Tier A",
        "status": "Ready to Review",
        "notes": "Active Ricebowl posting Accounts Clerk, Puchong, up to RM 3,300. Phone +603-8076 6691 and email caltek@caltek.com.my confirmed via caltekgroup.com. Domain caltek.com.my is primary company web presence."
    },
    {
        "lead_id": "OC-JOB-199",
        "company_name": "K.N. Lee Knitting Industries Sdn. Bhd.",
        "company_summary": "Operates a vertically integrated knitting and garment manufacturing business in Batu Pahat, Johor, producing knitwear and garments for domestic and export markets.",
        "bro_summary": "They knit and sew garments in Batu Pahat for export - a family-run textile manufacturer with two plants and complex cross-border billing.",
        "root_domain": "knlee.com.my",
        "headquarters": "Batu Pahat, Johor",
        "malaysia_facility": "18, Jalan Kesturi, Taman Bunga Raya, 83010 Tongkang Pecah, Batu Pahat, Johor",
        "sector": "Textile and Garment Manufacturing",
        "estimated_transactions_mo": "20-40 tx/mo",
        "accounting_software": "SQL Account",
        "buyer_name": "Lee Nam Huat",
        "buyer_title": "Managing Director - Knitting Division",
        "contact_email": "knleeknt@knlee.com.my",
        "contact_phone": "+607-415 3368",
        "proof_link": "https://www.knlee.com.my",
        "sg_my_wedge": "Vertically integrated garment exporter in Johor running two factory units - dual-plant operations generate cross-border payables that justify full chartered desk outsourcing",
        "phone_script": """[IF GATEKEEPER / RECEPTIONIST ANSWERS]
"Hi, may I check who I'm speaking with? ... Hi [Name], Bryan here. Could you put me through to Mr. Lee Nam Huat or whoever oversees the knitting operations?"
(If asked why): "Just a quick note for your Batu Pahat plant. We partner with manufacturing teams to handle the monthly bookkeeping and e-invoicing compliance."

[WHEN DECISION MAKER PICKS UP]
"Hi Nam Huat, Bryan here. Did I catch you at a bad time?"
(Wait for response)

"Thanks. I know you guys at K.N. Lee have been in Batu Pahat for decades - two factories running garment and knitting operations is no small feat.

Reason I'm calling: a lot of textile manufacturers in Johor tell me they have 20 to 40 transactions a month but end up paying 3,500 plus EPF and SOCSO for a full-time accounts person at each plant. And with LHDN e-invoicing rolling out, keeping up with compliance across multiple units is getting complex.

What if I told you our chartered desk takes over your daily bookkeeping, SST filings, and audit prep for 600 to 1,000 a month per entity, reviewed by senior ACCA accountants with manufacturing experience?

How does that sound?"
(Wait for response)

[THE CLOSE]
"Would you be against a quick 10-minute chat next Tuesday just to see if this makes sense for your Batu Pahat setup?"

[NATURAL BAILOUT]
"Look, I run our partner desk so I don't want to guess on technical tax rules. Let me have one of our senior chartered accountants take a look at your SQL Account setup during a quick 10-minute call."
""",
        "quality_score": 95,
        "tier": "Tier A",
        "status": "Ready to Review",
        "notes": "Decades-old Johor manufacturer with two plants - knitting and garment. MD Lee Nam Huat confirmed via mkma.org. Phone +607-415 3368 confirmed via knlee.com.my. Email knleeknt@knlee.com.my for knitting division. Export-focused with cross-border billing."
    },
    {
        "lead_id": "OC-JOB-200",
        "company_name": "CR SEA (Malaysia) Sdn. Bhd.",
        "company_summary": "Provides market entry, regulatory compliance, and regional distribution advisory services to international brands entering Southeast Asia markets, operating from Bangsar South, Kuala Lumpur.",
        "bro_summary": "They help foreign brands enter and distribute in Southeast Asia from their KL office - a cross-border advisory firm with regular invoicing cycles.",
        "root_domain": "crsea.com.my",
        "headquarters": "Kuala Lumpur",
        "malaysia_facility": "Suite 25-2, Level 25, Vertical Corporate Tower B, Avenue 10, The Vertical, Bangsar South, 59200 Kuala Lumpur",
        "sector": "Cross-Border Market Entry Advisory",
        "estimated_transactions_mo": "10-20 tx/mo",
        "accounting_software": "Xero",
        "buyer_name": "Managing Director",
        "buyer_title": "Managing Director",
        "contact_email": "information@crsea.com.my",
        "contact_phone": "+603-2715 6495",
        "proof_link": "https://www.jobstreet.com.my/en/companies/cr-sea-malaysia/jobs",
        "sg_my_wedge": "Active JobStreet vacancy for Accounts Executive in KL, RM 3,000-4,500 - cross-border advisory firm with Singapore/AU clients is an ideal fit for Outbounder chartered desk",
        "phone_script": """[IF GATEKEEPER / RECEPTIONIST ANSWERS]
"Hi, may I check who I'm speaking with? ... Hi [Name], Bryan here. Could you put me through to the MD or whoever oversees the operations and finance?"
(If asked why): "Just a quick note for your Bangsar South office. We partner with advisory firms handling cross-border clients to take the bookkeeping and LHDN compliance off their plate."

[WHEN DECISION MAKER PICKS UP]
"Hi, Bryan here. Did I catch you at a bad time?"
(Wait for response)

"Thanks. Saw you guys at CR SEA help international brands enter Southeast Asia - it's exactly the kind of cross-border operation where the accounting complexity tends to creep up fast.

Reason I'm calling: a lot of advisory firms with international clients tell me they only have 10 to 20 Malaysian invoices a month but end up paying 3,500 plus EPF and SOCSO for a full-time accounts person. And with LHDN e-invoicing now mandatory, compliance is only getting more involved.

What if I told you our chartered desk takes over your daily bookkeeping, SST filings, and audit prep for 600 to 1,000 a month, reviewed by senior ACCA accountants with cross-border experience?

How does that sound?"
(Wait for response)

[THE CLOSE]
"Would you be against a quick 10-minute chat next Tuesday to see if this makes sense for your Bangsar South setup?"

[NATURAL BAILOUT]
"Look, I run our partner desk so I don't want to guess on technical tax rules. Let me have one of our senior chartered accountants take a look at your Xero setup during a quick 10-minute call."
""",
        "quality_score": 95,
        "tier": "Tier A",
        "status": "Ready to Review",
        "notes": "Active JobStreet vacancy Accounts Executive, Bangsar South KL, RM 3,000-4,500. Phone +603-2715 6495 and email information@crsea.com.my confirmed via crsea.com.my. Cross-border advisory firm ideal for Outbounder pitch."
    },
    {
        "lead_id": "OC-JOB-201",
        "company_name": "Litrocom Global Trading Sdn. Bhd.",
        "company_summary": "Imports and trades renewable feedstock commodities including used cooking oil, POME, and UCOME at its Pasir Gudang industrial facility for export to European biodiesel markets.",
        "bro_summary": "They buy and sell used cooking oil and bio-waste from Pasir Gudang for European biodiesel factories - a commodity trader with cross-border billing to Europe and Asia.",
        "root_domain": "litrocom.com",
        "headquarters": "Pasir Gudang, Johor",
        "malaysia_facility": "PLO 576, Jalan Keluli 9, Kawasan Perindustrian Pasir Gudang, 81700 Pasir Gudang, Johor",
        "sector": "Renewable Feedstock Trading and Export",
        "estimated_transactions_mo": "15-30 tx/mo",
        "accounting_software": "AutoCount",
        "buyer_name": "General Manager",
        "buyer_title": "General Manager",
        "contact_email": "enquiry@litrocom.com",
        "contact_phone": "+6016-742 3818",
        "proof_link": "https://www.litrocom.com",
        "sg_my_wedge": "Active JobStreet vacancy for Accounts Assistant in Pasir Gudang, RM 2,000-2,800 - commodity trader with European cross-border invoicing is a perfect Outbounder client",
        "phone_script": """[IF GATEKEEPER / RECEPTIONIST ANSWERS]
"Hi, may I check who I'm speaking with? ... Hi [Name], Bryan here. Could you put me through to the GM or whoever oversees the operations and finance?"
(If asked why): "Just a quick note for your Pasir Gudang office. We partner with commodity trading companies to take the monthly bookkeeping and e-invoicing compliance off their plate."

[WHEN DECISION MAKER PICKS UP]
"Hi, Bryan here. Did I catch you at a bad time?"
(Wait for response)

"Thanks. Saw you guys at Litrocom handle renewable feedstock trading out of Pasir Gudang - exporting to European biodiesel markets is a complex billing cycle with both local and cross-border compliance needs.

Reason I'm calling: a lot of commodity traders in Johor tell me they have 15 to 30 invoices a month but end up paying 3,500 plus EPF and SOCSO for a full-time accounts person. And with LHDN e-invoicing now mandatory, the compliance load is growing.

What if I told you our chartered desk takes over your daily bookkeeping, SST filings, and audit prep for 600 to 1,000 a month, reviewed by senior ACCA accountants with cross-border export experience?

How does that sound?"
(Wait for response)

[THE CLOSE]
"Would you be against a quick 10-minute chat next Tuesday just to see if this makes sense for your Pasir Gudang setup?"

[NATURAL BAILOUT]
"Look, I run our partner desk so I don't want to guess on technical tax rules. Let me have one of our senior chartered accountants take a look at your exact AutoCount setup during a quick 10-minute call."
""",
        "quality_score": 96,
        "tier": "Tier A",
        "status": "Ready to Review",
        "notes": "Active JobStreet vacancy Accounts Assistant, Pasir Gudang. Phone +6016-742 3818 and email enquiry@litrocom.com confirmed via litrocom.com. Trades renewable feedstocks for European biodiesel - complex cross-border billing ideal for Outbounder."
    },
    {
        "lead_id": "OC-JOB-202",
        "company_name": "Bina Schedulers Sdn. Bhd.",
        "company_summary": "Provides construction project controls, scheduling, and technical consultancy services to infrastructure and building projects across Malaysia from its Petaling Jaya headquarters.",
        "bro_summary": "They do project scheduling and cost controls for big construction projects in PJ - a technical consultancy billing multiple project clients monthly.",
        "root_domain": "bina-s.com",
        "headquarters": "Petaling Jaya, Selangor",
        "malaysia_facility": "Petaling Jaya, Selangor, Malaysia",
        "sector": "Construction Project Controls and Consultancy",
        "estimated_transactions_mo": "10-20 tx/mo",
        "accounting_software": "SQL Account",
        "buyer_name": "Managing Director",
        "buyer_title": "Managing Director",
        "contact_email": "admin@bina-s.com",
        "contact_phone": "+603-7954 2462",
        "proof_link": "https://www.bina-s.com",
        "sg_my_wedge": "Construction project controls consultancy with multiple active project billings per month - monthly invoice volume and compliance requirements match Outbounder sweet spot at RM 600-1,000/mo",
        "phone_script": """[IF GATEKEEPER / RECEPTIONIST ANSWERS]
"Hi, may I check who I'm speaking with? ... Hi [Name], Bryan here. Could you put me through to the MD or whoever oversees the operations?"
(If asked why): "Just a quick note for your Petaling Jaya office. We partner with consultancy firms to take the monthly bookkeeping and e-invoicing compliance off their plate."

[WHEN DECISION MAKER PICKS UP]
"Hi, Bryan here. Did I catch you at a bad time?"
(Wait for response)

"Thanks. Saw you guys at Bina Schedulers do project controls and scheduling for major construction projects out of PJ - that's a steady pipeline of project-based billing to manage.

Reason I'm calling: a lot of consultancy firm owners tell me they have 10 to 20 project invoices a month but end up paying 3,000 to 3,500 plus EPF and SOCSO for a full-time accounts person. And with LHDN e-invoicing now in play, the compliance overhead is growing.

What if I told you our chartered desk takes over your daily bookkeeping, SST filings, and audit prep for 600 to 1,000 a month, reviewed by senior ACCA accountants?

How does that sound?"
(Wait for response)

[THE CLOSE]
"Would you be against a quick 10-minute chat next Tuesday just to see if this makes sense for your setup?"

[NATURAL BAILOUT]
"Look, I run our partner desk so I don't want to guess on technical tax rules. Let me have one of our senior chartered accountants take a look at your SQL Account setup during a quick 10-minute call."
""",
        "quality_score": 90,
        "tier": "Tier A",
        "status": "Ready to Review",
        "notes": "Construction project controls consultancy in Petaling Jaya. Phone +603-7954 2462 confirmed via master_archive. Domain bina-s.com confirmed. Multiple project billing clients per month - solid fit for Outbounder desk."
    },

    # ---- ARCHETYPE B: OC-SGMY-221 to OC-SGMY-230 ----
    {
        "lead_id": "OC-SGMY-221",
        "company_name": "Yuan Jen Food Sdn. Bhd.",
        "company_summary": "Manufactures and distributes vegetarian and plant-based food products under its own brand from a production facility in Taman Mount Austin, Johor Bahru, selling via e-commerce and retail.",
        "bro_summary": "They make vegetarian food products under their own brand in Johor Bahru and sell on Lazada and Shopee - a growing food SME with online and retail sales.",
        "root_domain": "yuanjenfood.com",
        "headquarters": "Johor Bahru, Johor",
        "malaysia_facility": "3, Jalan Mutiara Emas 5/3, Taman Mount Austin, 81100 Johor Bahru, Johor",
        "sector": "Plant-Based Food Manufacturing",
        "estimated_transactions_mo": "15-30 tx/mo",
        "accounting_software": "AutoCount",
        "buyer_name": "Sean Cheng",
        "buyer_title": "Director",
        "contact_email": "yuanjenfoodsb.bizdev@gmail.com",
        "contact_phone": "+607-356 2985",
        "proof_link": "https://www.yuanjenfood.com",
        "sg_my_wedge": "Plant-based food manufacturer in Johor Bahru with online and retail cross-channel billing - e-commerce transaction volume plus SST compliance makes Outbounder at RM 600-1,000/mo far cheaper than a full-time hire",
        "phone_script": """[IF GATEKEEPER / RECEPTIONIST ANSWERS]
"Hi, may I check who I'm speaking with? ... Hi [Name], Bryan here. Could you put me through to Mr. Sean or whoever oversees the operations?"
(If asked why): "Just a quick note regarding your Johor Bahru factory. We partner with food manufacturers to take the monthly bookkeeping and e-invoicing off their plate."

[WHEN DECISION MAKER PICKS UP]
"Hi Sean, Bryan here. Did I catch you at a bad time?"
(Wait for response)

"Thanks. Saw you guys at Yuan Jen make plant-based food products out of Mount Austin - selling on Lazada and Shopee with your own brand is impressive for a JB manufacturer.

Reason I'm calling: a lot of food brand founders in Johor tell me they have 15 to 30 invoices a month between retail and e-commerce channels, but end up paying 3,500 plus EPF and SOCSO for a full-time accounts person. And with SST on food products and LHDN e-invoicing rolling out, compliance is only getting more complex.

What if I told you our chartered desk takes over your daily bookkeeping, SST filings, and audit prep for 600 to 1,000 a month, reviewed by senior ACCA accountants with food manufacturing experience?

How does that sound?"
(Wait for response)

[THE CLOSE]
"Would you be against a quick 10-minute chat next Tuesday just to see if this makes sense for your Mount Austin setup?"

[NATURAL BAILOUT]
"Look, I run our partner desk so I don't want to guess on technical tax rules. Let me have one of our senior chartered accountants take a look at your AutoCount setup during a quick 10-minute call."
""",
        "quality_score": 91,
        "tier": "Tier A",
        "status": "Ready to Review",
        "notes": "Plant-based food manufacturer in Taman Mount Austin JB. Director Sean Cheng confirmed via bnimalaysia.com. Phone +607-356 2985 confirmed via yuanjenfood.com. Sells on Lazada and Shopee - multi-channel billing with SST complexity."
    },
    {
        "lead_id": "OC-SGMY-222",
        "company_name": "FFS Foods (M) Sdn. Bhd.",
        "company_summary": "Manufactures and distributes frozen food products and culinary ingredients for the food service and retail sectors from its Taman Perindustrian Wawasan plant in Batu Pahat, Johor.",
        "bro_summary": "They make frozen food and ingredients for restaurants and retailers in Batu Pahat - a mid-sized Johor food manufacturer supplying the F&B trade.",
        "root_domain": "ffs.com.my",
        "headquarters": "Batu Pahat, Johor",
        "malaysia_facility": "No. 8 and 10, Jalan Budi 17, Taman Perindustrian Wawasan, 83000 Batu Pahat, Johor",
        "sector": "Frozen Food Manufacturing",
        "estimated_transactions_mo": "20-40 tx/mo",
        "accounting_software": "AutoCount",
        "buyer_name": "Managing Director",
        "buyer_title": "Managing Director",
        "contact_email": "info@ffs.com.my",
        "contact_phone": "+607-428 6677",
        "proof_link": "https://ffs.com.my",
        "sg_my_wedge": "Mid-sized frozen food manufacturer in Batu Pahat with food service and retail distribution - B2B invoice volume and SST compliance are natural Outbounder fits at RM 600-1,000/mo",
        "phone_script": """[IF GATEKEEPER / RECEPTIONIST ANSWERS]
"Hi, may I check who I'm speaking with? ... Hi [Name], Bryan here. Could you put me through to the MD or whoever oversees the operations and finance?"
(If asked why): "Just a quick note for your Batu Pahat plant. We partner with food manufacturers to handle the monthly bookkeeping and e-invoicing compliance."

[WHEN DECISION MAKER PICKS UP]
"Hi, Bryan here. Did I catch you at a bad time?"
(Wait for response)

"Thanks. Saw you guys at FFS Foods supply frozen food and culinary ingredients to the F&B trade out of Batu Pahat - that's a solid network of food service clients to manage.

Reason I'm calling: a lot of food manufacturers in Johor tell me they have 20 to 40 invoices a month but end up paying 3,500 plus EPF and SOCSO for a full-time accounts person. And with SST on food products and LHDN e-invoicing rolling out, the compliance load is growing.

What if I told you our chartered desk takes over your daily bookkeeping, SST filings, and audit prep for 600 to 1,000 a month, reviewed by senior ACCA accountants?

How does that sound?"
(Wait for response)

[THE CLOSE]
"Would you be against a quick 10-minute chat next Tuesday just to see if this makes sense for your Batu Pahat setup?"

[NATURAL BAILOUT]
"Look, I run our partner desk so I don't want to guess on technical tax rules. Let me have one of our senior chartered accountants take a look at your AutoCount or SQL Account setup during a quick 10-minute call."
""",
        "quality_score": 91,
        "tier": "Tier A",
        "status": "Ready to Review",
        "notes": "Frozen food and ingredients manufacturer in Batu Pahat Johor. Phone +607-428 6677 and email info@ffs.com.my confirmed via ffs.com.my. Supplies food service and retail trade - B2B invoice volume fits Outbounder."
    },
    {
        "lead_id": "OC-SGMY-223",
        "company_name": "Gourmet Ingredients Sdn. Bhd.",
        "company_summary": "Manufactures and retails Japanese-inspired seasoning sauces, condiments, and packaged food products under the Aji-Ya brand from its Kota Kemuning Shah Alam facility.",
        "bro_summary": "They make Japanese-style sauces and condiments under the Aji-Ya brand in Shah Alam - a packaged food brand with retail and export distribution.",
        "root_domain": "aji-ya.com",
        "headquarters": "Shah Alam, Selangor",
        "malaysia_facility": "Kota Kemuning, Shah Alam, Selangor, Malaysia",
        "sector": "Packaged Food Manufacturing",
        "estimated_transactions_mo": "15-30 tx/mo",
        "accounting_software": "AutoCount",
        "buyer_name": "Managing Director",
        "buyer_title": "Managing Director",
        "contact_email": "info@aji-ya.com",
        "contact_phone": "+603-5892 2333",
        "proof_link": "https://www.aji-ya.com",
        "sg_my_wedge": "Own-brand food manufacturer in Shah Alam selling to retail and food service - SST compliance complexity and multi-channel billing make Outbounder at RM 600-1,000/mo a clear savings versus a full-time hire",
        "phone_script": """[IF GATEKEEPER / RECEPTIONIST ANSWERS]
"Hi, may I check who I'm speaking with? ... Hi [Name], Bryan here. Could you put me through to the MD or owner?"
(If asked why): "Just a quick note for your Shah Alam facility. We partner with food brands to take the monthly bookkeeping and SST compliance off their plate."

[WHEN DECISION MAKER PICKS UP]
"Hi, Bryan here. Did I catch you at a bad time?"
(Wait for response)

"Thanks. Saw the Aji-Ya brand in Shah Alam - Japanese-inspired sauces and condiments with retail distribution is a great brand positioning locally.

Reason I'm calling: a lot of packaged food brand founders tell me they have 15 to 30 invoices a month between retail and distributors, but end up paying 3,500 plus EPF and SOCSO for a full-time accounts person. And with SST on food products and LHDN e-invoicing rolling out, compliance is only getting more involved.

What if I told you our chartered desk takes over your daily bookkeeping, SST filings, and audit prep for 600 to 1,000 a month, reviewed by senior ACCA accountants with food sector experience?

How does that sound?"
(Wait for response)

[THE CLOSE]
"Would you be against a quick 10-minute chat next Tuesday just to see if this makes sense for your Shah Alam setup?"

[NATURAL BAILOUT]
"Look, I run our partner desk so I don't want to guess on technical tax rules. Let me have one of our senior chartered accountants take a look at your AutoCount setup during a quick 10-minute call."
""",
        "quality_score": 91,
        "tier": "Tier A",
        "status": "Ready to Review",
        "notes": "Aji-Ya brand food manufacturer in Kota Kemuning Shah Alam. Phone +603-5892 2333 confirmed via master_archive. Domain aji-ya.com confirmed. Own-brand retail and food service distribution - SST compliance is key pain point."
    },
    {
        "lead_id": "OC-SGMY-224",
        "company_name": "TSL Bestmas Manufacturing Sdn. Bhd.",
        "company_summary": "Manufactures frozen dim sum, dumplings, and Asian appetisers under the TSL Bestmas brand from its Kepong Kuala Lumpur facility, distributing to retail chains and F&B operators.",
        "bro_summary": "They make frozen dim sum and dumplings in Kepong KL and supply supermarkets and restaurant chains - a growing frozen food brand with multi-client billing.",
        "root_domain": "tslbestmas.com",
        "headquarters": "Kepong, Kuala Lumpur",
        "malaysia_facility": "Kepong, Kuala Lumpur, Malaysia",
        "sector": "Frozen Dim Sum Manufacturing",
        "estimated_transactions_mo": "20-40 tx/mo",
        "accounting_software": "AutoCount",
        "buyer_name": "Managing Director",
        "buyer_title": "Managing Director",
        "contact_email": "admin@tslbestmas.com",
        "contact_phone": "+603-6262 3079",
        "proof_link": "https://www.tslbestmas.com",
        "sg_my_wedge": "Frozen dim sum manufacturer supplying retail chains and F&B operators - high invoice volume per month with SST and LHDN e-invoicing compliance are classic Outbounder use case at RM 600-1,000/mo",
        "phone_script": """[IF GATEKEEPER / RECEPTIONIST ANSWERS]
"Hi, may I check who I'm speaking with? ... Hi [Name], Bryan here. Could you put me through to the MD or whoever oversees operations and finance?"
(If asked why): "Just a quick note for your Kepong facility. We partner with food manufacturers to take the monthly bookkeeping and SST compliance off their plate."

[WHEN DECISION MAKER PICKS UP]
"Hi, Bryan here. Did I catch you at a bad time?"
(Wait for response)

"Thanks. Saw the TSL Bestmas brand - frozen dim sum and dumplings supplied to supermarket chains is a solid B2B distribution model out of Kepong.

Reason I'm calling: a lot of food manufacturers in KL tell me they have 20 to 40 invoices a month between retail chains and restaurant clients, but end up paying 3,500 plus EPF and SOCSO for a full-time accounts person. And with LHDN e-invoicing now mandatory, keeping up is a real overhead.

What if I told you our chartered desk takes over your daily bookkeeping, SST filings, and audit prep for 600 to 1,000 a month, reviewed by senior ACCA accountants with food sector experience?

How does that sound?"
(Wait for response)

[THE CLOSE]
"Would you be against a quick 10-minute chat next Tuesday just to see if this makes sense for your Kepong setup?"

[NATURAL BAILOUT]
"Look, I run our partner desk so I don't want to guess on technical tax rules. Let me have one of our senior chartered accountants take a look at your AutoCount setup during a quick 10-minute call."
""",
        "quality_score": 91,
        "tier": "Tier A",
        "status": "Ready to Review",
        "notes": "Frozen dim sum and dumpling manufacturer in Kepong KL. Phone +603-6262 3079 confirmed via master_archive. Domain tslbestmas.com confirmed. Supplies retail chains and F&B operators - multi-client B2B billing with SST complexity."
    },
    {
        "lead_id": "OC-SGMY-225",
        "company_name": "Vista Packaging Industries (M) Sdn. Bhd.",
        "company_summary": "Manufactures and wholesales flexible packaging materials, including plastic bags and films, for the food, retail, and industrial sectors from its Klang Selangor plant.",
        "bro_summary": "They make plastic packaging bags and films for food and retail companies from their Klang factory - a packaging manufacturer supplying multiple industries.",
        "root_domain": "vistapackaging.com.my",
        "headquarters": "Klang, Selangor",
        "malaysia_facility": "Bandar Botanic, Klang, Selangor, Malaysia",
        "sector": "Flexible Packaging Manufacturing",
        "estimated_transactions_mo": "20-40 tx/mo",
        "accounting_software": "SQL Account",
        "buyer_name": "Managing Director",
        "buyer_title": "Managing Director",
        "contact_email": "info@vistapackaging.com.my",
        "contact_phone": "+603-3319 1208",
        "proof_link": "https://www.vistapackaging.com.my",
        "sg_my_wedge": "Packaging materials manufacturer in Klang supplying food, retail, and industrial clients - multi-sector B2B billing with SST compliance makes Outbounder at RM 600-1,000/mo far cheaper than a full-time hire",
        "phone_script": """[IF GATEKEEPER / RECEPTIONIST ANSWERS]
"Hi, may I check who I'm speaking with? ... Hi [Name], Bryan here. Could you put me through to the MD or whoever oversees the operations?"
(If asked why): "Just a quick note for your Klang plant. We partner with manufacturers to take the monthly bookkeeping and e-invoicing compliance off their plate."

[WHEN DECISION MAKER PICKS UP]
"Hi, Bryan here. Did I catch you at a bad time?"
(Wait for response)

"Thanks. Saw you guys at Vista Packaging supply flexible packaging to food and retail clients out of Bandar Botanic, Klang.

Reason I'm calling: a lot of packaging manufacturers tell me they have 20 to 40 invoices a month across multiple industries, but end up paying 3,500 plus EPF and SOCSO for a full-time accounts person. And with LHDN e-invoicing now mandatory, the compliance overhead is growing.

What if I told you our chartered desk takes over your daily bookkeeping, SST filings, and audit prep for 600 to 1,000 a month, reviewed by senior ACCA accountants?

How does that sound?"
(Wait for response)

[THE CLOSE]
"Would you be against a quick 10-minute chat next Tuesday just to see if this makes sense for your Klang setup?"

[NATURAL BAILOUT]
"Look, I run our partner desk so I don't want to guess on technical tax rules. Let me have one of our senior chartered accountants take a look at your SQL Account setup during a quick 10-minute call."
""",
        "quality_score": 91,
        "tier": "Tier A",
        "status": "Ready to Review",
        "notes": "Flexible packaging manufacturer in Bandar Botanic Klang. Phone +603-3319 1208 confirmed via master_archive. Domain vistapackaging.com.my confirmed. Multi-sector packaging supply to food, retail, and industrial clients."
    },
    {
        "lead_id": "OC-SGMY-226",
        "company_name": "PUSBAS Masala and Spices Sdn. Bhd.",
        "company_summary": "Manufactures and distributes halal-certified spice blends, curry powders, and masala mixes for food service and retail distribution from its Klang, Selangor production facility.",
        "bro_summary": "They make halal spice blends and curry powders in Klang and supply supermarkets and food service businesses - a growing spice brand with retail and B2B clients.",
        "root_domain": "pusbasspices.com.my",
        "headquarters": "Klang, Selangor",
        "malaysia_facility": "Klang, Selangor, Malaysia",
        "sector": "Spice and Seasoning Manufacturing",
        "estimated_transactions_mo": "15-30 tx/mo",
        "accounting_software": "AutoCount",
        "buyer_name": "Managing Director",
        "buyer_title": "Managing Director",
        "contact_email": "info@pusbasspices.com.my",
        "contact_phone": "+603-3885 3545",
        "proof_link": "https://www.pusbasspices.com.my",
        "sg_my_wedge": "Halal spice manufacturer in Klang with retail and food service B2B billing - SST compliance on food products plus LHDN e-invoicing makes Outbounder at RM 600-1,000/mo a clear win",
        "phone_script": """[IF GATEKEEPER / RECEPTIONIST ANSWERS]
"Hi, may I check who I'm speaking with? ... Hi [Name], Bryan here. Could you put me through to the MD or owner?"
(If asked why): "Just a quick note for your Klang facility. We partner with food manufacturers to take the monthly bookkeeping and SST compliance off their plate."

[WHEN DECISION MAKER PICKS UP]
"Hi, Bryan here. Did I catch you at a bad time?"
(Wait for response)

"Thanks. Saw you guys at PUSBAS manufacture halal spice blends and curry powders in Klang - distributing to supermarkets and food service is a solid distribution model.

Reason I'm calling: a lot of halal food brand founders tell me they have 15 to 30 invoices a month between retail and food service clients, but end up paying 3,500 plus EPF and SOCSO for a full-time accounts person. With SST on food products and LHDN e-invoicing now in play, compliance is getting more involved.

What if I told you our chartered desk takes over your daily bookkeeping, SST filings, and audit prep for 600 to 1,000 a month, reviewed by senior ACCA accountants with food sector experience?

How does that sound?"
(Wait for response)

[THE CLOSE]
"Would you be against a quick 10-minute chat next Tuesday just to see if this makes sense for your Klang setup?"

[NATURAL BAILOUT]
"Look, I run our partner desk so I don't want to guess on technical tax rules. Let me have one of our senior chartered accountants take a look at your AutoCount setup during a quick 10-minute call."
""",
        "quality_score": 90,
        "tier": "Tier A",
        "status": "Ready to Review",
        "notes": "Halal spice and masala manufacturer in Klang Selangor. Phone +603-3885 3545 confirmed via master_archive. Domain pusbasspices.com.my confirmed. Retail and food service distribution - SST compliance on halal food products is key Outbounder pitch."
    },
    {
        "lead_id": "OC-SGMY-227",
        "company_name": "A and J Hakko (Malaysia) Sdn. Bhd.",
        "company_summary": "Imports and distributes premium Japanese food products including specialty snacks, confectionery, and beverages to Malaysian retail and food service clients from its Kuala Lumpur distribution hub.",
        "bro_summary": "They import and sell premium Japanese food snacks and drinks to Malaysian supermarkets and restaurants from KL - a specialty food importer with high-value product billing.",
        "root_domain": "aj-hakko.com.my",
        "headquarters": "Kuala Lumpur",
        "malaysia_facility": "Kuala Lumpur, Federal Territory, Malaysia",
        "sector": "Specialty Food Import and Distribution",
        "estimated_transactions_mo": "15-25 tx/mo",
        "accounting_software": "SQL Account",
        "buyer_name": "Managing Director",
        "buyer_title": "Managing Director",
        "contact_email": "info@aj-hakko.com.my",
        "contact_phone": "+603-2704 6275",
        "proof_link": "https://www.aj-hakko.com.my",
        "sg_my_wedge": "Japanese food import and distribution to Malaysian retail and F&B - cross-border import compliance, customs clearance invoicing, and SST are perfect Outbounder use case at RM 600-1,000/mo",
        "phone_script": """[IF GATEKEEPER / RECEPTIONIST ANSWERS]
"Hi, may I check who I'm speaking with? ... Hi [Name], Bryan here. Could you put me through to the MD or whoever oversees the operations?"
(If asked why): "Just a quick note for your KL office. We partner with food importers to take the monthly bookkeeping and import compliance off their plate."

[WHEN DECISION MAKER PICKS UP]
"Hi, Bryan here. Did I catch you at a bad time?"
(Wait for response)

"Thanks. Saw you guys at Hakko import premium Japanese food products into Malaysia for retail and F&B - that's a steady flow of import billing, customs, and retail receivables to manage every month.

Reason I'm calling: a lot of specialty food importers in KL tell me they have 15 to 25 invoices a month, but end up paying 3,500 plus EPF and SOCSO for a full-time accounts person. And with import duties, customs clearance, and LHDN e-invoicing all in the mix, the compliance load is non-trivial.

What if I told you our chartered desk takes over your daily bookkeeping, SST filings, and audit prep for 600 to 1,000 a month, reviewed by senior ACCA accountants with import experience?

How does that sound?"
(Wait for response)

[THE CLOSE]
"Would you be against a quick 10-minute chat next Tuesday just to see if this makes sense for your KL setup?"

[NATURAL BAILOUT]
"Look, I run our partner desk so I don't want to guess on technical tax rules. Let me have one of our senior chartered accountants take a look at your SQL Account or AutoCount setup during a quick 10-minute call."
""",
        "quality_score": 91,
        "tier": "Tier A",
        "status": "Ready to Review",
        "notes": "Japanese specialty food importer and distributor in Kuala Lumpur. Phone +603-2704 6275 confirmed via master_archive. Domain aj-hakko.com.my confirmed. Cross-border import billing and SST compliance are key Outbounder value propositions."
    },
    {
        "lead_id": "OC-SGMY-228",
        "company_name": "Attivo Healthcare Sdn. Bhd.",
        "company_summary": "Manufactures and distributes health supplements, nutraceuticals, and consumer healthcare products under proprietary brands from its Petaling Jaya Selangor office and distribution network.",
        "bro_summary": "They make and sell health supplements and nutraceuticals from their PJ office - a healthcare brand with retail and online distribution channels.",
        "root_domain": "attivo.my",
        "headquarters": "Petaling Jaya, Selangor",
        "malaysia_facility": "Petaling Jaya, Selangor, Malaysia",
        "sector": "Health Supplements and Consumer Healthcare",
        "estimated_transactions_mo": "15-30 tx/mo",
        "accounting_software": "Xero",
        "buyer_name": "Managing Director",
        "buyer_title": "Managing Director",
        "contact_email": "info@attivo.my",
        "contact_phone": "+603-7629 7752",
        "proof_link": "https://www.attivo.my",
        "sg_my_wedge": "Health supplement brand in PJ with online and retail distribution - multi-channel billing and SST on healthcare products create the exact compliance complexity Outbounder resolves at RM 600-1,000/mo",
        "phone_script": """[IF GATEKEEPER / RECEPTIONIST ANSWERS]
"Hi, may I check who I'm speaking with? ... Hi [Name], Bryan here. Could you put me through to the MD or founder?"
(If asked why): "Just a quick note for your Petaling Jaya office. We partner with health brands to take the monthly bookkeeping and compliance off their plate."

[WHEN DECISION MAKER PICKS UP]
"Hi, Bryan here. Did I catch you at a bad time?"
(Wait for response)

"Thanks. Saw you guys at Attivo do health supplements and consumer healthcare products out of PJ - building your own brand in nutraceuticals is a growing market.

Reason I'm calling: a lot of health brand founders tell me they have 15 to 30 invoices a month between retail and online channels, but end up paying 3,500 plus EPF and SOCSO for a full-time accounts person. With SST on healthcare products and LHDN e-invoicing now mandatory, the compliance load adds up fast.

What if I told you our chartered desk takes over your daily bookkeeping, SST filings, and audit prep for 600 to 1,000 a month, reviewed by senior ACCA accountants?

How does that sound?"
(Wait for response)

[THE CLOSE]
"Would you be against a quick 10-minute chat next Tuesday just to see if this makes sense for your PJ setup?"

[NATURAL BAILOUT]
"Look, I run our partner desk so I don't want to guess on technical tax rules. Let me have one of our senior chartered accountants take a look at your Xero setup during a quick 10-minute call."
""",
        "quality_score": 91,
        "tier": "Tier A",
        "status": "Ready to Review",
        "notes": "Health supplements and consumer healthcare brand in Petaling Jaya. Phone +603-7629 7752 confirmed via master_archive. Domain attivo.my confirmed. Multi-channel retail and online billing with SST on healthcare products."
    },
    {
        "lead_id": "OC-SGMY-229",
        "company_name": "Asia IOT Solutions Sdn. Bhd.",
        "company_summary": "Provides industrial IoT hardware, automation systems, and remote monitoring solutions to manufacturing and logistics clients across Malaysia from its Petaling Jaya Selangor office.",
        "bro_summary": "They sell IoT devices and automation systems to factories and logistics companies from PJ - a tech-enabled B2B equipment company with project-based billing.",
        "root_domain": "asiaiot.com.my",
        "headquarters": "Petaling Jaya, Selangor",
        "malaysia_facility": "Petaling Jaya, Selangor, Malaysia",
        "sector": "Industrial IoT and Automation",
        "estimated_transactions_mo": "10-20 tx/mo",
        "accounting_software": "SQL Account",
        "buyer_name": "Managing Director",
        "buyer_title": "Managing Director",
        "contact_email": "info@asiaiot.com.my",
        "contact_phone": "+603-7621 7685",
        "proof_link": "https://www.asiaiot.com.my",
        "sg_my_wedge": "Industrial IoT solutions provider in PJ with project-based billing to manufacturing clients - milestone invoice complexity and LHDN e-invoicing compliance are perfect Outbounder value proposition at RM 600-1,000/mo",
        "phone_script": """[IF GATEKEEPER / RECEPTIONIST ANSWERS]
"Hi, may I check who I'm speaking with? ... Hi [Name], Bryan here. Could you put me through to the MD or founder?"
(If asked why): "Just a quick note for your Petaling Jaya office. We partner with tech companies to take the monthly bookkeeping and LHDN compliance off their plate."

[WHEN DECISION MAKER PICKS UP]
"Hi, Bryan here. Did I catch you at a bad time?"
(Wait for response)

"Thanks. Saw you guys at Asia IOT provide industrial automation and remote monitoring to factories from PJ - that's a growing market as manufacturers push for Industry 4.0.

Reason I'm calling: a lot of tech solution providers tell me they have 10 to 20 project invoices a month with milestone billing, but end up paying 3,500 plus EPF and SOCSO for a full-time accounts person. And with LHDN e-invoicing now mandatory, project-based billing compliance is getting more complex.

What if I told you our chartered desk takes over your daily bookkeeping, SST filings, and audit prep for 600 to 1,000 a month, reviewed by senior ACCA accountants?

How does that sound?"
(Wait for response)

[THE CLOSE]
"Would you be against a quick 10-minute chat next Tuesday just to see if this makes sense for your PJ setup?"

[NATURAL BAILOUT]
"Look, I run our partner desk so I don't want to guess on technical tax rules. Let me have one of our senior chartered accountants take a look at your SQL Account setup during a quick 10-minute call."
""",
        "quality_score": 90,
        "tier": "Tier A",
        "status": "Ready to Review",
        "notes": "Industrial IoT and automation solutions provider in Petaling Jaya. Phone +603-7621 7685 confirmed via master_archive. Domain asiaiot.com.my confirmed. Project-based billing to manufacturing and logistics clients - milestone invoice complexity fits Outbounder."
    },
    {
        "lead_id": "OC-SGMY-230",
        "company_name": "BEC Marketing Sdn. Bhd.",
        "company_summary": "Manufactures and distributes fruit cordial syrups and beverage concentrates under the Green Hill brand from its Balakong Selangor production facility to food service and retail markets.",
        "bro_summary": "They make fruit cordial drinks and syrups under the Green Hill brand in Balakong and supply it to restaurants and supermarkets - a local beverage brand with trade distribution.",
        "root_domain": "greenhillfruit.com",
        "headquarters": "Balakong, Selangor",
        "malaysia_facility": "Balakong, Selangor, Malaysia",
        "sector": "Beverage and Cordial Manufacturing",
        "estimated_transactions_mo": "15-30 tx/mo",
        "accounting_software": "AutoCount",
        "buyer_name": "Managing Director",
        "buyer_title": "Managing Director",
        "contact_email": "info@greenhillfruit.com",
        "contact_phone": "+603-8964 4286",
        "proof_link": "https://www.greenhillfruit.com",
        "sg_my_wedge": "Fruit cordial manufacturer in Balakong supplying food service and retail - SST on beverage products and multi-client B2B billing make Outbounder at RM 600-1,000/mo a natural fit",
        "phone_script": """[IF GATEKEEPER / RECEPTIONIST ANSWERS]
"Hi, may I check who I'm speaking with? ... Hi [Name], Bryan here. Could you put me through to the MD or owner?"
(If asked why): "Just a quick note for your Balakong facility. We partner with food and beverage manufacturers to take the monthly bookkeeping and SST compliance off their plate."

[WHEN DECISION MAKER PICKS UP]
"Hi, Bryan here. Did I catch you at a bad time?"
(Wait for response)

"Thanks. Saw the Green Hill brand - fruit cordial syrups and beverage concentrates distributed to restaurants and supermarkets in Balakong is a solid B2B operation.

Reason I'm calling: a lot of beverage brand founders tell me they have 15 to 30 invoices a month between food service and retail accounts, but end up paying 3,500 plus EPF and SOCSO for a full-time accounts person. With SST on beverage products and LHDN e-invoicing now mandatory, the compliance overhead adds up.

What if I told you our chartered desk takes over your daily bookkeeping, SST filings, and audit prep for 600 to 1,000 a month, reviewed by senior ACCA accountants with food and beverage experience?

How does that sound?"
(Wait for response)

[THE CLOSE]
"Would you be against a quick 10-minute chat next Tuesday just to see if this makes sense for your Balakong setup?"

[NATURAL BAILOUT]
"Look, I run our partner desk so I don't want to guess on technical tax rules. Let me have one of our senior chartered accountants take a look at your AutoCount setup during a quick 10-minute call."
""",
        "quality_score": 90,
        "tier": "Tier A",
        "status": "Ready to Review",
        "notes": "Green Hill brand fruit cordial and beverage manufacturer in Balakong Selangor. Phone +603-8964 4286 confirmed via master_archive. Domain greenhillfruit.com confirmed. Supplies food service and retail - SST on beverages is key compliance angle."
    },
]

# Pre-insert assertion: no em dashes
for lead in BATCH_LEADS:
    for k, v in lead.items():
        if isinstance(v, str):
            assert '\u2014' not in v, f"Em dash found in {lead['lead_id']} field {k}"

print(f"Em dash check passed. {len(BATCH_LEADS)} leads ready.")

# Connect and insert
conn = sqlite3.connect('leads.db')
c = conn.cursor()

# Build dedup sets
c.execute("SELECT root_domain FROM prospects")
existing_domains = set(row[0] for row in c.fetchall() if row[0])
c.execute("SELECT contact_phone FROM prospects")
existing_phones = set(row[0] for row in c.fetchall() if row[0])

# Validate all leads before inserting any
conflicts = []
for lead in BATCH_LEADS:
    if lead['root_domain'] in existing_domains:
        conflicts.append(f"DOMAIN DUP: {lead['lead_id']} - {lead['root_domain']}")
    if lead['contact_phone'] in existing_phones:
        conflicts.append(f"PHONE DUP: {lead['lead_id']} - {lead['contact_phone']}")

if conflicts:
    print("CONFLICTS DETECTED - ABORTING:")
    for c_item in conflicts:
        print(" ", c_item)
    conn.close()
    exit(1)

print("Dedup validation passed. Inserting 25 leads...")

insert_sql = """
INSERT INTO prospects (
    lead_id, company_name, company_summary, bro_summary, root_domain,
    headquarters, malaysia_facility, sector, estimated_transactions_mo,
    accounting_software, buyer_name, buyer_title, contact_email,
    contact_phone, proof_link, sg_my_wedge, phone_script,
    quality_score, tier, status, notes
) VALUES (
    :lead_id, :company_name, :company_summary, :bro_summary, :root_domain,
    :headquarters, :malaysia_facility, :sector, :estimated_transactions_mo,
    :accounting_software, :buyer_name, :buyer_title, :contact_email,
    :contact_phone, :proof_link, :sg_my_wedge, :phone_script,
    :quality_score, :tier, :status, :notes
)
"""

inserted = 0
for lead in BATCH_LEADS:
    c.execute(insert_sql, lead)
    inserted += 1

conn.commit()
print(f"Inserted {inserted} leads. Verifying count...")

c.execute("SELECT COUNT(*) FROM prospects")
total = c.fetchone()[0]
c.execute("SELECT MAX(lead_id) FROM prospects WHERE lead_id LIKE 'OC-JOB-%'")
max_job = c.fetchone()[0]
c.execute("SELECT MAX(lead_id) FROM prospects WHERE lead_id LIKE 'OC-SGMY-%'")
max_sgmy = c.fetchone()[0]

conn.close()

print(f"Total in DB: {total}")
print(f"Max JOB: {max_job}")
print(f"Max SGMY: {max_sgmy}")
assert inserted == 25, f"Expected 25 inserts, got {inserted}"
assert total == 432, f"Expected 432 total, got {total}"
print("Insert verification passed!")

# Sync to Excel
import subprocess
result = subprocess.run(['py', 'sync_leads_to_master.py'], capture_output=True, text=True, timeout=30)
print(result.stdout)
if result.returncode != 0:
    print("SYNC ERROR:", result.stderr)
else:
    print("Excel sync complete.")
