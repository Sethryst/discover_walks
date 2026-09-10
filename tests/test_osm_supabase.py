import base64
import hashlib
import json
from pathlib import Path

import pytest

from app.pipeline.osm_state import BuildError
from app.pipeline.osm_supabase import (
    HttpResult,
    STANDARD_UPLOAD_MAX_BYTES,
    SupabaseConfig,
    SupabaseHttpError,
    SupabaseStoragePublisher,
    TUS_CHUNK_BYTES,
    publish_release,
)


class FakeStorage:
    def __init__(self):
        self.objects = {}
        self.sessions = {}
        self.calls = []
        self.fail_next_patch = False

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url, dict(headers), len(body or b"")))
        if "/object/info/bucket/" in url:
            path = url.split("/object/info/bucket/", 1)[1]
            item = self.objects.get(path)
            return self._info(url, item)
        if "/object/public/bucket/" in url:
            path = url.split("/object/public/bucket/", 1)[1]
            item = self.objects.get(path)
            if not item:
                return HttpResult(404, {}, b"missing", url)
            return HttpResult(206, {"content-range": f"bytes 0-7/{len(item['body'])}"}, item["body"][:8], url)
        if method == "POST" and "/object/bucket/" in url:
            path = url.split("/object/bucket/", 1)[1]
            metadata = json.loads(base64.b64decode(headers["x-metadata"]))
            if path in self.objects:
                return HttpResult(400, {}, b"Asset Already Exists", url)
            self.objects[path] = {"body": body, "user_metadata": metadata, "content_type": headers["Content-Type"]}
            return HttpResult(200, {}, b"{}", url)
        if method == "POST" and url.endswith("/upload/resumable"):
            metadata = self._tus_metadata(headers["Upload-Metadata"])
            session = f"{url}/session-{len(self.sessions) + 1}"
            self.sessions[session] = {"path": metadata["objectName"], "offset": 0, "body": bytearray(), "metadata": json.loads(metadata["metadata"]), "length": int(headers["Upload-Length"])}
            return HttpResult(201, {"location": session}, b"", url)
        if method == "HEAD" and url in self.sessions:
            return HttpResult(200, {"upload-offset": str(self.sessions[url]["offset"])}, b"", url)
        if method == "PATCH" and url in self.sessions:
            if self.fail_next_patch:
                self.fail_next_patch = False
                return HttpResult(503, {}, b"retry later", url)
            session = self.sessions[url]
            assert int(headers["Upload-Offset"]) == session["offset"]
            session["body"].extend(body)
            session["offset"] += len(body)
            if session["offset"] == session["length"]:
                self.objects[session["path"]] = {"body": bytes(session["body"]), "user_metadata": session["metadata"], "content_type": "application/vnd.pmtiles"}
            return HttpResult(204, {"upload-offset": str(session["offset"])}, b"", url)
        return HttpResult(500, {}, b"unexpected request", url)

    @staticmethod
    def _tus_metadata(header):
        return {part.split(" ", 1)[0]: base64.b64decode(part.split(" ", 1)[1]).decode() for part in header.split(",")}

    @staticmethod
    def _info(url, item):
        if not item:
            return HttpResult(404, {}, b"missing", url)
        payload = {"metadata": {"size": len(item["body"]), "mimetype": item["content_type"]}, "user_metadata": item["user_metadata"]}
        return HttpResult(200, {}, json.dumps(payload).encode(), url)


@pytest.fixture
def config():
    return SupabaseConfig("https://project.supabase.co", "test-service-key", "bucket")


def write_pmtiles(path: Path, size: int):
    path.write_bytes(b"PMTiles\x03" + b"x" * (size - 8))
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_missing_credentials_are_reported_without_values():
    with pytest.raises(BuildError, match="SUPABASE_SERVICE_ROLE_KEY"):
        SupabaseConfig.from_environment({"SUPABASE_URL": "https://example.supabase.co", "SUPABASE_STORAGE_BUCKET": "osm"})


def test_http_errors_redact_a_key_even_if_a_server_echoes_it():
    error = SupabaseHttpError("POST", "https://example.test", 401, b"bad test-service-key", secret="test-service-key")
    assert "test-service-key" not in str(error)
    assert "[REDACTED]" in str(error)


