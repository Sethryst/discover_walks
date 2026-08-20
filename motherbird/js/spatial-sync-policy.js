export const SPATIAL_SYNC_OPERATION_SCHEMA_VERSION = 1;

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string.`);
  return value;
}

/**
 * Validates the transport-neutral operation envelope that a later persistent
 * sync service may accept. It performs no storage or network work.
 */
export function validateSpatialSyncOperation(operation) {
  if (!operation || typeof operation !== 'object') throw new TypeError('Spatial sync operation must be an object.');
  if (operation.schemaVersion !== SPATIAL_SYNC_OPERATION_SCHEMA_VERSION) throw new Error(`Unsupported spatial sync operation schema: ${operation.schemaVersion}.`);
  if (!['local-close', 'local-reopen', 'local-note'].includes(operation.kind)) throw new TypeError(`Unsupported spatial sync operation kind: ${operation.kind}.`);
  const base = operation.base;
  if (!base || typeof base !== 'object') throw new TypeError('Spatial sync operation needs a base artifact identity.');
  return {
    ...operation,
    poiId: requiredString(operation.poiId, 'poiId'),
    reason: requiredString(operation.reason, 'reason'),
    actorId: requiredString(operation.actorId, 'actorId'),
    createdAt: requiredString(operation.createdAt, 'createdAt'),
    base: {
      poiVersion: requiredString(base.poiVersion, 'base.poiVersion'),
      boundaryVintage: requiredString(base.boundaryVintage, 'base.boundaryVintage'),
      sourceChecksum: requiredString(base.sourceChecksum, 'base.sourceChecksum')
    }
  };
}

/**
 * Resolves policy only. `canonicalPoi` is null when an authoritative rebuild
 * removed the stable POI ID. The caller owns persistence and review workflow.
 */
export function resolveSpatialSyncConflict({ canonicalPoi = null, localOperation = null } = {}) {
  const operation = localOperation ? validateSpatialSyncOperation(localOperation) : null;
  if (!operation) return { canonicalPoi, effectivePoi: canonicalPoi, state: canonicalPoi ? 'canonical' : 'absent', auditOperation: null };
  if (canonicalPoi && String(canonicalPoi.id) !== operation.poiId) throw new Error('Canonical POI and local operation must use the same stable ID.');

  if (!canonicalPoi) {
    return {
      canonicalPoi: null, effectivePoi: null, state: 'superseded_by_authoritative_removal', auditOperation: operation,
      message: 'The county removal wins; retain the local operation only as audit history.'
    };
  }
  if (operation.kind === 'local-close') {
    return {
      canonicalPoi, effectivePoi: null, state: 'needs_review', auditOperation: operation,
      message: 'The county retains the POI; hide it for this user pending review, expiry, or revocation.'
    };
  }
  return {
    canonicalPoi, effectivePoi: canonicalPoi, state: operation.kind === 'local-reopen' ? 'local_correction' : 'canonical_with_local_annotation', auditOperation: operation
  };
}
