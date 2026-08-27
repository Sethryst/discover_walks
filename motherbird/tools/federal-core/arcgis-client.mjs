const DEFAULT_HEADERS = Object.freeze({
  Accept: 'application/geo+json, application/json',
  'User-Agent': 'MotherBird-federal-core/2.0'
});

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function arcGisError(label, payload) {
  const detail = payload?.error?.details?.filter(Boolean).join('; ');
  const message = payload?.error?.message || 'unknown ArcGIS error';
  return new Error(`${label}: ${message}${detail ? ` (${detail})` : ''}`);
}

/** ArcGIS transport. Provider paging details stay behind this interface. */
export class ArcGisClient {
  constructor({ fetchImpl = globalThis.fetch, retries = 3, timeoutMs = 120_000 } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('ArcGisClient requires fetch');
    this.fetchImpl = fetchImpl;
    this.retries = retries;
    this.timeoutMs = timeoutMs;
  }

  async layerMetadata(service, label = service) {
    return this.#request(`${service}?f=pjson`, undefined, label);
  }

  async count(service, { where = '1=1', envelope } = {}, label = service) {
    const payload = await this.#query(service, {
      where,
      returnCountOnly: 'true',
      f: 'json',
      ...spatialParameters(envelope)
    }, label);
    if (!Number.isInteger(payload.count) || payload.count < 0) {
      throw new Error(`${label}: ArcGIS count response is invalid`);
    }
    return payload.count;
  }

  async objectIds(service, { where = '1=1', envelope } = {}, label = service) {
    const payload = await this.#query(service, {
      where,
      returnIdsOnly: 'true',
      returnGeometry: 'false',
      f: 'json',
      ...spatialParameters(envelope)
    }, label);
    if (!Array.isArray(payload.objectIds)) {
      if (payload.objectIds === null) return [];
      throw new Error(`${label}: ArcGIS object-ID response is invalid`);
    }
    return [...new Set(payload.objectIds.map(String))].sort(compareIds);
  }

  async featuresByIds(service, objectIds, { outFields = '*', batchSize = 500, objectIdField = 'OBJECTID' } = {}, label = service) {
    const ids = [...new Set(objectIds.map(String))].sort(compareIds);
    const features = [];
    const fetchBatch = async (batch, batchLabel) => {
      try {
        const payload = await this.#query(service, {
          objectIds: batch.join(','),
          outFields,
          returnGeometry: 'true',
          outSR: '4326',
          f: 'geojson'
        }, batchLabel);
        if (payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
          throw new Error(`${batchLabel}: ArcGIS did not return GeoJSON`);
        }
        if (payload.exceededTransferLimit) {
          throw new Error(`${batchLabel}: object-ID batch exceeded the transfer limit`);
        }
        const returnedIds = payload.features.map((feature) => String(feature.properties?.[objectIdField] ?? feature.id ?? ''));
        const missingIds = batch.filter((id) => !returnedIds.includes(id));
        if (payload.features.length !== batch.length || missingIds.length) {
          throw new Error(`${batchLabel}: incomplete object-ID batch; missing ${missingIds.join(', ') || 'unknown IDs'}`);
        }
        return payload.features;
      } catch (error) {
        if (batch.length === 1) throw error;
        const midpoint = Math.ceil(batch.length / 2);
        const left = await fetchBatch(batch.slice(0, midpoint), `${batchLabel}.a`);
        const right = await fetchBatch(batch.slice(midpoint), `${batchLabel}.b`);
        return [...left, ...right];
      }
    };
    for (let offset = 0; offset < ids.length; offset += batchSize) {
      const batch = ids.slice(offset, offset + batchSize);
      features.push(...await fetchBatch(batch, `${label} batch ${Math.floor(offset / batchSize) + 1}`));
    }
    return features;
  }

  async completeQuery(service, { where = '1=1', envelope, outFields = '*', batchSize = 500, objectIdField = 'OBJECTID' } = {}, label = service) {
    const objectIds = await this.objectIds(service, { where, envelope }, label);
    const features = await this.featuresByIds(service, objectIds, { outFields, batchSize, objectIdField }, label);
    return { features, stats: { method: 'object-id-batches', objectIdCount: objectIds.length, batchCount: Math.ceil(objectIds.length / batchSize) } };
  }

  async #query(service, parameters, label) {
    return this.#request(`${service.replace(/\/$/, '')}/query`, new URLSearchParams(parameters), label);
  }

  async #request(url, body, label) {
    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, {
          method: body ? 'POST' : 'GET',
          headers: body ? { ...DEFAULT_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' } : DEFAULT_HEADERS,
          body,
          signal: AbortSignal.timeout(this.timeoutMs)
        });
        if (!response.ok) {
          const error = new Error(`${label}: ArcGIS returned ${response.status} ${response.statusText}`.trim());
          error.retryable = response.status === 429 || response.status >= 500;
          throw error;
        }
        const payload = await response.json();
        if (payload?.error) throw arcGisError(label, payload);
        return payload;
      } catch (error) {
        lastError = error;
        const retryable = error?.retryable || error?.name === 'TimeoutError' || error?.name === 'AbortError' || error instanceof TypeError;
        if (!retryable || attempt === this.retries) break;
        await wait(250 * (2 ** attempt));
      }
    }
    throw lastError;
  }
}

export function spatialParameters(envelope) {
  if (!envelope) return {};
  if (!Array.isArray(envelope) || envelope.length !== 4 || envelope.some((value) => !Number.isFinite(value))) {
    throw new TypeError('ArcGIS envelope must be [xmin, ymin, xmax, ymax]');
  }
  return {
    geometry: envelope.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects'
  };
}

function compareIds(left, right) {
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) ? a - b : left.localeCompare(right);
}
