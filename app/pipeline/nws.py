"""Keyless National Weather Service snapshot producer for a region."""

from __future__ import annotations

import json
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from pathlib import Path


USER_AGENT = "Gremlin-Lab/1.0 (build-time regional data producer)"


def build_weather_snapshot(region: dict[str, Any], generated_at: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """Retrieve a compact forecast and active-alert snapshot for the region centroid."""
    south, west, north, east = region["bbox"]
    lat, lng = (south + north) / 2, (west + east) / 2
    point = _get(f"https://api.weather.gov/points/{lat:.4f},{lng:.4f}")
    forecast = _get(point["properties"]["forecast"])
    alerts = _get("https://api.weather.gov/alerts/active?" + urlencode({"point": f"{lat:.4f},{lng:.4f}"}))
    periods = forecast.get("properties", {}).get("periods", [])[:4]
    expires = datetime.now(timezone.utc) + timedelta(hours=12)
    snapshot = {"schemaVersion": 1, "regionId": region["id"], "generatedAt": generated_at, "source": {"name": "National Weather Service", "url": "https://www.weather.gov/documentation/services-web-api", "authorityTier": "federal_government"}, "forecast": [{key: period.get(key) for key in ("name", "startTime", "endTime", "temperature", "temperatureUnit", "windSpeed", "windDirection", "shortForecast", "detailedForecast", "probabilityOfPrecipitation")} for period in periods], "activeAlerts": [{"id": feature.get("id"), "event": feature.get("properties", {}).get("event"), "severity": feature.get("properties", {}).get("severity"), "headline": feature.get("properties", {}).get("headline"), "effective": feature.get("properties", {}).get("effective"), "expires": feature.get("properties", {}).get("expires"), "web": feature.get("properties", {}).get("web")} for feature in alerts.get("features", [])], "freshnessExpiresAt": expires.isoformat().replace("+00:00", "Z")}
    report = {"id": "nws-forecast", "name": "National Weather Service forecast and alerts", "url": "https://api.weather.gov/", "provider": "nws", "licenseUrl": "https://www.weather.gov/documentation/services-web-api", "authorityTier": "federal_government", "recordCount": len(periods), "acquiredAt": generated_at}
    return snapshot, report


def _get(url: str) -> dict[str, Any]:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/geo+json, application/json"})
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def attach_weather_snapshot(bundle_dir: Path, snapshot: dict[str, Any], dry_run: bool = False) -> None:
    """Attach a refreshed NWS artifact to an existing release without touching POIs."""
    manifest_path = bundle_dir / "producer-manifest.json"
    if not manifest_path.exists() or not (bundle_dir / "pois.json").exists():
        raise FileNotFoundError(f"No existing release bundle at {bundle_dir}")
    content = (json.dumps(snapshot, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    checksums = dict(manifest.get("checksums", {}))
    checksums["supplemental/weather.json"] = "sha256:" + hashlib.sha256(content).hexdigest()
    manifest["checksums"] = checksums
    if dry_run:
        return
    supplemental = bundle_dir / "supplemental"
    supplemental.mkdir(exist_ok=True)
    (supplemental / "weather.json").write_bytes(content)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
