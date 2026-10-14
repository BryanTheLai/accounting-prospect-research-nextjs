"""Copy the authored Streamlit call aids without rewriting or shortening them."""

import ast
import json
import re
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
SOURCES = {
    "yc": WEB.parent.parent / "accounting-prospect-research" / "app.py",
    "malaysia": WEB.parent / "app.py",
}


def extract(source):
    tree = ast.parse(source.read_text(encoding="utf-8-sig"))
    guide = None
    summary = None
    for node in ast.walk(tree):
        if isinstance(node, ast.With):
            for item in node.items:
                call = item.context_expr
                if not isinstance(call, ast.Call) or not call.args:
                    continue
                label = call.args[0]
                if isinstance(label, ast.Constant) and "Instant Objection Handlers" in str(label.value):
                    for child in ast.walk(node):
                        if isinstance(child, ast.Call) and isinstance(child.func, ast.Attribute) and child.func.attr == "markdown":
                            guide = ast.literal_eval(child.args[0])
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "wa_summary_text" for target in node.targets):
            parts = []
            for value in node.value.values:
                if isinstance(value, ast.Constant):
                    parts.append(value.value)
                    continue
                expression = ast.unparse(value.value)
                placeholders = {"lead_fname": "firstName", "cur_lead['company_name']": "company", "cur_lead['accounting_software']": "software"}
                if expression not in placeholders:
                    raise ValueError(f"Unknown Streamlit interpolation: {expression}")
                parts.append("{" + placeholders[expression] + "}")
            summary = "".join(parts)
    if not guide or not summary:
        raise ValueError(f"Call content missing from {source}")
    chunks = re.split(r'\* \*\*"(.+?)":\*\*', guide)[1:]
    objections = []
    for question, response in zip(chunks[::2], chunks[1::2]):
        paragraphs = []
        for line in response.splitlines():
            line = line.strip()
            if line.startswith(">"):
                paragraphs.append(line[1:].strip().strip('*"'))
        objections.append({"objection": question, "response": "\n".join(paragraphs)})
    if len(objections) != 6:
        raise ValueError(f"Expected all six objection handlers from {source}")
    return {"objections": objections, "summaryTemplate": summary}


content = {key: extract(source) for key, source in SOURCES.items()}
output = WEB / "lib" / "streamlit-call-content.json"
serialized = json.dumps(content, ensure_ascii=False, indent=2) + "\n"
if "--check" in sys.argv:
    if output.read_text(encoding="utf-8") != serialized:
        raise SystemExit("Streamlit call content differs. Run this script to sync it.")
    print("Full Streamlit call content matches both source apps.")
else:
    output.write_text(serialized, encoding="utf-8")
    print("Copied both full Streamlit call playbooks (6 objections and follow-up each).")
