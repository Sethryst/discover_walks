const APPROVED_NARRATION_METADATA = {
  'east-potomac-changing-park': [{ durationSeconds: 12.971, bytes: 156716 }, { durationSeconds: 11.179, bytes: 135116 }, { durationSeconds: 8.469, bytes: 102572 }, { durationSeconds: 10.709, bytes: 129644 }],
  'kennedy-center-human-chain': [{ durationSeconds: 17.003, bytes: 205100 }, { durationSeconds: 18.005, bytes: 217196 }, { durationSeconds: 17.685, bytes: 213164 }, { durationSeconds: 14.229, bytes: 171692 }]
};

// Editorial prototypes. Geometry choreographs the experience but does not make
// claims about construction boundaries. Publish only after reporting review.
export const DC_STORIES = [
  {
    id: 'east-potomac-changing-park', city: 'dc', status: 'changing', editorialStatus: 'draft',
    headline: 'A place is changing at East Potomac Park', mapLabel: 'A place is changing',
    hook: 'Take a 22-minute walk through a landscape where trees, recreation, and public access are being renegotiated.',
    durationMinutes: 22, freshnessLabel: 'Editorial prototype · reporting in progress', center: [38.8746, -77.0264],
    footprint: [[38.8800,-77.0318],[38.8780,-77.0230],[38.8700,-77.0198],[38.8657,-77.0250],[38.8692,-77.0321]],
    route: [[38.8800,-77.0277],[38.8777,-77.0251],[38.8745,-77.0235],[38.8707,-77.0227],[38.8675,-77.0250]],
    chapters: [
      { title: 'The first sixty trees', minutes: 1, look: 'Look toward the golf course edge.', audioStatus: 'unpublished', audioAssetId: null, narration: 'Start with what can be seen. The landscape is already carrying evidence of change. This opening chapter will establish what has been verified, what remains uncertain, and why the trees became the first visible signal.' },
      { title: 'Why this land exists', minutes: 2, look: 'Keep the river on your right.', audioStatus: 'unpublished', audioAssetId: null, narration: 'East Potomac Park is constructed land with layers of public purpose. This chapter will connect the ground underfoot to the decisions that made the park possible and the uses that followed.' },
      { title: 'The path that may disappear', minutes: 2, look: 'Notice where the walking line meets recreation space.', audioStatus: 'unpublished', audioAssetId: null, narration: 'A path is more than a line on a map. It determines who can move through a place, what people can reach, and what becomes difficult when plans change.' },
      { title: 'What remains unresolved', minutes: 1, look: 'Pause and take in the whole footprint.', audioStatus: 'unpublished', audioAssetId: null, narration: 'The final chapter separates confirmed decisions from open questions. As reporting develops, this chapter changes with it—and eventually becomes the record of what happened.' }
    ],
    sources: [{ name: 'National Park Service — East Potomac Park', url: 'https://www.nps.gov/places/east-potomac-park.htm' }],
    unresolved: ['Confirm tree-removal count and dates', 'Document public-access impacts', 'Obtain final project geometry and decision record']
  },
  {
    id: 'kennedy-center-human-chain', city: 'dc', status: 'live', editorialStatus: 'reporting',
    headline: 'What would it mean to hold a building together?', mapLabel: 'People gather here',
    hook: 'A threatened rebuild becomes physical when people gather around the Kennedy Center and imagine linking hands around the entire building.',
    durationMinutes: 18, freshnessLabel: 'Story seed · requires reporting and verification', center: [38.8959, -77.0559],
    footprint: [[38.8976,-77.0578],[38.8975,-77.0538],[38.8944,-77.0537],[38.8943,-77.0578]],
    route: [[38.8972,-77.0572],[38.8971,-77.0543],[38.8948,-77.0542],[38.8947,-77.0572],[38.8972,-77.0572]],
    chapters: [
      { title: 'The building in the middle', minutes: 1, look: 'Stand back far enough to see the full mass of the building.', audioStatus: 'unpublished', audioAssetId: null, narration: 'The Kennedy Center board has backed a two-year closure for renovations. The plan follows months of disputes over the building, its leadership, and the possibility of major physical changes. A federal judge has ordered the center to give thirty days notice before those changes begin.' },
      { title: 'A ring of people', minutes: 2, look: 'Imagine the plaza filled with people around the building.', audioStatus: 'unpublished', audioAssetId: null, narration: 'On September eighteenth, supporters gathered outside the center for a Hands Off the Arts protest. News reports described people linking arms around as much of the building as they could and chanting hands off. Organizers presented the chain as a defense of the center as a public arts institution.' },
      { title: 'Who gets to change a monument?', minutes: 2, look: 'Notice the approaches, terraces, and edges.', audioStatus: 'unpublished', audioAssetId: null, narration: 'The dispute now runs through the board, the courts, Congress, performers, workers, and the people who use the building. The proposed closure would move performances elsewhere while repairs and renovations are considered. The court has asked for more information before the project can move ahead.' },
      { title: 'After the crowd leaves', minutes: 1, look: 'Listen to the space after the gathering.', audioStatus: 'unpublished', audioAssetId: null, narration: 'The protest was one evening in a longer fight. The next facts to watch are the court notices, the renovation documents, the center’s programming, and the decisions that determine whether the building closes, changes, or remains open.' }
    ],
    sources: [
      { name: 'The Kennedy Center — official site', url: 'https://www.kennedy-center.org/' },
      { name: 'Associated Press — court notice and physical changes', url: 'https://apnews.com/article/128f25afb33841baff16245d492f320c' },
      { name: 'Washington Post — Hands Off the Arts gathering', url: 'https://www.washingtonpost.com/dc-md-va/2026/09/18/hundreds-kennedy-center-supporters-rally-in-its-defense/' }
    ],
    unresolved: ['Verify the rebuilding proposal and decision authority', 'Report gathering organizers and participants', 'Replace conceptual route with accessible surveyed path']
  },
  {
    id: 'the-wagon-philadelphia-1925', city: 'philadelphia', scope: 'national', status: 'historical', editorialStatus: 'rights-reviewed',
    headline: 'Hear Philadelphia in September 1925', mapLabel: 'A 1925 recording city',
    hook: 'A public-domain recording of Ben Harney’s “The Wagon” brings a century-old Philadelphia sound into the walk.',
    durationMinutes: 2, freshnessLabel: 'Wikimedia Commons · public domain recording', center: [39.9526, -75.1652],
    footprint: [[39.9640,-75.1820],[39.9640,-75.1480],[39.9400,-75.1480],[39.9400,-75.1820]],
    route: [[39.9526,-75.1652]],
    chapters: [
      { title: 'The Wagon', minutes: 2, look: 'Philadelphia is the recorded city; the exact venue is not identified in the source.', narration: 'In September 1925, Ben Harney performed The Wagon in Philadelphia. The recording survives through a phonograph cylinder held by the Library of Congress Gordon Collection and is available through Wikimedia Commons. The source identifies the city, but not the precise recording venue, so this is a city-level historical point rather than an exact-address claim.' }
    ],
    sources: [
      { name: 'Wikimedia Commons — The Wagon.ogg', url: 'https://commons.wikimedia.org/wiki/File:TheWagon.ogg' },
      { name: 'Library of Congress — Gordon Collection', url: 'https://www.loc.gov/collections/gordon-parks-photographs/about-this-collection/' }
    ],
    unresolved: ['Find a primary source naming the exact Philadelphia recording venue']
  }
].map((story) => ({
  ...story,
  scope: story.scope || 'local',
  chapters: story.chapters.map((chapter, index) => ({
    ...chapter,
    audioStatus: 'ready',
    audioAssetId: `${story.id}-chapter-${index + 1}`,
    position: story.route[Math.min(index, story.route.length - 1)],
    audioUsesSourceClips: false,
    audioApproval: {
      status: 'approved-editorial-narration',
      approvedAt: '2026-09-23',
      reviewer: 'editorial approval recorded in chat',
      sourceClipRights: 'pending'
    },
    // Bytes never live in this package. These are editorial records for
    // candidate archival clips and the separately rendered narration.
    narrationEngine: 'kokoro-editorial-prerender',
    audioRights: {
      sourceUrl: story.id === 'the-wagon-philadelphia-1925' ? 'https://commons.wikimedia.org/wiki/Special:FilePath/TheWagon.ogg' : 'editorial://walk-wildlife/narration',
      license: story.id === 'the-wagon-philadelphia-1925' ? 'public-domain-mark; PD-US-record-expired' : 'original-editorial',
      attribution: story.id === 'the-wagon-philadelphia-1925' ? 'Ben Harney, The Wagon, September 1925; Wikimedia Commons / Library of Congress Gordon Collection.' : 'Walk & Wildlife editorial narration; approved for this story package.',
      transcript: chapter.narration,
      durationSeconds: story.id === 'the-wagon-philadelphia-1925' ? 107 : APPROVED_NARRATION_METADATA[story.id][index].durationSeconds,
      reviewStatus: 'approved',
      mimeType: story.id === 'the-wagon-philadelphia-1925' ? 'audio/ogg' : 'audio/mpeg',
      bytes: story.id === 'the-wagon-philadelphia-1925' ? 1180954 : APPROVED_NARRATION_METADATA[story.id][index].bytes
    },
    sourceClips: [{
      assetId: `${story.id}-clip-${index + 1}`,
      sourceUrl: story.id === 'the-wagon-philadelphia-1925'
        ? 'https://commons.wikimedia.org/wiki/File:TheWagon.ogg'
        : story.id === 'east-potomac-changing-park'
        ? 'https://www.nps.gov/subjects/oralhistory/recordings.htm'
        : 'https://blogs.loc.gov/now-see-hear/2023/01/before-the-john-f-kennedy-center-for-the-performing-arts-part-1/',
      sourceType: story.id === 'the-wagon-philadelphia-1925' ? 'wikimedia-commons-public-domain' : 'official-archive-candidate',
      sourceTitle: story.id === 'the-wagon-philadelphia-1925' ? 'The Wagon — Ben Harney, 1925' : story.id === 'east-potomac-changing-park' ? 'NPS Oral History Recordings' : 'Before the John F. Kennedy Center for the Performing Arts',
      license: story.id === 'the-wagon-philadelphia-1925' ? 'public-domain-mark; PD-US-record-expired' : 'pending-verification',
      attribution: story.id === 'the-wagon-philadelphia-1925' ? 'Ben Harney; Wikimedia Commons; source: Library of Congress Gordon Collection.' : 'Candidate archival source; verify reuse terms and credit line before publication.',
      transcript: '', durationSeconds: story.id === 'the-wagon-philadelphia-1925' ? 107 : null,
      rightsReviewStatus: story.id === 'the-wagon-philadelphia-1925' ? 'approved' : 'pending'
    }]
  }))
}));
