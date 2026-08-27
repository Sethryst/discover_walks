export const POLICY_VERSION = '2026-08-27.1';

export const ROUTING_PROFILES = Object.freeze({
  research: 1 << 0,
  ordinary_walking_beta: 1 << 1,
  verified_access: 1 << 2,
  accessible_verified: 1 << 3
});

const PEDESTRIAN_TYPES = new Set([
  'sidewalk', 'footpath', 'crossing', 'trail', 'pedestrian_plaza',
  'indoor_pathway', 'pedestrian_link'
]);

export function materializeAccessPolicy({ access, edgeType, evidence, attributes = {} }) {
  const explicitlyPrivate = evidence === 'explicit_privatewalk' || access === 'prohibited';
  const explicitlyPublic = access === 'allowed';
  const pedestrianGeometry = PEDESTRIAN_TYPES.has(edgeType);
  const accessibilityKnown = accessibilityRequirementsPass(attributes);

  const routability = {
    research: true,
    ordinary_walking_beta: pedestrianGeometry && !explicitlyPrivate,
    verified_access: explicitlyPublic && !explicitlyPrivate,
    accessible_verified: explicitlyPublic && !explicitlyPrivate && accessibilityKnown === true
  };

  return {
    raw_access: access,
    access_evidence: evidence,
    routability,
    profile_bitmask: profileBitmask(routability),
    policy_confidence: policyConfidence({ access, evidence, edgeType }),
    policy_warning: routability.ordinary_walking_beta && !explicitlyPublic
      ? 'Access is inferred from pedestrian-network geometry and is not independently verified.'
      : null,
    policy_version: POLICY_VERSION
  };
}

export function profileAllows(edge, profile = 'ordinary_walking_beta') {
  if (!(profile in ROUTING_PROFILES)) throw new RangeError(`Unknown routing profile: ${profile}`);
  if (edge.routability) return Boolean(edge.routability[profile]);
  if (profile === 'research') return true;
  if (profile === 'ordinary_walking_beta') return edge.access !== 'prohibited';
  return edge.access === 'allowed';
}

export function profileBitmask(routability) {
  return Object.entries(ROUTING_PROFILES).reduce(
    (mask, [profile, bit]) => routability[profile] ? mask | bit : mask,
    0
  );
}

export function evidenceFor(properties, dataset, edgeType, access) {
  const classificationText = (dataset.classification_fields || [])
    .map((field) => String(properties[field] ?? '').trim().toLowerCase())
    .join(' ');
  if (classificationText.includes('privatewalk')) return 'explicit_privatewalk';
  if (access === 'prohibited') return 'explicit_private';
  if (access === 'allowed') return 'explicit_public';
  if (['sidewalk', 'crossing', 'pedestrian_link'].includes(edgeType)) return 'municipal_pedestrian_network';
  if (edgeType === 'trail') return 'official_public_trail';
  if (PEDESTRIAN_TYPES.has(edgeType)) return 'unknown_pedestrian_geometry';
  return 'unknown_nonpedestrian_geometry';
}

function policyConfidence({ access, evidence, edgeType }) {
  if (access === 'prohibited' || access === 'allowed') return 1;
  if (evidence === 'municipal_pedestrian_network' || evidence === 'official_public_trail') return 0.8;
  if (edgeType === 'pedestrian_link') return 0.7;
  return 0.5;
}

function accessibilityRequirementsPass(attributes) {
  const stairs = firstValue(attributes, ['stairs', 'steps', 'vertchange']);
  const ramp = firstValue(attributes, ['ramp', 'curb_ramp', 'ada']);
  if (stairs === undefined || ramp === undefined) return null;
  const noStairs = /^(0|false|no|none)$/i.test(String(stairs));
  const rampPasses = /^(1|true|yes|present|compliant)$/i.test(String(ramp));
  return noStairs && rampPasses;
}

function firstValue(attributes, keys) {
  for (const key of keys) if (attributes[key] !== undefined && attributes[key] !== null && attributes[key] !== '') return attributes[key];
  return undefined;
}
