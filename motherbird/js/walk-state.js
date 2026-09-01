/**
 * A walk is GPS-active only while it is recording and its position watch is
 * running. A stopped walk can remain in state while it waits for review.
 */
export function walkIsActive({ activeWalk, watchId } = {}) {
  return activeWalk?.recordingStatus === 'recording' && watchId !== null && watchId !== undefined;
}
