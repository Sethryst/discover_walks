import test from 'node:test';
import assert from 'node:assert/strict';
import { CITIES } from '../js/constants.js';
import { collectKpiInventory, poiMetadataKpi, renderEnrichmentHtml, renderKpiHtml } from '../tools/build-kpi-index.mjs';

test('KPI inventory reconciles the frontend and producer source contracts', async () => {
  const model = await collectKpiInventory();
  assert.equal(model.summary.selectableRegions, Object.keys(CITIES).length);
  assert.equal(model.summary.configuredEndpoints, model.sources.length);
  assert.equal(model.summary.registeredAccounts, 3);
  assert.equal(model.summary.registeredConfigured, 3);
  assert.equal(model.summary.registeredHealthy, model.endpointRegistry.registrations.filter((endpoint) => endpoint.healthStatus === 'verified').length);
  assert.equal(model.summary.registeredProducing, 0);
  assert.ok(model.endpointRegistry.registrations.every((endpoint) => endpoint.registrationEvidence.includes('Mailbox')));
  assert.equal(model.endpointRegistry.registrations.find((endpoint) => endpoint.id === 'nyc-geoclient-v2').configured, true);
  assert.equal(model.summary.producerRegions, model.configs.length);
  assert.equal(model.summary.backlogCandidates, 101);
  assert.equal(model.summary.coreReadyRegions, model.cities.filter((city) => city.missingRequiredFiles.length === 0).length);
  assert.ok(model.cities.every((city) => city.readinessScore >= 0 && city.readinessScore <= 100));
  assert.equal(model.summary.experienceModes, 3);
  assert.equal(model.summary.discoverCategories, 4);
  assert.ok(model.summary.fieldGuideSubjects >= 6);
  assert.equal(model.summary.workflowCount, model.automationJobs.length);
  assert.ok(model.sources.some((source) => source.provider === 'arcgis_feature_service'));
  assert.ok(model.sources.some((source) => source.frontend.includes('Walk')));
});

test('POI enrichment KPI makes missing narrative metadata actionable', () => {
  const bare = poiMetadataKpi({ id: 'park-1', name: 'Park', lat: 1, lng: 2, category: 'park' });
  const enriched = poiMetadataKpi({ id: 'park-2', name: 'Park', lat: 1, lng: 2, category: 'park', description: 'A riverside pause.', source: [{ name: 'City parks', url: 'https://example.gov/parks/2' }], website: 'https://example.gov/parks/2', hours: 'Dawn to dusk', amenities: ['bench'], review: { validationStatus: 'valid' }, publishingState: 'published', discoverCategory: 'explore' });
  assert.ok(bare.missing.includes('description'));
  assert.ok(bare.missing.includes('publishingState'));
  assert.ok(enriched.completeness > bare.completeness);
});

test('enrichment page supports region-level and individual POI inspection', async () => {
  const html = renderEnrichmentHtml(await collectKpiInventory());
  assert.match(html, /POI enrichment KPI/);
  assert.match(html, /Inspect each POI/);
  assert.match(html, /Narrative-ready/);
  assert.match(html, /Explicit publishing\/category fields/);
  assert.match(html, /first 250; search to narrow/);
});

test('KPI page exposes operator paths without publishing credential values', async () => {
  const model = await collectKpiInventory();
  const html = renderKpiHtml(model);
  assert.match(html, /How data reaches a walker/);
  assert.match(html, /Endpoint inventory/);
  assert.match(html, /Account-to-data pipeline/);
  assert.match(html, /Registered product/);
  assert.match(html, /Healthy.*requires a dated redacted probe/s);
  assert.match(html, /Live browser services/);
  assert.match(html, /Prioritized repair queue/);
  assert.match(html, /Product delivery progress/);
  assert.match(html, /Repository automation/);
  assert.match(html, /Google sign-in/);
  assert.match(html, /Readiness is a transparent product score/);
  assert.match(html, /id="gapFilter"/);
  assert.match(html, /id="sourceSearch"/);
  assert.match(html, /NPS_API_KEY/);
  assert.doesNotMatch(html, /service_role|serviceRole|anonKey\s*[:=]/i);
  assert.doesNotMatch(html, /OPEN_ROUTING_KEY\s*[:=]\s*[A-Za-z0-9_-]{12,}/);
});

test('KPI coverage separates core failures from missing optional enhancements', async () => {
  const model = await collectKpiInventory();
  for (const city of model.cities) {
    assert.equal(city.status === 'Core broken', city.missingRequiredFiles.length > 0);
    assert.ok(Array.isArray(city.missingOptionalFiles));
  }
  assert.equal(model.summary.p0Gaps, model.gaps.filter((gap) => gap.priority === 'P0').length);
  assert.deepEqual([...model.gaps].map((gap) => gap.priority), [...model.gaps].map((gap) => gap.priority).sort());
});
