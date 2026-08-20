const INTEREST_LABELS = { park: 'green space', trail: 'wildlife and trails', history: 'local history', water_access: 'water', public_art: 'public art' };

export function onboardingProgress(interests = [], step = 'interests') {
  if (step === 'ready') return 3;
  if (step === 'region') return 1;
  return interests.length ? 2 : 1;
}

export function onboardingValue(cityName, interests = []) {
  const labels = interests.map((id) => INTEREST_LABELS[id]).filter(Boolean);
  const interestText = labels.length ? labels.slice(0, 2).join(' and ') : 'a calm selection of walks and places';
  return `Your first Discover Walks view in ${cityName} will prioritize ${interestText}.`;
}
