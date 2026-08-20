import test from 'node:test';
import assert from 'node:assert/strict';
import { CITIES } from '../js/constants.js';
import { collectKpiInventory, renderKpiHtml } from '../tools/build-kpi-index.mjs';

test('KPI inventory reconciles the frontend and producer source contracts', async () => {
  const model = await collectKpiInventory();
  assert.equal(model.summary.selectableRegions, Object.keys(CITIES).length);
  assert.equal(model.summary.configuredEndpoints, model.sources.length);
  assert.equal(model.summary.producerRegions, model.configs.length);
  assert.equal(model.summary.backlogCandidates, 101);
  assert.equal(model.summary.coreReadyRegions, model.cities.filter((city) => city.missingRequiredFiles.length === 0).length);
  assert.ok(model.cities.every((city) => city.readinessScore >= 0 && city.readinessScore <= 100));
  assert.ok(model.sources.some((source) => source.provider === 'arcgis_feature_service'));
  assert.ok(model.sources.some((source) => source.frontend.includes('Walk')));
});

test('KPI page exposes operator paths without publishing credential values', async () => {
  const model = await collectKpiInventory();
  const html = renderKpiHtml(model);
  assert.match(html, /How data reaches a walker/);
  assert.match(html, /Endpoint inventory/);
  assert.match(html, /Live browser services/);
  assert.match(html, /Prioritized repair queue/);
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
