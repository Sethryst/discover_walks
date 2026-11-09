# Map Filterable Icons

## Purpose

This document inventories the map markers that can be filtered in Explore. It distinguishes the visible top-level Explore controls from the detailed filters under Customize Explore. The detailed list is data-driven: a filter appears only when the active region has at least one matching place or observation, except for the Nature observation categories, which are registered as available when the Nature layer is present.

## How filtering is organized

The Explore map has three top-level public lights:

- **News**: events and civic places.
- **Rec**: outdoor places, history, art, Nature observations, sports, and other mapped places.
- **Cuisine**: food and drink places.

Opening **Customize Explore** exposes the advanced filter families. Turning off a top-level light hides its related advanced filters and markers. Turning off an individual chip hides only the matching public places or observations.

## Advanced filter families and marker icons

| Family | Filter labels or examples | Marker icon | Notes |
|---|---|---|---|
| Outdoors and Recreation | Trails, Walkways, Parks, Nature, Water, Scenic places, Recreation, Community gardens, Gardens, Playgrounds, Dog parks, Splash pads, Rest, Benches, Shelters, Shade, Restrooms, Water fountains, Community, Facilities, Libraries, Recreation centers, Pantries, Wi-Fi | Varies by tag: walking figure, tree, eye, droplet, anchor, bench, building, or home | The exact chips shown depend on tags in the active region. Several source tags intentionally collapse into one visible filter, such as garden and community garden into Community. |
| History Sites | History Sites, Landmarks, Monuments, Museums, Cemeteries, Historical Markers | Building, bookmark, open book, or map pin | History subtypes are rendered with distinct icons. |
| Art | Art | Star | Includes public art records. |
| Nature observations | Birds, Plants, Mammals, Insects, Invertebrates, Fungi, Lichen, Reptiles, Amphibians, Other life | Bird, tree, paw print, bug, mushroom, leaf, turtle, or microscope | These are open-coordinate iNaturalist observation categories. |
| Sports and Activities | Basketball, Tennis, Disc golf, Skate parks, Sports centres, Swimming pools, Pitches, Golf, Fitness centres | Category-specific icon when available; map pin fallback otherwise | These filters are available when the active regional data contains the corresponding tags. |
| News and Culture | Events, Civic places | Star for event markers; map pin or source-specific marker for civic places | News markers are also controlled by the News light. |
| Food and Drink | Food, Drink, Markets, Restaurants, Quick-service food, Cafes, Coffee shops, Food carts, Bakeries, Tea, and regional cuisine tags | Utensils or coffee cup | The visible family is consolidated into Food and Drink. Cuisine-specific tags such as Greek, Turkish, Tex Mex, Seafood, Southern, Lunch, and Health Food can be added from regional data. |
| Places | OpenStreetMap places not already grouped into another public category | Map pin | OSM provenance itself is not duplicated as a filter when a meaningful category is already available. |

## Complete filter to icon inventory

The following table expands the source tag lists. Icon names are the repository asset IDs, not guesses about appearance. `map-pin` means the renderer uses its explicit fallback because the source does not define a dedicated glyph for that tag. A filter chip can use a normalized family icon while an individual place marker uses the more specific tag icon; both behaviors are documented below.

### Top level Explore controls

| Control | Source icon ID |
|---|---|
| News | `radio` |
| Rec | `tree` |
| Cuisine | `utensils-taxonomy` |

### Quick Explore chips

| Chip | Source icon ID |
|---|---|
| Routes | `walk` |
| Nature | `tree` |
| Trails | `walk` |
| Historic | `bookmark` |
| Volunteer | `map-pin` fallback |
| Cafés | `coffee` |
| Markets | `utensils` |
| Restaurants | `utensils` |
| Tex Mex | `map-pin` fallback |

### Recreation and place filters

| Filter tag | Source label | Source icon ID |
|---|---|---|
| `trail` | Trails | `walk` |
| `walkway` | Walkways | `map-pin` fallback |
| `park` | Parks | `tree` |
| `nature` | Nature | `tree` |
| `water` | Water | `droplet` |
| `scenic` | Scenic places | `map-pin` fallback |
| `recreation` | Recreation | `map-pin` fallback |
| `community_garden` | Community | `tree` |
| `garden` | Community | `tree` |
| `playground` | Playground | `tree` |
| `dog_park` | Dog park | `tree` |
| `splash_pad` | Splash pad | `map-pin` fallback |
| `rest` | Community | `building` |
| `bench` | Benches | `bench` |
| `shelter` | Shade shelters | `tree` |
| `shade` | Shade | `map-pin` fallback |
| `restrooms` | Restrooms | `building` |
| `drinking_water` | Water fountains | `droplet` |
| `water_fountain` | Water fountains | `droplet` |
| `community` | Community | `home` |
| `facility` | Community | `home` |
| `library` | Community | `book-open` |
| `recreation_center` | Community | `building` |
| `pantry` | Community | `home` |
| `wifi` | Community | `home` |

