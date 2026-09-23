# Wikimedia bulk ingestion

`scripts/ingest_wikimedia_media.py` is restartable and metadata-first. Discovery uses 50-result continuation pages; Commons metadata is fetched in ten-title batches to stay below URL limits for long filenames. Every response is cached under the run's `.cache/` directory and the run checkpoint is stored in `.checkpoint.json`.

The default target is 500 unique file pages. Rights and geographic evidence are validated before media access. Media is content-addressed by SHA-256 and completed files are skipped on retry. Requests use a descriptive User-Agent, `maxlag`, cached GETs, `Retry-After`, and exponential backoff. Media requests are sequential, keeping concurrency below Wikimedia's documented limit.

Example:

```powershell
.venv\Scripts\python.exe scripts/ingest_wikimedia_media.py `
  --query "historic theater Washington DC" `
  --limit 500 `
  --out .tmp-cache/historical-media-batch `
  --mirror-media `
  --approve-valid
```

For a broad category run, use the checked-in query set. Results are deduplicated across all categories:

```powershell
.venv\Scripts\python.exe scripts/ingest_wikimedia_media.py `
  --query-file config/wikimedia-historical-queries.json `
  --limit 500 --out .tmp-cache/historical-media-batch
```

Hugging Face publication is opt-in. `HF_TOKEN` is loaded from `.env`; set `HF_DATASET_REPO` in the process environment. Files are uploaded in bounded batches and recorded in the checkpoint:

```powershell
$env:HF_DATASET_REPO = 'sethryst/historical-media'
.venv\Scripts\python.exe scripts/ingest_wikimedia_media.py `
  --query "historic theater Washington DC" --limit 500 `
  --out .tmp-cache/historical-media-batch --mirror-media `
  --approve-valid --upload-hf --upload-batch-size 100
```

Do not commit `.tmp-cache`, tokens, or bulk media to Git. Verify the remote release index and checksums before promoting an index to Motherbird.
