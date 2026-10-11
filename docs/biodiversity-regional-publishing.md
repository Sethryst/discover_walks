# Regional biodiversity sidecars

The Motherbird Nature layer is published as static, region-specific sidecars under `motherbird/regions/<region>/biodiversity/records.json`.

## Release policy

- Vienna is `published` after the 2026-10-10 static quality review.
- Falls Church is now `published` after an exact-boundary quality review of its expanded GBIF extract.
- Smaller supported regions use substantial GBIF occurrence-search sidecars; larger regions remain labeled for the authenticated GBIF download workflow until those bulk extracts are acquired.
- All other supported app regions have a sidecar and an explicit release, freshness, and coverage label. Empty or sparse sidecars are not evidence of absence.
- Smaller regions use GBIF occurrence search (`limit=300`, with offsets bounded at `100000`). Larger regions declare the authenticated GBIF download workflow because search pagination is not sufficient for a complete extract.

## Safeguards carried by every sidecar

The normalizer filters coordinate uncertainty and boundary mismatches, excludes captive/cultivated observations, aggregates to privacy-aware grid cells, removes exact public coordinates, preserves source vintage and boundary version, and carries image-license metadata when an image is present. The static metadata records these safeguards so a release can be audited without contacting Supabase.

## User-facing behavior

Nature displays freshness and coverage badges (`Rich coverage`, `Sparse coverage`, or `Historical coverage`) from the sidecar metadata. Biodiversity categories have their own `Birds`, `Plants`, `Mammals`, `Insects & invertebrates`, `Fungi & lichens`, `Reptiles & amphibians`, and `Other life` selectors in Explore → Advanced filters; they remain default-off until a user enables them.