### History, art, sports, and civic filters

| Filter tag | Source label | Source icon ID |
|---|---|---|
| `history` | History Sites | `bookmark` |
| `history_landmark` | History Sites | `building` |
| `history_monument` | History Sites | `bookmark` |
| `history_museum` | History Sites | `book-open` |
| `history_cemetery` | History Sites | `map-pin` |
| `history_marker` | History Sites | `bookmark` |
| `historic` | History Sites | `map-pin` fallback |
| `museum` | History Sites | `book-open` |
| `landmark` | History Sites | `building` |
| `monument` | History Sites | `bookmark` |
| `cemetery` | History Sites | `map-pin` |
| `art` / `public_art` | Art | `star` |
| `basketball` | Basketball | `map-pin` fallback |
| `tennis` | Tennis | `map-pin` fallback |
| `disc_golf` | Disc golf | `map-pin` fallback |
| `skate_park` | Skate park | `map-pin` fallback |
| `sports_centre` | Sports centre | `map-pin` fallback |
| `swimming_pool` | Swimming pool | `map-pin` fallback |
| `pitch` | Pitch | `map-pin` fallback |
| `golf` | Golf | `map-pin` fallback |
| `fitness_centre` | Fitness centre | `map-pin` fallback |
| `event` | Events | `star` |
| `civic` | Civic places | `map-pin` fallback |

### Nature observation filters

| Filter tag | Source label | Source icon ID |
|---|---|---|
| `biodiversity:birds` | Birds | `bird` |
| `biodiversity:plants` | Plants | `tree` |
| `biodiversity:mammals` | Mammals | `paw-print` |
| `biodiversity:insects` | Insects | `bug` |
| `biodiversity:invertebrates` | Invertebrates | `bug` |
| `biodiversity:fungi` | Fungi | `mushroom` |
| `biodiversity:lichen` | Lichen | `leaf` |
| `biodiversity:reptiles` | Reptiles | `turtle` |
| `biodiversity:amphibians` | Amphibians | `turtle` |
| `biodiversity:other` | Other life | `microscope` |

### Food and drink filters

| Filter tag | Source label | Source icon ID |
|---|---|---|
| `food` | Food | `utensils` |
| `drink` | Drink | `utensils` |
| `market` / `farmers_market` | Markets | `utensils` |
| `grocery` / `supermarket` | Markets | `utensils` |
| `restaurant` | Restaurants | `utensils` |
| `fast_food` | Quick-service food | `utensils` |
| `coffee` / `coffee_shop` / `cafe` | Coffee shops | `coffee` |
| `food_cart` | Food carts | `utensils` |
| `bakery` | Bakeries | `utensils` |
| `argentinian` | Argentinian | `utensils` |
| `british` | British | `utensils` |
| `crepe` | Crepe | `utensils` |
| `greek` | Greek | `utensils` |
| `latin_american` | Latin American | `utensils` |
| `tea` | Tea | `utensils` |
| `turkish` | Turkish | `utensils` |
| `tex_mex` | Tex Mex | `utensils` |
| `juice` | Juices | `utensils` |
| `seafood` | Seafood | `utensils` |
| `southern` | Southern | `utensils` |
| `milkshake` / `milkshakes` | Milkshakes | `utensils` |
| `lunch` | Lunch | `utensils` |
| `health_food` | Health Food | `utensils` |

### Other mapped-place filters

| Filter tag | Source label | Source icon ID |
|---|---|---|
| `osm` | Places | `map-pin` fallback |
| `parking` | Parking | `parking` |
| `accessible_parking` | Accessible parking | `parking` |
| `bicycle_parking` / `bike_rack` | Bike racks | `bike` |
| `waste_basket` / `trash` | Trash receptacles | `trash-2` |

## Other map-visible items

The map can also show routes, saved routes, personal places, drawings and annotations, civic notices, and volunteer or story content. These are controlled by separate layer or workspace controls rather than the public place-filter chips. Personal place categories can have user-selected icons, including Place, Coffee, Nature, Favorite, and Building.

## Important behavior

- Filters are regional and data-driven. A city can show fewer or more chips than this inventory.
- Several source tags share one user-facing filter and one visual treatment.
- The map can use a map-pin fallback when a regional tag has no dedicated icon.
- Turning off a parent Explore light suppresses its child filters and markers together.

## Source files

The inventory is derived from `js/layer-system.js`, `js/poi-icons.js`, and `js/constants.js`. The UI markup for Customize Explore is in `index.html`.
