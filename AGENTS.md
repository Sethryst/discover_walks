# Repository workflow

## Live Pages and deployment verification

- The canonical live GitHub Pages URL for the Motherbird UI is https://sethryst.github.io/discover_walks/ (the app is served from the repository root; do not append `/motherbird/`).
- When changing deployed Motherbird CSS, JavaScript, HTML, or service-worker behavior, bump the relevant asset query versions and the `APP_CACHE` version in `motherbird/service-worker.js` so GitHub Pages and existing clients cannot keep serving stale UI code; verify the refreshed live URL after deployment.
- Before changing a deployed UI, inspect the currently live GitHub Pages deployment to understand the actual rendered behavior and distinguish stale deployment state from source behavior.
- After making a UI change, run or open a test version and verify the requested behavior there before treating the change as complete.
- Push the changes made for the request to GitHub so the Pages deployment can update and development can continue from the same published state.
- Preserve unrelated worktree changes; stage and commit only files belonging to the current request.
