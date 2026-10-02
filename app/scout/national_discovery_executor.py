"""Bounded, research-only executor for the national search queue."""
from __future__ import annotations
import argparse, json, re, time
from html.parser import HTMLParser
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from urllib.parse import parse_qs, quote_plus, unquote, urljoin, urlsplit, urlunsplit
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.robotparser import RobotFileParser

try:
    from scrapy.spiders import CrawlSpider, Rule
    from scrapy.linkextractors import LinkExtractor
    from scrapy.crawler import CrawlerProcess
    from scrapy import Request as ScrapyRequest
except ImportError:  # unit-test environments may omit optional runtime deps
    CrawlSpider = object
    Rule = LinkExtractor = CrawlerProcess = ScrapyRequest = None

USER_AGENT = "GremlinLabNationalDiscovery/1.0 (+https://github.com/Sethryst/discover_walks)"
MAX_BODY = 1_000_000
MAX_SITEMAP_BODY = 5_000_000
ALLOWED = ("text/html", "application/xhtml+xml", "application/json", "application/rss+xml", "application/xml")
SEARCH_ENGINE_HOSTS = {"google.com", "www.google.com", "support.google.com", "bing.com", "www.bing.com"}
TRACKING_KEYS = {"gclid", "fbclid", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"}
ASSET_EXTENSIONS = (".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2", ".pdf")
BLOCKED_PATHS = ("/login", "/signin", "/sign-in", "/consent", "/privacy", "/accounts/")

class _LinkParser(HTMLParser):
    def __init__(self): super().__init__(); self.links = []; self.feeds = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs); href = attrs.get("href")
        if tag.lower() == "a" and href: self.links.append(href)
        if tag.lower() == "link" and href and ("alternate" in attrs.get("rel", "").lower() or attrs.get("type", "").lower() in {"application/rss+xml", "application/atom+xml", "text/calendar"}): self.feeds.append(href)

PATH_HINTS = ("event", "calendar", "meeting", "park", "recreation", "library", "culture", "volunteer", "open-data", "rss", "feed", "ics", "api")
EVENT_FAMILIES = {"events", "meetings", "rss_ics", "json_ld", "civicplus", "granicus", "legistar"}
EVENT_PATH_HINTS = ("event", "calendar", "meeting", "agenda", "rss", "feed", "ics", "api")
NON_EVENT_PATH_HINTS = ("parking", "feedback", "contact", "login", "privacy", "accessibility")
FEED_PATH_HINTS = (".rss", "/rss", "/feed", ".ics", "/ical", "icalendar")
PLATFORM_SUFFIXES = (".arcgis.com", ".govdelivery.com", ".civicplus.com", ".granicus.com")
QUERY_FAMILY_PATHS = {
    "events": ("/events", "/calendar"), "meetings": ("/meetings", "/calendar"),
    "parks": ("/parks", "/parks-recreation"), "trails": ("/trails", "/parks"),
    "libraries": ("/libraries", "/library"), "culture": ("/culture", "/arts"),
    "volunteer": ("/volunteer", "/volunteering"), "open_data": ("/open-data", "/opendata"),
    "rss_ics": ("/rss/events", "/events/rss", "/rss", "/feed", "/calendar.ics"), "arcgis": ("/arcgis", "/gis"),
    "socrata": ("/open-data", "/opendata"), "ckan": ("/data",),
    "json_ld": ("/events", "/calendar"), "civicplus": ("/calendar", "/events"),
    "granicus": ("/meetings", "/events"), "legistar": ("/legislation", "/meetings"),
}
SEED_PATH_PRIORITY = ("/events", "/calendar", "/rss/events", "/events/rss", "/meetings", "/parks", "/open-data", "/opendata", "/rss", "/feed", "/culture", "/volunteer", "/trails", "/arcgis", "/gis", "/data", "/legislation")


