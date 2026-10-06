# Biodiversity sidecar (static-first, phase 1)

Motherbird keeps biodiversity as a versioned regional sidecar under `regions/<region>/biodiversity/`. The browser lazy-loads it; no remote database or Supabase path is required. `data-contracts/biodiversity-record.schema.json` defines taxon, region/grid/month aggregate, uncertainty/privacy, source flags, image licensing, DOI, vintage, and boundary metadata.

`tools/normalize-biodiversity.mjs` is prepared for a GBIF download containing iNaturalist Research-grade Observations. It applies the boundary, rejects excessive uncertainty, excludes captive/cultivated observations, retains occurrence IDs and download DOI, aggregates by grid cell × species × month, and never writes exact coordinates to a public aggregate. Images retain a URL and license. The checked-in Alexandria package is explicitly fixture data, not production data.

The UI describes historical/community observations, not current-presence guarantees. It makes no edible, poisonous, harvesting, or foraging claims: identification is not food-safety advice and users must never consume a plant or fungus based only on the app. Personal encounters export locally for manual iNaturalist handoff; OAuth/JWT storage are absent and the user chooses geoprivacy. A later phase may add an opt-in Google Photos picker; it is not connected here.
