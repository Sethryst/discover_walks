const MEETING_TITLE = /\b(meeting|forum|hearing|town hall|work session)\b/i;
const VIRTUAL_VENUE = /\bvirtual\b|\bonline\b|\bteams\b|\bzoom\b/i;
const CIVIC_BUILDING = /\b(town hall|city hall|government center|community center|recreation center|rec(?:reation)? ctr|library|police|auditorium|board auditorium)\b/i;

export function civicNoticesFromPack(data = {}, pois = [], now = Date.now()) {
  const current = (item) => !item?.expiresAt || (Number.isFinite(Date.parse(item.expiresAt)) && now < Date.parse(item.expiresAt));
  const notice = (item, kind) => {
    const venueText = `${item?.locationLabel || ''} ${item?.venueAddress || ''}`;
    if (!item?.title || !/^https:\/\//i.test(item.officialUrl || '') || !current(item) || VIRTUAL_VENUE.test(venueText)) return null;
    if (kind === 'Meeting' && !MEETING_TITLE.test(item.title)) return null;
    return { ...item, kind, artifact_type: 'temporal_event', location: locateOfficialVenue(item, pois) };
  };
  const notices = [
    ...(data.meetings?.items || []).map((item) => notice(item, 'Meeting')),
    ...(data.events?.items || []).map((item) => notice(item, 'Event')),
    ...(data.vote?.items || []).map((item) => notice(item, 'Vote'))
  ].filter(Boolean);
  notices.sort((a, b) => String(a.startsAt || a.date || '').localeCompare(String(b.startsAt || b.date || '')) || a.title.localeCompare(b.title));
  return notices;
}

export function locateOfficialVenue(item, pois = []) {
  const lat = Number(item.latitude ?? item.lat ?? item.location?.lat);
  const lng = Number(item.longitude ?? item.lng ?? item.location?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  const candidates = pois.filter((poi) => Number.isFinite(poi.lat) && Number.isFinite(poi.lng));
  const referencedId = item.poiId || item.placeId || item.locationId;
  const referenced = candidates.find((poi) => referencedId && String(poi.id) === String(referencedId));
  if (referenced) return { lat: referenced.lat, lng: referenced.lng };
  const venue = `${item.locationLabel || ''} ${item.venueAddress || ''}`.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  if (!venue) return null;
  const named = candidates.filter((poi) => {
    const name = String(poi.name || '').trim().toLocaleLowerCase();
    if (name.length < 8) return false;
    return venue.includes(name);
  });
  if (named.length === 1) return { lat: named[0].lat, lng: named[0].lng };
  const civic = named.filter((poi) => CIVIC_BUILDING.test(poi.name || '') || CIVIC_BUILDING.test(venue));
  if (civic.length === 1) return { lat: civic[0].lat, lng: civic[0].lng };
  const street = venue.match(/\b(\d{2,5}\s+[a-z0-9.' -]{4,40}(?:st|street|ave|avenue|rd|road|blvd|dr|drive|pl|place|pkwy|ct|ln|lane|ter|terrace|way)\.?)\b/i);
  if (street) {
    const line = street[1].replace(/\./g, '').replace(/\s+/g, ' ');
    const byStreet = candidates.filter((poi) => String(poi.address || poi.venueAddress || poi.locationLabel || '').toLocaleLowerCase().replace(/\./g, '').includes(line));
    if (byStreet.length === 1) return { lat: byStreet[0].lat, lng: byStreet[0].lng };
  }
  return null;
}

export function newsIsAvailable({ capability, notices = [] } = {}, userNewsCount = 0) {
  if (userNewsCount > 0) return true;
  if (capability === 'furnished') return true;
  if (notices.length) return true;
  if (capability === 'stale') return notices.length > 0;
  return false;
}
