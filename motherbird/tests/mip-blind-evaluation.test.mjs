import assert from 'node:assert/strict';
import test from 'node:test';
import { BLIND_RUBRIC, createBlindPacket, generateBlindPacket, loadEvaluationPairs, validateBlindRatings } from '../tools/mip-blind-evaluation.mjs';

test('blind evaluation fixture contains ten in-bounds OD pairs', () => {
  assert.equal(loadEvaluationPairs().length, 10);
});

test('blind packet removes route identity and deterministically anonymizes candidates', () => {
  const pairs = loadEvaluationPairs();
  const results = pairs.map((pair) => ({ pairId: pair.id, candidates: [
    { id: 'direct-secret', archetype: 'direct', ok: true, durationSeconds: 600, distanceMeters: 800, explanation: 'A direct walk.' },
    { id: 'mip-secret', archetype: 'discovery', ok: true, durationSeconds: 720, distanceMeters: 950, explanation: 'Adds 150 m of a reviewed corridor.' }
  ] }));
  const first = createBlindPacket(pairs, results);
  const second = createBlindPacket(pairs, results);
  assert.deepEqual(first, second);
  assert.equal(first.blind, true);
  assert.deepEqual(first.rubric, BLIND_RUBRIC);
  assert.equal(first.cases.every((item) => item.candidates.every((candidate) => !('id' in candidate) && !('archetype' in candidate))), true);
});

test('blind ratings accept bounded rubric values and reject invalid values', () => {
  const pairs = loadEvaluationPairs();
  const packet = createBlindPacket(pairs, pairs.map((pair) => ({ pairId: pair.id, candidates: [{ ok: true, durationSeconds: 1 }] })));
  assert.equal(validateBlindRatings(packet, [{ caseId: 'od-01', preferredLabel: 'Route A', wouldChoose: 4 }]), true);
  assert.equal(validateBlindRatings(packet, [{ caseId: 'od-01', preferredLabel: 'Route A', wouldChoose: 6 }]), false);
});

test('blind packet can be generated from a real per-pair candidate callback', async () => {
  const packet = await generateBlindPacket({ generateForPair: async (pair) => [
    { id: `${pair.id}-direct`, archetype: 'direct', ok: true, durationSeconds: 600, distanceMeters: 800 },
    { id: `${pair.id}-alternative`, archetype: 'discovery', ok: true, durationSeconds: 720, distanceMeters: 950 }
  ] });
  assert.equal(packet.cases.length, 10);
  assert.equal(packet.cases.every((item) => item.status === 'ready'), true);
});
