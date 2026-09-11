# Mother Bird map experience: paper blueprint

This is a design map for the intended end product. Numbers are deliberately stable: write the same number beside the UI control, the front-end state change, the local record, and any future backend event.

## How to draw it on paper

Use four horizontal bands:

1. **Person / gesture** — what the walker taps, types, moves, hears, or encounters.
2. **Map experience** — what changes on screen.
3. **App state + local data** — what the browser remembers immediately.
4. **Backend / public network** — optional sync, public content, or asynchronous messaging.

Use solid arrows for local-first behavior and dotted arrows for optional online behavior. Put a lock around anything private. Put a bird icon around Messenger Bird. Put a star around records that may become public only after an explicit publish action.

## The central model

```text
MAP VIEW
  ├─ current viewport / region identity
  ├─ public places, events, journeys, civic content
  ├─ private places, visits, observations, drawings
  └─ active walk + geofence encounters

FIELD GUIDE (backpack)
  ├─ Discover: walks, journeys, public expansion
  ├─ Learn: stories, history, wildlife, map layers
  ├─ My Maps: personal places, layers, advanced filters
  └─ App: online, offline, sharing, backup, settings

JOURNAL
  ├─ notes, reflections, observations, photos, voice
  ├─ visit history and encounter memory
  └─ optional encrypted backup; not public by default

MESSENGER BIRD
  ├─ private asynchronous notes/messages
  ├─ walk-plan sharing and friend-walk invitations
  └─ explicit public cipher / place signal publishing
```

## Numbered event-handler map

| # | Person action / handler | Map or UI result | Immediate local state | Backend or network relationship |
|---:|---|---|---|---|
| 1 | App opens | Map shell, active region, lights, overlays appear | Load settings, profile, walks, installed region, POIs from IndexedDB and static pack | Fetch static region artifacts; no personal data required |
| 2 | Search bar input | Search results appear under the bar; local hits first, wider search second | Query is transient; selected result becomes map focus | Optional remote place search; cache result, do not make it a personal record until saved |
| 3 | Search result selected | Map flies to the place and zooms in; result becomes the current focus | Store `lastMapView` / focused place if desired | No write by default |
| 4 | Map pan or zoom | Pins, layers, neighborhood boundaries, region label, and visible results rerender | Update viewport: center, zoom, bounds; debounce expensive work | Future region resolver can read viewport and return a region identifier; do not silently change user identity or neighborhood |
| 5 | Region identity updates | Search bar subtitle/placeholder reads like `Washington, DC · Capitol Hill` or `Current area` | `activeRegionId`, viewport region, and installed pack remain distinct concepts | Read-only region lookup; user must confirm before switching installed data |
| 6 | Locate / geolocate | Map centers on the walker and shows location permission/status | Position is held in memory; during a walk it becomes a route point | Browser geolocation only; never publish raw GPS by default |
| 7 | Open Locate options | Geofence alerts, radius, and category chips are shown | Save enable/disable, radius, categories to `settings` | No backend write |
| 8 | Start walk | Start control becomes End walk; route line, companion, and walk status activate | Create active walk; start geolocation watch; append quality-filtered points | Local walk record only; optional future encrypted backup, never live location by default |
| 9 | Position update while walking | Route line advances; distance/time/status update | Validate accuracy/speed; append point; check nearby POIs/geofences | Local event stream; aggregate walk stats may sync only if user opts in |
| 10 | Geofence encounter | Gentle prompt: “You’re near …”; offer history, journal, observe, or dismiss | Record encounter/visit and suppress repeat prompts | No public post; a future public cipher may reference the place without exposing the route |
| 11 | End walk | Summary/reflection prompt; route remains viewable in journal/history | Persist walk, points, totals, encounters; update profile; archive refresh | Optional encrypted cloud backup; no raw route sharing unless explicitly exported/shared |
| 12 | Tap a public pin / event / journey stop | Place card opens with source, details, route option, journal option | Record focus only; “visited” or “remember” requires explicit action | Public content came from static release/Supabase catalogue; user actions remain local unless shared |
| 13 | Add Location / Places + | Map-center pin mode or form opens; user confirms name/category | Save personal place with coordinates and privacy state | Private local record; future share creates a separate derivative payload |
| 14 | Draw on map | Pencil mode, line/area, save/cancel affordances | Save drawing as a private moment | No backend write by default |
| 15 | Journal open / note typing | Journal sheet expands; word count and context update | Debounced save to `moments`; attach walk/place/region context | Local source of truth; optional encrypted snapshot only |
| 16 | Observe / photo / voice / transcribe | Observation form, camera/file, microphone, or speech transcription | Save observation, photo, voice note, and tags locally; attach to moment/place/walk | No public sync by default; explicit share creates sanitized artifact |
| 17 | Open Field Guide backpack | One container replaces a right-side tool pile; tabs/dropdown reveal product areas | Persist selected tab and layer preferences | Mostly local; tab content can load public regional artifacts |
| 18 | Field Guide → Discover → Walk this | Walk sketch card appears; stops and reason shown; user can start/send | Save pending walk plan; lock selected route/pack when started | Shareable `.walkplan` is a deliberate export; no personal journal content |
| 19 | Field Guide → Learn | Stories, history, wildlife, and map lenses open or highlight on map | Save read/star/layer preferences locally | Read public source-backed content; no personal data sent |
| 20 | Field Guide → My Maps | Personal places and map layers are managed in one place | Save categories, layer toggles, installed-region choices | Local package/catalogue operations; optional public pack downloads |
| 21 | Field Guide → App → Offline | Install, verify, or save offline region/view controls | Store region package, PMTiles/graph, checksums, offline settings | Download public artifacts; no journal upload |
| 22 | Field Guide → App → Share / import | QR/file/share panels open; user chooses payload and merge mode | Export/import journal, places, walk plan, map seal, or region addition | Device-to-device transfer; never silently includes private journal data |
| 23 | Messenger Bird: send a private note | Bird inbox/outbox and delivery state appear; map context can be attached | Queue message locally with recipient, thread, place/plan reference, and delivery status | New Supabase async messaging tables/function; RLS by sender/recipient; no raw GPS unless explicitly attached |
| 24 | Messenger Bird: receive / open | Quiet inbox indicator; message opens as a card, not a map takeover | Cache message, read state, reply draft | Supabase Realtime or polling; server stores message envelope and explicit attachments |
| 25 | Messenger Bird: share walk plan / invite friend walk | Recipient sees plan or invite; both can accept/decline | Store invite token, local participant state, notes | Supabase coordination layer; live location is opt-in, time-bounded, and revocable |
| 26 | Cipher / public expansion publish | User reviews a redacted cipher/place signal before publishing | Create a public candidate separate from the private source journal item | Backend moderation/public table; publish only sanitized text, coarse place, provenance, and consent |
| 27 | Friend reply or public response | Thread, reaction, or response appears attached to the right place/plan | Local notification/read state; never mutate journal silently | Async backend event; all writes authorized by RLS and auditable |

