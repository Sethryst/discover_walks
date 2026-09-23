# Story audio delivery and Geo Cypher privacy

## Current state

Story narration currently uses browser speech as a preview. No audio files are
downloaded on app startup. Geo Cypher is local-only: its manifests, recordings,
keys, and playback events are stored in IndexedDB. The client has no Supabase
queries for Geo Cypher and does not write Geo Cypher records to
`public_markers`.

The existing Supabase `public_markers` feature is separate community marker
functionality. It must not be used as a Geo Cypher transport.

## Click-to-load story audio plan

1. Keep the story package lightweight. Publish text, transcript, chapter order,
   duration, source metadata, freshness, and an opaque `audioAssetId`; do not
   embed audio blobs in regional JSON or precache them for every user.
2. On an explicit story/chapter play click, request a short-lived signed URL
   from a server-side story-audio endpoint. The endpoint checks that the story
   is published and returns only that chapter's asset.
3. Stream the asset through an `<audio>` element. Keep the transcript available
   before and during playback, and retain browser speech as a fallback when the
   network or asset request fails.
4. Cache only the chapter the user explicitly played, using an in-memory/object
   URL or an explicitly chosen offline-save action. Never silently download the
   whole story catalog.
5. Store audio outside public web assets, ideally in a private object bucket.
   Signed URLs should be short-lived, scoped to one asset, and never expose
   service-role credentials to the browser.
6. The editorial pipeline remains: draft narration → editor approval → speech
   synthesis → pronunciation overrides → waveform/duration metadata → publish.
   A failed synthesis must leave the story playable by transcript/browser voice.

The current Washington edition contains two local editorial packages. Their
archival clips are candidates only: each carries a source URL, proposed
license, attribution, transcript slot, duration slot, and `pending` rights
status. They remain ineligible for streaming until an editor verifies reuse
rights and a rendered chapter receives an opaque asset ID. National stories
use the same dropdown but are not fabricated when no reviewed package exists.

The original Kokoro/ONNX narration renders are a separate approval lane. The
current four-chapter render for each Washington story is marked
`approved-editorial-narration`; that approval does not approve any third-party
archival clip. This separation lets narration ship while archival candidates
remain blocked until their individual rights records are complete.

The delivery adapter is defined in `app/pipeline/story_audio_delivery.py`.
It accepts a chapter only when the story is published, the chapter is ready,
rights review is approved, and the requested URL is constrained to a short
TTL. It returns no storage key or catalog data.

## Geo Cypher rule

Geo Cypher remains private and local unless a future product decision explicitly
changes that boundary. Do not add a public Supabase table, public marker record,
public bucket, or public URL for it. The migration
`supabase-migration-private-geo-cypher.sql` conditionally enables RLS and revokes
`anon` and `authenticated` table access for any experimental Geo Cypher tables
that may exist in a deployment.

If cloud sync is ever requested, it needs a separate privacy design: explicit
recipient/room access, authenticated server mediation, private storage, signed
asset URLs, deletion/revocation, and an audit of existing data before enabling
any policy.

## Progress log

- 2026-09-23: Confirmed Geo Cypher has no Supabase integration; it is IndexedDB-only.
- 2026-09-23: Added a conditional defensive migration that prevents accidental
  anonymous/authenticated table access if experimental Geo Cypher tables exist.
- 2026-09-23: Documented click-to-load story audio and private object-storage
  requirements.
- 2026-09-23: Executed the lightweight-package slice: story chapters now carry
  explicit unpublished audio metadata (`audioStatus` and nullable
  `audioAssetId`) while keeping audio bytes out of the story package.
- 2026-09-23: Added local-story scope filtering in Explore → News stories and
  a fail-closed delivery contract for signed chapter URLs.
