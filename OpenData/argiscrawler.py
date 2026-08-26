"""Backward-compatible ArcGIS entry point; prefer ``scraper.py``."""

from __future__ import annotations

import sys

from scraper import main


if __name__ == "__main__":
    raise SystemExit(main(["--platform", "ArcGIS", *sys.argv[1:]]))
