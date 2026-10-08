# Repository workflow

## Default publishing policy

Static repository artifacts and GitHub Pages are the default path for all app data, source catalogues, regional releases, and review outputs. Supabase is optional and operator-controlled only; agents must not invoke Supabase, Supabase Storage, Supabase approval tables, or Supabase credentials unless the user explicitly requests a Supabase operation in the current task.

An agent must never block a static build or local release because Supabase is absent. When Supabase is not explicitly requested, write validated artifacts to the repository's normal `published/`, `releases/`, `motherbird/data/`, or Pages build outputs, and label their provenance and publication state clearly. Never move records to a live/remote state merely because a Supabase variable happens to exist in `.env`.

The optional Supabase path remains available for a human operator who deliberately chooses authenticated profiles, remote sync, approval persistence, or object storage. Keep its code and documentation separate from the default static workflow.

## Live Pages and deployment verification

- The canonical live GitHub Pages URL for the Motherbird UI is https://sethryst.github.io/discover_walks/ (the app is served from the repository root; do not append `/motherbird/`).
- When changing deployed Motherbird CSS, JavaScript, HTML, or service-worker behavior, bump the relevant asset query versions and the `APP_CACHE` version in `motherbird/service-worker.js` so GitHub Pages and existing clients cannot keep serving stale UI code; verify the refreshed live URL after deployment.
- Before changing a deployed UI, inspect the currently live GitHub Pages deployment to understand the actual rendered behavior and distinguish stale deployment state from source behavior.
- After making a UI change, run or open a test version and verify the requested behavior there before treating the change as complete.
- After pushing a UI change, wait 3 minutes before checking the live GitHub Pages deployment. Use that time to finish other scoped checks or changes first; do not treat an early cached response as deployment verification.
- Push the changes made for the request to GitHub so the Pages deployment can update and development can continue from the same published state.
- Preserve unrelated worktree changes; stage and commit only files belonging to the current request.
