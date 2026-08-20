import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

export class InMemoryStorageProvider {
  constructor() {
    this.files = new Map();
  }

  async save(path, contents) {
    this.files.set(path, contents);
  }

  async read(path) {
    return this.files.has(path) ? this.files.get(path) : null;
  }

  async exists(path) {
    return this.files.has(path);
  }
}

export function createInMemoryStorageProvider() {
  return new InMemoryStorageProvider();
}

export class RegionBuilder {
  constructor(storageProvider) {
    this.storage = storageProvider;
  }

  async build(regionConfig) {
    const artifactPath = `${regionConfig.regionKey || regionConfig.id}.pmtiles`;
    const tileData = JSON.stringify({
      regionKey: regionConfig.regionKey || regionConfig.id,
      type: 'pmtiles',
      boundary: regionConfig.geographic?.bounds || regionConfig.boundary || {}
    });
    await this.storage.save(artifactPath, tileData);
    return { path: artifactPath, contents: tileData };
  }
}

export class PoiBuilder {
  constructor(storageProvider) {
    this.storage = storageProvider;
  }

  async build(regionConfig) {
    const artifactPath = `${regionConfig.regionKey || regionConfig.id}-poi.json`;
    const sources = regionConfig.poiSources || [];
    const pois = [];

    for (const source of sources) {
      const sourcePath = path.join(projectRoot, source.path || '');
      try {
        const contents = await readFile(sourcePath, 'utf8');
        const parsed = JSON.parse(contents);
        const features = parsed.features || [];
        for (const feature of features) {
          const props = feature.properties || {};
          const [lng, lat] = feature.geometry?.coordinates || [];
          pois.push({
            id: `${regionConfig.regionKey || regionConfig.id}-${pois.length + 1}`,
            name: props.name || 'Unnamed place',
            lat,
            lng,
            category: props.category || source.category || 'general',
            source: source.id || 'region-source'
          });
        }
      } catch (error) {
        console.warn(`Skipping POI source ${source.id}: ${error.message}`);
      }
    }

    const poiData = JSON.stringify({ regionKey: regionConfig.regionKey || regionConfig.id, pois });
    await this.storage.save(artifactPath, poiData);
    return { path: artifactPath, contents: poiData };
  }
}

export class TaxonomyEngine {
  constructor(storageProvider) {
    this.storage = storageProvider;
  }

  async build(regionConfig) {
    const artifactPath = `${regionConfig.regionKey || regionConfig.id}-buckets.json`;
    const taxonomy = regionConfig.categoryTaxonomy || {};
    const buckets = {
      city: regionConfig.displayName || regionConfig.name,
      universalBuckets: (taxonomy.universal || []).map((category) => ({
        name: category,
        displayName: category.replace(/_/g, ' '),
        count: 1,
        enabled: true,
        icon: '•'
      })),
      featuredBuckets: (regionConfig.featuredBuckets || []).map((bucket) => ({
        name: bucket.id,
        displayName: bucket.name,
        count: 1,
        enabled: true,
        icon: bucket.icon || '★',
        description: bucket.description || ''
      }))
    };
    const bucketsData = JSON.stringify(buckets);
    await this.storage.save(artifactPath, bucketsData);
    return { path: artifactPath, contents: bucketsData };
  }
}

export class RegionManager {
  constructor(storageProvider, builders = null) {
    this.storage = storageProvider;
    this.builders = builders || {
      regionBuilder: new RegionBuilder(storageProvider),
      poiBuilder: new PoiBuilder(storageProvider),
      taxonomyEngine: new TaxonomyEngine(storageProvider)
    };
  }

  async getRegion(regionKey, config = null) {
    const regionConfig = config || (await this.loadConfig(regionKey));
    const artifactKey = regionKey || regionConfig.regionKey || regionConfig.id;
    const normalizedConfig = { ...regionConfig, regionKey: artifactKey, id: artifactKey };
    const artifactRoot = path.join(projectRoot, 'regions', artifactKey);
    const artifacts = [
      path.join(artifactRoot, `${artifactKey}.pmtiles`),
      path.join(artifactRoot, `${artifactKey}-poi.json`),
      path.join(artifactRoot, `${artifactKey}-buckets.json`),
      path.join(artifactRoot, 'metadata.json')
    ];

    const ready = await Promise.all(artifacts.map((artifact) => this._pathExists(artifact)));
    if (ready.every(Boolean)) {
      return this.loadRegion(artifactKey);
    }

    const regionResult = await this.buildRegion(normalizedConfig, artifactKey);
    return this.loadRegion(artifactKey, regionResult);
  }

