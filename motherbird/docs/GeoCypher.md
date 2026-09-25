# Audio Notes (formerly Geo Cypher)

Audio Notes are local-first geofenced audio encounters. The implementation file and storage keys retain the historical Geo Cypher name for compatibility, but the product feature is private Audio Notes: recording, encounter, playback, and signed-response lineage remain on the device unless the user deliberately shares a Bird Note or attaches the note to a Room.

## Runtime contract

- `geo_cypher_manifests` stores lightweight signed immutable metadata; `geo_cypher_audio` stores blobs separately and loads them only when playback is requested. Version-12 `geo_cyphers` records migrate locally on first launch.
- `geo_cypher_keys` stores one non-exportable P-256 private signing key and its public JWK on the device.
- `geo_cypher_events` stores factual local events including `created`, `encountered`, `started`, `completed`, `dismissed`, `responded`, and `removed`.
- A pin signs its ID, creation time, coordinates, radius, duration, MIME type, media SHA-256 digest, creator-key fingerprint, and lineage object.
- Verification recomputes both the media digest and public-key fingerprint before checking the ECDSA signature.
- A response starts recording immediately. Its lineage names the parent and root pin; no audible or timed attribution pre-roll is imposed.
- Audio is capped at two minutes and is fetched from IndexedDB only for playback.
- Accountless creators are labeled **Anonymous**; the private signing key remains non-exportable on their device.
- Invalid manifests and changed media fail closed. Dismissal survives reload, and removal deletes the local manifest and audio.

## Sharing boundary

Audio Notes are not a public feed. The **Share via Bird Note** action creates a portable `.birdnote` package that another Walk & Wildlife installation can import into its own private Audio Notes. Public place-wide audio belongs to a Field Edition Room and requires explicit publication, ownership, media delivery, and moderation infrastructure.

## Local capability

Pins are currently local to one browser. There is no upload, discovery API, public publishing, moderation pipeline, or background geolocation. The map center allows desktop testing; a recent device fix takes precedence. Playback stays disabled until the reference point is inside the pin radius.

This boundary is intentional. A public pilot needs a media/object-store transport, bbox metadata endpoint, removal/reporting controls, and an explicit consent model before local records are shared.

## Manual test

1. Serve `motherbird` over localhost or HTTPS and open Fairfax.
2. Use **Locate**, or pan the map to a test position.
3. Open **Audio**, select **Drop audio here**, grant microphone access, record, and stop.
4. Confirm the new card reports `signed lineage` and can play at the pin location.
5. Select **Respond**, then **Record response**. Recording begins immediately.
6. Confirm the response reports `response 1` and verifies its signed lineage.
