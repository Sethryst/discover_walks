# Regional capabilities manifest

`data/regional-capabilities.json` is the generated contract between regional publishing and the Mother Bird browser. It is rebuilt by `npm run build:capabilities` and automatically refreshed at the start of `npm run build` and `npm run build:kpi`.

The manifest contains one entry for every selectable region. Each capability records:

- `status`: `furnished`, `available`, `declared-empty`, or `unavailable`;
- `delivery`: `offline` for published package artifacts or `live` for on-request services;
- `freshness`: generated time, source vintage, and the applicable freshness policy;
- `provenance`, `attribution`, and `licenseUrls`;
- `validation.status`, without turning discovery or configuration into publication evidence;
- `coverage`, including the region bounding box and record count; and
- `dependencies`, such as journeys depending on places and walking-network evidence.

The current capability IDs are `places`, `journeys`, `walkingNetwork`, `civic`, `wildlife`, `boundaries`, `learn`, and `weather`.

The publishing boundary remains explicit:

```text
Discover → Review → Approve → Publish → Manifest → Browser
```

The manifest is not a source-discovery queue and does not promote candidates. A capability becomes `furnished` only when the corresponding static artifact is present with records; `available` is reserved for declared live services such as weather. Missing or empty artifacts remain visible as `unavailable` or `declared-empty` so the browser can avoid presenting unsupported filters.

The browser loads the index through `js/regional-capabilities.js`. Map-layer availability uses the manifest as a declaration and still checks the loaded records before rendering. This keeps the manifest authoritative for product capability while preventing it from inventing data.
