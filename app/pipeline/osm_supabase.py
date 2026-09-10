"""Build-environment-only Supabase Storage publisher for OSM releases."""

from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from app.pipeline.osm_state import BuildError, atomic_json, sha256_file, validate_pmtiles, validate_release


TUS_VERSION = "1.0.0"
TUS_CHUNK_BYTES = 6 * 1024 * 1024
STANDARD_UPLOAD_MAX_BYTES = 6 * 1024 * 1024
IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable"


@dataclass(frozen=True, slots=True)
class SupabaseConfig:
    url: str
    service_role_key: str
    bucket: str

    @classmethod
    def from_environment(cls, environment: dict[str, str] | None = None) -> "SupabaseConfig":
        values = environment if environment is not None else os.environ
        names = ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_STORAGE_BUCKET")
        missing = [name for name in names if not values.get(name, "").strip()]
        if missing:
            raise BuildError("Missing Supabase publishing credentials: " + ", ".join(missing))
        return cls(values[names[0]].rstrip("/"), values[names[1]], values[names[2]])


@dataclass(slots=True)
class HttpResult:
    status: int
    headers: dict[str, str]
    body: bytes
    url: str


class SupabaseHttpError(BuildError):
    def __init__(self, method: str, url: str, status: int, body: bytes, *, secret: str = ""):
        detail = body.decode("utf-8", "replace")[:1000].strip()
        if secret:
            detail = detail.replace(secret, "[REDACTED]")
        super().__init__(f"Supabase Storage {method} failed with HTTP {status} for {url}: {detail or 'empty response'}")
        self.status = status
        self.method = method
        self.url = url


Transport = Callable[[str, str, dict[str, str], bytes | None], HttpResult]


def _urllib_transport(method: str, url: str, headers: dict[str, str], body: bytes | None) -> HttpResult:
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return HttpResult(response.status, {key.lower(): value for key, value in response.headers.items()}, response.read(), response.url)
    except urllib.error.HTTPError as exc:
        return HttpResult(exc.code, {key.lower(): value for key, value in exc.headers.items()}, exc.read(), url)


def release_object_prefix(release: str) -> str:
    marker = "osm-us-"
    if not release.startswith(marker) or len(release) <= len(marker):
        raise ValueError("Release must use the osm-us-YYYY-MM-DD convention.")
    return f"osm/{release[len(marker):]}"


