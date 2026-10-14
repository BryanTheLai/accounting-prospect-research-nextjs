"""
Compiles OUTBOUNDER_1_PAGE_OVERVIEW.html into a crisp, vector A4 PDF using Microsoft Edge.
"""
import subprocess
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
HTML_PATH = BASE_DIR / "OUTBOUNDER_1_PAGE_OVERVIEW.html"
PDF_PATH = BASE_DIR / "OUTBOUNDER_1_PAGE_OVERVIEW.pdf"

EDGE_PATHS = [
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
]

def build_pdf():
    edge_bin = None
    for p in EDGE_PATHS:
        if p.exists():
            edge_bin = p
            break
            
    if not edge_bin:
        raise FileNotFoundError("Microsoft Edge executable not found on Windows system.")
        
    cmd = [
        str(edge_bin),
        "--headless",
        "--disable-gpu",
        f"--print-to-pdf={PDF_PATH}",
        "--no-pdf-header-footer",
        HTML_PATH.as_uri()
    ]
    
    print(f"Compiling {HTML_PATH.name} -> {PDF_PATH.name} via Edge...")
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode == 0 and PDF_PATH.exists() and PDF_PATH.stat().st_size > 0:
        print(f"SUCCESS: Generated {PDF_PATH.name} ({PDF_PATH.stat().st_size} bytes)")
        return PDF_PATH
    else:
        raise RuntimeError(f"Failed to generate PDF. Exit code {res.returncode}: {res.stderr}")

if __name__ == "__main__":
    build_pdf()
