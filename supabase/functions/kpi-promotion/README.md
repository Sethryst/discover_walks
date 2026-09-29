# KPI promotion function

Deploy this function to the configured Supabase project and set these secrets:

- `KPI_MODERATOR_EMAIL_HASH` and/or `KPI_MODERATOR_PHONE_HASH`
- `GITHUB_WORKFLOW_TOKEN` with permission to dispatch the repository workflow
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_REF` (normally `main`)

The browser sends only the authenticated Supabase session, package ID, selected record IDs, requested lifecycle action, and optionally the Actions review run ID. The GitHub token never reaches the browser. The function dispatches `acquisition-frontend-promotion.yml`, which independently verifies package approval and selections through the Supabase RLS/service boundary. A supplied run ID makes the workflow download the exact review artifact; without one it uses the committed package path.
