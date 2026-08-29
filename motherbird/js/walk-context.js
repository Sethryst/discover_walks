import { state } from './state.js';
import db from './storage.js';
import { uid } from './utils.js';
import { addEventToWalk, attachArtifactToWalk, createWalkEvent, normalizeWalkArtifact } from './walk-artifact.js';

const DRAFT_ID = 'active-walk';

export async function attachWalkArtifact(item, type = 'moment') {
  const walk = state.activeWalk;
  if (!walk || !item?.id) return;
  attachArtifactToWalk(walk, { id: item.id, type });
  if (type === 'photo') {
    const timestamp = item.createdAt || new Date().toISOString();
    const event = createWalkEvent({ id: uid('walk-event'), walkId: walk.id, type: 'photo-stop', timestamp, location: item.location, state: 'completed', metadata: { artifactId: item.id } });
    event.endTime = timestamp;
    event.durationSeconds = 0;
    event.immutable = true;
    addEventToWalk(walk, event);
    await db.put('walk_events', event);
  }
  await db.put('walk_drafts', { id: DRAFT_ID, updatedAt: new Date().toISOString(), walk: normalizeWalkArtifact(walk) });
}
