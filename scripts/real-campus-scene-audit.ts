import assert from "node:assert/strict";
import {statSync,writeFileSync,readFileSync} from "node:fs";
import {osmRegions} from "../src/osm-map-data-real";
import {REAL_CAMPUS_BUILDINGS,REAL_CAMPUS_LANDMARKS} from "../src/game/real-campus-data";
import {SATELLITE_ROOF_COLORS} from "../src/game/real-campus-satellite-colors";
import {SATELLITE_TREE_POINTS} from "../src/game/real-campus-satellite-trees";
import {pointInPolygon} from "../src/game/create-game";

const region:any=osmRegions.main;
const campusPolygons=region.campuses.filter((campus:any)=>campus.name==="北京大学"||campus.name==="清华大学");
const center=(points:readonly (readonly number[])[])=>[points.reduce((sum,point)=>sum+point[0],0)/points.length,points.reduce((sum,point)=>sum+point[1],0)/points.length] as const;
const insideCampus=(x:number,z:number)=>campusPolygons.some((campus:any)=>pointInPolygon(x,z,campus.points));
const campusBuildings=region.buildings.filter((building:any)=>{const [x,z]=center(building.points);return insideCampus(x,z);});
const physicalWidthMeters=(region.bbox[3]-region.bbox[1])*111320*Math.cos(((region.bbox[0]+region.bbox[2])/2)*Math.PI/180);
const metersPerWorld=physicalWidthMeters/region.width;
const terrainValues=[...region.terrain.heights] as number[];
let maxTerrainNeighbor=0;
for(let z=0;z<region.terrain.rows;z++)for(let x=0;x<region.terrain.cols;x++){const index=z*region.terrain.cols+x;if(x+1<region.terrain.cols)maxTerrainNeighbor=Math.max(maxTerrainNeighbor,Math.abs(terrainValues[index]-terrainValues[index+1]));if(z+1<region.terrain.rows)maxTerrainNeighbor=Math.max(maxTerrainNeighbor,Math.abs(terrainValues[index]-terrainValues[index+region.terrain.cols]));}
const polygonArea=(points:readonly (readonly number[])[])=>Math.abs(points.reduce((sum,point,index)=>{const next=points[(index+1)%points.length];return sum+point[0]*next[1]-next[0]*point[1];},0)/2);
const hectares=(areas:any[])=>Number((areas.reduce((sum,area)=>sum+polygonArea(area.points),0)*metersPerWorld*metersPerWorld/10000).toFixed(2));
const waterHectares=(areas:any[])=>Number((areas.reduce((sum,area)=>sum+polygonArea(area.points)-(area.holes??[]).reduce((holeSum:number,hole:number[][])=>holeSum+polygonArea(hole),0),0)*metersPerWorld*metersPerWorld/10000).toFixed(2));
const campusRoads=region.roads.filter((road:any)=>road.points.some((point:number[])=>insideCampus(point[0],point[1]))),
  campusLandcovers=region.landcovers.filter((area:any)=>{const [x,z]=center(area.points);return insideCampus(x,z);}),
  campusHardscapes=region.hardscapes.filter((area:any)=>{const [x,z]=center(area.points);return insideCampus(x,z);}),
  campusWaters=region.waters.filter((area:any)=>{const [x,z]=center(area.points);return insideCampus(x,z);}),
  campusOsmTrees=region.trees.filter((point:number[])=>insideCampus(point[0],point[1])),
  campusTreeRows=region.treeRows.filter((row:number[][])=>row.some(point=>insideCampus(point[0],point[1])));

