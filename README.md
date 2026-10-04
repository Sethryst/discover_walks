# Gremlin Lab

Gremlin Lab is a data-rich walking project with two connected but deliberately separate parts: a local-first walking experience and the tools that build its geographic knowledge.

**Try the live app:** [Walk & Wildlife on GitHub Pages](https://sethryst.github.io/discover_walks/)

## Contents

- [What is here](#what-is-here)
- [Highlights](#highlights)
- [Where Walk & Wildlife is available](#where-walk--wildlife-is-available)
- [Architecture](#architecture)
- [Routing status](#routing-status)
- [Development](#development)
- [Libraries and data](#libraries-and-data)
- [Project guides](#project-guides)
- [Project hub](#project-hub)
- [Project principles](#project-principles)
- [License](#license)

## What is here

| Directory | Purpose |
| --- | --- |
| [`motherbird/`](motherbird/) | Walk & Wildlife, a vanilla JavaScript progressive web app for exploring, planning, recording, and revisiting walks. |
| [`app/`](app/) | Python 3.12 static-pack and data-pipeline tooling for geographic, civic, and historical content. |
| [`scripts/`](scripts/) | Release, registry, routing-cell, and data-maintenance utilities. |
| [`docs/`](docs/) | Design notes, handoffs, and operational documentation. |
| [`tests/`](tests/) | Python-side pipeline and data-contract tests. |

There is no first-party HTTP API. The PWA is a browser application, not a FastAPI service.

## Highlights

- Local-first walking journal with offline-friendly maps and saved walks.
- Regional places, trails, civic information, stories, and audio encounters.
- Source-aware geographic data with provenance and validation checks.
- Browser-based pedestrian routing using compact, lazily loaded graph packages.
- Resumable routing-cell conversion and publication tooling.
- A deliberately conservative routing contract: no invented straight-line paths or unverified network connections.

## Where Walk & Wildlife is available

Walk & Wildlife currently offers **76 selectable areas** in the app. Choosing an area changes the map, the search field, and the places the app searches. The list includes cities, counties, metro areas, and a few destination communities.

### Current areas, alphabetically

Albuquerque · Alexandria · Anchorage · Ann Arbor · Arlington County · Asheville · Atlanta · Austin · Baltimore · Boston · Boise–Meridian–Old Town · Boulder · Charleston · Charlotte · Chicago · Cleveland · Columbus · Corpus Christi · Dallas–Fort Worth · Denver · Detroit · Eugene · Fairfax County · Falls Church · Flagstaff · Fort Worth · Fresno · Hartford · Honolulu · Houston · Indianapolis · Kansas City · Keystone & Summit County · Las Vegas · Lexington · Los Angeles · Loudoun County · Madison · Miami–Fort Lauderdale · Milwaukee · Minneapolis–Saint Paul · Moab · Nashville · New Orleans · New York · Newark · Norfolk · Oklahoma City · Omaha · Philadelphia · Phoenix · Pittsburgh · Portland · Portland (Maine) · Prince George’s County · Providence · Raleigh–Durham · Richmond · Salt Lake City · San Diego · San Francisco · San Francisco Bay Area · Santa Fe · Savannah · Seattle · Sedona · St. Louis · Tempe · Tucson · Washington · Wolf Trap.

### What “available” means

The 2026-10-04 regional publication batch adds El Paso, Rochester, Buffalo, Cincinnati, and Pittsburgh with validated native POI packages and separate official-page links.

- The app has a named area users can select from the locality menu.
- Search is limited to places the app can serve directly for that area; it does not mix outside web pages into the results.
- Official government, parks, events, and program pages appear separately as clearly marked external links.
- Regional place data is published as static, checkable packages with source information and validation records.
- Some areas have richer legacy or civic content than others. New packages are promoted only after their data passes the release checks; areas still waiting on evidence remain in the research queue rather than being presented as complete.

The live experience is available at [Walk & Wildlife on GitHub Pages](https://sethryst.github.io/discover_walks/). The catalogue is maintained in [`motherbird/js/constants.js`](motherbird/js/constants.js), while published regional data lives under [`motherbird/regions/`](motherbird/regions/).

## Architecture

The browser app is a static PWA. Its module graph, service worker, regional packages, and routing artifacts are built into a deployable GitHub Pages site. The data factory and routing compiler run separately, producing versioned artifacts that the browser can validate and load when needed.

The routing work is being developed in stages, beginning with Fairfax/Vienna, Virginia (ZIP 22182):

1. Compile existing pedestrian graphs into browser binaries.
2. Preserve stable edge IDs, names, and source provenance.
3. Validate snapping, route geometry, instructions, and binary integrity.
4. Add verified cross-cell continuity and bounded recovery.
5. Expand through resumable, gated national conversion.

Only cells with validated, published artifacts should be marked `routing_available`. A failed or missing route is reported honestly; the app does not draw a decorative line to imply unsupported navigation.

## Routing status

Routing is an active engineering area rather than a finished national coverage claim. Current work includes:

- production-format binary decoding;
- graph-identity-aware memory caching;
- verified OPFS persistence with quota fallback;
- timeout cancellation and bounded worker lifetime;
- boundary-transfer gap rejection;
- stable binary names, IDs, and provenance metadata;
- resumable per-cell publication with checksum and atomic-registry gates.

The focused Motherbird suite currently covers Fairfax user journeys, route truth fixtures, route objectives, and walking-cell runtime behavior. See the latest GitHub Actions status and the routing handoff documents before treating coverage as complete.

## Development

Requirements: Node.js 22 for the Motherbird toolchain and Python 3.12 for the Lab pipelines.

```powershell
cd motherbird
npm ci
npm test                 # focused browser/runtime suite
npm run test:all         # all Motherbird Node tests
npm run build            # build the GitHub Pages site into motherbird/dist
```

For Python-side work:

```powershell
python -m venv .venv
\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
python -m pytest
```

Preserve unrelated local data and working-tree changes. In particular, local routing source/cache directories may be large and are not automatically suitable for Git commits.

## Libraries and data

The browser package is intentionally lightweight and uses:

- [Leaflet](https://leafletjs.com/) for interactive maps;
- [Leaflet Geoman](https://github.com/geoman-io/leaflet-geoman) for map editing interactions;
- [Turf](https://turfjs.org/) for geographic calculations;
- [Flatbush](https://github.com/mourner/flatbush) and [RBush](https://github.com/mourner/rbush) for spatial indexing;
- browser-native Service Worker, IndexedDB, OPFS, Web Workers, and typed binary data APIs for offline behavior.

Routing and map data may include OpenStreetMap and civic/open-data sources. Each published artifact should retain its source release, checksums, and attribution requirements. Do not treat generated artifacts as a substitute for source provenance.

## Project guides

- [`motherbird/README.md`](motherbird/README.md) — product-specific app notes.
- [`app/README.md`](app/README.md) — static-pack factory notes.
- [`DOCUMENTATION.md`](DOCUMENTATION.md) — catalog of project documentation.
- [`motherbird/docs/ProductBacklog.md`](motherbird/docs/ProductBacklog.md) — canonical product backlog.
- [`HANDOFF-national-routing-tonight.md`](HANDOFF-national-routing-tonight.md) — routing handoff context.
- [`AGENTS.md`](AGENTS.md) — repository workflow and deployment rules.

## Project hub

Gremlin Lab is being developed as a living research project as well as a software project.

- [`ROADMAP.md`](ROADMAP.md) — major project chapters, release themes, and current priorities.
- [`LAB_NOTEBOOK.md`](LAB_NOTEBOOK.md) — dated experiments, discoveries, and design decisions.
- [`DOCUMENTATION.md`](DOCUMENTATION.md) — the full documentation index.
- [GitHub Issues](https://github.com/Sethryst/discover_walks/issues) — bugs, data problems, and focused research questions.

The repository’s GitHub Project is intended to organize work into backlog, active research, implementation, verification, and published states. Milestones should represent meaningful releases rather than arbitrary dates.

## Project principles

- **Local-first:** the app should remain useful with limited connectivity and make its storage behavior understandable.
- **Evidence before inference:** geographic facts, route connections, accessibility claims, and source attributions should come from inspectable data.
- **Honest navigation:** when a verified route cannot be established, the product should say so rather than draw a decorative line.
- **Small public surface:** this repository publishes a static browser app; it does not promise a hosted API or a contribution workflow.
- **Respect for source terms:** OpenStreetMap, civic data, libraries, and media keep their own licenses and attribution requirements.
- **Private by design where possible:** personal walks and local state are intended to stay in the browser unless a specific feature says otherwise.

This repository is maintained as a personal project. There is no promise of issue response, support, compatibility, or acceptance of outside changes. The source is publicly visible for transparency and evaluation, but it is not offered for reuse or outside contributions.

## License

Unless a subdirectory says otherwise, the original code and project materials in this repository are proprietary and all rights are reserved under the [repository license](LICENSE). Viewing the source does not grant permission to copy, modify, publish, distribute, sell, or reuse it in another project. Third-party libraries, map data, civic data, and historical media remain subject to their own licenses, attribution requirements, and source terms; this repository does not relicense them. Permission requests should be made to the copyright holder.

The deployed site is hosted through GitHub Pages by the repository owner. Netlify is not part of the deployment path.
## Open the project

- [Walking App](https://sethryst.github.io/discover_walks/)
- [KPI Dashboard](https://sethryst.github.io/discover_walks/kpi/)

The KPI Dashboard contains the [Source Atlas](https://sethryst.github.io/discover_walks/kpi/sources.html), a second map of the data systems, providers, and provenance behind the walking experience.
