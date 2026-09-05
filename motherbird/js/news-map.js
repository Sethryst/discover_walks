import { state } from './state.js';
import { syncNewsStory } from './learn-change.js';

export function bindNewsMap() {
  if (bindNewsMap.bound) return;
  bindNewsMap.bound = true;
  window.addEventListener('city-layer-data-changed', () => void syncNewsStory());
  window.addEventListener('layer-state-dirty', () => void syncNewsStory());
  window.addEventListener('map-viewport-changed', () => {
    if (state.learnChangeLayer) return;
    void syncNewsStory();
  });
  void syncNewsStory();
}

bindNewsMap();
