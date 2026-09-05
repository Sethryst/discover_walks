import { state } from './state.js';

export const EXPLORE_POIS_URL = './data/learn/discover/explore-pois.json';

let exploreCache = null;

export async function loadExplorePois() {
  if (exploreCache) return exploreCache;
  try {
    const response = await fetch(EXPLORE_POIS_URL);
    exploreCache = response.ok ? await response.json() : { items: [] };
  } catch {
    exploreCache = { items: [] };
  }
  return exploreCache;
}

export async function mergeExplorePois() {
  const catalog = await loadExplorePois();
  const city = state.activeCity;
  if (!city) return [];
  const list = state.cityPois[city] || [];
  const have = new Set(list.map((poi) => String(poi.id)));
  for (const item of catalog.items || []) {
    if (have.has(item.id)) continue;
    list.push({
      id: item.id,
      name: item.name,
      lat: item.lat,
      lng: item.lng,
      category: item.category || 'history',
      tags: item.tags || ['history'],
      radius: item.radius || 50,
      officialUrl: item.officialUrl,
      note: item.note,
      source: [{ name: item.sourceName, url: item.officialUrl }],
      exploreLens: item.lens,
      city
    });
    have.add(item.id);
  }
  state.cityPois[city] = list;
  return list;
}

export const EXPLORE_LENSES = {
  marks: { id: 'marks', title: 'Find a survey mark', sourceName: 'National Geodetic Survey', sourceUrl: 'https://geodesy.noaa.gov/NGSDataExplorer/', question: 'Find a survey disk that most walkers miss.' },
  trees: { id: 'trees', title: 'Walk to a champion tree', sourceName: 'Virginia Big Tree Program', sourceUrl: 'https://bigtree.cnre.vt.edu/', question: 'Walk to a measured public tree.' },
  markers: { id: 'markers', title: 'Read a historic marker', sourceName: 'Virginia historical markers', sourceUrl: 'https://www.fairfaxcounty.gov/planning-development/historic/fairfax-county-highway-markers', question: 'Read a story set in the ground.' }
};