class SupabaseStoragePublisher:
    def __init__(self, config: SupabaseConfig, *, transport: Transport | None = None):
        self.config = config
        self.transport = transport or _urllib_transport

    @property
    def _auth_headers(self) -> dict[str, str]:
        # Never include this mapping in exceptions, logs, or returned metadata.
        headers = {"apikey": self.config.service_role_key}
        # Legacy service_role keys are JWTs. New sb_secret keys must not be
        # placed in Authorization because the gateway would parse them as JWTs.
        if not self.config.service_role_key.startswith("sb_"):
            headers["Authorization"] = f"Bearer {self.config.service_role_key}"
        return headers

    def _storage_url(self, suffix: str, *, direct: bool = False) -> str:
        parsed = urllib.parse.urlsplit(self.config.url)
        hostname = parsed.hostname or ""
        if direct and hostname.endswith(".supabase.co") and not hostname.endswith(".storage.supabase.co"):
            hostname = hostname.removesuffix(".supabase.co") + ".storage.supabase.co"
            netloc = hostname + (f":{parsed.port}" if parsed.port else "")
            base = urllib.parse.urlunsplit((parsed.scheme, netloc, "", "", ""))
        else:
            base = self.config.url
        return base + "/storage/v1/" + suffix.lstrip("/")

    def public_url(self, object_path: str) -> str:
        return self._storage_url(f"object/public/{_quote_path(self.config.bucket)}/{_quote_path(object_path)}")

    def object_info(self, object_path: str) -> dict[str, Any] | None:
        url = self._storage_url(f"object/info/{_quote_path(self.config.bucket)}/{_quote_path(object_path)}")
        result = self.transport("GET", url, self._auth_headers, None)
        if result.status == 404:
            return None
        if result.status < 200 or result.status >= 300:
            raise SupabaseHttpError("GET", url, result.status, result.body, secret=self.config.service_role_key)
        try:
            value = json.loads(result.body)
        except json.JSONDecodeError as exc:
            raise BuildError(f"Supabase Storage returned invalid object metadata for {object_path}.") from exc
        value["httpStatus"] = result.status
        return value

    def upload_immutable(self, source: Path, object_path: str, *, content_type: str, resume_path: Path | None = None) -> dict[str, Any]:
        size = source.stat().st_size
        checksum = sha256_file(source)
        existing = self.object_info(object_path)
        if existing is not None:
            self._assert_identical(existing, object_path, size, checksum)
            range_status = self.verify_public_range(object_path, size) if content_type == "application/vnd.pmtiles" else None
            return self._verified_result(object_path, existing, checksum, "already_present", 200, 0.0, range_status)

        started = time.monotonic()
        if size > STANDARD_UPLOAD_MAX_BYTES:
            status = self._upload_tus(source, object_path, checksum, content_type, resume_path)
            method = "tus"
        else:
            status = self._upload_standard(source, object_path, checksum, content_type)
            method = "standard"
        remote = self.object_info(object_path)
        if remote is None:
            raise BuildError(f"Supabase upload returned HTTP {status}, but object metadata is missing for {object_path}.")
        self._assert_identical(remote, object_path, size, checksum)
        range_status = self.verify_public_range(object_path, size) if content_type == "application/vnd.pmtiles" else None
        return self._verified_result(object_path, remote, checksum, method, status, time.monotonic() - started, range_status)

    def verify_public_range(self, object_path: str, size: int) -> int:
        url = self.public_url(object_path)
        result = self.transport("GET", url, {"Range": "bytes=0-7", "Accept": "application/vnd.pmtiles"}, None)
        content_range = result.headers.get("content-range", "")
        if result.status != 206 or not content_range.startswith("bytes 0-7/") or result.body[:8] != b"PMTiles\x03":
            raise BuildError(
                f"Supabase public PMTiles range verification failed with HTTP {result.status} for {url}; "
                f"expected bytes 0-7/{size}."
            )
        return result.status

    def _upload_standard(self, source: Path, object_path: str, checksum: str, content_type: str) -> int:
        metadata = _metadata(checksum, source.stat().st_size)
        headers = {
            **self._auth_headers,
            "Content-Type": content_type,
            "Cache-Control": IMMUTABLE_CACHE_CONTROL,
            "x-upsert": "false",
            "x-metadata": base64.b64encode(json.dumps(metadata, separators=(",", ":")).encode()).decode(),
        }
        url = self._storage_url(f"object/{_quote_path(self.config.bucket)}/{_quote_path(object_path)}")
        result = self.transport("POST", url, headers, source.read_bytes())
        if result.status < 200 or result.status >= 300:
            if result.status in {400, 409}:
                remote = self.object_info(object_path)
                if remote is not None:
                    self._assert_identical(remote, object_path, source.stat().st_size, checksum)
                    return result.status
            raise SupabaseHttpError("POST", url, result.status, result.body, secret=self.config.service_role_key)
        return result.status

    def _upload_tus(self, source: Path, object_path: str, checksum: str, content_type: str, resume_path: Path | None) -> int:
        size = source.stat().st_size
        session_url = None
        offset = 0
        if resume_path and resume_path.exists():
            try:
                saved = json.loads(resume_path.read_text(encoding="utf-8"))
                if saved.get("objectPath") == object_path and saved.get("sha256") == checksum and saved.get("bytes") == size:
                    session_url = saved.get("uploadUrl")
            except (OSError, json.JSONDecodeError):
                session_url = None
        if session_url:
            head = self.transport("HEAD", session_url, {**self._auth_headers, "Tus-Resumable": TUS_VERSION}, None)
            if 200 <= head.status < 300:
                offset = int(head.headers.get("upload-offset", "0"))
            else:
                session_url = None
        if not session_url:
            metadata = {
                "bucketName": self.config.bucket,
                "objectName": object_path,
                "contentType": content_type,
                "cacheControl": "31536000",
                "metadata": json.dumps(_metadata(checksum, size), separators=(",", ":")),
            }
            headers = {
                **self._auth_headers,
                "Tus-Resumable": TUS_VERSION,
                "Upload-Length": str(size),
                "Upload-Metadata": ",".join(f"{key} {base64.b64encode(value.encode()).decode()}" for key, value in metadata.items()),
                "x-upsert": "false",
            }
            endpoint = self._storage_url("upload/resumable", direct=True)
            created = self.transport("POST", endpoint, headers, b"")
            if created.status not in {201, 204}:
                if created.status in {400, 409}:
                    remote = self.object_info(object_path)
                    if remote is not None:
                        self._assert_identical(remote, object_path, size, checksum)
                        return created.status
                raise SupabaseHttpError("POST", endpoint, created.status, created.body, secret=self.config.service_role_key)
            location = created.headers.get("location")
            if not location:
                raise BuildError("Supabase TUS creation response omitted the Location header.")
            session_url = urllib.parse.urljoin(endpoint, location)
            if resume_path:
                atomic_json(resume_path, {"objectPath": object_path, "sha256": checksum, "bytes": size, "uploadUrl": session_url})

        with source.open("rb") as stream:
            stream.seek(offset)
            while offset < size:
                chunk = stream.read(TUS_CHUNK_BYTES)
                headers = {
                    **self._auth_headers,
                    "Tus-Resumable": TUS_VERSION,
                    "Upload-Offset": str(offset),
                    "Content-Type": "application/offset+octet-stream",
                    "Content-Length": str(len(chunk)),
                }
                patched = self.transport("PATCH", session_url, headers, chunk)
                if patched.status not in {204}:
                    raise SupabaseHttpError("PATCH", session_url, patched.status, patched.body, secret=self.config.service_role_key)
                returned_offset = int(patched.headers.get("upload-offset", str(offset + len(chunk))))
                if returned_offset != offset + len(chunk):
                    raise BuildError(f"Supabase TUS offset mismatch: expected {offset + len(chunk)}, got {returned_offset}.")
                offset = returned_offset
        if resume_path:
            resume_path.unlink(missing_ok=True)
        return 204

    @staticmethod
    def _assert_identical(remote: dict[str, Any], object_path: str, size: int, checksum: str) -> None:
        metadata = remote.get("metadata") or {}
        user_metadata = remote.get("user_metadata") or remote.get("userMetadata") or {}
        remote_size = remote.get("size", metadata.get("size", metadata.get("contentLength")))
        remote_hash = user_metadata.get("sha256") or metadata.get("sha256")
        if int(remote_size or -1) != size or str(remote_hash or "").casefold() != checksum.casefold():
            raise BuildError(
                f"Immutable object collision for {object_path}: remote bytes/SHA-256 "
                f"({remote_size}, {remote_hash or 'missing'}) differ from local ({size}, {checksum})."
            )

    def _verified_result(self, object_path: str, remote: dict[str, Any], checksum: str, method: str, status: int, duration: float, range_status: int | None) -> dict[str, Any]:
        metadata = remote.get("metadata") or {}
        return {
            "available": True,
            "objectPath": object_path,
            "url": self.public_url(object_path),
            "bytes": int(remote.get("size", metadata.get("size", metadata.get("contentLength", 0)))),
            "sha256": checksum,
            "method": method,
            "httpStatus": status,
            "durationSeconds": round(duration, 3),
            "verifiedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "rangeCompatible": True,
            "rangeHttpStatus": range_status,
            "contentType": metadata.get("mimetype") or metadata.get("contentType"),
            "cacheControl": remote.get("cache_control") or remote.get("cacheControl") or metadata.get("cacheControl"),
        }


