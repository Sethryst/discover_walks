"""Run the municipal scraper using only authoritative-region discovery terms."""
from __future__ import annotations

import sys
from scraper import main

if __name__ == "__main__":
    raise SystemExit(main(["--boundary-only", "--max-per-city", "4", "--max-features", "100000", *sys.argv[1:]]))
