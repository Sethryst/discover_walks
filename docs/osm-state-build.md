# State OSM → PMTiles build

This is an offline data factory. It does not add a map server or change the
regional Overpass enrichment pipeline.

## Commands

The native tools are installed in Ubuntu WSL. From PowerShell at the repository
root, use the wrapper so paths and executables stay in the same environment:

```powershell
.\scripts\osm-state.ps1 preflight
.\scripts\osm-state.ps1 plan-state VA --with-poi
.\scripts\osm-state.ps1 build-state VA --no-upload
.\scripts\osm-state.ps1 build-state VA --dry-run
.\scripts\osm-state.ps1 build-poi-state VA --no-upload
.\scripts\osm-state.ps1 build-states VA FL CA
.\scripts\osm-state.ps1 build-states --missing
.\scripts\osm-state.ps1 validate-state VA
.\scripts\osm-state.ps1 validate-release
.\scripts\osm-state.ps1 generate-manifest
```

Builds default to `.gremlin-osm/`, which is ignored by Git. Use `--release` to
pin a release identifier and `--root` to move the factory workspace. A source
PBF is downloaded only for the active state and deleted after the local
artifact validates. `--keep-source` is available for deliberate debugging.

No upload occurs by default. `--no-upload` makes local-only intent explicit.
The batch publisher is enabled only by `-PublishSupabase` and reads
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET`
from the build environment. The service-role key is never logged or passed to
browser code. The bucket must already exist and be public so PMTiles can be
read by immutable public URLs with HTTP Range requests.

Small objects use the Supabase Storage object upload API without upsert. Files
larger than 6 MiB use the official TUS resumable endpoint on the direct Storage
hostname in fixed 6 MiB chunks. Upload state is retained under
`.gremlin-osm/uploads/<release>/` so an interrupted TUS session can resume.
Every object stores its local SHA-256 as custom metadata; object-info metadata,
size, checksum, and a public `bytes=0-7` request must all verify before
`cloudAvailable` becomes true. Different bytes at an existing immutable path
fail safely. See the official [standard upload](https://supabase.com/docs/guides/storage/uploads/standard-uploads),
[resumable upload](https://supabase.com/docs/guides/storage/uploads/resumable-uploads),
and [public serving](https://supabase.com/docs/guides/storage/serving/downloads)
documentation.

Large PMTiles must not be split into arbitrary byte chunks: the PMTiles header
and directory index describe one archive. If whole-state offline installation
becomes too large, generate smaller geographic polygons (for example, a
California region or county group) as independent, individually verified
PMTiles and add them as manifest products. The canonical state artifacts remain
range-readable and TUS-resumable meanwhile.

## Strict POI policy

Roadway builds never invoke POI extraction. `build-poi-state` uses an early
`osmium tags-filter` expression file containing only explicit values, then a
second Python allowlist gate. It excludes high-volume restaurants, fast food,
supermarkets, and convenience stores, caps the filtered PBF at 256 MiB, and
caps normalized candidates at 250,000. Broader food discovery remains in the
existing tiled, record-capped regional Overpass adapter.

## Dependencies

The WSL installation contains Osmium, Tippecanoe (including tile-join), the
Protomaps PMTiles CLI, and GDAL. To reproduce it on another Debian/Ubuntu host:

```bash
sudo apt-get install osmium-tool gdal-bin build-essential git golang-go libsqlite3-dev zlib1g-dev
git clone --depth 1 https://github.com/felt/tippecanoe.git
make -C tippecanoe -j2 && sudo make -C tippecanoe install
GOBIN=/usr/local/bin go install github.com/protomaps/go-pmtiles@v1.31.2
sudo ln -s /usr/local/bin/go-pmtiles /usr/local/bin/pmtiles
```

Python tests use `requirements-dev.txt`. Normal unit tests do not download a
PBF. The first dry run downloads only the small Census 2025 state-boundary
archive and derives the requested polygon and `[west, south, east, north]`
bbox from it.

## Next-state handoff

Virginia is complete. Run subsequent downloads in an ordinary PowerShell
window from the repository root, not in chat:

```powershell
# Recommended next validation set; runs sequentially and continues after a failure.
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-osm-state-batch.ps1

# Or choose states explicitly.
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-osm-state-batch.ps1 `
  -States MD,NC,FL,CA -Release osm-us-2026-09-07

# Optional: add independent POI products after each roadway build.
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-osm-state-batch.ps1 `
  -States MD,NC,FL,CA -IncludePoi -Release osm-us-2026-09-07
```

After validating with Virginia and mocked HTTP, opt into publishing explicitly:

```powershell
$env:SUPABASE_URL = 'https://<project-ref>.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY = '<build-environment secret>'
$env:SUPABASE_STORAGE_BUCKET = '<public bucket name>'
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-osm-state-batch.ps1 `
  -States MD,NC,FL,CA -IncludePoi -PublishSupabase -Release osm-us-2026-09-07
```

The release manifest is uploaded last at a checksum-addressed path under
`osm/2026-09-07/manifests/`. Put the verified manifest URL reported by the
publisher in `osmReleaseManifestUrl` in the browser-safe Supabase config. The
browser then reads public metadata and downloads products; it never uploads.

`-States MD,NC,FL,CA` and `-States MD NC FL CA` are both accepted. In
PowerShell, keep the backtick at the end of the previous line only; do not use
a Unix-style backslash for continuation.

Run states sequentially. The builder removes each successful source PBF and
intermediates before moving on, but retains failed state inputs for diagnosis.
Check that at least 10 GiB is free before each large state; California may need
substantially more because GeoJSON is larger than its compressed PBF.

The batch writes one log per state under
`.gremlin-osm/logs/osm-us-2026-09-07/`. It is resumable: rerunning the command
skips an already-valid immutable artifact. To continue every provider-supported
state after the four-state validation set:

```powershell
.\scripts\osm-state.ps1 build-states --missing --release osm-us-2026-09-07
```

After the external run, provide the state log(s) plus
`.gremlin-osm/releases/osm-us-2026-09-07/manifest.json`. Useful checks before
handoff are:

```powershell
.\scripts\osm-state.ps1 validate-release --release osm-us-2026-09-07
Get-PSDrive C | Select-Object Used,Free
```

Roadway and POI are built and validated independently. A POI failure does not
invalidate a roadway artifact, and a state failure does not stop later states.
Inputs and intermediates are removed only when every requested product for that
state succeeds; failed-state inputs remain for diagnosis.