def test_standard_http_upload_is_verified_and_never_upserts(tmp_path, config):
    source = tmp_path / "small.pmtiles"
    checksum = write_pmtiles(source, 256)
    storage = FakeStorage()
    result = SupabaseStoragePublisher(config, transport=storage).upload_immutable(source, "osm/2026-09-07/us-va/poi.pmtiles", content_type="application/vnd.pmtiles")
    assert result["method"] == "standard"
    assert result["sha256"] == checksum
    assert result["rangeHttpStatus"] == 206
    post = next(call for call in storage.calls if call[0] == "POST")
    assert post[1].endswith("/storage/v1/object/bucket/osm/2026-09-07/us-va/poi.pmtiles")
    assert all(call[2].get("x-upsert") != "true" for call in storage.calls)


def test_large_upload_uses_direct_host_and_six_mib_tus_chunks(tmp_path, config):
    source = tmp_path / "large.pmtiles"
    write_pmtiles(source, STANDARD_UPLOAD_MAX_BYTES + 1)
    storage = FakeStorage()
    result = SupabaseStoragePublisher(config, transport=storage).upload_immutable(source, "osm/2026-09-07/us-va/roadway.pmtiles", content_type="application/vnd.pmtiles")
    assert result["method"] == "tus"
    creation = next(call for call in storage.calls if call[0] == "POST")
    assert "project.storage.supabase.co/storage/v1/upload/resumable" in creation[1]
    patches = [call for call in storage.calls if call[0] == "PATCH"]
    assert [call[3] for call in patches] == [TUS_CHUNK_BYTES, 1]


def test_remote_mismatch_is_an_immutable_collision(tmp_path, config):
    source = tmp_path / "artifact.pmtiles"
    write_pmtiles(source, 256)
    storage = FakeStorage()
    storage.objects["osm/x.pmtiles"] = {"body": b"different", "user_metadata": {"sha256": "bad"}, "content_type": "application/vnd.pmtiles"}
    with pytest.raises(BuildError, match="Immutable object collision"):
        SupabaseStoragePublisher(config, transport=storage).upload_immutable(source, "osm/x.pmtiles", content_type="application/vnd.pmtiles")
    assert not any(call[0] == "POST" for call in storage.calls)


def test_failed_tus_upload_can_resume_without_rebuilding(tmp_path, config):
    source = tmp_path / "large.pmtiles"
    checksum = write_pmtiles(source, STANDARD_UPLOAD_MAX_BYTES + 1)
    resume = tmp_path / "resume.json"
    storage = FakeStorage()
    storage.fail_next_patch = True
    publisher = SupabaseStoragePublisher(config, transport=storage)
    with pytest.raises(SupabaseHttpError, match="HTTP 503"):
        publisher.upload_immutable(source, "osm/retry.pmtiles", content_type="application/vnd.pmtiles", resume_path=resume)
    assert source.exists() and resume.exists()
    result = publisher.upload_immutable(source, "osm/retry.pmtiles", content_type="application/vnd.pmtiles", resume_path=resume)
    assert result["sha256"] == checksum
    assert not resume.exists()
    assert any(call[0] == "HEAD" for call in storage.calls)


def test_range_verification_failure_is_not_cloud_success(tmp_path, config):
    source = tmp_path / "artifact.pmtiles"
    write_pmtiles(source, 256)
    storage = FakeStorage()
    original = storage.__call__

    def no_range(method, url, headers, body):
        result = original(method, url, headers, body)
        if "/object/public/" in url:
            return HttpResult(200, {}, result.body, url)
        return result

    with pytest.raises(BuildError, match="range verification failed"):
        SupabaseStoragePublisher(config, transport=no_range).upload_immutable(source, "osm/no-range.pmtiles", content_type="application/vnd.pmtiles")


