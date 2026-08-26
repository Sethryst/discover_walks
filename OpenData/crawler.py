"""Backward-compatible unified scraper entry point.

New code can invoke ``scraper.py`` directly. This wrapper preserves the old
``python crawler.py`` command while running both Socrata and ArcGIS portals.
"""

from __future__ import annotations

import sys

from scraper import main


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
