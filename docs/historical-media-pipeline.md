# Historical-media pipeline

The offline-first pipeline in `app/pipeline/historical_media.py` accepts Wikimedia Commons records only when machine-readable compatible-license evidence, attribution, and sourced geographic evidence are present. It preserves the Commons identity, source snapshot, location statement, and append-only moderation events.

Records move through `discovered`, `candidate`, `verified`, `approved`, `suppressed`, and `rejected`. Only approved records enter a versioned compact index. Exact/address/venue locations can be pins; neighborhood/city/region locations remain approximate context and never gain invented coordinates.

The Hugging Face dataset layout is created by `write_repository_layout()` and intentionally separates metadata from media. Media mirroring must occur only after validation, using content-addressed filenames and resumable uploads. Credentials belong in the environment, never Git.

Motherbird should fetch `releases/<version>/app-index.json`, render metadata immediately, and fetch `media_url` on demand with a description/transcript fallback. Keep this archive separate from private journal/location data.

## Fixture check

```powershell
python -m pytest tests/test_historical_media.py
cd motherbird; npm test -- --test-name-pattern=historical-media
```

The next ingestion batch should use a cached Commons API response, write metadata first, validate rights/location/checksum/MIME/size, then mirror media and generate a release. Publishing and pushing remain explicit operator actions.