def test_release_manifest_tracks_verified_cloud_transition_and_partial_coverage(tmp_path, config, monkeypatch):
    release = "osm-us-2026-09-07"
    release_dir = tmp_path / "releases" / release
    artifact = release_dir / "us-va" / "roadway.pmtiles"
    artifact.parent.mkdir(parents=True)
    checksum = write_pmtiles(artifact, 256)
    manifest = {
        "release": release,
        "states": {
            "us-va": {"id": "us-va", "code": "VA", "roadway": {"localAvailable": True, "cloudAvailable": False, "path": "us-va/roadway.pmtiles", "sha256": checksum}, "poi": {"localAvailable": False, "cloudAvailable": False}},
            "us-md": {"id": "us-md", "code": "MD", "roadway": {"localAvailable": False, "cloudAvailable": False}, "poi": {"localAvailable": False, "cloudAvailable": False}},
        },
    }
    (release_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    monkeypatch.setattr("app.pipeline.osm_supabase.validate_pmtiles", lambda path: {"valid": True, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    monkeypatch.setattr("app.pipeline.osm_supabase.validate_release", lambda root, release: {"valid": True, "errors": []})
    storage = FakeStorage()
    summary = publish_release(tmp_path, release, config, state_codes=["VA", "MD"], transport=storage)
    saved = json.loads((release_dir / "manifest.json").read_text(encoding="utf-8"))
    assert saved["states"]["us-va"]["roadway"]["cloudAvailable"] is True
    assert saved["states"]["us-va"]["roadway"]["upload"]["rangeHttpStatus"] == 206
    assert saved["states"]["us-va"]["poi"]["cloudAvailable"] is False
    assert summary["partial"] is True
    assert summary["manifest"]["objectPath"].startswith("osm/2026-09-07/manifests/")


def test_failed_artifact_upload_leaves_cloud_unavailable_but_publishes_accurate_partial_manifest(tmp_path, config, monkeypatch):
    release = "osm-us-2026-09-07"
    release_dir = tmp_path / "releases" / release
    artifact = release_dir / "us-va" / "poi.pmtiles"
    artifact.parent.mkdir(parents=True)
    checksum = write_pmtiles(artifact, 256)
    manifest = {"release": release, "states": {"us-va": {"id": "us-va", "code": "VA", "roadway": {"localAvailable": False, "cloudAvailable": False}, "poi": {"localAvailable": True, "cloudAvailable": False, "path": "us-va/poi.pmtiles", "sha256": checksum}}}}
    (release_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    monkeypatch.setattr("app.pipeline.osm_supabase.validate_pmtiles", lambda path: {"valid": True, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    monkeypatch.setattr("app.pipeline.osm_supabase.validate_release", lambda root, release: {"valid": True, "errors": []})
    storage = FakeStorage()

    def fail_pmtiles_only(method, url, headers, body):
        if method == "POST" and url.endswith("poi.pmtiles"):
            return HttpResult(503, {}, b"temporary outage", url)
        return storage(method, url, headers, body)

    summary = publish_release(tmp_path, release, config, state_codes=["VA"], transport=fail_pmtiles_only)
    saved = json.loads((release_dir / "manifest.json").read_text(encoding="utf-8"))
    assert saved["states"]["us-va"]["poi"]["cloudAvailable"] is False
    assert "HTTP 503" in saved["states"]["us-va"]["poi"]["upload"]["error"]
    assert summary["partial"] is True
    assert summary["manifest"]["available"] is True


def test_full_release_publishes_national_poi_with_range_verification(tmp_path, config, monkeypatch):
    release = "osm-us-2026-09-07"
    release_dir = tmp_path / "releases" / release
    artifact = release_dir / "national" / "poi.pmtiles"
    artifact.parent.mkdir(parents=True)
    checksum = write_pmtiles(artifact, 256)
    manifest = {
        "release": release,
        "states": {},
        "national": {
            "poi": {
                "localAvailable": True,
                "cloudAvailable": False,
                "path": "national/poi.pmtiles",
                "sha256": checksum,
            }
        },
    }
    (release_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    monkeypatch.setattr("app.pipeline.osm_supabase.validate_pmtiles", lambda path: {"valid": True, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    monkeypatch.setattr("app.pipeline.osm_supabase.validate_release", lambda root, release: {"valid": True, "errors": []})

    summary = publish_release(tmp_path, release, config, transport=FakeStorage())
    saved = json.loads((release_dir / "manifest.json").read_text(encoding="utf-8"))
    national = saved["national"]["poi"]
    assert national["cloudAvailable"] is True
    assert national["objectPath"] == "osm/2026-09-07/national/poi.pmtiles"
    assert national["upload"]["rangeHttpStatus"] == 206
    assert summary["partial"] is False
    assert summary["results"][0]["state"] == "national"
