"""Refresh only the exact sources listed in OpenData/datasets.csv.

This command never performs portal catalog discovery. A healthy existing file is
kept when a refresh fails or its feature count regresses beyond the configured
threshold.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Sequence
from urllib.parse import urlparse

try:
    from .scraper import (
        DEFAULT_DATASETS, DEFAULT_OUTPUT, ArcGISAdapter, Candidate, CrawlError,
        HttpClient, Portal, Recorder, Result, SocrataAdapter, configure_logging,
        load_datasets, utc_now,
    )
except ImportError:  # direct execution: python OpenData/updater.py
    from scraper import (
        DEFAULT_DATASETS, DEFAULT_OUTPUT, ArcGISAdapter, Candidate, CrawlError,
        HttpClient, Portal, Recorder, Result, SocrataAdapter, configure_logging,
        load_datasets, utc_now,
    )


def destination(root: Path, relative_file: str) -> Path:
    path = (root / Path(relative_file)).resolve()
    if path == root or root not in path.parents:
        raise CrawlError("unsafe_path", f"registry file escapes output root: {relative_file!r}")
    return path


def current_feature_count(path: Path) -> int | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    features = data.get("features") if isinstance(data, dict) else None
    return len(features) if isinstance(features, list) else None


def replace_geojson_atomically(path: Path, data: dict[str, Any]) -> None:
    """Replace one curated file only after its complete candidate is on disk."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=".gremlin_update_", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass


def result_row(record, stage: str, status: str, **kwargs: Any) -> Result:
    return Result(
        timestamp=utc_now(), state=record.state, city=record.city,
        platform=record.platform, stage=stage, status=status,
        dataset_id=record.dataset_id, dataset_name=record.dataset_name,
        source_url=record.source_url, file=record.file, **kwargs,
    )


def refresh_record(record, args, http, logger: logging.Logger) -> tuple[Result, bool]:
    if not record.source_url:
        return result_row(
            record, "update", "skipped", reason="source_url_unknown",
            detail="local file is protected from rediscovery but cannot be refreshed directly",
        ), False

    output_root = args.output.resolve()
    path = destination(output_root, record.file)
    candidate = Candidate(
        record.platform, record.dataset_id, record.dataset_name,
        record.notes, record.source_url, direct=True,
    )
    try:
        if record.platform.casefold() == "socrata":
            adapter = SocrataAdapter(http, logger)
            parsed = urlparse(record.source_url)
            portal = Portal(record.state, record.city, f"{parsed.scheme}://{parsed.netloc}", "Socrata")
            adapter.validate(portal, candidate)
            if args.dry_run:
                return result_row(record, "validation", "success", detail="direct source metadata valid"), False
            refreshed = adapter.download(portal, candidate, args.max_features, args.page_size)
        elif record.platform.casefold() == "arcgis":
            adapter = ArcGISAdapter(http, logger)
            layers = adapter.layers(candidate)
            if len(layers) != 1:
                raise CrawlError("ambiguous_layer", f"direct registry URL resolved to {len(layers)} layers")
            layer_id, layer_name, metadata = layers[0]
            adapter.validate_layer(candidate, layer_id, layer_name, metadata, 1)
            if args.dry_run:
                count = adapter.selected_count(
                    candidate, layer_id, record.query_where, record.bbox
                )
                return result_row(
                    record, "validation", "success", feature_count=count,
                    detail="direct layer metadata and selector valid",
                ), False
            refreshed = adapter.download_layer(
                candidate, layer_id, args.max_features, args.page_size,
                record.query_where, record.bbox,
            )
        else:
            raise CrawlError("unsupported_platform", record.platform)

        previous_count = current_feature_count(path)
        baseline = previous_count or record.last_observed_feature_count
        observed = int(refreshed["feature_count"])
        if baseline and observed / baseline < args.min_previous_ratio:
            ratio = observed / baseline
            return result_row(
                record, "update", "degraded", feature_count=observed,
                expected_count=baseline, coverage_ratio=round(ratio, 6),
                coverage_status="degraded", reason="regression_guard",
                detail=f"kept previous file: {observed} is {ratio:.1%} of previous {baseline}",
                **refreshed["spatial"],
            ), False

        replace_geojson_atomically(path, refreshed["geojson"])
        detail = "atomic refresh complete"
        if refreshed["quality"]["coverage_status"] != "complete":
            detail += "; usable partial data retained and coverage recorded"
        return result_row(
            record, "update", "success", feature_count=observed,
            detail=detail, **refreshed["spatial"], **refreshed["quality"],
        ), True
    except CrawlError as exc:
        return result_row(
            record, "update", "failed", reason=exc.reason,
            http_status=exc.status or "", detail=exc.detail,
        ), False
    except Exception as exc:
        logger.exception("Unexpected updater failure for %s", record.dataset_id)
        return result_row(
            record, "update", "failed", reason="unexpected_error",
            detail=f"{type(exc).__name__}: {exc}",
        ), False


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--datasets", type=Path, default=DEFAULT_DATASETS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--state")
    parser.add_argument("--city")
    parser.add_argument("--dataset-id")
    parser.add_argument("--max-features", type=int, default=1_000_000)
    parser.add_argument("--page-size", type=int, default=2_000)
    parser.add_argument("--request-delay", type=float, default=0.35)
    parser.add_argument("--dataset-delay", type=float, default=0.5)
    parser.add_argument("--timeout", type=float, default=40.0)
    parser.add_argument("--min-previous-ratio", type=float, default=0.8)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    args.datasets = args.datasets.resolve()
    args.output = args.output.resolve()
    if not (0 < args.min_previous_ratio <= 1):
        raise SystemExit("--min-previous-ratio must be greater than 0 and no more than 1")
    records = load_datasets(args.datasets)
    records = [record for record in records if record.status.casefold() == "curated"]
    if args.state:
        records = [record for record in records if record.state.casefold() == args.state.casefold()]
    if args.city:
        records = [record for record in records if record.city.casefold() == args.city.casefold()]
    if args.dataset_id:
        records = [record for record in records if record.dataset_id.casefold() == args.dataset_id.casefold()]

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    log_dir = args.output / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    logger = configure_logging(log_dir / f"updater_{stamp}.log", args.verbose)
    recorder = Recorder(log_dir / f"update_results_{stamp}.csv")
    http = HttpClient(args.request_delay, args.timeout, logger)
    updated = 0
    logger.info("Refreshing %d curated dataset(s); dry_run=%s", len(records), args.dry_run)
    try:
        for index, record in enumerate(records):
            row, changed = refresh_record(record, args, http, logger)
            recorder.add(row)
            updated += int(changed)
            logger.info("%s, %s: %s [%s]", record.city, record.state, record.dataset_name, row.status)
            if index + 1 < len(records) and args.dataset_delay > 0:
                time.sleep(args.dataset_delay)
    except KeyboardInterrupt:
        logger.warning("Interrupted; writing partial source-health diagnostics")
    finally:
        recorder.write()
    logger.info("Finished: %d file(s) refreshed", updated)
    logger.info("Source-health CSV: %s", recorder.path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
