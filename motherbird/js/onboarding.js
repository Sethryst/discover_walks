const INTEREST_LABELS = { park: 'green space', trail: 'wildlife and trails', history: 'local history', water_access: 'water', public_art: 'public art' };

export function onboardingValue(cityName, interests = []) {
  const labels = interests.map((id) => INTEREST_LABELS[id]).filter(Boolean);
  const interestText = labels.length ? labels.slice(0, 2).join(' and ') : 'walks and public places';
  return `We’ll open ${cityName} with ${interestText} ready to explore.`;
}
