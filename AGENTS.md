# Repository workflow

## Live Pages and deployment verification

- Before changing a deployed UI, inspect the currently live GitHub Pages deployment to understand the actual rendered behavior and distinguish stale deployment state from source behavior.
- After making a UI change, run or open a test version and verify the requested behavior there before treating the change as complete.
- Push the changes made for the request to GitHub so the Pages deployment can update and development can continue from the same published state.
- After pushing, refresh the live Pages site and verify that the deployed result matches the tested change. Report any deployment delay or mismatch explicitly.
- Preserve unrelated worktree changes; stage and commit only files belonging to the current request.