  async buildRegion(regionConfig, artifactKeyOverride = null) {
    const artifactKey = artifactKeyOverride || regionConfig.regionKey || regionConfig.id;
    const targetDir = path.join(projectRoot, 'regions', artifactKey);
    const regionResult = {
      id: artifactKey,
      path: targetDir,
      config: regionConfig
    };

    try {
      await mkdir(targetDir, { recursive: true });
      const pmtilesResult = await this.builders.regionBuilder.build(regionConfig);
      const poiResult = await this.builders.poiBuilder.build(regionConfig);
      const bucketsResult = await this.builders.taxonomyEngine.build(regionConfig);

      const poisPayload = JSON.parse(poiResult.contents || '{}');
      const bucketsPayload = JSON.parse(bucketsResult.contents || '{}');
      const metadata = this._createMetadata(regionConfig, artifactKey, targetDir, poisPayload.pois || [], bucketsPayload);

      const writes = [
        this._writeArtifactFile(targetDir, `${artifactKey}.pmtiles`, pmtilesResult.contents),
        this._writeArtifactFile(targetDir, `${artifactKey}-poi.json`, poiResult.contents),
        this._writeArtifactFile(targetDir, `${artifactKey}-buckets.json`, bucketsResult.contents),
        this._writeArtifactFile(targetDir, 'metadata.json', JSON.stringify(metadata, null, 2)),
        this._writeArtifactFile(targetDir, 'manifest.json', JSON.stringify(metadata, null, 2))
      ];
      await Promise.all(writes);
      regionResult.metadata = metadata;
      regionResult.pois = poisPayload.pois || [];
      regionResult.buckets = bucketsPayload;
      regionResult.ready = true;
      return regionResult;
    } catch (error) {
      await rm(targetDir, { recursive: true, force: true });
      throw new Error(`Failed to build region ${artifactKey}: ${error.message}`);
    }
  }

  async loadRegion(regionId, buildResult = null) {
    const artifactKey = regionId;
    const regionDir = path.join(projectRoot, 'regions', artifactKey);
    const metadataPath = path.join(regionDir, 'metadata.json');
    const metadata = await this._loadJson(metadataPath);
    if (!metadata) {
      if (buildResult) {
        return {
          id: artifactKey,
          name: buildResult.config.name || artifactKey,
          mapSource: { type: 'local', path: path.join('regions', artifactKey, `${artifactKey}.pmtiles`) },
          pois: buildResult.pois || [],
          buckets: buildResult.buckets || {},
          metadata: buildResult.metadata,
          ready: true,
          progress: 'Ready'
        };
      }
      throw new Error(`Region ${artifactKey} is not installed`);
    }

    const poiPath = path.join(regionDir, `${artifactKey}-poi.json`);
    const bucketsPath = path.join(regionDir, `${artifactKey}-buckets.json`);
    const pmtilesPath = path.join(regionDir, `${artifactKey}.pmtiles`);

    const [poiContents, bucketsContents] = await Promise.all([
      this._loadJson(poiPath),
      this._loadJson(bucketsPath)
    ]);

    return {
      id: artifactKey,
      name: metadata.name || artifactKey,
      mapSource: { type: 'local', path: path.join('regions', artifactKey, `${artifactKey}.pmtiles`) },
      pois: poiContents?.pois || [],
      buckets: bucketsContents || {},
      metadata,
      ready: true,
      progress: 'Ready'
    };
  }

  async discoverInstalledRegions() {
    const regionsRoot = path.join(projectRoot, 'regions');
    let entries = [];
    try {
      entries = await this._listDirectories(regionsRoot);
    } catch {
      return [];
    }

    const discovered = [];
    for (const entry of entries) {
      const metadataPath = path.join(regionsRoot, entry, 'metadata.json');
      const metadata = await this._loadJson(metadataPath);
      if (metadata) {
        discovered.push({ id: metadata.regionId || entry, name: metadata.name || entry, installed: true });
      }
    }
    return discovered;
  }

  async loadConfig(regionKey) {
    const configPath = path.join(projectRoot, 'regions', regionKey, 'region.json');
    const contents = await readFile(configPath, 'utf8');
    const config = JSON.parse(contents);
    config.regionKey = config.regionKey || config.id || regionKey;
    return config;
  }

  _createMetadata(regionConfig, artifactKey, targetDir, pois, buckets) {
    const bucketCount = Array.isArray(buckets?.universalBuckets) ? buckets.universalBuckets.length : 0;
    return {
      regionId: artifactKey,
      name: regionConfig.displayName || regionConfig.name || artifactKey,
      created: new Date().toISOString(),
      artifacts: {
        pmtiles: path.join('regions', artifactKey, `${artifactKey}.pmtiles`),
        poi: path.join('regions', artifactKey, `${artifactKey}-poi.json`),
        buckets: path.join('regions', artifactKey, `${artifactKey}-buckets.json`)
      },
      stats: {
        poiCount: Array.isArray(pois) ? pois.length : 0,
        bucketCount
      }
    };
  }

  async _writeArtifactFile(targetDir, fileName, contents) {
    const filePath = path.join(targetDir, fileName);
    await writeFile(filePath, contents, 'utf8');
  }

  async _loadJson(filePath) {
    try {
      const contents = await readFile(filePath, 'utf8');
      return JSON.parse(contents);
    } catch {
      return null;
    }
  }

  async _pathExists(filePath) {
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async _listDirectories(rootPath) {
    const entries = await readdir(rootPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  }

  _defaultConfig(regionKey) {
    return {
      name: regionKey,
      regionKey,
      description: `Auto-generated region for ${regionKey}`,
      type: 'city',
      boundary: { north: 0, south: 0, east: 0, west: 0 },
      osmExtraction: { tool: 'osmium', pbfSource: 'planet', extraTags: [] },
      poiSources: [],
      attribution: 'Local fallback region',
      featuredBuckets: []
    };
  }
}
