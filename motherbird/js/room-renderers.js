import { escapeHtml } from './utils.js';

const TYPE_COPY = {
  museum: ['Gallery guide', 'A place-based sequence for exhibits, stories, and featured audio.'],
  trail: ['Trail guide', 'A route-oriented Room for landmarks, observations, and walk traces.'],
  garden: ['Garden guide', 'A local coordinate workspace for beds, habitats, and seasonal notes.'],
  park: ['Park guide', 'A place-based workspace for entrances, paths, and nearby observations.'],
  'historic-site': ['History guide', 'A contextual Room for site history, sources, and visitor notes.'],
  neighborhood: ['Neighborhood guide', 'A local Room for connected places and resident-curated walks.'],
  building: ['Place guide', 'A private place-based workspace for notes, audio, and visits.']
};

export function renderRoomSections(room) {
  const [heading, description] = TYPE_COPY[room.type] || TYPE_COPY.building;
  const relationships = room.spatialPlace?.relationships || [];
  const stationCount = (room.data?.featuredStationIds || room.audioStationIds || []).length;
  const traceCount = Array.isArray(room.traces) ? room.traces.length : 0;
  const relationshipCopy = relationships.length
    ? `${relationships.length} spatial connection${relationships.length === 1 ? '' : 's'} are attached to this place.`
    : 'Connections to nearby places can be added as this Room grows.';
  const sections = [
    { title: heading, body: description },
    { title: 'Spatial context', body: relationshipCopy },
    { title: 'Room activity', body: `${traceCount} local trace${traceCount === 1 ? '' : 's'} saved${stationCount ? ` · ${stationCount} featured station${stationCount === 1 ? '' : 's'}` : ''}.` }
  ];
  if (room.type === 'garden') sections.splice(1, 0, { title: 'Local coordinates', body: 'Use this Room as a device-local coordinate layer for beds, paths, and observations.' });
  return sections.map((section) => `<section class="room-section"><h3>${escapeHtml(section.title)}</h3><p>${escapeHtml(section.body)}</p></section>`).join('');
}
