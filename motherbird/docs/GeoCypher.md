# Geo Cypher prototype

Geo Cypher is a local-first Fairfax prototype for geofenced audio encounters. It deliberately proves the on-device record, encounter, playback, and signed-response loop before any public transport or moderation service is added.

## Runtime contract

- `geo_cyphers` stores audio blobs and their signed immutable manifests.
- `geo_cypher_keys` stores one non-exportable P-256 private signing key and its public JWK on the device.
- `geo_cypher_events` stores factual local events: `created`, `encountered`, `started`, and `completed`.
- A pin signs its ID, creation time, coordinates, radius, duration, MIME type, media SHA-256 digest, creator-key fingerprint, and lineage object.
- Verification recomputes both the media digest and public-key fingerprint before checking the ECDSA signature.
- A response starts recording immediately. Its lineage names the parent and root pin; no audible or timed attribution pre-roll is imposed.
- Audio is capped at two minutes and is fetched from IndexedDB only for playback.

## Prototype boundary

Pins are currently local to one browser. There is no upload, discovery API, public publishing, moderation pipeline, or background geolocation. The map center allows desktop testing; a recent device fix takes precedence. Playback stays disabled until the reference point is inside the pin radius.

This boundary is intentional. A public pilot needs a media/object-store transport, bbox metadata endpoint, removal/reporting controls, and an explicit consent model before local records are shared.

## Manual test

1. Serve `motherbird` over localhost or HTTPS and open Fairfax.
2. Use **Locate**, or pan the map to a test position.
3. Open **Audio**, select **Drop audio here**, grant microphone access, record, and stop.
4. Confirm the new card reports `signed lineage` and can play at the pin location.
5. Select **Respond**, then **Record response**. Recording begins immediately.
6. Confirm the response reports `response 1` and verifies its signed lineage.
