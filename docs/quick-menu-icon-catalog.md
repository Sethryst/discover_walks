# Quick Menu Icon Catalog

## Recommendation

The starred quick menu should use the same custom SVG icon language as the rest of Motherbird. Every star-able action should store an icon path such as `./icons/book-open.svg`; emoji and text glyphs should be treated as temporary fallbacks only.

The quick menu is best used for actions, not destinations that merely open a large surface. Keep the list short enough to scan quickly, but let people star any useful action from the shell menus.

## Current actions and advised icons

| Action ID | Label | Surface | Star? | Recommended icon |
| --- | --- | --- | :---: | --- |
| `walk-field-guide` | Saved walks | Walk | Yes | `./icons/bookmark.svg` |
| `walk-draw` | Draw a route | Walk | Yes | `./icons/pencil.svg` |
| `library-field-guide` | Field Guide | Workspace | Yes | `./icons/book-open.svg` |
| `my-workspace` | Workspace | Workspace | Yes | `./icons/briefcase.svg` *(add)* |
| `me-companion` | Companion and Maps | Me | Yes | `./icons/compass.svg` |
| `me-online` | Online | Me | Optional | `./icons/globe.svg` |
| `me-export` | Export data | Me → Advanced | Optional | `./icons/download.svg` |
| `privacy` | Data & privacy | Me → Advanced | No by default | `./icons/lock.svg` *(add)* |
| `help` | App Help & Guide | Me → Advanced | No by default | `./icons/info.svg` |

## Additional surfaces that should expose star-able actions

These are useful candidates to add to the shell menus or their own local action menus. They should use stable IDs so existing starred shortcuts do not break when labels change.

| Action ID | Label | Surface | Recommended icon | Notes |
| --- | --- | --- | --- | --- |
| `explore-search` | Search places | Explore | `./icons/search.svg` | Opens the map search field. High-frequency action. |
| `explore-locate` | Locate me | Explore | `./icons/navigation.svg` | Useful on every walk; should remain one tap. |
| `explore-radio` | Open Radio | Explore | `./icons/music.svg` | Existing quick link; good star candidate. |
| `explore-draw` | Open Draw | Explore | `./icons/pencil.svg` | Existing quick link; same action as `walk-draw` if behavior is unified. |
| `explore-layers` | Map layers | Explore | `./icons/layers.svg` | Opens layer controls without making it a permanent top-level control. |
| `explore-nature` | Nature guide | Explore | `./icons/tree.svg` | Opens the regional biodiversity surface. |
| `walk-start` | Start walk | Walk | `./icons/walk.svg` | The primary radial action should not need starring, but can be a recoverable shortcut. |
| `walk-pause` | Pause walk | Active walk | `./icons/pause.svg` *(add)* | State-dependent; replace the label and icon while recording. |
| `walk-end` | End walk | Active walk | `./icons/check-circle.svg` | State-dependent; keep behind a confirmation if exposed outside the radial control. |
| `workspace-new-walk` | Build a route | Workspace | `./icons/route.svg` | High-value Workspace action. |
| `workspace-journal` | Journal | Workspace | `./icons/book.svg` | Opens the journal room, not the whole Workspace. |
| `workspace-annotate` | Annotations | Workspace | `./icons/pencil.svg` | Opens Draw/annotation tools. |
| `workspace-learn` | Learn | Workspace | `./icons/award.svg` | Opens the field guide learning surface. |
| `journal-observation` | Add observation | Journal | `./icons/eye.svg` | Strong candidate for a one-tap quick action. |
| `journal-photo` | Add photo note | Journal | `./icons/camera.svg` | Strong candidate when camera capture is available. |
| `journal-audio` | Add audio note | Journal | `./icons/mic.svg` | Strong candidate for hands-busy walking. |
| `journal-share` | Share a walk | Journal / Workspace | `./icons/share-2.svg` | Keep sharing explicit and never auto-share. |
| `nature-nearby` | Nature near me | Nature | `./icons/tree.svg` | Opens nearby records using the existing privacy-safe location flow. |
| `radio-play` | Play Radio | Radio | `./icons/music.svg` | State-dependent; use `pause.svg` while playing. |
| `backup-export` | Export backup | Backup | `./icons/download.svg` | Useful but lower priority; place under Me by default. |

## Surfaces that should not be starred

- Close, back, resize, delete, clear, undo, and other transient controls.
- Location permission or account/authentication steps.
- Destructive actions such as replacing local data.
- Raw map layer toggles; star the “Map layers” surface instead.
- A specific place or event card unless it is converted into a durable saved record.

## Icon additions needed

The existing icon set covers most recommendations. Add these custom SVGs before wiring the new actions:

- `briefcase.svg` — Workspace destination.
- `lock.svg` — Privacy and local data controls.
- `pause.svg` — Pause/resume state.
- `stop.svg` — Optional explicit end-walk state if the check icon is not sufficient.
- `radio.svg` — Dedicated radio identity instead of recoloring `music.svg`.

## Implementation guardrails

1. Keep the canonical action registry in one module and derive shell rows and radial items from it.
2. Persist `id`, `label`, and `icon`; never persist executable functions in IndexedDB.
3. Use SVG paths for all new entries and retain the current text/emoji fallback only for old user data.
4. Cap the visible radial menu at 6–8 starred actions and provide a clear “Manage starred actions” route.
5. If an action is state-dependent, preserve its stable ID and update only its current label/icon at render time.