def seed_paths_for_queries(queries):
    """Return deterministic bounded paths derived from selected query families."""
    families = {query.get("queryFamily") for query in queries}
    base = {"/robots.txt", "/sitemap.xml", "/sitemap_index.xml", "/"}
    discovered = {path for family in families for path in QUERY_FAMILY_PATHS.get(family, ())}
    selected = sorted(discovered, key=lambda path: (SEED_PATH_PRIORITY.index(path) if path in SEED_PATH_PRIORITY else len(SEED_PATH_PRIORITY), path))[:6]
    return ["/", "/robots.txt", "/sitemap.xml", "/sitemap_index.xml", *selected]


class NationalDiscoverySpider(CrawlSpider):
    """Scrapy spider contract used by the production runner.

    The executor below keeps a synchronous injected-fetcher seam for fixtures;
    this spider supplies Scrapy's robots, retry, sitemap, throttle, and bounded
    same-domain scheduling when deployed through a normal Scrapy runner.
    """
    name = "gremlin_national_discovery"
    custom_settings = {
        "ROBOTSTXT_OBEY": True,
        "RETRY_ENABLED": True,
        "AUTOTHROTTLE_ENABLED": True,
        "AUTOTHROTTLE_START_DELAY": 1.0,
        "AUTOTHROTTLE_MAX_DELAY": 10.0,
        "CONCURRENT_REQUESTS_PER_DOMAIN": 2,
        "DOWNLOAD_MAXSIZE": MAX_BODY,
        "DOWNLOAD_TIMEOUT": 15,
        "USER_AGENT": USER_AGENT,
    }
    if Rule:
        rules = (Rule(LinkExtractor(allow=PATH_HINTS), follow=True, callback="parse_item"),)

    def __init__(self, official_domain=None, max_pages=24, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.official_domain = official_domain
        self.max_pages = max_pages
        self.pages_seen = 0

    def start_requests(self):
        if self.official_domain:
            yield self.make_requests_from_url(f"https://{self.official_domain}/")

    def parse_item(self, response):
        self.pages_seen += 1
        if self.pages_seen <= self.max_pages:
            yield {"url": response.url, "content_type": response.headers.get(b"Content-Type", b"").decode(), "body": response.text[:MAX_BODY]}


class ScrapyNationalBatchSpider(NationalDiscoverySpider):
    """One bounded Scrapy crawl for a deduplicated domain batch."""
    name = "gremlin_national_discovery_batch"

    def __init__(self, queries=None, results_sink=None, max_pages=24, *args, **kwargs):
        self.queries = queries or []
        self.domain_queries = {}
        for query in self.queries:
            self.domain_queries.setdefault(query["officialDomain"].lower().removeprefix("www."), []).append(query)
        self.results = {q["officialDomain"].lower().removeprefix("www."): {"queries": [], "records": [], "pages": 0, "failures": [], "robotsDecision": "unknown"} for q in self.queries}
        self.max_pages = max_pages
        self.results_sink = results_sink
        self.seen_by_domain = {domain: set() for domain in self.results}
        super().__init__(official_domain=None, max_pages=max_pages, *args, **kwargs)

    def start_requests(self):
        for domain in self.results:
            for path in seed_paths_for_queries(self.domain_queries.get(domain, [])):
                limit = 256_000 if path == "/robots.txt" else (MAX_SITEMAP_BODY if path.endswith(".xml") else MAX_BODY)
                yield ScrapyRequest(f"https://{domain}{path}", callback=self.parse_batch, errback=self.errback_batch, dont_filter=True, meta={"domain": domain, "seed": path, "handle_httpstatus_all": True, "download_maxsize": limit})

    async def start(self):
        """Scrapy 2.13+ start hook; retain start_requests for older releases."""
        for request in self.start_requests():
            yield request

    def parse_batch(self, response):
        domain = response.meta["domain"]
        state = self.results[domain]
        seed = response.meta.get("seed")
        if seed == "/robots.txt":
            if response.status == 200 and response.text.strip():
                parser = RobotFileParser(response.url); parser.parse(response.text.splitlines())
                state["robotsDecision"] = "allowed" if parser.can_fetch(USER_AGENT, f"https://{domain}/") else "disallowed"
            else:
                state["robotsDecision"] = "unknown"
            if state["robotsDecision"] == "disallowed":
                return
        elif state.get("robotsDecision") == "disallowed":
            return
        if response.status >= 400:
            state["failures"].append({"url": response.url, "status": response.status, "errorType": "http_error", "error": f"HTTP {response.status}"})
            return
        if len(self.seen_by_domain[domain]) >= self.max_pages and response.meta.get("seed") not in {"/robots.txt", "/sitemap.xml", "/sitemap_index.xml"}: return
        self.seen_by_domain[domain].add(response.url); state["pages"] = len(self.seen_by_domain[domain])
        body = response.text[:MAX_BODY]; ctype = response.headers.get(b"Content-Type", b"").decode("latin1")
        source = classify_candidate(response.url, ctype, body)
        response_path = urlsplit(response.url).path.lower()
        synthetic_format_path = response_path.endswith(".ics") or "/api/" in response_path or "featureserver" in response_path or "mapserver" in response_path
        if (source != "HTML calendar" or any(h in response.url.lower() for h in PATH_HINTS)) and not (source == "HTML calendar" and synthetic_format_path):
            seeded = response.meta.get("seed") not in {None, "/", "link", "/robots.txt", "/sitemap.xml", "/sitemap_index.xml"}
            origin = f"https://{domain}/" if seeded else response.url
            state["records"].append({"url": response.url, "canonicalUrl": response.url, "sourceType": source, "evidenceUrls": [origin], "originatingPageUrl": origin, "discoveryReason": "query_family_seed" if seeded else "official_page", **score_candidate(response.url, source, official_link=False, body=body), "needsHumanReview": True})
        if "xml" in ctype.lower() or response.url.lower().endswith(".xml"):
            targets = re.findall(r"<loc>\s*(https://[^<]+)", body, re.I)
        else:
            # Candidate extraction remains HTTPS-only, but the bounded crawler
            # must follow relative official links to reach those candidates.
            raw_links = response.css("a::attr(href), link::attr(href)").getall()
            targets = [urljoin(response.url, raw_link) for raw_link in raw_links]
            targets.extend(extract_candidate_urls(body))
        for target in targets:
            clean = canonical_candidate_url(target)
            if clean and _crawl_host_allowed(clean, domain) and clean not in self.seen_by_domain[domain] and len(self.seen_by_domain[domain]) < self.max_pages:
                target_path = (urlsplit(clean).path + "?" + urlsplit(clean).query).lower()
                platform_target = any(marker in clean.lower() for marker in ("featureserver", "mapserver", "socrata", "/api/3/action/", ".govdelivery.com", ".civicplus.com", ".granicus.com"))
                if (any(hint in target_path for hint in PATH_HINTS) or platform_target) and not any(existing.get("url") == clean for existing in state["records"]):
                    discovered_type = classify_candidate(clean, "", "")
                    seeded = response.meta.get("seed") in {"/events", "/calendar", "/meetings", "/parks", "/parks-recreation", "/trails", "/libraries", "/library", "/culture", "/arts", "/volunteer", "/volunteering", "/open-data", "/opendata", "/rss/events", "/events/rss", "/rss", "/feed", "/calendar.ics", "/arcgis", "/gis", "/data", "/api/3/action/status_show", "/legislation"}
                    origin = f"https://{domain}/" if seeded else response.url
                    target_path = urlsplit(clean).path.lower()
                    target_is_synthetic = target_path.endswith(".ics") or "/api/" in target_path or "featureserver" in target_path or "mapserver" in target_path
                    if not (discovered_type == "HTML calendar" and target_is_synthetic):
                        state["records"].append({"url": clean, "canonicalUrl": clean, "sourceType": discovered_type, "evidenceUrls": [origin], "originatingPageUrl": origin, "discoveryReason": "query_family_seed" if seeded else "official_page_link", **score_candidate(clean, discovered_type, official_link=not seeded), "needsHumanReview": True})
                yield ScrapyRequest(clean, callback=self.parse_batch, errback=self.errback_batch, meta={"domain": domain, "seed": "link"})

    def errback_batch(self, failure):
        request = failure.request; self.results[request.meta["domain"]]["failures"].append({"url": request.url, "errorType": failure.value.__class__.__name__, "error": str(failure.value)})

    def closed(self, reason):
        for domain, state in self.results.items():
            state["status"] = "succeeded" if state["pages"] else "failed"
        if self.results_sink is not None:
            self.results_sink.update(self.results)

def _priority(url):
    text = url.lower()
    return (0 if any(hint in text for hint in PATH_HINTS) else 1, len(url))

def extract_candidate_urls(html):
    parser = _LinkParser(); parser.feed(html); found = set()
    blocked_hosts = {host.removeprefix("www.") for host in SEARCH_ENGINE_HOSTS}
    for raw in parser.links + parser.feeds:
        value = unquote(raw.strip()); parts = urlsplit(value); query = parse_qs(parts.query)
        if parts.path.startswith("/url") and query.get("q"):
            parts = urlsplit(query["q"][0]); query = parse_qs(parts.query)
        if parts.scheme.lower() != "https" or not parts.netloc: continue
        host, path = parts.netloc.lower().removeprefix("www."), parts.path.lower()
        if host in blocked_hosts or path in {"", "/"} or path.endswith(ASSET_EXTENSIONS) or any(path.startswith(x) for x in BLOCKED_PATHS): continue
        clean_query = "&".join(f"{k}={v[0]}" for k,v in query.items() if k not in TRACKING_KEYS)
        found.add(urlunsplit(("https", parts.netloc, parts.path or "/", clean_query, "")))
    return sorted(found)


def canonical_candidate_url(value):
    """Normalize a candidate while enforcing the HTTPS-only boundary."""
    value = unquote(str(value).strip())
    parts = urlsplit(value)
    if parts.scheme.lower() != "https" or not parts.netloc: return None
    host = parts.netloc.lower().removeprefix("www.")
    path = parts.path or "/"
    if host in {h.removeprefix("www.") for h in SEARCH_ENGINE_HOSTS}: return None
    if path in {"", "/"} or path.lower().endswith(ASSET_EXTENSIONS) or any(path.lower().startswith(p) for p in BLOCKED_PATHS): return None
    query = "&".join(f"{k}={v}" for k, v in parse_qsl(parts.query) if k.lower() not in TRACKING_KEYS)
    return urlunsplit(("https", parts.netloc, path, query, ""))


def _crawl_host_allowed(url, official_domain):
    host = (urlsplit(url).hostname or "").lower().removeprefix("www.")
    root = official_domain.lower().removeprefix("www.")
    return host == root or host.endswith("." + root) or any(host.endswith(s) for s in PLATFORM_SUFFIXES)


def classify_candidate(url, content_type="", body=""):
    """Classify a discovered endpoint without treating generic HTML as strong evidence."""
    text = f"{url} {content_type}".lower()
    if "sitemap" in text or re.search(r"<urlset\b|<sitemapindex\b", body, re.I): return "Sitemap"
    if "text/html" in content_type.lower() or "application/xhtml" in content_type.lower():
        if re.search(r'"@type"\s*:\s*(?:\[\s*)?["\']Event', body, re.I): return "JSON-LD Event"
        return "HTML calendar"
    if "text/calendar" in text or body.lstrip().upper().startswith("BEGIN:VCALENDAR"): return "ICS/iCalendar"
    if "rss" in text or "atom" in text or re.search(r"<(rss|feed)\b", body, re.I): return "RSS/Atom"
    if "featureserver" in text or "mapserver" in text: return "ArcGIS FeatureServer/MapServer"
    if "socrata" in text: return "Socrata"
    if "ckan" in text or "/api/3/action/" in text: return "CKAN"
    if re.search(r'"@type"\s*:\s*(?:\[\s*)?["\']Event', body, re.I): return "JSON-LD Event"
    if "json" in text or body.lstrip().startswith(("{", "[")): return "JSON API"
    return "HTML calendar"


def family_relevant(url, family, body="", *, machine_readable=False):
    """Keep family-specific discovery from turning every civic link into an event source."""
    path = urlsplit(url).path.lower()
    if any(marker in path for marker in NON_EVENT_PATH_HINTS):
        return False
    if family in EVENT_FAMILIES:
        return machine_readable or any(marker in path for marker in EVENT_PATH_HINTS) or '"event"' in body.lower()
    return True


def score_candidate(url, source_type, *, official_link=False, body=""):
    signals = {
        "official_site_link": 0.25 if official_link else 0.0,
        "machine_readable_format": 0.30 if source_type != "HTML calendar" else 0.0,
        "event_related_path": 0.15 if any(h in url.lower() for h in PATH_HINTS) else 0.0,
        "valid_https": 0.10 if url.startswith("https://") else 0.0,
        "structured_event_fields": 0.10 if source_type == "JSON-LD Event" else 0.0,
        "stable_identifier": 0.05 if any(x in url.lower() for x in ("api", "dataset", "event")) else 0.0,
        "freshness_signals": 0.025 if any(x in body.lower() for x in ("updated", "startdate", "pubdate")) else 0.0,
        "licensing_or_terms_evidence": 0.025 if any(x in body.lower() for x in ("license", "terms")) else 0.0,
    }
    return {"confidence": round(min(1.0, sum(signals.values())), 3), "scoreBreakdown": signals}

def _now(): return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
class DiscoveryExecutor:
    def __init__(self, *, workers=2, timeout=15, retries=2, backoff=1.0, fetcher=None):
        self.workers, self.timeout, self.retries, self.backoff = max(1, workers), timeout, retries, backoff
        self._use_scrapy = fetcher is None
        self.fetcher = fetcher or self._fetch
        self._robots, self._robots_lock = {}, Lock()

    def _robots_decision(self, target_url):
        parts = urlsplit(target_url); origin = f"{parts.scheme}://{parts.netloc}"
        with self._robots_lock:
            rp = self._robots.get(origin)
            if rp == "unknown":
                return "unknown"
            if rp is None:
                rp = RobotFileParser(urljoin(origin, "/robots.txt"))
                try:
                    request = Request(urljoin(origin, "/robots.txt"), headers={"User-Agent": USER_AGENT})
                    with urlopen(request, timeout=self.timeout) as response:
                        if getattr(response, "status", 200) >= 400:
                            self._robots[origin] = "unknown"
                            return "unknown"
                        body = response.read(256_000).decode("utf-8", "replace")
                    rp.parse(body.splitlines())
                except Exception:
                    self._robots[origin] = "unknown"
                    return "unknown"
                self._robots[origin] = rp
        return "disallowed" if rp and not rp.can_fetch(USER_AGENT, target_url) else "allowed"

    def _fetch(self, query):
        domain = str(query.get("officialDomain", "")).lower().strip()
        if not domain: return {"status": None, "errorType": "missing_domain", "error": "officialDomain missing", "urls": [], "attempts": 0}
        homepage = "https://" + domain + "/"; robots = self._robots_decision(homepage)
        family = str(query.get("queryFamily") or query.get("expectedSourceType") or "").lower()
        if robots == "disallowed": return {"status": None, "skipped": "robots_disallowed", "robots": robots, "urls": [], "attempts": 0}
        queue = [homepage]; seen = set(); candidates = set(); evidence = {}; statuses = []
        for sitemap in ("https://" + domain + "/sitemap.xml", "https://" + domain + "/sitemap_index.xml"):
            try:
                req = Request(sitemap, headers={"User-Agent": USER_AGENT, "Accept": "application/xml,text/xml"})
                with urlopen(req, timeout=self.timeout) as response: body = response.read(MAX_BODY).decode("utf-8", "replace")
                queue.extend(re.findall(r"<loc>\s*(https://[^<]+)", body, re.I))
            except HTTPError as exc:
                statuses.append((sitemap, 429 if exc.code == 429 else exc.code))
            except Exception as exc: statuses.append((sitemap, type(exc).__name__))
        while queue and len(seen) < 3:
            url = sorted(set(queue), key=_priority).pop(0); queue.remove(url)
            if url in seen or urlsplit(url).scheme != "https": continue
            host = urlsplit(url).netloc.lower(); same = host == domain or host == "www." + domain
            if not same and not any(host.endswith(s) for s in PLATFORM_SUFFIXES): continue
            seen.add(url); time.sleep(0.2)
            try:
                req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": ", ".join(ALLOWED)})
                with urlopen(req, timeout=self.timeout) as response:
                    status = getattr(response, "status", None); ctype = response.headers.get_content_type(); body = response.read(MAX_BODY).decode("utf-8", "replace")
                if status == 429: statuses.append((url, 429)); continue
                machine = any(x in ctype or x in url.lower() for x in ("rss", "xml", "calendar", "json", "api", "featureserver", "mapserver", "socrata", "ckan"))
                event_schema = '"Event"' in body or '"@type":"Event"' in body or '"@type": "Event"' in body
                if family_relevant(url, family, body, machine_readable=machine or event_schema):
                    candidates.add(url)
                    evidence[url] = {"evidenceUrl": url, "sourceType": classify_candidate(url, ctype, body), "confidence": 0.8 if machine or event_schema else 0.55}
                parser = _LinkParser(); parser.feed(body)
                for raw in parser.links:
                    child = urljoin(url, raw); child = urlunsplit((urlsplit(child).scheme, urlsplit(child).netloc, urlsplit(child).path, urlsplit(child).query, ""))
                    if child.startswith("https://") and child not in seen:
                        child_clean = canonical_candidate_url(child)
                        child_path = urlsplit(child).path.lower()
                        child_host = (urlsplit(child).hostname or "").lower()
                        bounded_host = child_host == domain or child_host.endswith("." + domain) or any(child_host.endswith(s) for s in PLATFORM_SUFFIXES)
                        if child_clean and bounded_host and any(marker in child_path for marker in FEED_PATH_HINTS) and family_relevant(child_clean, family, machine_readable=True):
                            candidates.add(child_clean)
                            evidence[child_clean] = {"evidenceUrl": url, "sourceType": classify_candidate(child_clean, "", ""), "confidence": 0.7}
                        queue.append(child)
            except HTTPError as exc: statuses.append((url, 429 if exc.code == 429 else exc.code))
            except Exception as exc: statuses.append((url, type(exc).__name__))
        return {"status": 200, "robots": robots, "urls": sorted(candidates), "evidence": evidence, "attempts": len(seen), "crawlStatus": "completed" if seen else "failed", "failures": statuses}

    def run(self, queries):
        if self._use_scrapy and CrawlerProcess is not None:
            return self._run_scrapy(queries)
        def one(q):
            started = _now(); result = self.fetcher(q); urls = sorted({u for u in result.get("urls", []) if urlsplit(str(u)).scheme == "https" and urlsplit(str(u)).netloc and urlsplit(str(u)).netloc.lower() not in SEARCH_ENGINE_HOSTS})
            status = "skipped" if result.get("skipped") else ("succeeded" if urls else ("failed" if result.get("error") else "succeeded"))
            return {"query": q, "status": status, "reason": result.get("skipped"), "errorType": result.get("errorType"), "robots": result.get("robots", "unknown"), "error": result.get("error"), "httpStatus": result.get("status"), "candidateUrls": urls, "candidateEvidence": result.get("evidence", {}), "crawlStatus": result.get("crawlStatus"), "failures": result.get("failures", []), "attempts": result.get("attempts", 1), "startedAt": started, "finishedAt": _now()}
        with ThreadPoolExecutor(max_workers=self.workers) as pool:
            return sorted((f.result() for f in as_completed([pool.submit(one, q) for q in queries])), key=lambda x: x["query"]["queryId"])

    def _run_scrapy(self, queries):
        grouped = {}
        for query in queries:
            grouped.setdefault(str(query.get("officialDomain", "")).lower().removeprefix("www."), []).append(query)
        process = CrawlerProcess({
            "ROBOTSTXT_OBEY": True,
            "RETRY_ENABLED": True,
            "RETRY_TIMES": self.retries,
            "DOWNLOAD_TIMEOUT": self.timeout,
            "DOWNLOAD_MAXSIZE": MAX_BODY,
            "USER_AGENT": USER_AGENT,
            "CONCURRENT_REQUESTS_PER_DOMAIN": max(1, self.workers),
            "AUTOTHROTTLE_ENABLED": True,
            "AUTOTHROTTLE_START_DELAY": max(0.1, self.backoff),
            "AUTOTHROTTLE_MAX_DELAY": max(1.0, self.backoff * 8),
            "LOG_ENABLED": False,
        })
        results_sink = {}
        process.crawl(ScrapyNationalBatchSpider, queries=queries, results_sink=results_sink, max_pages=24)
        process.start()
        output = []
        for domain, domain_queries in grouped.items():
            state = results_sink.get(domain, {"records": [], "pages": 0, "failures": [], "robotsDecision": "unknown"})
            records = state.get("records", [])
            for query in domain_queries:
                output.append({"query": query, "domainOutcome": {"domain": domain, "robotsDecision": state.get("robotsDecision", "unknown"), "pagesCrawled": state.get("pages", 0), "failures": state.get("failures", []), "candidateCount": len(records)}, "status": "succeeded" if state.get("pages") else "failed", "reason": "robots_disallowed" if state.get("robotsDecision") == "disallowed" else None, "errorType": None, "robots": state.get("robotsDecision", "unknown"), "error": None, "httpStatus": 200 if state.get("pages") else None, "candidateUrls": sorted({r["url"] for r in records}), "candidates": records, "candidateEvidence": {r["url"]: r for r in records}, "crawlStatus": "completed" if state.get("pages") else "failed", "failures": state.get("failures", []), "attempts": state.get("pages", 0), "pagesCrawled": state.get("pages", 0), "startedAt": _now(), "finishedAt": _now()})
        return sorted(output, key=lambda item: item["query"]["queryId"])

def execute(queue, output, capture_output, offset=0, limit=100, workers=2, timeout=15, retries=2, backoff=1.0):
    queue_path, output_path, capture_path = queue, output, capture_output
    queue = json.loads(Path(queue_path).read_text(encoding="utf-8")); all_queries = queue["queries"]
    selected = all_queries[offset:offset + limit]
    results = DiscoveryExecutor(workers=workers, timeout=timeout, retries=retries, backoff=backoff).run(selected)
    candidate_map = {}
    for r in results:
        q = r["query"]
        for url in r["candidateUrls"]:
            key = url.split("#", 1)[0]
            evidence = r.get("candidateEvidence", {}).get(url, {})
            item = candidate_map.setdefault(key, {"market": q["market"], "markets": [], "place": q["place"], "queryId": q["queryId"], "queryIds": [], "queryFamilies": [], "sourceUrl": url, "canonicalUrl": key, "providerName": urlsplit(url).netloc, "sourceType": evidence.get("sourceType", q["expectedSourceType"]), "coverageScope": q["marketId"], "discoveryEvidence": "National bounded crawler result; review required.", "evidenceUrls": [url] + evidence.get("evidenceUrls", []), "originatingOfficialDomain": q.get("officialDomain", ""), "originatingSeed": q.get("provenance", {}).get("seedFile"), "confidence": evidence.get("confidence", 0.4), "scoreBreakdown": evidence.get("scoreBreakdown", {}), "needsHumanReview": evidence.get("needsHumanReview", True), "crawlStatus": r.get("crawlStatus"), "robotsDecision": r.get("robots", "unknown"), "httpStatus": r.get("httpStatus"), "crawlTimestamp": r.get("finishedAt"), "failureReason": r.get("error") or next((f.get("error") for f in r.get("failures", []) if isinstance(f, dict)), None)})
            item["queryIds"].append(q["queryId"]); item["markets"].append(q.get("market")); item["queryFamilies"].append(q.get("queryFamily", q.get("expectedSourceType")))
    candidates = []
    for item in candidate_map.values():
        item["queryIds"] = sorted(set(item["queryIds"])); item["markets"] = sorted({value for value in item["markets"] if value}); item["queryFamilies"] = sorted({value for value in item["queryFamilies"] if value}); candidates.append(item)
    capture = {"schemaVersion": 2, "kind": "national-candidate-capture", "readOnly": True, "publicationState": "research-only", "generatedAt": _now(), "candidates": sorted(candidates, key=lambda x:x["sourceUrl"]), "negativeDiscoveries": []}
    succeeded = sum(r["status"] == "succeeded" for r in results)
    failed_requests = sum(len(r.get("failures", [])) for r in results)
    rate_limited = sum(1 for r in results for failure in r.get("failures", []) if (isinstance(failure, (list, tuple)) and len(failure) > 1 and failure[1] == 429) or (isinstance(failure, dict) and failure.get("status") == 429))
    summary = {"attempted": len(selected), "httpSuccesses": sum(bool(r.get("httpStatus") and 200 <= r["httpStatus"] < 400) for r in results), "succeeded": succeeded, "succeededWithCandidates": sum(bool(r["status"] == "succeeded" and r["candidateUrls"]) for r in results), "succeededWithoutCandidates": sum(bool(r["status"] == "succeeded" and not r["candidateUrls"]) for r in results), "failed": sum(r["status"]=="failed" for r in results), "failedRequests": failed_requests, "skipped": sum(r["status"]=="skipped" for r in results), "robots_disallowed": sum(r.get("reason") == "robots_disallowed" for r in results), "robots_unknown": sum(r.get("robots") == "unknown" for r in results), "responses_429": rate_limited, "rateLimitedRequests": rate_limited, "timeout_network_failures": sum(r.get("errorType") in {"timeout", "network_error"} for r in results), "pagesCrawled": sum(r.get("attempts", 0) for r in results), "pagesFetched": sum(r.get("attempts", 0) for r in results), "pagesRejected": failed_requests, "domainsCrawled": len({q.get("officialDomain") for q in selected}), "candidatesFound": len(candidates), "usefulDiscoveries": len(candidates), "candidatesNeedingHumanReview": sum(c.get("needsHumanReview", True) for c in candidates), "duplicateUrlsMerged": sum(max(0, len(r.get("candidateUrls", [])) - len(set(r.get("candidateUrls", [])))) for r in results), "uniqueCandidates": len(candidates), "candidateCaptureErrors": None}
    report = {"schemaVersion": 2, "kind": "national-discovery-batch", "readOnly": True, "publicationState": "research-only", "sourceQueue": str(queue_path).replace("\\", "/"), "offset": offset, "limit": limit, "selectedQueryIds": [q["queryId"] for q in selected], "results": results, "summary": summary}
    for path, data in ((output_path, report), (capture_path, capture)):
        Path(path).parent.mkdir(parents=True, exist_ok=True); Path(path).write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return report

def main():
    p=argparse.ArgumentParser(); p.add_argument("--queue", type=Path, default=Path("expansion-queues/national-region-search-queue.json")); p.add_argument("--output", type=Path, default=Path("expansion-queues/national-discovery-batch.json")); p.add_argument("--capture-output", type=Path, default=Path("expansion-queues/national-candidate-capture.json")); p.add_argument("--offset", type=int, default=0); p.add_argument("--limit", type=int, default=100); p.add_argument("--workers", type=int, default=2); p.add_argument("--timeout", type=float, default=15); p.add_argument("--retries", type=int, default=2); p.add_argument("--backoff", type=float, default=1.0); a=p.parse_args(); r=execute(**vars(a)); print(json.dumps(r["summary"], sort_keys=True))
if __name__ == "__main__": main()
