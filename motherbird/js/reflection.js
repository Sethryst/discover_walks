export const REFLECTION_PROMPTS = [
  'What did you notice today that surprised you?',
  'Describe one place you want to remember.',
  'What changed between the beginning and end of this walk?',
  'What did your attention keep returning to?'
];

// Context-aware quote framework. Geo-spatial triggers can map to these keys
// later; the journal already exposes the complete library on every page.
export const WALK_QUOTES = Object.freeze([
  { context: 'long-pause', quote: 'Walk as if you are kissing the Earth with your feet.', attribution: 'Thich Nhat Hanh, Peace Is Every Step', tag: 'attributed' },
  { context: 'long-pause', quote: 'I took a walk in the woods and came out taller than the trees.', attribution: 'Unknown', tag: 'unknown' },
  { context: 'end-of-walk-return', quote: 'Walking is the human way of getting about.', attribution: 'Rebecca Solnit, Wanderlust', tag: 'attributed' },
  { context: 'end-of-walk-return', quote: 'It is a great art to saunter.', attribution: 'Henry David Thoreau, Walking', tag: 'attributed' },
  { context: 'end-of-walk-return', quote: 'It is not the mountain we conquer but ourselves.', attribution: 'Edmund Hillary', tag: 'attributed' },
  { context: 'wildlife-sighting', quote: 'Attention is the beginning of devotion.', attribution: 'Mary Oliver, Upstream', tag: 'attributed' },
  { context: 'wildlife-sighting', quote: 'The clearest way into the Universe is through a forest wilderness.', attribution: 'John Muir, journal, 1869', tag: 'attributed' },
  { context: 'entering-park-threshold', quote: 'What I stand for is what I stand on.', attribution: 'Wendell Berry', tag: 'attributed' },
  { context: 'entering-park-threshold', quote: 'A park is a promise a city makes and keeps.', attribution: 'Unknown', tag: 'unknown' },
  { context: 'overlook-vista', quote: 'I think that I cannot preserve my health and spirits, unless I spend four hours a day at least... sauntering through the woods.', attribution: 'Henry David Thoreau, Walking', tag: 'attributed' },
  { context: 'overlook-vista', quote: 'The trees were tall, but I was taller.', attribution: 'Cheryl Strayed, Wild', tag: 'attributed' },
  { context: 'overlook-vista', quote: "Your legs know something your head hasn't caught up to yet.", attribution: 'Unknown', tag: 'unknown' },
  { context: 'climbing-elevation-gain', quote: 'All truly great thoughts are conceived while walking.', attribution: 'Friedrich Nietzsche, Twilight of the Idols', tag: 'attributed' },
  { context: 'climbing-elevation-gain', quote: 'Climb the mountains and get their good tidings.', attribution: 'John Muir, Our National Parks', tag: 'attributed' },
  { context: 'crossing-stream-water', quote: 'No man ever steps in the same river twice.', attribution: 'Heraclitus, via Plato’s paraphrase', tag: 'attributed' },
  { context: 'entering-woods-forest-canopy', quote: 'Between every two pines is a doorway to a new world.', attribution: 'John Muir', tag: 'attributed' },
  { context: 'entering-woods-forest-canopy', quote: 'In every walk with nature one receives far more than he seeks.', attribution: 'John Muir, John of the Mountains', tag: 'attributed' },
  { context: 'setting-out-trailhead', quote: 'The rhythm of walking generates a kind of rhythm of thinking.', attribution: 'Rebecca Solnit, Wanderlust', tag: 'attributed' },
  { context: 'setting-out-trailhead', quote: 'I have walked myself into my best thoughts.', attribution: 'Søren Kierkegaard', tag: 'attributed' },
  { context: 'setting-out-trailhead', quote: 'Of all exercises, walking is the best.', attribution: 'Thomas Jefferson, letter to Peter Carr, 1785', tag: 'attributed' }
]);

export function promptForWalk(walkId = '') {
  const index = walkId ? [...walkId].reduce((sum, character) => sum + character.charCodeAt(0), 0) % REFLECTION_PROMPTS.length : 0;
  return REFLECTION_PROMPTS[index];
}

export function wordCount(value = '') {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

export function buildReflectionMoment({ id, city, heading, mood, note, prompt, walkId, createdAt }) {
  const cleanNote = String(note || '').trim();
  return {
    id,
    type: 'journal',
    title: String(heading || '').trim() || 'Journal note',
    note: cleanNote || 'A reflection saved after a walk.',
    prompt: String(prompt || '').trim() || null,
    createdAt,
    walkId: walkId || null,
    city
  };
}
