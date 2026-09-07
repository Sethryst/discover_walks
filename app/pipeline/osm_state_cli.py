"""Command line interface for the state-at-a-time OSM data factory."""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path
from typing import Any

from app.pipeline.osm_feedback import build_prompt
from app.pipeline.osm_state import (
    STATES, BuildError, build_state, cleanup_state_inputs, preflight_report, regenerate_manifest, resolve_state,
    state_plan, validate_pmtiles, validate_release,
)
from app.pipeline.osm_supabase import SupabaseConfig, publish_release


def _emit(payload: Any) -> None:
    print(json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False))


def _common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--release", default=f"osm-us-{date.today().isoformat()}")
    parser.add_argument("--root", type=Path, default=Path(".gremlin-osm"))


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="Build immutable state OSM PMTiles without retaining a national PBF.")
    commands = root.add_subparsers(dest="command", required=True)
    preflight = commands.add_parser("preflight")
    _common(preflight)
    plan = commands.add_parser("plan-state")
    plan.add_argument("state")
    plan.add_argument("--with-poi", action="store_true")
    plan.add_argument("--offline", action="store_true", help="Do not download the small Census boundary archive.")
    _common(plan)
    for name in ("build-state", "build-poi-state"):
        build = commands.add_parser(name)
        build.add_argument("state")
        build.add_argument("--source-url")
        build.add_argument("--source-sha256")
        build.add_argument("--publish-dir", type=Path)
        build.add_argument("--public-base-url")
        build.add_argument("--keep-source", action="store_true")
        build.add_argument("--no-upload", action="store_true", help="Explicit local-only mode (also the default without --publish-dir).")
        build.add_argument("--dry-run", action="store_true")
        _common(build)
    builds = commands.add_parser("build-states")
    builds.add_argument("states", nargs="*")
    builds.add_argument("--missing", action="store_true")
    builds.add_argument("--dry-run", action="store_true")
    builds.add_argument("--keep-source", action="store_true")
    _common(builds)
    validate = commands.add_parser("validate-state")
    validate.add_argument("state")
    validate.add_argument("--product", choices=("roadway", "poi"), default="roadway")
    _common(validate)
    validate_all = commands.add_parser("validate-release")
    _common(validate_all)
    manifest = commands.add_parser("generate-manifest")
    _common(manifest)
    publish = commands.add_parser("publish-release")
    publish.add_argument("states", nargs="*")
    _common(publish)
    cleanup = commands.add_parser("cleanup-state")
    cleanup.add_argument("state")
    _common(cleanup)
    feedback = commands.add_parser("generate-feedback-prompt")
    feedback.add_argument("feedback", type=Path)
    feedback.add_argument("--selectors", default="strict-v1")
    feedback.add_argument("--metrics", default="not measured")
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        if args.command == "preflight":
            report = preflight_report(); _emit(report); return 0 if report["ready"] else 2
        if args.command == "plan-state":
            _emit(state_plan(args.state, args.release, args.root, with_poi=args.with_poi, allow_boundary_download=not args.offline)); return 0
        if args.command in {"build-state", "build-poi-state"}:
            if args.no_upload and args.publish_dir:
                raise ValueError("--no-upload and --publish-dir are mutually exclusive")
            if args.dry_run:
                _emit(state_plan(args.state, args.release, args.root, with_poi=args.command == "build-poi-state")); return 0
            _emit(build_state(args.state, args.release, args.root, product="poi" if args.command == "build-poi-state" else "roadway", source_url=args.source_url, source_sha256=args.source_sha256, publish_dir=args.publish_dir, public_base_url=args.public_base_url, keep_source=args.keep_source)); return 0
        if args.command == "build-states":
            requested = [resolve_state(value).code for value in args.states]
            if args.missing:
                manifest = regenerate_manifest(args.root, args.release)
                available = {key for key, value in manifest["states"].items() if value.get("roadway", {}).get("available")}
                requested = [state.code for state in STATES.values() if state.source_url and state.id not in available]
            if not requested:
                raise ValueError("Provide states or use --missing")
            results = []
            for code in requested:
                results.append(state_plan(code, args.release, args.root) if args.dry_run else build_state(code, args.release, args.root, keep_source=args.keep_source))
            _emit({"results": results}); return 0
        if args.command == "validate-state":
            state = resolve_state(args.state)
            artifact = args.root / "releases" / args.release / state.id / f"{args.product}.pmtiles"
            result = validate_pmtiles(artifact); _emit(result); return 0 if result["valid"] else 1
        if args.command == "validate-release":
            result = validate_release(args.root, args.release); _emit(result); return 0 if result["valid"] else 1
        if args.command == "generate-manifest":
            _emit(regenerate_manifest(args.root, args.release)); return 0
        if args.command == "publish-release":
            requested = split_state_values(args.states)
            _emit(publish_release(args.root, args.release, SupabaseConfig.from_environment(), state_codes=requested or None)); return 0
        if args.command == "cleanup-state":
            _emit(cleanup_state_inputs(args.state, args.root, args.release)); return 0
        if args.command == "generate-feedback-prompt":
            events = json.loads(args.feedback.read_text(encoding="utf-8"))
            release = events[0].get("release", "unknown") if events else "unknown"
            prompt = build_prompt(events, release=str(release), selectors=args.selectors, metrics=args.metrics)
            _emit({"status": "corroborated" if prompt else "review", "prompt": prompt}); return 0
    except (BuildError, OSError, ValueError) as exc:
        _emit({"status": "failed", "error": str(exc)})
        return 2
    return 2


def split_state_values(values: list[str]) -> list[str]:
    """Normalize both comma-delimited and already-tokenized state arguments."""
    return [part.strip() for value in values for part in value.split(",") if part.strip()]


if __name__ == "__main__":
    raise SystemExit(main())
