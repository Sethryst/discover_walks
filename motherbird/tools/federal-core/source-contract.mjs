/** Fail closed when a provider changes fields or declared vintage semantics. */
export async function inspectSourceContract(client, source) {
  const metadata = await client.layerMetadata(source.service, `${source.id} metadata`);
  const fields = new Set((metadata.fields || []).map((field) => field.name));
  for (const field of [source.idField, source.nameField, source.objectIdField || 'OBJECTID']) {
    if (!fields.has(field)) throw new Error(`${source.id}: configured field ${field} is absent from provider metadata`);
  }
  if (source.expectedDescriptionIncludes && !String(metadata.description || '').includes(source.expectedDescriptionIncludes)) {
    throw new Error(`${source.id}: provider vintage changed; expected metadata to include "${source.expectedDescriptionIncludes}"`);
  }
  if (!String(metadata.capabilities || '').split(',').includes('Query')) {
    throw new Error(`${source.id}: provider no longer declares Query capability`);
  }
  return {
    layerName: metadata.name,
    description: metadata.description || null,
    arcgisVersion: metadata.currentVersion,
    maxRecordCount: metadata.maxRecordCount,
    supportsPagination: metadata.advancedQueryCapabilities?.supportsPagination === true,
    supportedQueryFormats: metadata.supportedQueryFormats
  };
}
