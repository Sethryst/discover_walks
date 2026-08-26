"""Generate the complete human-readable crawler portal registry."""

from __future__ import annotations

import argparse
import csv
import re
from collections import Counter
from pathlib import Path
from typing import Sequence
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
DEFAULT_PORTALS = ROOT / "portals.csv"
DEFAULT_DATASETS = ROOT / "datasets.csv"
DEFAULT_OUTPUT = ROOT.parent / "docs" / "open-data-portal-registry.md"
DIRECT_SERVICE = re.compile(r"/(?:FeatureServer|MapServer)(?:/\d+)?/?$", re.I)


def _read(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def _escape(value: object) -> str:
    return str(value or "").replace("|", "\\|").replace("\n", " ").strip()


def _mode(row: dict[str, str]) -> str:
    if DIRECT_SERVICE.search(row.get("Portal_URL") or ""):
        return "direct layer"
    if (row.get("Status") or "").casefold() == "manual only":
        return "reference"
    return "catalog"


def _link(url: str) -> str:
    parsed = urlparse(url)
    label = f"{parsed.netloc}{parsed.path}".rstrip("/") or url
    return f"[{_escape(label)}]({url})"


def build_markdown(
    portals_path: Path = DEFAULT_PORTALS,
    datasets_path: Path = DEFAULT_DATASETS,
) -> str:
    """Render every crawler registry row and its current acquisition coverage."""
    portals = _read(portals_path)
    datasets = _read(datasets_path)
    curated = Counter(
        ((row.get("State") or "").casefold(), (row.get("City") or "").casefold())
        for row in datasets
        if (row.get("Status") or "").casefold() == "curated"
    )
    portals.sort(key=lambda row: (
        row.get("State") or "", row.get("City") or "",
        {"catalog": 0, "reference": 1, "direct layer": 2}[_mode(row)],
        row.get("Portal_URL") or "",
    ))
    modes = Counter(_mode(row) for row in portals)
    active = sum((row.get("Status") or "").casefold() == "working" for row in portals)
    checked = max((row.get("Last_Checked") or "" for row in portals), default="")
    lines = [
        "# Open-data crawler portal registry",
        "",
        f"Generated from `OpenData/portals.csv`; last registry check: **{checked or 'not recorded'}**.",
        "This is the master discovery list. Catalog rows are places to search for new datasets; "
        "direct-layer rows are repeatable allowlisted acquisitions; reference rows document official "
        "entry points or providers handled by another adapter.",
        "",
        f"- {len(portals)} total entries across {len({((row.get('State') or ''), (row.get('City') or '')) for row in portals})} places",
        f"- {active} active crawler inputs: {modes['catalog']} catalogs and {modes['direct layer']} direct ArcGIS layers",
        f"- {modes['reference']} discovery references retained but skipped by the municipal scraper",
        f"- {sum(curated.values())} curated dataset records in `OpenData/datasets.csv`",
        "",
        "`BBox_WGS84` order is `south|west|north|east`. SQL and bounding-box selectors are "
        "validated against the live ArcGIS count endpoint during `--dry-run`.",
        "",
        "| # | State | Place | Platform | Mode | Status | Portal or endpoint | Selector | Curated datasets | Last checked | Notes |",
        "|---:|---|---|---|---|---|---|---|---:|---|---|",
    ]
    for index, row in enumerate(portals, start=1):
        query = (row.get("Query_Where") or "").strip()
        bbox = (row.get("BBox_WGS84") or "").strip()
        selector = "; ".join(part for part in (
            f"where: `{_escape(query)}`" if query and query != "1=1" else "",
            f"bbox: `{_escape(bbox)}`" if bbox else "",
        ) if part) or "—"
        key = ((row.get("State") or "").casefold(), (row.get("City") or "").casefold())
        lines.append(
            "| " + " | ".join((
                str(index), _escape(row.get("State")), _escape(row.get("City")),
                _escape(row.get("Platform")), _mode(row), _escape(row.get("Status")),
                _link(row.get("Portal_URL") or ""), selector, str(curated[key]),
                _escape(row.get("Last_Checked")) or "—", _escape(row.get("Notes")) or "—",
            )) + " |"
        )
    return "\n".join(lines) + "\n"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--portals", type=Path, default=DEFAULT_PORTALS)
    parser.add_argument("--datasets", type=Path, default=DEFAULT_DATASETS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    content = build_markdown(args.portals, args.datasets)
    if args.check:
        if not args.output.exists() or args.output.read_text(encoding="utf-8") != content:
            raise SystemExit(f"{args.output} is stale; run OpenData/portal_registry.py")
        print(f"verified {args.output}")
        return 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(content, encoding="utf-8")
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
