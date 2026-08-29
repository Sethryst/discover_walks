import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addEventToWalk,
  completeWalkEvent,
  createWalkArtifact,
  createWalkEvent,
  detectTrackEvents,
  updateWalkDurations,
  walkReviewSummary
} from '../js/walk-artifact.js';

test('a walk document retains its track, lifecycle, associations, and explicit durations', () => {
  const walk = createWalkArtifact({ id: 'walk-1', city: 'fairfax', startedAt: '2026-08-29T12:00:00Z' });
  walk.points.push({ lat: 38.9, lng: -77.2, capturedAt: '2026-08-29T12:00:10Z' });
  walk.startLocation = walk.points[0];
  walk.endLocation = walk.points[0];
  walk.movingDurationSeconds = 8;
  walk.endedAt = '2026-08-29T12:01:00Z';
  walk.recordingStatus = 'stopped';
  updateWalkDurations(walk, Date.parse(walk.endedAt));
  const summary = walkReviewSummary(walk);
  assert.equal(walk.routeMode, 'tracking');
  assert.equal(walk.elapsedDurationSeconds, 60);
  assert.equal(summary.movingDurationSeconds, 8);
  assert.equal(summary.hasTrack, true);
  assert.equal(summary.pointCount, 1);
  assert.equal(walk.saved, false);
});

test('walk events move from encountered to completed without subjective interpretation', () => {
  const walk = createWalkArtifact({ id: 'walk-2', city: 'fairfax', startedAt: '2026-08-29T12:00:00Z' });
  const pause = createWalkEvent({ id: 'event-1', walkId: walk.id, type: 'pause', timestamp: '2026-08-29T12:05:00Z', location: { lat: 38.9, lng: -77.2 } });
  addEventToWalk(walk, pause);
  const completed = completeWalkEvent(pause, '2026-08-29T12:08:00Z');
  assert.equal(completed.state, 'completed');
  assert.equal(completed.durationSeconds, 180);
  assert.equal(completed.immutable, true);
  assert.equal('emotion' in completed.metadata, false);
});

test('track detection can factually mark a new area without requiring a POI', () => {
  const walk = createWalkArtifact({ id: 'walk-3', city: 'fairfax', startedAt: '2026-08-29T12:00:00Z' });
  walk.points.push(
    { lat: 38.9, lng: -77.2, capturedAt: '2026-08-29T12:00:00Z' },
    { lat: 38.9001, lng: -77.2, capturedAt: '2026-08-29T12:00:15Z' }
  );
  const detections = detectTrackEvents({
    walk,
    previousPoint: walk.points.at(-1),
    point: { lat: 38.9002, lng: -77.2, capturedAt: '2026-08-29T12:00:30Z' },
    knownTrackPoints: [{ lat: 39.0, lng: -77.0 }],
    nowMs: Date.parse('2026-08-29T12:00:30Z')
  });
  assert.ok(detections.some(({ type }) => type === 'new-area'));
});
