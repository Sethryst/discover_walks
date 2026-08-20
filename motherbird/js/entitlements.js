import { state } from './state.js';
import db from './storage.js';

export function normalizedEntitlements(raw = {}) {
  return {
    fieldEdition: raw.fieldEdition === true,
    offlineRegions: [...new Set(Array.isArray(raw.offlineRegions) ? raw.offlineRegions : [])],
    partnerGrants: Array.isArray(raw.partnerGrants) ? raw.partnerGrants : []
  };
}

export function canUseOfflineRegion(regionId) {
  const access = normalizedEntitlements(state.settings?.entitlements);
  return access.fieldEdition || access.offlineRegions.includes(regionId) || access.partnerGrants.some((grant) => grant.regionIds?.includes(regionId) || grant.allRegions);
}

export function fieldEditionStatus() {
  const access = normalizedEntitlements(state.settings?.entitlements);
  if (access.fieldEdition) return 'Field Edition active';
  if (access.partnerGrants.length) return 'Partner Field Edition access active';
  return 'Free edition';
}

// This is deliberately only a local entitlement model. A production purchase
// or partner grant must be verified by a server; client-side codes are not a
// security boundary and must never be treated as payment verification.
export async function saveEntitlements(entitlements) {
  state.settings.entitlements = normalizedEntitlements(entitlements);
  await db.put('settings', state.settings);
  return state.settings.entitlements;
}
