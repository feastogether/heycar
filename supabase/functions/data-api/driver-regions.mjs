export const driverRegions=['北部','中部','南部','花東','其他'];
// Preserve an unchanged legacy region in partial/document edits; never bulk-convert it.
export function validDriverRegionChange(record,previous=undefined){return !Object.hasOwn(record,'region')||driverRegions.includes(record.region)||previous!==undefined&&record.region===previous;}
