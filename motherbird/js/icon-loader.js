const svgCache = new Map();

// Icons are kept as auditable standalone MIT-licensed assets, then promoted
// into the DOM as inline SVG so `currentColor` follows each layer/category.
export async function hydrateInlineIcons(root = document) {
  const images = [...root.querySelectorAll('img[data-inline-svg]')];
  await Promise.all(images.map(async (image) => {
    if (!image.isConnected) return;
    try {
      const source = image.getAttribute('src');
      if (!/^\.\/icons\/[a-z0-9-]+\.svg$/i.test(source || '')) throw new Error('Unsupported icon path');
      let markup = svgCache.get(source);
      if (!markup) {
        const response = await fetch(source);
        if (!response.ok) throw new Error('Icon unavailable');
        markup = await response.text();
        svgCache.set(source, markup);
      }
      const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
      const svg = parsed.documentElement;
      if (svg.nodeName.toLowerCase() !== 'svg' || svg.querySelector('script')) throw new Error('Invalid SVG asset');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      svg.classList.add(...image.classList);
      image.replaceWith(document.importNode(svg, true));
    } catch {
      const fallback = document.createElement('span');
      fallback.className = 'icon-text-fallback';
      fallback.textContent = image.dataset.iconFallback || '';
      fallback.setAttribute('aria-hidden', 'true');
      image.replaceWith(fallback);
    }
  }));
}

