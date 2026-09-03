const FOOD = new Set(['restaurant','fast_food','coffee','coffee_shop','cafe','bakery','market','farmers_market','grocery','supermarket','cuisine','food']);
export function placeLight(poi) {
  const tags = [...(Array.isArray(poi.tags) ? poi.tags : []), poi.category, poi.light].filter(Boolean);
  if (tags.some((tag) => ['event','news','meeting','civic'].includes(tag))) return 'news';
  if (tags.some((tag) => FOOD.has(tag))) return 'cuisine';
  return 'recreation';
}
export function publicPlaceSource(poi, card = {}) {
  const sources = Array.isArray(poi?.source) ? poi.source : [poi?.source];
  const candidates = [
    { url: card.officialUrl, name: card.provenance?.name },
    { url: poi?.officialUrl || poi?.website || poi?.link, name: poi?.name },
    ...sources.map((source) => typeof source === 'string' ? { url: source } : { url: source?.officialUrl || source?.url, name: source?.name })
  ];
  return candidates.find((source) => {
    try { const url = new URL(source.url); return url.protocol === 'https:' && !url.username && !url.password && !/openstreetmap\.org\/copyright/.test(url.href); } catch { return false; }
  }) || null;
}
export function walkerDetails(poi) {
  const fields = { ...(poi.properties || {}), ...(poi.attributes || {}), ...(poi.metadata || {}), ...poi };
  const groups = [
    ['Food & drink', ['cuisine', 'diet:vegetarian', 'diet:vegan', 'outdoor_seating']],
    ['Visit', ['opening_hours', 'hours', 'season', 'startsAt', 'locationLabel']],
    ['Comfort & access', ['wheelchair', 'accessibility', 'drinking_water', 'toilets', 'dogs', 'fee']],
    ['On the ground', ['surface', 'trailType', 'lengthMiles', 'difficulty', 'operator']]
  ];
  const rows = [];
  for (const [group, names] of groups) {
    const values = names.flatMap((name) => {
      const value = fields[name];
      if (!['string','number','boolean'].includes(typeof value) || value === '' || /^https?:/i.test(String(value))) return [];
      return [`${name.replaceAll('_',' ')}: ${String(value).slice(0,120)}`];
    });
    if (values.length) rows.push({ group, text: values.slice(0,3).join(' · ') });
  }
  return rows.slice(0,3);
}
