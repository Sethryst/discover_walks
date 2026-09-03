# Map-first journal and sealed Online

## Runtime behavior

Launch goes directly to the map. One installed region is selected automatically;
otherwise the saved region remains selected. The first-use hints dismiss after
ten seconds, accept no pointer input, and respect reduced motion. Category colors
are shared by filters, pins, clusters, and Learn. My Places remains available when
empty. Nested categories inherit a parent's off state; advanced places are opt-in
and kept private. City incidents require a public source and reported date.

The Journal has a current page, newest-first history, counts/jump dropdown, and
Transcribe / Observe / Nearby / Record controls. Record uses the existing
`voice_notes` store and links each file by `momentId`. Legacy `journal_audio` rows
migrate locally. No new journal database or export control was added. Closing the
sheet stops capture. Web Speech creates text only and may use the browser's speech
service; it is not promised offline. Record requires browser support for genuine
`audio/mp4` or `audio/mpeg`; WebM is not mislabeled or uploaded as MP4.

Learn opens real, sourced pins immediately: closest NEWS, RECREATION, and CUISINE
when eligible pins exist, then remaining points by distance. No placeholder story
stands in for a missing NEWS point. Source links use public place/dataset URLs,
not license pages. Walking-direction text requires a planned route or explicitly
linked pack edge. Distance labels are proximity, never a drawn straight-line route.

## Before enabling Online in a deployment

Apply `supabase-migration-sealed-online.sql` to the existing Supabase project after
reviewing it. It reuses `journal_backups`; that table must have the columns used by
the existing cloud-journal implementation. Existing rows are preserved. Legacy
policies on that table are replaced with owner-only access, without a subscription
gate. New friend-walk tables hold only encrypted contents plus access metadata.
The migration has not been applied by this code change.

Supabase passkey authentication must be enabled and the account must already have
an enrolled authentication passkey or a valid session. This change does not add
account signup forms. The pinned Supabase client is loaded asynchronously so its
CDN cannot block the local map. Use HTTPS (localhost works for development).

Go online authenticates, creates a random AES-256-GCM key on the device, and wraps
it with a key derived from WebAuthn PRF output. Authentication and encryption-key
wrapping may require separate browser ceremonies. IndexedDB stores the wrap, not
the raw key. The encrypted envelope also contains the wrap for a second browser
with the same synced passkey. Unsupported PRF fails closed; there is no plaintext
or password fallback. See [WebAuthn PRF](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API/WebAuthn_extensions)
and [Supabase passkeys](https://supabase.com/docs/guides/auth/passkeys).

Default sealed classes are Walks, Journal, and Pins/drawings. Voice and offline
view conditions are off. Voice-off strips files and nested audio references.
Tiles, OPFS, authentication keys, inferred civic participation, and spatial-sync
outboxes never enter the personal blob. Activity totals no longer sync separately
in plaintext. Saves run every ten minutes only while the page is open, connected,
and unlocked. After reload, Go online unlocks again. The maximum encrypted copy is
32 MB. Concurrent copies use compare-and-swap and retry; new IDs are preserved.
Different texts for the same ID require explicit OPEN → Join same ids.

The OPEN Join selector applies only to OPEN. Add new is non-destructive. Join
same-id note text records both `[local time]` and `[saved time]` sections. Replace
pack extras only replaces county sidecars for incoming packs, never private pages.
Imports validate before a single IndexedDB transaction changes the selected stores.

## OPEN formats

File, phrase, and QR share `parseOpenPayload`:

- `walk-wildlife-plan-v1`: existing stop-ID plan, no invented path.
- Existing `walk-wildlife-filters-v1` / personal-place files: lights and local pins.
- `{ "pack_id": "fairfax-county-va", "checksum": "sha256:…" }`: area pointer.
- `{ "pack_id": "…", "place_id": "…" }` or `learn_id`: Learn pointer.
- `walk-wildlife-subset-v1`: plaintext OPEN requires `journalPagesIncluded: true`.
- `walk-wildlife-personal-seal-v1`: owner account/passkey required.
- Licensed county `additions.pois` / `additions.edges`, or existing checksummed
  county-addition files. Public named geometry only; no journal or trace fields.
- Separate `walk-wildlife-friend-invite-v1` invitations.

Phrases include `sealed`, `learn <pack_id> <place_id>`, `area <pack_id> <checksum>`,
JSON, or `walk:<base64url-json>`. QR uses BarcodeDetector; otherwise use the phrase
field. Camera capture stops when leaving Online, hiding the page, or finishing.
An absent area displays the visiting-area banner. Only the explicit Install
button uses the existing catalogue; no sender OPFS is transferred.

## Offline and friend walks

Offline preview saves `{ layers, range, zoom, pack_id }`. Offline boot applies
valid settings before paint, only to an installed pack. Missing PMTiles leaves
pack pins available without fetching a replacement county. Preview is explicit
when no local archive exists. PMTiles do not imply an installed routing graph.

A friend invitation is a bearer secret: anyone receiving the entire invite can
join with an authenticated account. Share it privately. A new random walk key is
wrapped for the owner and for the invite; it is separate from the personal key.
Each note/draw/pin is an individually sealed, append-only ticket with a unique ID.
Same-minute tickets are retained and ordered by timestamp then ID. The server
serializes ticket acceptance against End. Polling is every 15 seconds while open.
Encrypted local outbox/cache records are excluded from personal backups.

End merges tickets into each participating device with Add new only, then expires
access once every member acknowledges. Unacknowledged sessions have a 24-hour
access limit. An offline device can retain tickets it previously received, but
cannot recover unseen tickets after expiry. Expiry revokes access; it does not
physically purge database rows. Server retention cleanup is a deployment concern.
Cohort bytes enter a personal seal only after local merge and with Journal checked.

## Verification

`npm test` includes crypto round trips, PRF ceremony mocks, Voice-off exclusions,
join/replace safety, same-minute tickets, offline no-fetch behavior, real-pin Learn
ordering, category nesting, and markup checks. Browser checks cover map-first
entry, Journal, My maps, nested category controls, and Online/offline preview.

Real hardware WebAuthn, microphone, QR camera, two authenticated browsers, backend
RLS/concurrency, and a real installed county PMTiles archive still need deployment
acceptance testing. Mocks and local preview checks do not certify those flows.
