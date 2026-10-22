import sqlite3, sys

db = sqlite3.connect(sys.argv[1])
db.row_factory = sqlite3.Row

for tid in (2, 3, 4, 84018, 89087):
    r = db.execute("SELECT template_id, name, subject, body FROM outbound_templates WHERE template_id=?", (tid,)).fetchone()
    if not r:
        continue
    print("=" * 78)
    print(f"[{r['template_id']}] {r['name']}")
    print(f"  subject: {r['subject']}")
    body = r["body"] or ""
    print(f"  body ({len(body)} chars):")
    for line in body.split("\n")[:16]:
        print("    | " + line[:96])
    print()

db.close()