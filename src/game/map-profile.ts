import {REAL_CAMPUS_BUILDINGS,REAL_CAMPUS_LANDMARKS} from "./real-campus-data";
import {osmRegions as classicRegions} from "../osm-map-data";
import {osmRegions as realRegions} from "../osm-map-data-real";

export type MapProfile = "classic" | "real-campus-v1";
export const DEFAULT_MAP_PROFILE: MapProfile = "real-campus-v1";
export const MAP_GEOMETRY_VERSION = 1;
export const MAP_PROFILES: Array<{id:MapProfile;title:string;detail:string}> = [
  {id:"real-campus-v1",title:"2026真实校园",detail:"固定建筑高度、材质、屋顶与校园景观"},
];

export type RealCampusBuilding = (typeof REAL_CAMPUS_BUILDINGS)[number];
export type RealCampusLandmark = (typeof REAL_CAMPUS_LANDMARKS)[number];
export const REAL_BUILDING_BY_KEY = new Map<string,RealCampusBuilding>(REAL_CAMPUS_BUILDINGS.map(item=>[item.key,item]));
export const REAL_LANDMARK_BY_SITE = new Map<number,RealCampusLandmark>(REAL_CAMPUS_LANDMARKS.map(item=>[item.siteId,item]));
export const REAL_LANDMARK_BY_KEY = new Map<string,RealCampusLandmark>(REAL_CAMPUS_LANDMARKS.map(item=>[item.key,item]));
export const isRealCampus = (profile: MapProfile | undefined) => profile === "real-campus-v1";
export const mapRegionsFor = (profile: MapProfile | undefined) => isRealCampus(profile) ? realRegions : classicRegions;
