export const REFLECTION_PROMPTS = [
  'What did you notice today that surprised you?',
  'Describe one place you want to remember.',
  'What changed between the beginning and end of this walk?',
  'What did your attention keep returning to?'
];

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
    title: String(heading || '').trim() || mood,
    mood,
    note: cleanNote || 'A reflection saved after a walk.',
    prompt: String(prompt || '').trim() || null,
    createdAt,
    walkId: walkId || null,
    city
  };
}
