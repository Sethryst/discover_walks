# Appalachian Corridor Lab upstream research · 2026-08-20

## Technical summary

The current lab route envelope is misaligned with its named Bears Den / Snickers Gap focus. Its eastern edge is -77.905, while the official Bears Den and Snickers Gap parking records are near longitude -77.854. The previously cached route-envelope centerline covers a different southern/western slice; distances of 6–13 km from those parking records to that slice must not be used for route binding.

This package pulls the authoritative centerline over the full support envelope, preserves the official parking attributes, and creates research-grade access and endpoint evidence. Nothing here is editor-signed or promotable.

## Key findings

- The route-envelope parking query remains empty; the support envelope returns 10 official parking records.
- The support-envelope centerline contains 37 features and 4487 vertices, hashed as 15a1afac18c929ee04d6552ae095b5ad85f4cb5889976ef3e6140512f34889dd.
- 17 official endpoint candidates fall within the configured 200–300 m geometric thresholds. Geometry proximity does not establish access.
- Event and volunteer parsing remains source-only.
- Source health is recorded in the matrix; primary failures require an explicit, expiring waiver.

## Scope and method

ArcGIS source geometries were requested in EPSG:4326 and clipped server-side to the explicit support envelope. Parking was ranked by named lab relevance and then geometric proximity. Connection distances use point-to-line-segment distance in a local equirectangular projection, suitable for screening at this geographic scale but not a routing engine.

## Limitations and robustness

The centerline source does not itself establish recent relocations or closures. Parking attributes do not prove current public access. Snickers Gap connection notes are supported by an official county memorandum but require current field/editor review. Other access fields remain unknown rather than inferred.

## Required next steps

1. Review the corrected support-envelope centerline and redefine the tight route envelope around the intended focus.
2. Editor-review Bears Den and Snickers Gap access, closure, and connector evidence.
3. Bind candidate windows only after at least one entry is verified.
4. Keep OSM services and event/volunteer records behind their existing health and completeness gates.

## Further questions

- Is Bears Den / Snickers Gap the intended first micro-region, or should the existing Morgan Mill slice remain a separate lab?
- Which authority owns the final current-access decision for each parking record?
- Is an official current closures feed available for this corridor?
