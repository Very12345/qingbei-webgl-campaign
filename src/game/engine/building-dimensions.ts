import { BUILDING_HEIGHTS } from "../building-height-data";

type Building = { osmType: string; osmId: number; levels?: number };
type Region = { width: number; bbox: readonly number[] };

export const FLOOR_HEIGHT_METRES = 3.35;

// Use exactly the same horizontal metre scale as work/fetch-osm.mjs.
export function buildingMetreScale(region: Region): number {
  const [south, west, north, east] = region.bbox;
  const latitude = ((south + north) / 2) * Math.PI / 180;
  return region.width / ((east - west) * 111320 * Math.cos(latitude));
}

export function buildingHeightMetres(building: Building): number {
  const retained = BUILDING_HEIGHTS[`${building.osmType}/${building.osmId}`];
  if (retained) return retained[0];
  // Untagged buildings use a fixed four-storey estimate, never an OSM-ID random height.
  const levels = building.levels ?? 0;
  return (Number.isFinite(levels) && levels > 0 ? levels : 4) * FLOOR_HEIGHT_METRES;
}
