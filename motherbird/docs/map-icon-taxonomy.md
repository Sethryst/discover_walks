# Map Icon Taxonomy

## Purpose

The public map uses three domains to keep the Explore surface understandable:

- **Rec** for recreation, nature, history, art, sports, amenities, and general places.
- **News** for events, civic places, notices, and related public stories.
- **Cuisine** for food, drink, markets, cafes, restaurants, and regional food tags.

Personal places, saved routes, route previews, drawings, annotations, journal encounters, and location controls are intentionally outside this public place taxonomy. They have their own visibility and customization rules.

## Source of truth

`js/poi-icons.js` owns the shared public icon registry. `MAP_DOMAINS` defines the three top-level controls. `filterIconId()` resolves a filter ID to a safe repository asset or the explicit `map-pin` fallback.

`js/layer-system.js` owns the data-driven filter families and regional availability. It uses the shared registry for filter-chip icons and top-level domain icons. A region can expose fewer filters than the registry because options are only shown when matching source data exists.

`js/constants.js` owns the base POI tag labels, tag priority, and the legacy POI icon mappings used by marker selection. Detailed marker precedence remains deliberate: history subtypes and observation types can use a more specific glyph than their parent filter.

## Icon precedence

For a public place marker, the renderer uses this order:

1. A specific history subtype or observation taxonomy icon.
2. The canonical tag icon from the shared registry.
3. A safe `map-pin` fallback for an unknown or unsupported regional tag.

For a personal place, the user-selected collection icon and color remain authoritative. Public domain icons must never overwrite those choices.

## User customization

Map Settings stores public domain customization in `state.settings.mapSettings`:

- `domainLabels.news`, `domainLabels.recreation`, and `domainLabels.cuisine` are local display names, capped at 24 characters.
- `domainIcons.news`, `domainIcons.recreation`, and `domainIcons.cuisine` are selected from bounded lists of existing repository assets.
- The customization changes presentation only. It does not rename filter IDs, change source tags, alter saved filter payloads, or merge public places with personal collections.

The settings UI dispatches `map-domain-labels-changed`; the layer system re-renders the top-level controls and advanced filter surface without reloading the map.

## Asset coverage and follow-up

Nature observations use the authored taxonomy assets already present in the repository, including bird, paw print, bug, mushroom, leaf, turtle, and microscope variants. Existing generic gaps were filled where repository assets were available: sports use `activity`, civic places use `flag`, splash pads use `water-fountain`, scenic places use `eye`, walkways use `walk`, shade uses `tree`, and Wi-Fi uses `wifi`.

Further visual polish can add dedicated authored assets without changing filter semantics. New assets should be added to `icons/`, allow-listed in `ICON_IDS`, mapped in `ICONS`, and covered by the source-backed inventory in `docs/map-filterable-icons.md`.
