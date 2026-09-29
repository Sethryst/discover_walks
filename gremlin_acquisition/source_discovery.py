"""Bounded discovery and schema probes for static source backlog candidates.

Discovery is evidence only. It never turns a landing page or an undated link
into app data; publication still goes through the existing adapters/contracts.
"""
from __future__ import annotations
import hashlib, json, re
from dataclasses import dataclass, asdict
from html import unescape
from urllib.parse import urljoin, urlparse

from gremlin_acquisition.adapters import acquire

@dataclass(frozen=True)
class DiscoveryResult:
    source_id: str
    url: str
    status: str
    http_status: int | None
    content_type: str | None
    final_url: str | None
    jsonld_events: int
    candidate_endpoints: tuple[str, ...]
    selector_candidates: tuple[str, ...]
    schema_status: str
    schema_evidence: tuple[str, ...]
    blocker: str | None

    def jsonable(self):
        value = asdict(self)
        value["candidate_endpoints"] = list(self.candidate_endpoints)
        value["selector_candidates"] = list(self.selector_candidates)
        value["schema_evidence"] = list(self.schema_evidence)
        return value

def _links(html: str, base: str) -> tuple[str, ...]:
    found = []
    for href, label in re.findall(r'''<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)</a>''', html, re.I | re.S):
        target = urljoin(base, unescape(href).strip())
        text = re.sub(r"<[^>]+>", " ", label).lower()
        if urlparse(target).scheme not in {"http", "https"}: continue
        if re.search(r"\.(?:ics|ical)(?:$|[?#])|rss|atom|feed|calendar|event|api|json", target.lower() + " " + text): found.append(target)
    return tuple(sorted(set(found)))

def discover_html(source_id: str, url: str, html: str, *, http_status: int = 200, content_type: str = "text/html", final_url: str | None = None) -> DiscoveryResult:
    jsonld = 0
    for block in re.findall(r'''<script[^>]+type=["']application/ld\+json["'][^>]*>(.*?)</script>''', html, re.I | re.S):
        try:
            payload = json.loads(block.strip())
            values = payload if isinstance(payload, list) else payload.get("@graph", [payload]) if isinstance(payload, dict) else []
            jsonld += sum(1 for item in values if isinstance(item, dict) and "Event" in ([item.get("@type")] if isinstance(item.get("@type"), str) else item.get("@type", [])))
        except json.JSONDecodeError:
            continue
    endpoints = _links(html, final_url or url)
    selectors = []
    for tag, attr in (("article", "class"), ("li", "class"), ("div", "class")):
        for value in re.findall(fr"<{tag}[^>]*{attr}=[\"']([^\"']+)[\"']", html, re.I):
            if re.search(r"event|calendar|meeting", value, re.I): selectors.append(f"{tag}.{value.split()[0]}")
    schema = "jsonld-events-found" if jsonld else "endpoint-or-selector-needed"
    blocker = None if jsonld or endpoints or selectors else "no-dated-event-schema-or-discoverable-endpoint"
    return DiscoveryResult(source_id, url, "SUCCEEDED" if http_status < 400 else "FAILED", http_status, content_type, final_url or url, jsonld, endpoints, tuple(sorted(set(selectors))), schema, tuple([f"jsonldEvents={jsonld}", f"links={len(endpoints)}", f"selectors={len(set(selectors))}"]), blocker)

def verify_structured_schema(source_id: str, config: dict, transport) -> DiscoveryResult:
    try:
        body = transport(config["url"])
        result = acquire(config, lambda _: body)
    except Exception as exc:
        return DiscoveryResult(source_id, config["url"], "FAILED", None, None, config["url"], 0, (), (), "adapter-error", (type(exc).__name__, str(exc)), "adapter-failed")
    evidence = (f"status={result.status}", f"records={len(result.records)}", f"errors={len(result.errors)}", f"rawSha256={result.raw_sha256 or hashlib.sha256(str(body).encode()).hexdigest()}")
    if result.status == "SUCCEEDED" and result.records:
        return DiscoveryResult(source_id, config["url"], "SUCCEEDED", 200, "application/json", config["url"], 0, (), (), "schema-valid", evidence, None)
    return DiscoveryResult(source_id, config["url"], "PARTIAL" if result.status == "PARTIAL" else "FAILED", 200, "application/json", config["url"], 0, (), (), "schema-invalid-or-empty", evidence, "schema-unverified")
