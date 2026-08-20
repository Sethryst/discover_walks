"""Rank discovered civic sources without approving or executing them."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


CATEGORIES = ("events", "meetings", "volunteer", "parks", "libraries", "recreation", "culturalActivities", "publicSpaces")
STRUCTURED_TYPES = {"JSON API", "CKAN", "ArcGIS", "Socrata", "RSS/ICS", "GeoJSON"}
AUTHORITY_SCORE = {"government": 5, "public_institution": 4, "official_partner": 3, "editorial": 2, "unknown": 1}
VALUE_SCORE = {"high": 5, "medium": 3, "low": 1}


class ScoutEngine:
    """Combine existing release coverage and reviewed discovery evidence into a queue."""

    def __init__(self, workspace: Path):
        self.workspace = workspace

    def run(self, region_id: str, discovery: dict[str, Any], generated_at: str | None = None) -> dict[str, Any]:
        timestamp = generated_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        region_path = self.workspace / "app" / "regions" / f"{region_id}.json"
        if not region_path.exists():
            raise ValueError(f"Unknown region: {region_id}")
        region = json.loads(region_path.read_text(encoding="utf-8"))
        if discovery.get("regionId") != region_id:
            raise ValueError("Discovery region does not match requested region")
        coverage = self._coverage(region_id, region)
        candidates = [self._evaluate(item, set(coverage["missingCategories"])) for item in discovery.get("candidates", [])]
        class_order = {"READY": 0, "INVESTIGATE": 1, "REJECT": 2}
        candidates.sort(key=lambda item: (class_order[item["classification"]], -item["scores"]["impactEffortRatio"], item["publisher"], item["id"]))
        for rank, item in enumerate(candidates, 1):
            item["rank"] = rank
        origins = Counter(item["discovery"]["origin"] for item in candidates)
        methods = Counter(item["discovery"]["method"] for item in candidates)
        return {
            "schemaVersion": 1,
            "kind": "civic-expansion-queue",
            "generatedAt": timestamp,
            "readOnly": True,
            "region": coverage,
            "discoverySummary": {
                "candidateCount": len(candidates),
                "automatedDiscoveryCount": origins.get("automated", 0),
                "humanProvidedLeadCount": origins.get("human", 0),
                "methods": dict(sorted(methods.items())),
                "scope": "Structured source discovery and supplied leads; not a general internet crawl.",
            },
            "queue": candidates,
            "captainDecision": {"required": True, "allowedActions": ["APPROVE_FOR_PROVIDER_RESEARCH", "REQUEST_MORE_EVIDENCE", "REJECT"]},
        }

    def _coverage(self, region_id: str, region: dict[str, Any]) -> dict[str, Any]:
        raw_sources = list(region.get("sources", []))
        if profile := region.get("profile"):
            profile_path = self.workspace / "app" / "regions" / "profiles" / f"{profile}.json"
            raw_sources += json.loads(profile_path.read_text(encoding="utf-8")).get("sources", [])
        domains = Counter(domain for source in raw_sources if source.get("status", "active") == "active" for domain in source.get("domains", []))
        provider_registry = json.loads((self.workspace / "app" / "regions" / "civic-providers.json").read_text(encoding="utf-8")).get("providers", {})
        civic_counts = {}
        civic_dir = self.workspace / "releases" / region_id / "civic"
        for artifact in ("events", "meetings", "volunteer"):
            path = civic_dir / f"{artifact}.json"
            civic_counts[artifact] = len(json.loads(path.read_text(encoding="utf-8")).get("items", [])) if path.exists() else 0
        poi_counts = Counter()
        pois_path = self.workspace / "releases" / region_id / "pois.json"
        if pois_path.exists():
            poi_counts.update(item.get("category") for item in json.loads(pois_path.read_text(encoding="utf-8")).get("pois", []))
        states = {
            "events": civic_counts["events"] > 0,
            "meetings": civic_counts["meetings"] > 0,
            "volunteer": civic_counts["volunteer"] > 0,
            "parks": domains["parks"] > 0,
            "libraries": domains["community"] > 0,
            "recreation": poi_counts["trail"] > 0 or domains["trails"] > 0,
            "culturalActivities": poi_counts["history"] > 0 or domains["art"] > 0,
            "publicSpaces": poi_counts["rest"] > 0 or domains["facilities"] > 0,
        }
        return {
            "id": region_id,
            "name": region["name"],
            "providerCount": {"configuredGeographicSources": sum(domains.values()), "automatedCivicProviders": 1 if region_id in provider_registry else 0, "byCategory": dict(sorted(domains.items()))},
            "recordDepth": {"publicPois": sum(poi_counts.values()), **civic_counts},
            "categoryCoverage": {category: ("present" if states[category] else "missing") for category in CATEGORIES},
            "estimatedCoveragePercent": round(100 * sum(states.values()) / len(CATEGORIES), 1),
            "coverageEstimateMethod": "Share of eight target categories with a configured source or current released records; this is a planning estimate, not a completeness claim.",
            "missingCategories": [category for category in CATEGORIES if not states[category]],
        }

    def _evaluate(self, raw: dict[str, Any], missing_categories: set[str]) -> dict[str, Any]:
        required = ("id", "url", "publisher", "category", "dataType", "authority", "coverageValue", "discovery")
        missing = [key for key in required if key not in raw]
        if missing:
            raise ValueError(f"Candidate source missing: {', '.join(missing)}")
        if not str(raw["url"]).startswith("https://") or not urlparse(raw["url"]).netloc:
            raise ValueError(f"Candidate {raw['id']} must have an HTTPS URL")
        discovery = raw["discovery"]
        if discovery.get("origin") not in {"automated", "human"} or not {"foundAt", "method", "confidence"}.issubset(discovery):
            raise ValueError(f"Candidate {raw['id']} has incomplete discovery provenance")
        trust = AUTHORITY_SCORE.get(raw["authority"], 1)
        impact = VALUE_SCORE.get(raw["coverageValue"], 1)
        difficulty = self._difficulty(raw)
        gap_multiplier = 1.5 if raw["category"] in missing_categories else 0.65
        ratio = round((impact * trust * gap_multiplier) / difficulty, 2)
        reject_reasons = []
        if raw.get("accessible") is False:
            reject_reasons.append("Source was not publicly accessible during discovery.")
        if raw.get("relevant") is False:
            reject_reasons.append("Source does not fill a target regional category.")
        if raw.get("duplicateOf"):
            reject_reasons.append(f"Duplicates the likely coverage of {raw['duplicateOf']}.")
        if trust <= 2 and impact <= 1:
            reject_reasons.append("Low publisher authority and low expected coverage value.")
        confidence = float(discovery["confidence"])
        clarity = raw.get("structureClarity", "unknown")
        aligned = bool(raw.get("alignedProviderPattern", raw["dataType"] in STRUCTURED_TYPES or raw["dataType"] == "HTML calendar"))
        if reject_reasons:
            classification, action = "REJECT", "Do not spend provider effort unless new evidence changes the evaluation."
            reasoning = " ".join(reject_reasons)
        elif trust >= 4 and clarity == "clear" and aligned and confidence >= 0.75:
            classification, action = "READY", "Captain may approve immediate provider research and fixture capture."
            reasoning = "High-authority publisher, identifiable structure, and an existing Gremlin Lab provider pattern are present."
        else:
            classification, action = "INVESTIGATE", "Human review is required before provider work."
            reasons = []
            if clarity != "clear": reasons.append("data structure needs confirmation")
            if not aligned: reasons.append("no confirmed existing provider pattern")
            if confidence < 0.75: reasons.append("discovery confidence is limited")
            if trust < 4: reasons.append("publisher authority is below government/public-institution tier")
            reasoning = "Requires investigation because " + ", ".join(reasons or ["scope or maintenance cost remains uncertain"]) + "."
        return {
            "id": raw["id"], "url": raw["url"], "publisher": raw["publisher"], "category": raw["category"],
            "likelyDataType": raw["dataType"],
            "trustSignals": {"authority": raw["authority"], "governance": raw.get("governance", []), "maintenance": raw.get("maintenance", []), "stability": raw.get("stability", [])},
            "coverageValue": raw["coverageValue"], "estimatedProviderDifficulty": {1: "LOW", 2: "LOW", 3: "MEDIUM", 4: "HIGH", 5: "HIGH"}[difficulty],
            "scores": {"trust": trust, "coverageImpact": impact, "difficulty": difficulty, "coverageGapMultiplier": gap_multiplier, "impactEffortRatio": ratio},
            "classification": classification, "recommendedAction": action, "evaluationReasoning": reasoning,
            "discovery": discovery,
        }

    @staticmethod
    def _difficulty(raw: dict[str, Any]) -> int:
        kind = raw["dataType"]
        base = 1 if kind in {"JSON API", "RSS/ICS", "GeoJSON"} else 2 if kind in {"ArcGIS", "Socrata", "CKAN"} else 3 if kind == "HTML calendar" else 4
        if raw.get("structureClarity") == "unclear": base += 1
        return min(base, 5)
