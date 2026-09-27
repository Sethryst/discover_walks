# Acquisition approval schema runbook

The acquisition system deliberately keeps source discovery, record selection,
package approval, and publication separate. The browser's passkey check is a
usability gate; Supabase RLS is the authorization boundary.

## Apply the schema

1. Open the configured Supabase project in the Supabase Dashboard SQL Editor.
2. Review and run [`../supabase-migration-acquisition-package-approvals.sql`](../supabase-migration-acquisition-package-approvals.sql).
3. Confirm the SQL completes without errors. It is additive and uses
   `create table if not exists` plus replaceable policies; it does not publish
   packages or modify acquisition artifacts.

## Verify the live boundary

From the repository's `motherbird` directory, run:

```powershell
node tools/audit-endpoint-registrations.mjs --live
```

The Supabase registration should report `healthVerified: 1`, and its
`acquisitionSchema` result should be `verified`, with these three tables
reported as `present`:

- `acquisition_package_approvals`
- `acquisition_package_selections`
- `acquisition_source_proposals`

The probe uses only the browser-safe publishable key and records no credential
values. A successful schema probe does not prove moderator authorization; use a
real passkey moderator session on the deployed KPI page for that final check.

## Safety boundary

Do not use a service-role key in the browser or commit it. Applying this
migration does not approve any source or package and does not publish routine
acquisition output.
