export function isLikelyWatchDevice({ userAgent = '', width = 0, height = 0 } = {}) {
  if (/apple\s*watch|watch\s*os|wear\s*os|android\s*wear|sm-r\d+/i.test(String(userAgent))) return true;
  const shortSide = Math.min(Number(width) || 0, Number(height) || 0);
  const longSide = Math.max(Number(width) || 0, Number(height) || 0);
  if (!shortSide || !longSide) return false;
  // Watch browsers are compact in both dimensions and usually square-ish.
  // Avoid width-only detection: that would incorrectly redirect phones.
  return shortSide <= 396 && longSide <= 500 && (longSide / shortSide) <= 1.45;
}

export function shouldUseWatchEntrance({ search = '', userAgent = '', width = 0, height = 0 } = {}) {
  const requestedView = new URLSearchParams(search).get('view');
  if (requestedView === 'phone' || requestedView === 'full') return false;
  if (requestedView === 'watch') return true;
  return isLikelyWatchDevice({ userAgent, width, height });
}

function redirectWatchDevice() {
  if (typeof window === 'undefined' || /\/watch\.html$/i.test(window.location.pathname)) return;
  if (!shouldUseWatchEntrance({
    search: window.location.search,
    userAgent: window.navigator.userAgent,
    width: window.screen?.width || window.innerWidth,
    height: window.screen?.height || window.innerHeight
  })) return;
  const target = new URL('./watch.html', window.location.href);
  const source = new URL(window.location.href);
  const city = source.searchParams.get('city');
  if (city) target.searchParams.set('city', city);
  window.location.replace(target.href);
}

redirectWatchDevice();
