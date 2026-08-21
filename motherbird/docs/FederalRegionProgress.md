# Federal Region POI Progress

`npm run tag:federal-pois` is the producer-time retagging command. It loads only canonical TIGER geometries, assigns each app POI its state, county/county-equivalent, and current-Congress district identity, and rewrites the source package atomically.

Each tagged POI receives `federalRegions`:

```json
{
  "state": "us-state:51",
  "county": "us-county:51:059",
  "congressionalDistrict": "us-cd:119:51:11",
  "congress": 119,
  "boundaryVintage": "119th-congress"
}
```

The same run creates `data/federal-region-poi-progress.json`, a small checked-in index mapping each federal ID to its eligible POI IDs. Runtime publishing copies it beside the federal display shards. This keeps progress counting local and avoids loading or spatially joining every POI in the browser.

Visits are local-profile data. Existing history discoveries are migrated into `visitedPoiIds`; all regular POI popups offer **Mark visited**. The overlay intersects that local set with the current region index and shows `X of Y POIs visited`. DC neighborhood labels remain the visual priority, so a neighborhood center does not replace its label with a federal progress label.

When the current Congress changes: build the new federal artifact, run `npm run tag:federal-pois`, then `npm run publish:federal-regions`. The tagger fails if a present POI cannot be assigned by canonical geometry; generated supplemental packages absent from a checkout are reported and can be retagged on their producing build.