def publish_release(root: Path, release: str, config: SupabaseConfig, *, state_codes: list[str] | None = None, transport: Transport | None = None) -> dict[str, Any]:
    """Publish all selected locally valid artifacts, then an immutable manifest."""
    from app.pipeline.osm_state import resolve_state

    manifest_path = root / "releases" / release / "manifest.json"
    if not manifest_path.exists():
        raise BuildError(f"Release manifest does not exist: {manifest_path}")
    local_validation = validate_release(root, release)
    if not local_validation.get("valid"):
        raise BuildError("Release manifest/local artifact validation failed: " + "; ".join(local_validation.get("errors", [])))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    selected = {resolve_state(code).id for code in state_codes} if state_codes else None
    publisher = SupabaseStoragePublisher(config, transport=transport)
    prefix = release_object_prefix(release)
    results: list[dict[str, Any]] = []
    upload_dir = root / "uploads" / release
    upload_dir.mkdir(parents=True, exist_ok=True)

    for state_id, state in manifest.get("states", {}).items():
        if selected is not None and state_id not in selected:
            continue
        for product in ("roadway", "poi"):
            item = state.get(product) or {}
            if not item.get("localAvailable"):
                if selected is not None:
                    results.append({"state": state_id, "product": product, "status": "unavailable"})
                continue
            artifact = manifest_path.parent / item["path"]
            validation = validate_pmtiles(artifact)
            if not validation.get("valid") or validation.get("sha256") != item.get("sha256"):
                item.update({"cloudAvailable": False, "upload": {"status": "failed", "error": "local validation/checksum failed"}})
                results.append({"state": state_id, "product": product, "status": "failed", "error": "local validation/checksum failed"})
                continue
            object_path = f"{prefix}/{state_id}/{product}.pmtiles"
            try:
                uploaded = publisher.upload_immutable(
                    artifact,
                    object_path,
                    content_type="application/vnd.pmtiles",
                    resume_path=upload_dir / f"{state_id}-{product}.json",
                )
                item.update({
                    "cloudAvailable": True,
                    "available": True,
                    "url": uploaded["url"],
                    "objectPath": object_path,
                    "upload": {"status": "verified", **uploaded},
                    "uploadVerifiedAt": uploaded["verifiedAt"],
                })
                results.append({"state": state_id, "product": product, "status": "verified", **uploaded})
            except (BuildError, OSError) as exc:
                item.update({"cloudAvailable": False, "url": None, "objectPath": object_path, "upload": {"status": "failed", "error": str(exc)}})
                results.append({"state": state_id, "product": product, "status": "failed", "error": str(exc)})
            atomic_json(manifest_path, manifest)

    # A state-filtered retry intentionally touches only those states. A full
    # release publication also includes the independently built national POI
    # archive at its own immutable object path.
    national = manifest.get("national", {}).get("poi") or {}
    if selected is None and national.get("localAvailable"):
        artifact = manifest_path.parent / national["path"]
        validation = validate_pmtiles(artifact)
        object_path = f"{prefix}/national/poi.pmtiles"
        if not validation.get("valid") or validation.get("sha256") != national.get("sha256"):
            national.update({"cloudAvailable": False, "upload": {"status": "failed", "error": "local validation/checksum failed"}})
            results.append({"state": "national", "product": "poi", "status": "failed", "error": "local validation/checksum failed"})
        else:
            try:
                uploaded = publisher.upload_immutable(
                    artifact,
                    object_path,
                    content_type="application/vnd.pmtiles",
                    resume_path=upload_dir / "national-poi.json",
                )
                national.update({
                    "cloudAvailable": True,
                    "available": True,
                    "url": uploaded["url"],
                    "objectPath": object_path,
                    "upload": {"status": "verified", **uploaded},
                    "uploadVerifiedAt": uploaded["verifiedAt"],
                })
                results.append({"state": "national", "product": "poi", "status": "verified", **uploaded})
            except (BuildError, OSError) as exc:
                national.update({"cloudAvailable": False, "url": None, "objectPath": object_path, "upload": {"status": "failed", "error": str(exc)}})
                results.append({"state": "national", "product": "poi", "status": "failed", "error": str(exc)})
        atomic_json(manifest_path, manifest)

    atomic_json(manifest_path, manifest)
    manifest_checksum = sha256_file(manifest_path)
    manifest_object_path = f"{prefix}/manifests/{manifest_checksum}.json"
    manifest_upload = publisher.upload_immutable(
        manifest_path,
        manifest_object_path,
        content_type="application/json",
        resume_path=upload_dir / "manifest.json",
    )
    summary = {
        "release": release,
        "partial": any(result["status"] != "verified" for result in results),
        "results": results,
        "manifest": {**manifest_upload, "sha256": manifest_checksum},
    }
    # Avoid claiming success in the local manifest until the manifest object itself is verified.
    manifest["cloudManifest"] = summary["manifest"]
    atomic_json(manifest_path, manifest)
    return summary


def _metadata(checksum: str, size: int) -> dict[str, Any]:
    return {"sha256": checksum, "bytes": size, "immutable": True, "rangeCompatible": True}


def _quote_path(value: str) -> str:
    return "/".join(urllib.parse.quote(part, safe="") for part in value.split("/"))
