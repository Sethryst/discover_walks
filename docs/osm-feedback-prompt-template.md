# OSM feedback-to-prompt template

Use this template only after aggregating feedback. It is intentionally narrow:
it may propose a filter/tag change, a normalization change, a tile/index change,
or a UI change, but not silently change all four.

```text
You are improving the Gremlin offline/online map release {{release}}.

Evidence:
- State/equivalent: {{state}}
- H3 cells: {{h3_cells}}
- Filter: {{filter_id}} (label: {{filter_label}})
- Feedback counts: {{counts}}
- Representative reports: {{redacted_reports}}
- Current extraction selectors: {{selectors}}
- Current PMTiles metrics: {{metrics}}

Task:
{{problem_statement}}

Choose exactly one change class: extraction | normalization | tiling/indexing | UI.
Do not broaden the OSM allowlist without evidence. Preserve ODbL attribution,
release checksums, deterministic ordering, and offline behavior.

Acceptance criteria:
1. {{criterion_1}}
2. {{criterion_2}}
3. Existing Fairfax/regression tests remain green.
4. Release manifest records the changed selector/schema/tool version.

Return: proposed diff, tests, release impact, and whether human review is
required before the next national build.
```
