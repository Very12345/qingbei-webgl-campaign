import {writeFileSync} from "node:fs";
import {osmRegions} from "../src/osm-map-data-real";
import {makeFreshGame,pointInPolygon} from "../src/game/create-game";
import {photoSearchFor,sourceIdsForCampus} from "../src/game/real-campus-sources";
import {SATELLITE_ROOF_COLORS} from "../src/game/real-campus-satellite-colors";

type Campus="pku"|"thu";
type Roof="flat"|"gabled"|"hipped"|"pyramidal";
type Material="red-brick"|"gray-brick"|"stone"|"concrete"|"glass";
type VisualSignature="pku-library"|"pagoda"|"chinese-gate"|"white-arch-gate"|"xuetang"|"domed-auditorium"|"historic-library"|"historic-science"|"central-main"|"modern-auditorium"|"museum"|"twin-towers"|"dormitory"|"dining-hall"|"academic";
const region:any=osmRegions.main;
const campuses=(region.campuses as any[]).filter(c=>c.name==="北京大学"||c.name==="清华大学");
const game=makeFreshGame("real-campus-v1");
const sitesByKey=new Map(game.sites.filter(s=>s.osmKey).map(s=>[s.osmKey!,s]));
const satelliteRoofColors=SATELLITE_ROOF_COLORS as Record<string,{color:string;pixels:number;source:string}>;
type BuildingOverride=Partial<{levels:number;heightMeters:number;material:Material;roof:Roof;roofMeters:number;features:string[];sourceIds:string[];facadeColor:string;secondaryColor:string;roofColor:string;signature:VisualSignature;entranceDirection:number}>;
const overrides:Record<string,BuildingOverride>={
  "北大西门":{levels:1,heightMeters:8.5,material:"red-brick",roof:"flat",roofMeters:0,facadeColor:"#8b2f2b",secondaryColor:"#d4c6a9",roofColor:"#3f4b46",signature:"chinese-gate",entranceDirection:270,features:["gatehouse","traditional-eaves"],sourceIds:["pku-visit","pku-photo"]},
  "北京大学图书馆":{levels:5,heightMeters:25,material:"stone",roof:"flat",roofMeters:0,facadeColor:"#aaa596",secondaryColor:"#ddd5bf",roofColor:"#45524f",signature:"pku-library",entranceDirection:270,features:["three-part-library","sweeping-eaves","grand-stairs"],sourceIds:["pku-library","pku-heritage"]},
  "百周年纪念讲堂":{levels:4,heightMeters:25,material:"stone",roof:"flat",roofMeters:0,facadeColor:"#bdb29c",secondaryColor:"#d9d0bd",roofColor:"#6a6257",signature:"modern-auditorium",entranceDirection:180,features:["layered-terraces","octagonal-window","grand-stairs"],sourceIds:["pku-centennial"]},
  "中央主楼":{levels:10,heightMeters:40,material:"stone",roof:"flat",roofMeters:0,facadeColor:"#b8ae99",secondaryColor:"#ddd4bf",roofColor:"#66584b",signature:"central-main",entranceDirection:270,features:["central-tower","four-skybridges","classical-portal"],sourceIds:["thu-main","thu-planning"]},
  "主楼":{levels:10,heightMeters:40,material:"stone",roof:"flat",roofMeters:0,facadeColor:"#b8ae99",secondaryColor:"#ddd4bf",roofColor:"#66584b",signature:"central-main",entranceDirection:270,features:["central-tower","four-skybridges","classical-portal"],sourceIds:["thu-main","thu-planning"]},
  "二校门":{levels:1,heightMeters:8.5,material:"stone",roof:"flat",roofMeters:0,facadeColor:"#e3e0d7",secondaryColor:"#f3f0e7",roofColor:"#d5d1c7",signature:"white-arch-gate",entranceDirection:270,features:["three-arches","white-columns","inscription"],sourceIds:["thu-landscape","thu-gallery"]},
  "博雅塔":{levels:13,heightMeters:37,material:"gray-brick",roof:"flat",roofMeters:0,facadeColor:"#918d82",secondaryColor:"#c2b89f",roofColor:"#414b47",signature:"pagoda",features:["pagoda-tower","tiered-eaves"],sourceIds:["pku-visit","pku-photo"]},
  "清华学堂":{levels:2,heightMeters:13,material:"gray-brick",roof:"flat",roofMeters:0,facadeColor:"#a6a59d",secondaryColor:"#e4e0d5",roofColor:"#713f32",signature:"xuetang",entranceDirection:180,features:["inscribed-entrance","arched-windows","classical-portal"],sourceIds:["thu-landscape","thu-gallery"]},
  "大礼堂":{levels:3,heightMeters:30,material:"red-brick",roof:"flat",roofMeters:0,facadeColor:"#873f34",secondaryColor:"#ded8c8",roofColor:"#506b55",signature:"domed-auditorium",entranceDirection:180,features:["green-dome","white-colonnade","three-arches","grand-stairs"],sourceIds:["thu-landscape","thu-gallery","thu-planning","thu-auditorium"]},
  "科学馆":{levels:3,heightMeters:17,material:"red-brick",roof:"flat",roofMeters:0,facadeColor:"#87483b",secondaryColor:"#ded7c7",roofColor:"#5d5147",signature:"historic-science",entranceDirection:180,features:["classical-portal","symmetrical-wings"],sourceIds:["thu-landscape","thu-planning"]},
  "老馆":{levels:3,heightMeters:17,material:"red-brick",roof:"flat",roofMeters:0,facadeColor:"#814438",secondaryColor:"#d9d1bf",roofColor:"#514a42",signature:"historic-library",entranceDirection:180,features:["library-wings","arched-windows","stone-bands"],sourceIds:["thu-landscape","thu-planning"]},
  "老图书馆":{levels:3,heightMeters:17,material:"red-brick",roof:"flat",roofMeters:0,facadeColor:"#814438",secondaryColor:"#d9d1bf",roofColor:"#514a42",signature:"historic-library",entranceDirection:180,features:["library-wings","arched-windows","stone-bands"],sourceIds:["thu-landscape","thu-planning"]},
  "艺术博物馆":{levels:4,heightMeters:24,material:"stone",roof:"flat",roofMeters:0,facadeColor:"#a98665",secondaryColor:"#d1b898",roofColor:"#584b40",signature:"museum",features:["bronze-screen","sunken-entry","courtyard"],sourceIds:["thu-landscape","thu-gallery"]},
  "新清华学堂":{levels:5,heightMeters:28,material:"red-brick",roof:"flat",roofMeters:0,facadeColor:"#9a5948",secondaryColor:"#c9aa87",roofColor:"#51453d",signature:"modern-auditorium",features:["layered-terraces","grand-stairs","colonnade"],sourceIds:["thu-landscape","thu-gallery"]},
  "李兆基科技大楼":{levels:10,heightMeters:42,material:"glass",roof:"flat",roofMeters:0,facadeColor:"#718d99",secondaryColor:"#aeb9b6",roofColor:"#47545a",signature:"twin-towers",features:["modern-towers","podium","glass-curtain-wall"],sourceIds:["thu-landscape"]},
};
const campusOf=(building:any):Campus|null=>{
  const x=building.points.reduce((s:number,p:number[])=>s+p[0],0)/building.points.length;
  const z=building.points.reduce((s:number,p:number[])=>s+p[1],0)/building.points.length;
  for(const campus of campuses)if(pointInPolygon(x,z,campus.points))return campus.name==="北京大学"?"pku":"thu";
  return null;
};
const useFor=(name:string,site:any)=>site?.type??(/宿舍|公寓|\d+号楼|\d+楼/.test(name)?"dorm":/食堂|餐厅|园餐/.test(name)?"dining":/图书馆|老馆/.test(name)?"library":/体育|操场|游泳/.test(name)?"sports":/医院/.test(name)?"hospital":"teaching");
const levelsFor=(name:string,use:string,campus:Campus,known:number)=>known||(/塔/.test(name)?13:/主楼/.test(name)?10:/紫荆.*(?:楼|公寓)/.test(name)?11:use==="dorm"?(campus==="thu"?6:5):use==="dining"?3:use==="library"?6:use==="hospital"?6:use==="sports"?2:/大厦|中心|学院|研究院|科技/.test(name)?6:4);
const materialFor=(name:string,use:string,campus:Campus):Material=>{
  if(/学堂|礼堂|科学馆|老馆|同方|体育馆|斋/.test(name))return "red-brick";
  if(/塔|燕南园|办公楼|西门|古月|园/.test(name)&&use!=="dorm")return "gray-brick";
  if(/科技|大厦|中心|艺术博物馆|新清华|新奥|综合/.test(name))return "glass";
  if(use==="dorm"||use==="dining")return campus==="thu"?"red-brick":"gray-brick";
  return campus==="thu"?"red-brick":"stone";
};
const osmMaterial=(value:string):Material|undefined=>/glass/.test(value)?"glass":/brick/.test(value)?"red-brick":/stone|sandstone|limestone/.test(value)?"stone":/concrete|plaster|cement/.test(value)?"concrete":undefined;
const colorFor=(value:string,fallback:string)=>/^#?[0-9a-f]{6}$/i.test(value||"")?(value.startsWith("#")?value:`#${value}`):fallback;
const osmRoof=(value:string):Roof|undefined=>value==="flat"||value==="gabled"||value==="hipped"||value==="pyramidal"?value:undefined;
const roofFor=(name:string,_material:Material,_use:string):Roof=>/塔/.test(name)?"hipped":/大礼堂/.test(name)?"pyramidal":/学堂|科学馆|老馆|同方|古月堂|燕南园|西门|办公楼/.test(name)?"hipped":"flat";
const featuresFor=(name:string,use:string)=>/门$|校门/.test(name)?["gatehouse"]:/塔/.test(name)?["tower"]:/图书馆|老馆/.test(name)?["library-wings"]:/礼堂|学堂/.test(name)?["classical-portal","colonnade"]:use==="dorm"?["repeated-bays"]:use==="dining"?["entrance-canopy"]:["main-entrance"];
const signatureFor=(use:string):VisualSignature=>use==="dorm"?"dormitory":use==="dining"?"dining-hall":"academic";
const profiles:any[]=[];
for(const b of region.buildings as any[]){
  const campus=campusOf(b);if(!campus)continue;
  const key=`${b.osmType}/${b.osmId}`,site=sitesByKey.get(key),name=site?.name||b.name||`未命名校园建筑 ${key}`,use=useFor(name,site),override=overrides[b.name]||overrides[name]||{};
  const levels=override.levels??levelsFor(name,use,campus,b.levels||0),material=override.material??osmMaterial(b.material||"")??materialFor(name,use,campus),roof=override.roof??osmRoof(b.roofShape||"")??roofFor(name,material,use);
  const roofMeters=override.roofMeters??b.roofHeight??(roof==="flat"?0:roof==="pyramidal"?Math.min(6,levels*.55):Math.min(3.2,levels*.38));
  const fallbackFacade=material==="red-brick"?"#8b5a49":material==="gray-brick"?"#8b8880":material==="glass"?"#7896a2":material==="stone"?"#b1aa98":"#a7aaa3",fallbackRoof=roof==="flat"?"#777b78":campus==="thu"?"#795145":"#696761";
  const heightMeters=override.heightMeters??(b.height||Number((levels*(use==="dining"?4.2:use==="library"?4.4:use==="sports"?4.8:3.45)+roofMeters).toFixed(1)));
  profiles.push({key,campus,name,use,levels,heightMeters,material,facadeColor:override.facadeColor??colorFor(b.colour||"",fallbackFacade),secondaryColor:override.secondaryColor??(material==="red-brick"?"#d2c5ab":material==="glass"?"#a7babd":"#d6d0bf"),roof,roofMeters,roofColor:override.roofColor??colorFor(b.roofColour||"",satelliteRoofColors[key]?.color??fallbackRoof),satelliteRoofEvidence:satelliteRoofColors[key]?.source??null,entranceDirection:override.entranceDirection??null,startDate:b.startDate||"",signature:override.signature??signatureFor(use),features:override.features??featuresFor(name,use),siteId:site?.id??null,confidence:override.heightMeters?"official":b.height||b.levels?"osm":"estimated",verification:override.heightMeters?"verified-official":b.height||b.levels?"verified-osm":"pending-field-check",sourceIds:[...new Set([...sourceIdsForCampus(campus),...(override.sourceIds??[])])],outlineUrl:`https://www.openstreetmap.org/${b.osmType}/${b.osmId}`,photoSearch:photoSearchFor(name)});
}
profiles.sort((a,b)=>a.key.localeCompare(b.key));
const profileBySite=new Map(profiles.filter(p=>p.siteId!=null).map(p=>[p.siteId,p]));
const landmarkOnly:Record<string,BuildingOverride>={
  "北大西门":overrides["北大西门"],
  "北大东门":{heightMeters:8,material:"red-brick",facadeColor:"#88312c",secondaryColor:"#d8c9ad",roofColor:"#414b46",signature:"chinese-gate",features:["gatehouse","traditional-eaves"],sourceIds:["pku-visit","pku-photo"]},
  "清华西门":{heightMeters:9,material:"stone",facadeColor:"#d7d3c8",secondaryColor:"#eeeae0",roofColor:"#565c54",signature:"white-arch-gate",features:["three-arches","white-columns"],sourceIds:["thu-landscape","thu-gallery"]},
  "二校门":overrides["二校门"],
  "清华南门":{heightMeters:10,material:"stone",facadeColor:"#b8b1a3",secondaryColor:"#ded8ca",roofColor:"#5e554b",signature:"white-arch-gate",features:["three-arches","gatehouse"],sourceIds:["thu-map","thu-gallery"]},
  "清华东南门":{heightMeters:10,material:"stone",facadeColor:"#b8b1a3",secondaryColor:"#ded8ca",roofColor:"#5e554b",signature:"white-arch-gate",features:["three-arches","gatehouse"],sourceIds:["thu-map","thu-gallery"]},
};
const landmarks=game.sites.map(site=>{
  const base=profileBySite.get(site.id),campus:Campus=site.team,visual=base??landmarkOnly[site.name]??{},material=visual.material??(/门|塔/.test(site.name)?"stone":campus==="thu"?"red-brick":"gray-brick"),facadeColor=visual.facadeColor??(material==="red-brick"?"#8a5144":material==="glass"?"#718e9b":material==="stone"?"#b7ae9c":"#96938a"),secondaryColor=visual.secondaryColor??"#d8d0bc",roofColor=visual.roofColor??(campus==="thu"?"#624b40":"#4f5550");
  return {siteId:site.id,key:site.osmKey!,name:site.name,campus,type:site.type,x:site.x,z:site.z,heightMeters:visual.heightMeters??(/塔/.test(site.name)?37:/门/.test(site.name)?8.5:12),material,facadeColor,secondaryColor,roofColor,roof:visual.roof??(/塔/.test(site.name)?"hipped":"flat"),entranceDirection:visual.entranceDirection??null,signature:visual.signature??signatureFor(site.type),features:visual.features??featuresFor(site.name,site.type),sourceIds:[...new Set([...sourceIdsForCampus(campus),...(visual.sourceIds??[])])],outlineUrl:`https://www.openstreetmap.org/${site.osmKey!}`,photoReferenceChannels:[campus==="pku"?"pku-visit":"thu-landscape",campus==="pku"?"pku-photo":"thu-gallery",campus==="pku"?"pku-commons":"thu-commons"],photoAngles:{front:"pending-verification",side:"pending-verification",oblique:"pending-verification"},photoSearch:photoSearchFor(site.name),confidence:base?.confidence??(visual.heightMeters?"official":"estimated"),verification:base?.verification??(visual.heightMeters?"verified-official":"pending-field-check")};
});
const output=`// Generated by scripts/build-real-campus-data.ts. Do not hand-edit.\nexport const REAL_CAMPUS_BUILDINGS = ${JSON.stringify(profiles)} as const;\nexport const REAL_CAMPUS_LANDMARKS = ${JSON.stringify(landmarks)} as const;\n`;
writeFileSync(new URL("../src/game/real-campus-data.ts",import.meta.url),output);
const csv=(rows:any[],columns:string[])=>[columns.join(","),...rows.map(row=>columns.map(column=>`"${String(row[column]??"").replaceAll('"','""')}"`).join(","))].join("\n")+"\n";
writeFileSync(new URL("../docs/real-campus-building-audit.csv",import.meta.url),csv(profiles.map(profile=>({...profile,features:profile.features.join("|"),sourceIds:profile.sourceIds.join("|")})),["key","campus","name","use","levels","heightMeters","material","facadeColor","secondaryColor","roof","roofMeters","roofColor","satelliteRoofEvidence","entranceDirection","startDate","signature","features","siteId","confidence","verification","sourceIds","outlineUrl","photoSearch"]));
writeFileSync(new URL("../docs/real-campus-landmark-audit.csv",import.meta.url),csv(landmarks.map(landmark=>({...landmark,features:landmark.features.join("|"),sourceIds:landmark.sourceIds.join("|"),photoReferenceChannels:landmark.photoReferenceChannels.join("|")})),["siteId","key","name","campus","type","x","z","heightMeters","material","facadeColor","secondaryColor","roofColor","roof","entranceDirection","signature","features","confidence","verification","sourceIds","outlineUrl","photoReferenceChannels","photoSearch"]));
console.log(JSON.stringify({buildings:profiles.length,sites:landmarks.length,buildingSites:profiles.filter(p=>p.siteId!=null).length,official:profiles.filter(p=>p.confidence==="official").length,osm:profiles.filter(p=>p.confidence==="osm").length,estimated:profiles.filter(p=>p.confidence==="estimated").length}));
