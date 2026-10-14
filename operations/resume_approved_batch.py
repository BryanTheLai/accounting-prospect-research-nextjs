"""Resume only the unsent messages in the operator-approved revised YC batch."""
import json
import sqlite3
import sys
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from spintax_engine import render_email_template

BASE = "http://127.0.0.1:3000/api/dispatch"
ARTIFACTS = ROOT / "operations/yc-source-reviewed-20261008"


def control(body=None):
    request = Request(BASE if body else BASE + "?summary=1",
                      json.dumps(body).encode() if body else None,
                      {"Content-Type": "application/json"} if body else {})
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def main():
    snapshot = control()["snapshot"]
    if snapshot["is_running"]:
        print(json.dumps({"already_running": True, "snapshot": snapshot}))
        return
    manifest = json.loads((ARTIFACTS / "revised-pending-batch.json").read_text(encoding="utf-8"))
    path = ROOT / "operations/recovered-leads-20261008/leads.sqlite"
    connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    pending = []
    templates = {row["template_id"]: dict(row) for row in connection.execute(
        "SELECT template_id,name,subject,body FROM outbound_templates WHERE template_id IN (88,89)"
    )}
    for message in manifest:
        attempted = connection.execute(
            "SELECT 1 FROM campaign_sends WHERE (lead_id=? OR lower(trim(recipient_email))=?) "
            "AND coalesce(response_msg,'') NOT LIKE '%[DRY-RUN%' LIMIT 1",
            (message["lead_id"], message["email"].lower()),
        ).fetchone()
        suppressed = connection.execute("SELECT 1 FROM email_suppression WHERE lower(trim(email))=?",
                                        (message["email"].lower(),)).fetchone()
        if attempted or suppressed:
            continue
        lead = dict(connection.execute("SELECT * FROM prospects WHERE lead_id=?",
                                       (message["lead_id"],)).fetchone())
        template = templates[message["template_id"]]
        if lead["contact_email"].lower() != message["email"].lower():
            raise RuntimeError("Approved recipient changed; resume refused")
        if render_email_template(template["subject"], lead) != message["subject"] or \
                render_email_template(template["body"], lead) != message["body"]:
            raise RuntimeError("Approved copy changed; resume refused")
        pending.append(message["lead_id"])
    connection.close()
    if not pending:
        print(json.dumps({"remaining": 0}))
        return
    control({"action": "live", "enabled": True, "confirmed": True})
    result = control({"action": "start", "leadIds": pending, "campaignId": "yc_us_expansion",
                      "templateAName": templates[88]["name"], "templateBName": templates[89]["name"],
                      "liveConfirmed": True})
    if result["acceptedLeadCount"] != len(pending):
        control({"action": "stop"})
        raise RuntimeError("Eligibility changed; partial start stopped for review")
    control({"action": "override_schedule", "confirmed": True, "liveConfirmed": True})
    print(json.dumps({"accepted": result["acceptedLeadCount"], "snapshot": control()["snapshot"]}))


if __name__ == "__main__":
    main()