const cross=(a:readonly number[],b:readonly number[],c:readonly number[])=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const intersects=(a:readonly number[],b:readonly number[],c:readonly number[],d:readonly number[])=>{
  const ab1=cross(a,b,c),ab2=cross(a,b,d),cd1=cross(c,d,a),cd2=cross(c,d,b);
  return ab1*ab2<-.00000001&&cd1*cd2<-.00000001;
};
const selfIntersecting:string[]=[];
for(const building of campusBuildings){
  const points=building.points.filter((point:number[],index:number,values:number[][])=>!index||Math.hypot(point[0]-values[index-1][0],point[1]-values[index-1][1])>.0001);
  for(let first=0;first<points.length;first++)for(let second=first+2;second<points.length;second++){
    if(first===0&&second===points.length-1)continue;
    if(intersects(points[first],points[(first+1)%points.length],points[second],points[(second+1)%points.length])){selfIntersecting.push(`${building.osmType}/${building.osmId}`);first=points.length;break;}
  }
}
const campusMeasures=campusBuildings.map((building:any)=>{const [centerX,centerZ]=center(building.points);return {building,centerX,centerZ,area:polygonArea(building.points),minX:Math.min(...building.points.map((point:number[])=>point[0])),maxX:Math.max(...building.points.map((point:number[])=>point[0])),minZ:Math.min(...building.points.map((point:number[])=>point[1])),maxZ:Math.max(...building.points.map((point:number[])=>point[1]))};});
const suppressedNestedAnonymous=campusMeasures.filter(candidate=>!candidate.building.name&&campusMeasures.some(other=>other!==candidate&&other.area>candidate.area*1.2&&candidate.centerX>=other.minX&&candidate.centerX<=other.maxX&&candidate.centerZ>=other.minZ&&candidate.centerZ<=other.maxZ&&pointInPolygon(candidate.centerX,candidate.centerZ,other.building.points))).length;
const buildingsInRenderedWater=region.buildings.filter((building:any)=>{const [x,z]=center(building.points);return region.waters.some((water:any)=>pointInPolygon(x,z,water.points)&&!(water.holes??[]).some((hole:number[][])=>pointInPolygon(x,z,hole)));});
const waterHoleCount=region.waters.reduce((sum:number,water:any)=>sum+(water.holes?.length??0),0);

const roadKinds:Record<string,number>={},landcoverKinds:Record<string,number>={},hardscapeKinds:Record<string,number>={};
for(const road of region.roads)roadKinds[road.kind]=(roadKinds[road.kind]??0)+1;
for(const area of region.landcovers)landcoverKinds[area.kind]=(landcoverKinds[area.kind]??0)+1;
for(const area of region.hardscapes)hardscapeKinds[area.kind]=(hardscapeKinds[area.kind]??0)+1;
type AuditEndpoint={x:number;z:number;pedestrian:boolean;roadIndex:number};
type AuditSegment={x1:number;z1:number;x2:number;z2:number;pedestrian:boolean;roadIndex:number};
const campusEndpoints:AuditEndpoint[]=[],campusSegments:AuditSegment[]=[],segmentCell=.35,segmentIndex=new Map<string,AuditSegment[]>();
const pedestrianKinds=new Set(["footway","path","pedestrian","steps","cycleway","corridor"]);
for(const [roadIndex,road] of region.roads.entries()){
  const pedestrian=pedestrianKinds.has(road.kind);
  for(const point of [road.points[0],road.points.at(-1)])if(point&&insideCampus(point[0],point[1]))campusEndpoints.push({x:point[0],z:point[1],pedestrian,roadIndex});
  for(let index=1;index<road.points.length;index++){const first=road.points[index-1],second=road.points[index],midX=(first[0]+second[0])/2,midZ=(first[1]+second[1])/2;if(insideCampus(midX,midZ))campusSegments.push({x1:first[0],z1:first[1],x2:second[0],z2:second[1],pedestrian,roadIndex});}
}
for(const segment of campusSegments)for(let gx=Math.floor((Math.min(segment.x1,segment.x2)-.14)/segmentCell);gx<=Math.floor((Math.max(segment.x1,segment.x2)+.14)/segmentCell);gx++)for(let gz=Math.floor((Math.min(segment.z1,segment.z2)-.14)/segmentCell);gz<=Math.floor((Math.max(segment.z1,segment.z2)+.14)/segmentCell);gz++){const key=`${gx}/${gz}`,bucket=segmentIndex.get(key);if(bucket)bucket.push(segment);else segmentIndex.set(key,[segment]);}
let directConnections=0,visuallyStitched=0,tJunctionStitched=0,unmatched=0;
for(let index=0;index<campusEndpoints.length;index++){
  const endpoint=campusEndpoints[index];let nearest=Infinity;
  for(let other=0;other<campusEndpoints.length;other++)if(other!==index&&campusEndpoints[other].roadIndex!==endpoint.roadIndex&&campusEndpoints[other].pedestrian===endpoint.pedestrian)nearest=Math.min(nearest,Math.hypot(endpoint.x-campusEndpoints[other].x,endpoint.z-campusEndpoints[other].z));
  if(nearest<=.004){directConnections++;continue;}
  if(nearest<=.32){visuallyStitched++;continue;}
  const gx=Math.floor(endpoint.x/segmentCell),gz=Math.floor(endpoint.z/segmentCell);let nearestSegment=Infinity;
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const segment of segmentIndex.get(`${gx+dx}/${gz+dz}`)??[]){if(segment.roadIndex===endpoint.roadIndex||segment.pedestrian!==endpoint.pedestrian)continue;const sx=segment.x2-segment.x1,sz=segment.z2-segment.z1,length=sx*sx+sz*sz,t=length?Math.max(0,Math.min(1,((endpoint.x-segment.x1)*sx+(endpoint.z-segment.z1)*sz)/length)):0,x=segment.x1+sx*t,z=segment.z1+sz*t;nearestSegment=Math.min(nearestSegment,Math.hypot(endpoint.x-x,endpoint.z-z));}
  if(nearestSegment>.004&&nearestSegment<=.14)tJunctionStitched++;else unmatched++;
}

