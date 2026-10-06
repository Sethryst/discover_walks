# Biodiversity acquisition and Learn roadmap

## Recommended architecture: one source, many regional derivatives

Motherbird should use a two-tier biodiversity pipeline:

1. Acquire one canonical GBIF export for a bounded operating area such as NOVA/DMV.
2. Normalize it once, then publish small, versioned regional sidecars for Alexandria, Arlington, Fairfax, Falls Church, Loudoun, Vienna, and later regions.

This gives every regional derivative the same source vintage, taxonomic interpretation, filtering rules, and GBIF download DOI. It also avoids asking the browser to carry a national occurrence archive. A national warehouse can be added later, but it should be an operator-side source archive and processing input—not a file shipped to every walker.

The public pipeline is:

```text
GBIF download → raw Darwin Core archive → normalization/privacy filter
→ regional grid × species × month aggregates → Field Guide → Learn
```

The raw archive belongs outside the Pages build. Keep its query, checksum, download date, DOI, and normalizer version in an operator-controlled release record. Publish only the derived records needed by the app.

The production envelope is the existing Alexandria regional envelope (`-77.145,38.786` to `-77.037,38.845`), versioned as `alexandria-va-boundary-v1`. Public aggregates use a 0.01° grid and reject observations with coordinate uncertainty above 1,000 m. The exact GBIF request is checked in at `regions/alexandria-va/biodiversity/gbif-download-request.json`.

Submit that request through the GBIF website or authenticated API using the iNaturalist Research-grade Observations dataset key `50c9509d-22c7-4a22-a47d-8c48425ef4a7`. GBIF assigns the download DOI only after the asynchronous download succeeds. Record that DOI and the completion date in the release manifest; never commit a GBIF password or token.

Place the downloaded Darwin Core/SIMPLE_CSV export outside the web-published directory, run `npm run normalize:biodiversity -- input.tsv output.json alexandria-va`, then validate the output against `data-contracts/biodiversity-record.schema.json`. Audit the output’s row count, distinct occurrence IDs, aggregate counts, source DOI, image URLs/licenses, and privacy classes before replacing the fixture-backed `records.json`. Keep the fixture under a separate test filename when the production release is accepted.

The GBIF download API requires a registered GBIF user and HTTP authentication, so this repository contains the request definition but no fabricated DOI and no credentials.

## What GBIF adds beyond POIs

GBIF can provide a nature-observation layer rather than another place directory:

- species historically recorded in or near a region;
- month-by-month seasonality and phenology;
- broad organism groups such as plants, fungi, birds, insects, mammals, and amphibians;
- stable taxon IDs and taxonomic context from kingdom through species;
- observation volume as a recording signal, never as a population estimate;
- Research-grade community observations;
- representative images, sounds, media licenses, and links to source occurrences;
- privacy-aware uncertainty and geoprivacy metadata;
- comparisons between neighboring regions;
- seasonal prompts such as “what people have recorded here in October.”

These records should enrich a walk without pretending to be a complete inventory or live presence detector. No record does not mean absence, and an observation does not mean that a species is present today.

## Learn opportunity

The long-term opportunity is for Learn to become a place-based seasonal natural-history layer, not a second map of pins. A region’s Learn experience could combine:

- a short seasonal “notice this” briefing;
- a few species cards selected from the current month and active region;
- taxonomic relationships that explain how a species fits into its wider group;
- links from a species card to the underlying GBIF/iNaturalist provenance;
- image and sound credits shown at the point of use;
- comparisons between what is recorded in the selected region and nearby regions;
- prompts that help a walker observe without encouraging collection or consumption;
- a personal observation handoff to iNaturalist that remains local until the user chooses to share.

Learn should follow the same active-region rule as Discover: content is rendered from the selected regional package, and a region without a validated biodiversity release does not show the Nature experience. Selecting a region on the map is enough to browse its published Learn content; GPS is not required. GPS may improve nearby ordering, but it must not silently broaden the region or expose precise sensitive records.

## Claims and safety boundary

GBIF data can support “recorded here historically,” “recorded during this month,” and “community observations include” language. It cannot support claims that a plant is edible, poisonous, safe to harvest, abundant, present today, or legal to collect. Motherbird will not turn taxonomic identification into foraging advice. Identification is not food-safety advice, and users must never consume a plant or fungus based only on the app.

## Licensing and privacy gates

The iNaturalist Research-grade GBIF dataset is currently listed as CC BY-NC 4.0. Occurrence-data licensing and image/media licensing are separate checks. Every published image needs a source URL and usable license/rights statement; if that is unavailable, publish the species card without the image. Cite the GBIF download DOI and retain occurrence IDs for auditability.

Public derivatives must not expose exact coordinates. Apply coordinate uncertainty thresholds, exclude captive/cultivated records, preserve obscured/sensitive status without reconstructing locations, and aggregate to a coarse grid before publishing. The raw download remains an operator-side audit input.

## Rollout sequence

1. Submit one authenticated NOVA/DMV GBIF request.
2. Record the completed download DOI and source vintage.
3. Normalize and validate the canonical export once.
4. Split the validated output into regional sidecars.
5. Audit counts, occurrence IDs, privacy classes, image licenses, and DOI provenance.
6. Enable each region’s Nature tab only after its sidecar passes those gates.
7. Add seasonal Learn cards after the data release is stable.
8. Expand nationally using the same registry, sidecar, and release contract.
