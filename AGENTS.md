# Repository workflow

## Default publishing policy

Static repository artifacts and GitHub Pages are the default path for all app data, source catalogues, regional releases, and review outputs. Supabase is optional and operator-controlled only; agents must not invoke Supabase, Supabase Storage, Supabase approval tables, or Supabase credentials unless the user explicitly requests a Supabase operation in the current task.

An agent must never block a static build or local release because Supabase is absent. When Supabase is not explicitly requested, write validated artifacts to the repository's normal `published/`, `releases/`, `motherbird/data/`, or Pages build outputs, and label their provenance and publication state clearly. Never move records to a live/remote state merely because a Supabase variable happens to exist in `.env`.

The optional Supabase path remains available for a human operator who deliberately chooses authenticated profiles, remote sync, approval persistence, or object storage. Keep its code and documentation separate from the default static workflow.

## Live Pages and deployment verification

- Do not run `npm test`, `npm run test:*`, `npm run test:all`, or other broad test commands unless the user explicitly asks for test execution in the current task. When tests are explicitly requested, run the narrowest relevant command first; otherwise prefer targeted syntax checks and task-specific validation.
- Prefer the narrowest read, command, test, build, and browser check that can establish the requested result. Do not repeat a successful check unless the source or external state changed.
- Do not spend time on broad repository scans when a targeted `rg` query, known file, or scoped directory is sufficient; exclude generated artifacts, vendor bundles, large data exports, and caches from searches unless they are directly in scope.
- Do not rerun dependency installation, full builds, data refreshes, network fetches, or packaging when inputs are unchanged and the task does not require them.
- Do not poll unchanged external state, check Pages before the required propagation window, or take screenshots/open a browser when source or targeted validation is sufficient.
- Do not redo work already completed by another agent, spawn overlapping or trivial delegated tasks, or delegate the critical-path step when it would delay progress. Keep delegated work bounded, independent, and read-only unless a disjoint edit scope is explicitly assigned.
- Do not make speculative fixes before reproducing or locating the failure. Separate actual regressions from stale expectations and unrelated dirty-worktree changes.
- Preserve unrelated worktree changes; inspect and stage only files belonging to the current request.
- The canonical live GitHub Pages URL for the Motherbird UI is https://sethryst.github.io/discover_walks/ (the app is served from the repository root; do not append `/motherbird/`).
- When changing deployed Motherbird CSS, JavaScript, HTML, or service-worker behavior, bump the relevant asset query versions and the `APP_CACHE` version in `motherbird/service-worker.js` so GitHub Pages and existing clients cannot keep serving stale UI code; verify the refreshed live URL after deployment.
- Before changing a deployed UI, inspect the currently live GitHub Pages deployment to understand the actual rendered behavior and distinguish stale deployment state from source behavior.
- After making a UI change, run or open a test version and verify the requested behavior there before treating the change as complete.
- After pushing a UI change, wait 4 minutes before checking the live GitHub Pages deployment. Use that time to finish other scoped checks or changes first; do not treat an early cached response as deployment verification.
- During that 4-minute propagation window, open and show the user the local test/demo version of the changed UI, and keep working on the other scoped audits, syntax checks, source reviews, and deployment preparation required by this file. Do not idle or repeatedly poll Pages; the local demo is the interim verification surface.
- While waiting for Pages propagation, use the interval for relevant non-mutating checks (tests, source/data audits, local verification, and deployment preparation). When delegation is available and the audits are bounded and independent, ask read-only helper agents to inspect for missed regressions or taxonomy/layout issues; do not delegate overlapping edits, repeat unchanged polling, or broaden the request beyond the current change.
- Push the changes made for the request to GitHub so the Pages deployment can update and development can continue from the same published state.