const profileConfidence=REAL_CAMPUS_BUILDINGS.reduce((result:Record<string,number>,profile)=>{result[profile.confidence]=(result[profile.confidence]??0)+1;return result;},{});
const renderer=readFileSync(new URL("../src/game/engine/use-battlefield.ts",import.meta.url),"utf8");
const report={
  generatedAt:new Date().toISOString(),
  projection:{metersPerWorld:Number(metersPerWorld.toFixed(3)),terrainGrid:`${region.terrain.cols}x${region.terrain.rows}`,terrainSamples:region.terrain.heights.length,visualVerticalScale:1,heightRangeMeters:Number(((Math.max(...terrainValues)-Math.min(...terrainValues))*metersPerWorld).toFixed(2)),maxNeighborStepMeters:Number((maxTerrainNeighbor*metersPerWorld).toFixed(2))},
  buildings:{all:region.buildings.length,campus:campusBuildings.length,renderedCampus:campusBuildings.length-suppressedNestedAnonymous,suppressedNestedAnonymous,campusFootprintHectares:hectares(campusBuildings),landmarks:REAL_CAMPUS_LANDMARKS.length,profiles:REAL_CAMPUS_BUILDINGS.length,confidence:profileConfidence,satelliteRoofSamples:Object.keys(SATELLITE_ROOF_COLORS).length,selfIntersecting:selfIntersecting.length,selfIntersectingKeys:selfIntersecting},
  roads:{all:region.roads.length,campusFeatures:campusRoads.length,kinds:roadKinds,named:region.roads.filter((road:any)=>road.name).length,surfaceTagged:region.roads.filter((road:any)=>road.surface).length,bridgeTagged:region.roads.filter((road:any)=>road.bridge).length,sidewalkTagged:region.roads.filter((road:any)=>road.sidewalk).length,minWidthMeters:Number((Math.min(...region.roads.map((road:any)=>road.width))*metersPerWorld).toFixed(2)),maxWidthMeters:Number((Math.max(...region.roads.map((road:any)=>road.width))*metersPerWorld).toFixed(2)),estimatedSurfaceHectares:Number((region.roads.reduce((sum:number,road:any)=>sum+road.points.slice(1).reduce((length:number,point:number[],index:number)=>length+Math.hypot(point[0]-road.points[index][0],point[1]-road.points[index][1]),0)*road.width,0)*metersPerWorld*metersPerWorld/10000).toFixed(2)),campusEndpoints:campusEndpoints.length,directEndpointConnections:directConnections,nearEndpointConnectors:visuallyStitched,tJunctionConnectors:tJunctionStitched,legitimateOrUnresolvedDeadEnds:unmatched},
  ground:{landcovers:region.landcovers.length,campusLandcovers:campusLandcovers.length,landcoverKinds,landcoverHectares:hectares(region.landcovers),campusLandcoverHectares:hectares(campusLandcovers),hardscapes:region.hardscapes.length,campusHardscapes:campusHardscapes.length,hardscapeKinds,hardscapeHectares:hectares(region.hardscapes),campusHardscapeHectares:hectares(campusHardscapes),waters:region.waters.length,campusWaters:campusWaters.length,waterHoles:waterHoleCount,buildingsInRenderedWater:buildingsInRenderedWater.length,waterHectares:waterHectares(region.waters),campusWaterHectares:waterHectares(campusWaters)},
  trees:{osmPoints:region.trees.length,campusOsmPoints:campusOsmTrees.length,osmRows:region.treeRows.length,campusOsmRows:campusTreeRows.length,satelliteCandidates:{pku:SATELLITE_TREE_POINTS.pku.length,thu:SATELLITE_TREE_POINTS.thu.length},renderCap:2600,visualFamilies:4},
  materials:{macroBytes:statSync(new URL("../public/materials/campus-macro-variation.webp",import.meta.url)).size,surfaceMaskBytes:statSync(new URL("../public/materials/campus-surface-mask.png",import.meta.url)).size,nightLightBytes:statSync(new URL("../public/materials/campus-night-light-mask.png",import.meta.url)).size,leafAlbedoBytes:statSync(new URL("../public/materials/campus-leaf-albedo.webp",import.meta.url)).size,trackAlbedoBytes:statSync(new URL("../public/materials/campus-track-albedo.webp",import.meta.url)).size,roofAlbedoBytes:statSync(new URL("../public/materials/campus-roof-detail.webp",import.meta.url)).size,waterAlbedoBytes:statSync(new URL("../public/materials/campus-water-albedo.webp",import.meta.url)).size,worldSpaceMacroShader:renderer.includes("campusMacroUv"),multiSampledGrass:renderer.includes("campusGrassUvA")&&renderer.includes("campusGrassUvB"),batchedRoofMaterial:renderer.includes("applyCampusBuildingSurface")&&renderer.includes("campusRoofFactor")&&!renderer.includes("buildingMaterialGroups"),unifiedTerrainRoadSurface:renderer.includes("applyCampusSurface")&&renderer.includes("campusTextures?.surfaceMask && !road.bridge"),stableNightBuildings:renderer.includes("buildings.frustumCulled = false")&&renderer.includes("mesh.visible = !realCampus")&&renderer.includes("campusNightRoadMaterials"),cohesiveNaturalMaterials:renderer.includes("treeCrownClusters")&&renderer.includes("campusTextures?.track")&&renderer.includes("campusTextures?.water"),genericRoofPlateRemoved:!renderer.includes("length * 0.94, 0.03, depth * 0.92, roof"),separateFacadeRoofVertices:renderer.includes("const roofVertex")&&renderer.includes("realCampus ? wallTone.r : roofTone.r"),terrainConformingFoundations:renderer.includes("Math.max(centerBase, ...pts.map"),windowSpatialBatches:renderer.includes("campusWindowCenter"),sparseNightWindows:renderer.includes("hash%100>=18")},
};
assert.equal(campusBuildings.length,925);
assert.equal(REAL_CAMPUS_LANDMARKS.length,143);
assert.equal(selfIntersecting.length,0,`self-intersecting campus buildings: ${selfIntersecting.slice(0,8).join(", ")}`);
assert.ok(waterHoleCount>0&&buildingsInRenderedWater.length===0,"water relation holes are incomplete");
assert.ok(report.roads.minWidthMeters>=1&&report.roads.maxWidthMeters<=30,"road width outside audited range");
assert.ok(report.projection.heightRangeMeters<40&&report.projection.maxNeighborStepMeters<10,"terrain contains an implausible elevation cliff");
assert.ok(report.materials.worldSpaceMacroShader&&report.materials.multiSampledGrass&&report.materials.batchedRoofMaterial&&report.materials.unifiedTerrainRoadSurface&&report.materials.stableNightBuildings&&report.materials.cohesiveNaturalMaterials&&report.materials.genericRoofPlateRemoved&&report.materials.separateFacadeRoofVertices&&report.materials.terrainConformingFoundations&&report.materials.windowSpatialBatches&&report.materials.sparseNightWindows,"material/terrain regression");
writeFileSync(new URL("../docs/real-campus-scene-audit.json",import.meta.url),JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
