# Quick Menu Icon Catalog

## Recommendation

The starred quick menu should use the same custom SVG icon language as the rest of Motherbird. Every star-able action should store an icon path such as `./icons/book-open.svg`; emoji and text glyphs should be treated as temporary fallbacks only.

The quick menu is best used for leaf actions, not destinations that merely open a large surface. A parent surface can have its own favorites section, while the radial menu receives only the resulting actionable shortcuts. Keep the radial list short enough to scan quickly.

## Favoriting model

Use a two-level model internally, but keep the quick-link presentation flat:

1. Parent surfaces organize actions: Explore, Walk, Journal, Workspace, Radio, and Me.
2. Leaf actions are the things people favorite: Add observation, Audio note, Build route, or Open journal.

Do not favorite `Workspace` itself. Inside Workspace, allow favorites such as Build route and Open journal. The radial menu should show only “Build route” and “Open journal”; do not add parent paths, breadcrumbs, or explanatory context to the quick-link label.

Favoriting a nested action should open the parent surface only as much as needed, then run the action. It should not strand the user on a generic Workspace landing page.

## Current actions and advised icons

| Action ID | Label | Surface | Star? | Recommended icon |
| --- | --- | --- | :---: | --- |
| `walk-draw` | Draw a route | Walk | Yes | `./icons/pencil.svg` |
| `my-workspace` | Workspace | Workspace | No | `./icons/briefcase.svg` |
| `me-companion` | Companion and Maps | Me | No | `./icons/compass.svg` |
| `me-online` | Online | Me | No | `./icons/globe.svg` |
| `me-export` | Export data | Me → Advanced | No | `./icons/download.svg` |
| `privacy` | Data & privacy | Me → Advanced | No | `./icons/lock.svg` |
| `help` | App Help & Guide | Me → Advanced | No | `./icons/info.svg` |

## Additional surfaces that should expose star-able actions

These are useful candidates to add to the shell menus or their own local action menus. They should use stable IDs so existing starred shortcuts do not break when labels change.

| Action ID | Label | Surface | Recommended icon | Notes |
| --- | --- | --- | --- | --- |
| `explore-search` | Search places | Explore | `./icons/search.svg` | Opens the map search field. High-frequency action. |
| `explore-locate` | Locate me | Explore | `./icons/navigation.svg` | Useful on every walk. |
| `walk-start` | Start walk | Walk | `./icons/walk.svg` | Primary action; can remain outside the starred list. |
| `journal-observation` | Add observation | Journal | `./icons/eye.svg` | Strong one-tap capture action. |
| `journal-audio` | Add audio note | Journal | `./icons/mic.svg` | Strong hands-busy capture action. |
| `workspace-build-route` | Build route | Workspace | `./icons/route.svg` | Favorite the operation, not Workspace. |
| `workspace-journal` | Open journal | Workspace | `./icons/book.svg` | Opens the journal directly. |

## Surfaces that should not be starred

- Close, back, resize, delete, clear, undo, and other transient controls.
- Location permission or account/authentication steps.
- Destructive actions such as replacing local data.
- Raw map layer toggles, Workspace, settings, privacy, help, search, locate, Draw, and other controls already visible in the top chrome.
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
6. Store the parent surface separately for routing, but never show it as quick-link context; the shortcut label should remain just “Build route” or “Open journal.”
