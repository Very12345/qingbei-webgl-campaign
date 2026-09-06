import fs from "node:fs/promises";

const path = new URL("../src/osm-map-data-real.ts", import.meta.url);
const source = await fs.readFile(path, "utf8");
const regionData = JSON.parse(source.split("export const osmRegions = ", 2)[1].replace(/ as const;\s*$/, ""));
const region = regionData.main;
const [south, west, north, east] = region.bbox;
const latitude0 = ((south + north) / 2) * Math.PI / 180;
const metresPerLongitude = 111320 * Math.cos(latitude0);
const metresPerLatitude = 110574;
const scale = region.width / ((east - west) * metresPerLongitude);
const project = (latitude, longitude) => [
  Number(((longitude - (west + east) / 2) * metresPerLongitude * scale).toFixed(3)),
  Number((-(latitude - (south + north) / 2) * metresPerLatitude * scale).toFixed(3)),
];
const attributes = (value = "") => Object.fromEntries([...value.matchAll(/([\w:-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
const sameEndpoint = (first, second) => first === second;
const joinWays = (segments) => {
  const rings = [];
  while (segments.length) {
    const ring = segments.shift().slice();
    let joined = true;
    while (joined && segments.length) {
      joined = false;
      for (let index = 0; index < segments.length; index++) {
        const segment = segments[index];
        if (sameEndpoint(ring.at(-1), segment[0])) ring.push(...segment.slice(1));
        else if (sameEndpoint(ring.at(-1), segment.at(-1))) ring.push(...segment.slice().reverse().slice(1));
        else if (sameEndpoint(ring[0], segment.at(-1))) ring.unshift(...segment.slice(0, -1));
        else if (sameEndpoint(ring[0], segment[0])) ring.unshift(...segment.slice().reverse().slice(0, -1));
        else continue;
        segments.splice(index, 1);
        joined = true;
        break;
      }
    }
    if (ring.length >= 4 && ring[0] === ring.at(-1)) rings.push(ring);
  }
  return rings;
};

let relationCount = 0;
let holeCount = 0;
for (const water of region.waters) {
  if (water.osmType !== "relation") {
    water.holes = [];
    continue;
  }
  const response = await fetch(`https://api.openstreetmap.org/api/0.6/relation/${water.osmId}/full`, { headers: { "User-Agent": "QingbeiGameMapBuilder/2.1" } });
  if (!response.ok) throw new Error(`OSM relation ${water.osmId}: ${response.status}`);
  const xml = await response.text();
  const nodes = new Map([...xml.matchAll(/<node\b([^>]*?)(?:\/>|>[\s\S]*?<\/node>)/g)].map(match => {
    const data = attributes(match[1]);
    return [Number(data.id), [Number(data.lat), Number(data.lon)]];
  }));
  const ways = new Map([...xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)].map(match => {
    const data = attributes(match[1]);
    return [Number(data.id), [...match[2].matchAll(/<nd\b[^>]*ref="(\d+)"[^>]*\/>/g)].map(item => Number(item[1]))];
  }));
  const relationMatch = [...xml.matchAll(/<relation\b([^>]*)>([\s\S]*?)<\/relation>/g)].find(match => Number(attributes(match[1]).id) === water.osmId);
  if (!relationMatch) throw new Error(`OSM relation ${water.osmId}: relation body missing`);
  const innerWayIds = [...relationMatch[2].matchAll(/<member\b([^>]*)\/>/g)]
    .map(match => attributes(match[1]))
    .filter(member => member.type === "way" && member.role === "inner")
    .map(member => Number(member.ref));
  const rings = joinWays(innerWayIds.map(id => ways.get(id)).filter(Boolean));
  water.holes = rings.map(ring => ring.map(id => nodes.get(id)).filter(Boolean).map(([latitude, longitude]) => project(latitude, longitude))).filter(ring => ring.length >= 4);
  relationCount++;
  holeCount += water.holes.length;
}

await fs.writeFile(path, `// Generated ${new Date().toISOString()} from OpenStreetMap (ODbL) and Open-Meteo elevation data.\n// WGS84 equirectangular projection; full unclipped feature counts are preserved inside each declared bbox.\nexport const osmRegions = ${JSON.stringify(regionData)} as const;\n`);
console.log(JSON.stringify({ relations: relationCount, holes: holeCount }));
