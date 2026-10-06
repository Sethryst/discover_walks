# Alexandria real-data import runbook

The production envelope is the existing Alexandria regional envelope (`-77.145,38.786` to `-77.037,38.845`), versioned as `alexandria-va-boundary-v1`. Public aggregates use a 0.01° grid and reject observations with coordinate uncertainty above 1,000 m. The exact GBIF request is checked in at `regions/alexandria-va/biodiversity/gbif-download-request.json`.

Submit that request through the GBIF website or authenticated API using the iNaturalist Research-grade Observations dataset key `50c9509d-22c7-4a22-a47d-8c48425ef4a7`. GBIF assigns the download DOI only after the asynchronous download succeeds. Record that DOI and the completion date in the release manifest; never commit a GBIF password or token.

Place the downloaded Darwin Core/SIMPLE_CSV export outside the web-published directory, run `npm run normalize:biodiversity -- input.tsv output.json alexandria-va`, then validate the output against `data-contracts/biodiversity-record.schema.json`. Audit the output’s row count, distinct occurrence IDs, aggregate counts, source DOI, image URLs/licenses, and privacy classes before replacing the fixture-backed `records.json`. Keep the fixture under a separate test filename when the production release is accepted.

The GBIF download API requires a registered GBIF user and HTTP authentication, so this repository contains the request definition but no fabricated DOI and no credentials.
