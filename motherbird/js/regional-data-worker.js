self.onmessage = async ({ data }) => {
  const { id, url } = data || {};
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Regional data request failed: ${response.status}`);
    const text = await response.text();
    const pack = JSON.parse(text);
    self.postMessage({ id, ok: true, pack, bytes: text.length });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
};
