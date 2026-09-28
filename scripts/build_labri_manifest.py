"""Build the L'Abri Ideas Library radio manifest from its public catalogue page."""
from __future__ import annotations

import html
import json
import re
from pathlib import Path
from urllib.request import Request, urlopen

SOURCE_URL = "https://www.labriideaslibrary.org/"
OUTPUT = Path(__file__).resolve().parents[1] / "motherbird" / "data" / "radio" / "labri.json"
LINK_RE = re.compile(
    r'<a[^>]+href="([^\"]*drive\.google\.com/uc\?export=download&id=[^\"]+)"[^>]*>(.*?)</a>',
    re.S,
)
TAG_RE = re.compile(r"<[^>]+>")


def clean_title(value: str) -> str:
    return " ".join(html.unescape(TAG_RE.sub(" ", value)).split()).strip(" ,")


def main() -> None:
    page = urlopen(SOURCE_URL, timeout=30).read().decode("utf-8", "replace")
    tracks = []
    seen = set()
    for raw_url, raw_title in LINK_RE.findall(page):
        source_url = html.unescape(raw_url)
        if source_url in seen:
            continue
        seen.add(source_url)
        lecture_id = source_url.split("id=", 1)[1].split("&", 1)[0]
        title = clean_title(raw_title) or f"L'Abri lecture {len(tracks) + 1}"
        tracks.append(
            {
                "id": f"labri-{lecture_id}",
                "channel": "labri-ideas-library",
                "title": title,
                "genre": "Lecture",
                "sourceType": "labri-library",
                "mediaUrl": source_url,
                "sourceUrl": SOURCE_URL,
                "rightsStatus": "permissioned",
                "rightsLabel": "Permission granted by L'Abri Ideas Library",
            }
        )
    payload = {
        "id": "labri-ideas-library",
        "version": 1,
        "sourceUrl": SOURCE_URL,
        "generatedAt": "2026-09-28T00:00:00Z",
        "channels": [
            {
                "id": "labri-ideas-library",
                "name": "L'Abri Ideas Library",
                "description": "Permissioned lectures from the L'Abri Ideas Library.",
                "genre": "Lecture",
                "integration": "permissioned-program",
            }
        ],
        "tracks": tracks,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(tracks)} lectures to {OUTPUT}")


if __name__ == "__main__":
    main()
