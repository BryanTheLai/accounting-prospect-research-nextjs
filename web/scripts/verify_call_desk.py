"""Read-only checks for the deployed call data and mobile stylesheet assets."""

import json
import os
import re
import sqlite3
from pathlib import Path
from urllib.request import urlopen

BASE = "http://127.0.0.1:3002"
WEB = Path(__file__).resolve().parents[1]
DB = Path(os.environ.get("OUTBOUNDER_DB_PATH", WEB.parent.parent / "accounting-prospect-research" / "leads.db")).resolve()


def read(path):
    with urlopen(BASE + path, timeout=10) as response:
        assert response.status == 200
        return response.read().decode("utf-8")


html = read("/")
css_paths = re.findall(r'href="([^"]+\.css[^\"]*)"', html)
css = "\n".join(read(path.replace("&amp;", "&")) for path in css_paths)
assert ".call-primary-actions" in css
assert "safe-area-inset-bottom" in css
assert ".live-call-script" in css
assert ".call-script-choice" in css
print("Home: HTTP 200; deployed mobile call styles present.")

with sqlite3.connect(DB.as_uri() + "?mode=ro", uri=True) as conn:
    for campaign in ("yc_us_expansion", "jobstreet_hiring_pain"):
        row = conn.execute("SELECT lead_id, phone_script FROM prospects WHERE campaign_id = ? AND phone_script IS NOT NULL ORDER BY LENGTH(phone_script) DESC LIMIT 1", (campaign,)).fetchone()
        assert row is not None
        data = json.loads(read("/api/prospects?id=" + row[0]))
        assert data["phoneScript"] == row[1]
        print(f"{campaign}: complete saved script returned unchanged ({len(row[1])} characters).")

queue = json.loads(read("/api/call-queue?category=callable&campaignId=yc_us_expansion&limit=1&offset=0"))
print(f"Call queue: HTTP 200; {queue['total']} callable contacts in YC scope.")
original = json.loads(read("/api/call-queue?category=callable&scriptStyle=original&limit=100&offset=0"))
assert original["rows"]
for lead in original["rows"]:
    script = json.loads(read("/api/prospects?id=" + lead["id"]))["phoneScript"]
    assert "is this a bad time to talk" in script.lower() or "did i catch you at a bad time" in script.lower()
print(f"Original queue: {original['total']} contacts; first {len(original['rows'])} all have the requested opener.")
hydroball = json.loads(read("/api/prospects?id=OC-SGMY-001"))["phoneScript"]
assert "Is this a bad time to talk, or do you have 60 seconds?" in hydroball
assert '[IF RECEPTIONIST / GATEKEEPER ANSWERS]' in hydroball and '[IF NOT INTERESTED / BUSY]' in hydroball
print(f"Hydroball original: exact opener and complete {len(hydroball)}-character script present.")
snapshot = json.loads(read("/api/dispatch?summary=1"))["snapshot"]
assert not snapshot["live_dispatch"] and not snapshot["is_running"]
print("Dispatcher: idle; live email delivery off.")
