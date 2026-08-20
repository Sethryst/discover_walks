export class RegionPackage {
  constructor({ id, manifest, pmtilesBlob, poiData, bucketsData }) {
    this.id = id;
    this.manifest = manifest;
    this.pmtilesBlob = pmtilesBlob;
    this.poiData = poiData;
    this.bucketsData = bucketsData;
  }

  get name() {
    return this.manifest?.name || this.id;
  }
}
