# Candidate source lifecycle

Candidate source files under `app/regions/candidates/` are not region build configurations. The production CLI only loads files directly under `app/regions/`, so a candidate cannot be acquired, cached, or exported by accident.

A candidate becomes an active source only after its exact endpoint, terms, fixture, field mapping, stable identifiers, WGS84 coordinates, authority tier, and refresh rule have been verified. Credential-backed candidates additionally require a named environment variable; credentials are never stored in the candidate file or release bundle.
