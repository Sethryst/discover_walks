import io
import json
import os
import threading
from PIL import Image
from pathlib import Path

import pandas as pd
import rasterio
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from huggingface_hub import HfApi, hf_hub_download
from huggingface_hub.utils import EntryNotFoundError, HfHubHTTPError
from rio_tiler.utils import render
from usgs_topo_tiler import tile as usgs_tile

ERAS = ("1950s", "1960s", "1970s", "1980s")
CSV_DIR = Path(os.getenv("CSV_DIR", str(Path(__file__).resolve().parent)))
HF_DATASET_REPO = os.getenv("HF_DATASET_REPO", "")
HF_MANIFEST_REPO = os.getenv("HF_MANIFEST_REPO", HF_DATASET_REPO)
HF_TOKEN = os.getenv("HF_TOKEN")
HF_CACHE_DIR = Path(os.getenv("HF_CACHE_DIR", "/tmp/historical-topo-hf-cache"))
INDEX_DIR = Path(os.getenv("INDEX_DIR", "/tmp/historical-topo-index"))
hf_api = HfApi(token=HF_TOKEN) if HF_DATASET_REPO else None
app = FastAPI(title="Historical USGS Topo Tiles")
frames: dict[str, pd.DataFrame] = {}
index_locks = {era: threading.Lock() for era in ERAS}
tile_locks: dict[str, threading.Lock] = {}

def cached_tile_path(era: str, z: int, x: int, y: int) -> str:
    return f"tiles/{era}/{z}/{x}/{y}.png"

def get_cached_tile(path: str) -> bytes | None:
    if not hf_api:
        raise HTTPException(503, "HF_DATASET_REPO is not configured")
    try:
        local = hf_hub_download(
            repo_id=HF_DATASET_REPO, repo_type="dataset", filename=path,
            token=HF_TOKEN, cache_dir=str(HF_CACHE_DIR), force_download=False,
        )
        return Path(local).read_bytes()
    except EntryNotFoundError:
        return None
    except HfHubHTTPError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            return None
        raise HTTPException(502, f"HF cache lookup failed: {exc}")

def upload_cached_tile(path: str, data: bytes) -> None:
    try:
        hf_api.upload_file(
            path_or_fileobj=data, path_in_repo=path, repo_id=HF_DATASET_REPO,
            repo_type="dataset", token=HF_TOKEN, commit_message=f"Cache {path}",
        )
    except Exception as exc:
        # A cache write must not turn a successfully rendered tile into a 5xx.
        print(f"HF cache upload failed for {path}: {exc}", flush=True)

def load_era(era: str) -> pd.DataFrame:
    if era not in ERAS:
        raise HTTPException(404, "Unknown era")
    if era not in frames:
        path = CSV_DIR / f"layer_{era}_national.csv"
        if not path.exists():
            raise HTTPException(503, f"Missing CSV: {path}")
        df = pd.read_csv(path, usecols=lambda c: c in {
            "gnis_cell_id", "map_name", "primary_state", "imprint_year", "geotiff_url",
            "westbc", "eastbc", "northbc", "southbc", "geom_wkt"
        })
        frames[era] = df
    return frames[era]

def load_manifests_at_startup() -> None:
    """Download the four small lookup CSVs once per process startup."""
    if not HF_MANIFEST_REPO:
        raise RuntimeError("HF_MANIFEST_REPO is not configured")
    for era in ERAS:
        local = hf_hub_download(
            repo_id=HF_MANIFEST_REPO,
            repo_type="dataset",
            filename=f"manifests/layer_{era}_national.csv",
            token=HF_TOKEN,
            cache_dir=str(HF_CACHE_DIR),
        )
        frames[era] = pd.read_csv(local, usecols=lambda c: c in {
            "gnis_cell_id", "map_name", "primary_state", "imprint_year", "geotiff_url",
            "westbc", "eastbc", "northbc", "southbc", "geom_wkt"
        })

@app.on_event("startup")
def startup() -> None:
    load_manifests_at_startup()

def bbox_index(era: str):
    """Return rows with bounds. If CSV lacks bounds, discover them once via COG headers."""
    df = load_era(era)
    out = INDEX_DIR / f"{era}.jsonl"
    with index_locks[era]:
        if out.exists():
            return [json.loads(x) for x in out.read_text().splitlines()]
        INDEX_DIR.mkdir(parents=True, exist_ok=True)
        rows = []
        with out.open("w", encoding="utf-8") as f:
            for rec in df.to_dict("records"):
                try:
                    if all(k in rec and pd.notna(rec[k]) for k in ("westbc", "eastbc", "northbc", "southbc")):
                        b = [float(rec[k]) for k in ("westbc", "southbc", "eastbc", "northbc")]
                    else:
                        with rasterio.open(rec["geotiff_url"]) as src:
                            b = [src.bounds.left, src.bounds.bottom, src.bounds.right, src.bounds.top]
                    item = {"url": rec["geotiff_url"], "bbox": b}
                    rows.append(item); f.write(json.dumps(item) + "\n")
                except Exception:
                    continue
        return rows

def tile_bbox(z, x, y):
    n = 2 ** z
    west = x / n * 360 - 180
    east = (x + 1) / n * 360 - 180
    import math
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return west, south, east, north

def overlaps(a, b):
    return a[0] < b[2] and a[2] > b[0] and a[1] < b[3] and a[3] > b[1]

@app.get("/health")
def health(): return {"ok": True, "eras": ERAS, "max_zoom": 13}

@app.get("/tiles/{era}/{z}/{x}/{y}.png")
def get_tile(era: str, z: int, x: int, y: int):
    if era not in ERAS or not (0 <= z <= 13) or x < 0 or y < 0 or x >= 2**z or y >= 2**z:
        raise HTTPException(404, "Unsupported era or tile coordinate")
    repo_path = cached_tile_path(era, z, x, y)
    cached = get_cached_tile(repo_path)
    if cached is not None:
        return Response(cached, media_type="image/png", headers={"Cache-Control":"public, max-age=31536000, immutable"})
    lock = tile_locks.setdefault(repo_path, threading.Lock())
    with lock:
        cached = get_cached_tile(repo_path)
        if cached is not None: return Response(cached, media_type="image/png")
        candidates = [r["url"] for r in bbox_index(era) if overlaps(tile_bbox(z, x, y), r["bbox"])]
        if not candidates:
            empty = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
            buf = io.BytesIO(); empty.save(buf, format="PNG"); data = buf.getvalue()
        else:
            # At z<=13 quad boundaries are normally subpixel; first covering source is deterministic.
            arr, mask = usgs_tile(candidates[0], x, y, z, tilesize=256)
            data = render(arr, mask, img_format="png")
        upload_cached_tile(repo_path, data)
        return Response(data, media_type="image/png", headers={"Cache-Control":"public, max-age=31536000, immutable"})