## Consolidation decisions before visual design

### Replace the region selector with a location-aware search header

Preferred mental model:

```text
[ search icon  Place, trail, wildlife                         ]
                  Washington, DC · current map area
```

The map viewport determines the *suggested* region label. The user’s explicit choice determines the *active installed pack*. Keep those as two fields:

- `viewportRegion`: where the map is looking now.
- `activePack`: which data package powers the map offline.

This prevents a pan across a county boundary from unexpectedly switching data, breaking a walk, or changing the user’s self-described neighborhood.

### Put tools in the Field Guide backpack

Keep only the high-frequency actions on the map surface:

- Search
- Locate
- Start/End walk
- Journal
- One contextual “+” action

Move layers, advanced filters, offline/install, sharing, costumes, backups, and region/package management into Field Guide. Audio can remain a map action only if “leave/hear a message here” is a core loop; otherwise it belongs under Messenger Bird.

### Make the map a context engine, not the database

The map should emit context: viewport, focused place, active walk, current coarse region, and encounter. Journaling, ciphers, and messaging consume that context through explicit actions. They should not directly share private records with one another.

```text
map context → journal attachment (private)
map context → cipher draft (private review)
map context → message attachment (recipient-selected)
public source pack → map / Discover / Learn
private journal → none, unless export, encrypted backup, or explicit publish
```

## Suggested backend domain boundaries

Keep these as separate domains even if they share Supabase:

1. **Public geography/content:** regions, POIs, events, journeys, provenance, release manifests.
2. **Identity/preferences:** auth, profile, settings, entitlements, installed-pack catalogue.
3. **Private journal:** moments, observations, media metadata, walks, visits, drawings. Local first; encrypted backup optional.
4. **Messaging:** conversations, participants, messages, attachments, delivery/read state, expiry.
5. **Public expansion:** cipher drafts, moderation state, published signals, source attribution, consent receipts.

Do not use one generic `events` table for all five. “Event” should mean a user or system occurrence in the interaction model; storage entities should preserve privacy and ownership boundaries.

## The end-to-end story to draw largest on the paper

```text
1 Search / pan map
  → 2 region label updates
  → 3 focus a public place
  → 4 start walk
  → 5 geolocate + track
  → 6 geofence encounter
  → 7 journal / observe / hear or leave a bird
  → 8 end walk + reflection
  → 9 optionally send privately
  → 10 optionally redact and publish a cipher
  → 11 public expansion returns to Discover / map
```

The key design principle is that one experience can have many downstream meanings, but only explicit user actions cross boundaries: encounter does not equal publication, journal attachment does not equal message, and message attachment does not equal public map content.

## Current versus final

- **Already represented in the code:** local-first map startup, search, Locate, geofence settings, Start/End walk, POI encounters, Journal, observations, voice notes, Draw, personal places, Field Guide, Discover/Learn/My Maps/App areas, walk-plan sharing, region packages, encrypted cloud journal backup.
- **Needs consolidation:** viewport-driven region label in the search header, explicit separation of `viewportRegion` and `activePack`, a single Field Guide navigation model, consistent contextual attachment model, and a clear distinction between Audio/ciphers and Messenger Bird.
- **Needs new product/backend work:** asynchronous Supabase messaging, conversation/inbox UI, recipient permissions, delivery/read state, expiring friend-walk coordination, redaction/review before public cipher publication, moderation, and public expansion ingestion.
