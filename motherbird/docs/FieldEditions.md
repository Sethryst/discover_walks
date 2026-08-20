# Field Editions

A Field Edition is a bounded, installable content package for one place. It is
not a city map and it never replaces the ordinary Discover Walks experience.

## Source layout

```text
field-editions/<id>/
  field-edition.json       build configuration
  boundary.geojson         exact Polygon or MultiPolygon clip boundary
  places.json              editor-approved visible places only
  routes.json              reviewed walking routes and metadata
  stories.json             place stories and reflection prompts
  sources.json             attribution and licenses
  generated/               ignored build output
```

`npm run build:field-edition -- meadowlark-gardens --dry-run` validates the
bounded build configuration. A complete build requires Docker Desktop and
creates `generated/map.pmtiles`, the editorial files, an empty `images/`
directory, and a checksummed `manifest.json`. The build clips OSM using the
polygon—not its bounding box—and only creates tiles for configured zooms.

## Runtime

`FieldEditionLoader` discovers the edition catalogue, checks access (except
on localhost or with `?fieldEditionDev`), verifies package checksums, installs
the PMTiles archive in OPFS, stores editorial JSON in IndexedDB, and emits a
`field-edition-activated` event. A map renderer may listen for that event to
switch its tile source while the ordinary online Leaflet map remains available.

The initial Meadowlark route intentionally has no geometry. It is editorial
metadata only until its walking geometry is reviewed and packaged; this avoids
claiming offline navigation before a bounded walking graph or authoritative
route geometry exists.
