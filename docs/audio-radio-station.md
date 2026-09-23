# Retro Radio Station Concept

**Status:** Architecture direction; implementation can proceed in the browser/PWA

## Product idea

Add a retro-styled old-time radio experience for people walking, exploring physical maps, or simply moving through their day. It would provide continuous, multi-channel audio broadcasts using public-domain vintage material: news and historical dispatches, radio dramas, vintage commercials, field recordings, and ambient programming.

The experience should feel like tuning into a small family of period radio stations rather than browsing a media library. Candidate channels could be organized by era or style, for example:

- Golden Age drama
- Historical dispatches and newsreels
- Vintage commercials and station identification
- Field recordings and ambient sound

## Proposed delivery shape

The first implementation should be a browser-owned “fake radio” PWA. It does not need a live broadcast server: the illusion of a continuous station comes from a shared schedule, channel-specific track pools, deterministic selection, and client-side transitions. The experience is envisioned with:

- A Hugging Face-hosted master schedule and channel manifests
- Randomized track pools for each channel, with stable IDs and source metadata
- Simulated broadcast time so listeners joining the same channel can land in the same programmed window
- On-demand audio fetches from approved public-domain archives or Hugging Face Storage only after the user presses play
- A Web Audio playback layer for channel switching, volume, and basic playback state
- Sequential automatic playback with crossfades where supported
- Pre-cached station IDs, static, or other transition effects between tracks
- Optional text-to-audio introductions when a track has suitable metadata and the user has enabled that behavior
- IndexedDB caching for deliberate local saves, exposed through a tab-to-save button
- A walk-friendly, low-attention interface that can continue playing while the map is being explored

The schedule service and the PWA should remain separable: the dataset publishes immutable metadata and source references, while the client owns playback state, timing, transitions, and saved local audio. Liquidsoap/Icecast may remain a later option if a true shared live stream becomes valuable, but it is not part of this architecture.

## Browser broadcast model

1. Load and validate a versioned channel manifest and master schedule.
2. Derive the current simulated broadcast slot from schedule epoch, channel ID, and slot duration. Use a server-published epoch or explicit client clock policy so system-clock drift is visible and testable.
3. Select the track assigned to the slot, then resolve its on-demand audio URL. Do not download the whole pool.
4. Require a user gesture to begin playback, then maintain a small look-ahead queue for the next track and transition asset.
5. Play the current item, crossfade or use a short station-ID/static bridge, and advance the queue when playback ends.
6. Expose “save” for the currently playing track. Save the audio Blob plus a metadata snapshot, provenance, rights record, and manifest version in a dedicated radio cache store.

The client should recover from a failed source by marking that item unavailable for the session, selecting the next valid item, and keeping the station alive. It should not silently substitute unverified audio.

## Suggested metadata shape

Each track should include `id`, `channelIds`, `title`, `era`, `durationMs`, `audioUrl`, `sourceUrl`, `archiveIdentifier`, `rightsStatus`, `attribution`, `sha256` when available, and optional introduction text. A schedule slot should reference a track ID rather than duplicating the track record. Manifests need a version, generated timestamp, schedule epoch, slot duration, transition policy, and source/license revision.

IndexedDB should keep radio records separate from private journal and voice-note stores. Suggested stores are `radio_manifests`, `radio_playback_state`, `radio_saved_tracks`, and `radio_transition_assets`; saved audio should be bounded by an explicit user-visible storage policy.

## Editorial and rights boundary

“Public domain” must be verified per recording, performance, narration, underlying composition, and territory. Each item should carry provenance, source URL, rights determination, attribution requirements, duration, loudness/format metadata, and any usage restrictions before entering a playlist. Vintage commercials and broadcasts require particular care because age alone does not establish public-domain status.

## Future mobile path

After the PWA experience is proven, package it for Android with Capacitor. This is intentionally a later distribution step, not part of the first web/PWA milestone. The mobile plan should revisit background audio, media controls, network transitions, storage limits, and platform licensing when implementation begins.

## Explicit non-goals for this phase

- Do not add Liquidsoap, Icecast, or VPS infrastructure.
- Do not make the browser pretend it has a guaranteed background stream when the platform suspends a tab or blocks autoplay.
- Do not change the current map, routing, or local journal contracts to accommodate this concept prematurely.
- Do not treat a saved stream segment as available offline until rights, storage, and playback behavior are separately specified.

## Open questions

- Should stations be a Walk & Wildlife feature, a separate companion app, or both?
- Which archive sources and rights-review workflow are acceptable for the first channel?
- Is “tab-to-save” intended to save a recording, a program/bookmark, or a short local excerpt?
- What should happen when a listener loses connectivity during a live stream?
- Which channels, if any, should be geographically or route-aware?
- Where should schedule/manifests be published and versioned in the Hugging Face dataset layout?
- What is the minimum transition asset set for a compelling first channel?
