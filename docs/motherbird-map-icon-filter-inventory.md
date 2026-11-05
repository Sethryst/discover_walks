# Motherbird map icon and filter inventory

Updated 2026-11-05. This is the complete source inventory, not just the categories currently populated in one region. Dynamic regional categories appear when the imported regional data contains them.

## Startup visibility

- Recreation: on by default.
- Cuisine: on by default.
- News: availability-driven; it can be enabled when news exists.
- Personal places: off by default.
- An explicitly saved user choice overrides these defaults.

## Map families and parent controls

The Explore surface groups filters into three families:

### News

- News & culture: events, civic places, and public notices.
- Events (`event`)
- Civic places (`civic`)

### Recreation

- Outdoors & Recreation: trails, walkways, parks, gardens, water, community services, and rest places.
- History Sites: history, landmarks, monuments, museums, cemeteries, and historical markers.
- Art: art and public art.
- Nature observations: birds, plants, mammals, insects, invertebrates, fungi, lichen, reptiles, amphibians, and other life.
- Sports & activities: basketball, tennis, disc golf, skate parks, sports centres, swimming pools, pitches, golf, and fitness centres.
- Places: OpenStreetMap places not claimed by another group.

Parent recreation chips:

- Routes (`__routes`)
- Nature (`park`, `nature`, `wildlife`, `water`, `water_access`, `community_garden`, `garden`, `playground`, `dog_park`, `splash_pad`, `rest`, `restrooms`, `drinking_water`, `water_fountain`, `shelter`)
- Trails (`trail`)
- Historic (`history*`)
- Volunteer (`__volunteer`)

### Cuisine

- Food & Drink: markets, restaurants, cafés, food carts, bakeries, and regional food types.

Parent cuisine chips:

- Cafés (`coffee`, `coffee_shop`, `cafe`)
- Markets (`market`, `farmers_market`, `grocery`, `supermarket`, `convenience`)
- Restaurants (`restaurant`, `fast_food`)
- Tex-Mex (`tex_mex`)

## Complete known filter tags

These are the canonical tags used by the imported POI taxonomy. Regional releases may add extra tags dynamically; those are retained rather than discarded.

### Recreation and civic/place tags

`park`, `public_art`, `recreation_center`, `water_access`, `trail`, `library`, `community_garden`, `history`, `history_landmark`, `history_monument`, `history_museum`, `history_cemetery`, `history_marker`, `wifi`, `basketball`, `tennis`, `pantry`, `nature`, `community`, `water`, `art`, `wildlife`, `playground`, `dog_park`, `splash_pad`, `disc_golf`, `skate_park`, `restrooms`, `walkway`, `scenic`, `recreation`, `garden`, `rest`, `bench`, `shelter`, `shade`, `drinking_water`, `water_fountain`, `facility`, `historic`, `museum`, `landmark`, `monument`, `cemetery`, `civic`, `sports_centre`, `swimming_pool`, `pitch`, `golf`, `fitness_centre`, `parking`, `bicycle_parking`, `bike_rack`, `waste_basket`, `trash`, `accessible_parking`, and `osm`.

`osm` is the OpenStreetMap provenance/fallback category and must remain included in the inventory even when a regional UI groups most OSM records into more meaningful categories.

### Cuisine and food/drink tags

`coffee`, `coffee_shop`, `cafe`, `market`, `farmers_market`, `grocery`, `supermarket`, `convenience`, `restaurant`, `fast_food`, `food_cart`, `bakery`, `argentinian`, `british`, `crepe`, `greek`, `latin_american`, `tea`, `turkish`, `tex_mex`, `juice`, `seafood`, `southern`, `milkshake`, `milkshakes`, `lunch`, `health_food`, `açaí`, `american`, `asian`, `bubble_tea`, `french`, `ice_cream`, `indian`, `korean`, `pasta`, `pizza`, `sandwich`, `smoothie`, `thai`, and `uyghur`.

Drink-oriented tags are `coffee`, `coffee_shop`, `cafe`, `tea`, `açaí`, `bubble_tea`, `juice`, `smoothie`, `milkshake`, and `milkshakes`. The remaining food/drink tags are food-oriented.

## Icon mapping

| Icon | Used for |
|---|---|
| `tree` | parks, nature, gardens, playgrounds, dog parks, shelters, plants |
| `walk` | trails and routes |
| `anchor` | water access |
| `droplet` | water, fountains, and drinking water |
| `eye` | wildlife |
| `building` | rest, facilities, recreation centres, landmarks |
| `bench` | benches |
| `bookmark` | history, monuments, markers |
| `book-open` | museums and libraries |
| `map-pin` | cemeteries and fallback places |
| `star` | art, public art, events, and news |
| `coffee` | cafés and coffee stops |
| `utensils` | markets, restaurants, and food/drink |
| `home` | community, facilities, pantry, and personal-style places |
| `wifi` | free Wi-Fi |
| `parking` | accessible parking |
| `bike` | bicycle parking and bike racks |
| `trash-2` | waste baskets and trash |
| `bird` | biodiversity birds |
| `paw-print` | biodiversity mammals |
| `bug` | insects and invertebrates |
| `mushroom` | fungi |
| `leaf` | lichen |
| `turtle` | reptiles and amphibians |
| `microscope` | other biodiversity observations |

## Icon assets observed in the current map audit

The last populated map audit showed `bug-taxonomy.svg`, `mushroom-taxonomy.svg`, `tree-taxonomy.svg`, and the seasonal `tree-fall.svg`, plus the historical story beacon. The map is data-dependent, so this list changes with region, zoom, viewport, and enabled families.

## Dynamic behavior

- Filter options are built from the current region's imported POI tags.
- Unknown regional tags are preserved as dynamic options instead of being dropped.
- `osm` is recognized from OSM provenance even when a POI has another meaningful category.
- Categories with no records in the active region are omitted from the rendered filter surface but remain represented here as part of the full taxonomy.
- Marker icons render directly without the former green circular marker background or white outline.
