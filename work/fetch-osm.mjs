import fs from 'node:fs/promises';

// Every x/z pair is derived from WGS84 with one uniform metres-to-world scale.
// The main region is tiled only to keep Overpass requests reliable; the tiles
// cover the full declared rectangle without gaps.
const regionSpecs = [
  { id:'main',label:'燕园—清华园及相连片区',bbox:[39.974,116.284,40.027,116.353],width:132,offsetX:0,tiles:[4,4] },
];
const regions=regionSpecs.map(spec=>{
  const [s,w,n,e]=spec.bbox,lat0=(s+n)/2*Math.PI/180,metresWide=(e-w)*111320*Math.cos(lat0),metresDeep=(n-s)*110574;
  const depth=Number((spec.width*metresDeep/metresWide).toFixed(3)),boxes=[];
  for(let j=0;j<spec.tiles[0];j++)for(let i=0;i<spec.tiles[1];i++)boxes.push([s+(n-s)*j/spec.tiles[0],w+(e-w)*i/spec.tiles[1],s+(n-s)*(j+1)/spec.tiles[0],w+(e-w)*(i+1)/spec.tiles[1]]);
  return {...spec,depth,boxes};
});
const highwayWidth={motorway:1.3,trunk:1.15,primary:1,secondary:.86,tertiary:.72,residential:.55,service:.38,living_street:.46,pedestrian:.34,footway:.22,path:.18,cycleway:.24,track:.28,steps:.2,corridor:.16};
const osmApiEndpoints=['https://api.openstreetmap.org/api/0.6/map','https://www.openstreetmap.org/api/0.6/map'];

function project(lat,lon,r){
  const [s,w,n,e]=r.bbox,lat0=(s+n)/2*Math.PI/180,metresPerLon=111320*Math.cos(lat0),metresPerLat=110574,scale=r.width/((e-w)*metresPerLon);
  return [r.offsetX+(lon-(w+e)/2)*metresPerLon*scale,-(lat-(s+n)/2)*metresPerLat*scale];
}
function rect(r){return {minX:r.offsetX-r.width/2,maxX:r.offsetX+r.width/2,minZ:-r.depth/2,maxZ:r.depth/2};}
function inside([x,z],b){return x>=b.minX-.001&&x<=b.maxX+.001&&z>=b.minZ-.001&&z<=b.maxZ+.001;}
function clipSegment(a,b,box){
  const dx=b[0]-a[0],dz=b[1]-a[1],p=[-dx,dx,-dz,dz],q=[a[0]-box.minX,box.maxX-a[0],a[1]-box.minZ,box.maxZ-a[1]];let u1=0,u2=1;
  for(let i=0;i<4;i++){if(Math.abs(p[i])<1e-10){if(q[i]<0)return null;continue;}const t=q[i]/p[i];if(p[i]<0)u1=Math.max(u1,t);else u2=Math.min(u2,t);if(u1>u2)return null;}
  return [[a[0]+u1*dx,a[1]+u1*dz],[a[0]+u2*dx,a[1]+u2*dz]];
}
function clipPolyline(points,box){
  const lines=[];let line=[];for(let i=1;i<points.length;i++){const seg=clipSegment(points[i-1],points[i],box);if(!seg){if(line.length>1)lines.push(line);line=[];continue;}const [a,b]=seg,last=line.at(-1);if(!last||Math.hypot(last[0]-a[0],last[1]-a[1])>.002){if(line.length>1)lines.push(line);line=[a];}line.push(b);}if(line.length>1)lines.push(line);return lines;
}
function clipPolygon(points,box){
  let out=points.slice();const edges=[
    {in:p=>p[0]>=box.minX,hit:(a,b)=>[box.minX,a[1]+(b[1]-a[1])*(box.minX-a[0])/(b[0]-a[0])]},
    {in:p=>p[0]<=box.maxX,hit:(a,b)=>[box.maxX,a[1]+(b[1]-a[1])*(box.maxX-a[0])/(b[0]-a[0])]},
    {in:p=>p[1]>=box.minZ,hit:(a,b)=>[a[0]+(b[0]-a[0])*(box.minZ-a[1])/(b[1]-a[1]),box.minZ]},
    {in:p=>p[1]<=box.maxZ,hit:(a,b)=>[a[0]+(b[0]-a[0])*(box.maxZ-a[1])/(b[1]-a[1]),box.maxZ]},
  ];for(const edge of edges){const input=out;out=[];if(!input.length)break;let a=input.at(-1);for(const b of input){const ai=edge.in(a),bi=edge.in(b);if(bi){if(!ai)out.push(edge.hit(a,b));out.push(b);}else if(ai)out.push(edge.hit(a,b));a=b;}}
  return out.filter((p,i,a)=>!i||Math.hypot(p[0]-a[i-1][0],p[1]-a[i-1][1])>.001);
}
function sameGeo(a,b){return Math.abs(a.lat-b.lat)<1e-7&&Math.abs(a.lon-b.lon)<1e-7;}
function geometrySets(el){
  if(el.geometry?.length)return [el.geometry];
  const segments=(el.members||[]).filter(m=>(!m.role||m.role==='outer')&&m.geometry?.length).map(m=>m.geometry.slice()),rings=[];
  while(segments.length){const ring=segments.shift();let joined=true;while(joined&&segments.length){joined=false;for(let i=0;i<segments.length;i++){const s=segments[i];if(sameGeo(ring.at(-1),s[0]))ring.push(...s.slice(1));else if(sameGeo(ring.at(-1),s.at(-1)))ring.push(...s.reverse().slice(1));else if(sameGeo(ring[0],s.at(-1)))ring.unshift(...s.slice(0,-1));else if(sameGeo(ring[0],s[0]))ring.unshift(...s.reverse().slice(0,-1));else continue;segments.splice(i,1);joined=true;break;}}if(ring.length>=3)rings.push(ring);}
  return rings;
}
function decodeXml(value=''){return value.replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)));}
function attributes(source=''){const out={};for(const match of source.matchAll(/([\w:-]+)="([^"]*)"/g))out[match[1]]=decodeXml(match[2]);return out;}
function parseTags(body=''){const out={};for(const match of body.matchAll(/<tag\b([^>]*)\/>/g)){const a=attributes(match[1]);if(a.k)out[a.k]=a.v||'';}return out;}
function parseOsm(xml){
  const nodes=[],ways=[],relations=[];for(const match of xml.matchAll(/<node\b([^>]*?)(?:\/>|>([\s\S]*?)<\/node>)/g)){const a=attributes(match[1]);nodes.push({id:Number(a.id),lat:Number(a.lat),lon:Number(a.lon),tags:parseTags(match[2])});}
  for(const match of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)){const a=attributes(match[1]),body=match[2],refs=[...body.matchAll(/<nd\b[^>]*ref="(\d+)"[^>]*\/>/g)].map(x=>Number(x[1]));ways.push({id:Number(a.id),refs,tags:parseTags(body)});}
  for(const match of xml.matchAll(/<relation\b([^>]*)>([\s\S]*?)<\/relation>/g)){const a=attributes(match[1]),body=match[2],members=[...body.matchAll(/<member\b([^>]*)\/>/g)].map(x=>{const m=attributes(x[1]);return {type:m.type,ref:Number(m.ref),role:m.role||''};});relations.push({id:Number(a.id),members,tags:parseTags(body)});}
  return {nodes,ways,relations};
}
async function fetchOsmXml(box,label){
  const [s,w,n,e]=box,query=`bbox=${w},${s},${e},${n}`;for(let attempt=0;attempt<3;attempt++){for(const base of osmApiEndpoints){try{const res=await fetch(`${base}?${query}`,{headers:{'User-Agent':'QingbeiGameMapBuilder/2.0'}});if(res.ok)return await res.text();console.warn(label,base,res.status);}catch(error){console.warn(label,base,error.message);}}await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));}
  throw new Error(`OpenStreetMap API failed: ${label}`);
}
async function fetchOsm(r){
  const nodes=new Map(),ways=new Map(),relations=new Map();let tile=0;for(const box of r.boxes){const parsed=parseOsm(await fetchOsmXml(box,`${r.id} tile ${++tile}/${r.boxes.length}`));for(const x of parsed.nodes)nodes.set(x.id,x);for(const x of parsed.ways)ways.set(x.id,x);for(const x of parsed.relations)relations.set(x.id,x);console.log(r.id,`tile ${tile}/${r.boxes.length}`);}
  const elements=[];for(const node of nodes.values())elements.push({type:'node',...node,center:{lat:node.lat,lon:node.lon}});
  for(const way of ways.values()){const geometry=way.refs.map(id=>nodes.get(id)).filter(Boolean).map(n=>({lat:n.lat,lon:n.lon}));if(!geometry.length)continue;const lats=geometry.map(p=>p.lat),lons=geometry.map(p=>p.lon);elements.push({type:'way',id:way.id,tags:way.tags,geometry,center:{lat:(Math.min(...lats)+Math.max(...lats))/2,lon:(Math.min(...lons)+Math.max(...lons))/2}});}
  for(const relation of relations.values()){const members=relation.members.map(member=>{const way=ways.get(member.ref);if(member.type!=='way'||!way)return null;const geometry=way.refs.map(id=>nodes.get(id)).filter(Boolean).map(n=>({lat:n.lat,lon:n.lon}));return geometry.length?{...member,geometry}:null;}).filter(Boolean),all=members.flatMap(m=>m.geometry);if(!all.length)continue;const lats=all.map(p=>p.lat),lons=all.map(p=>p.lon);elements.push({type:'relation',id:relation.id,tags:relation.tags,members,center:{lat:(Math.min(...lats)+Math.max(...lats))/2,lon:(Math.min(...lons)+Math.max(...lons))/2}});}
  return {elements};
}
async function fetchTerrain(r,cols=20,rows=15){
  const [s,w,n,e]=r.bbox, coords=[];
  for(let j=0;j<rows;j++)for(let i=0;i<cols;i++)coords.push([s+(n-s)*j/(rows-1),w+(e-w)*i/(cols-1)]);
  const heights=[];
  for(let k=0;k<coords.length;k+=80){const chunk=coords.slice(k,k+80),lat=chunk.map(x=>x[0]).join(','),lon=chunk.map(x=>x[1]).join(',');
    try{const res=await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);const data=await res.json();heights.push(...data.elevation);}catch{heights.push(...chunk.map(()=>0));}}
  const min=Math.min(...heights), normalized=heights.map(h=>Number(((h-min)*(r.id==='main'?.025:.08)).toFixed(3)));
  return {cols,rows,heights:normalized};
}
const result={};
for(const r of regions){
  const data=await fetchOsm(r),roads=[],buildings=[],waters=[],campuses=[],lamps=[],landmarks=[],box=rect(r),landmarkKeys=new Set();
  for(const el of data.elements||[]){const tag=el.tags||{},key=`${el.type}/${el.id}`,center=el.lat!=null?[el.lat,el.lon]:el.center?[el.center.lat,el.center.lon]:null;
    if(tag.name&&center){const [x,z]=project(center[0],center[1],r);if(inside([x,z],box)&&!landmarkKeys.has(key)){landmarkKeys.add(key);landmarks.push({name:tag.name,osmType:el.type,osmId:el.id,x:Number(x.toFixed(3)),z:Number(z.toFixed(3))});}}
    if(el.type==='node'&&tag.highway==='street_lamp'&&center){const [x,z]=project(center[0],center[1],r);if(inside([x,z],box))lamps.push([Number(x.toFixed(3)),Number(z.toFixed(3))]);}
    const sets=geometrySets(el);if(tag.highway&&el.type==='way'){for(const raw of sets){const projected=raw.map(p=>project(p.lat,p.lon,r));for(const points of clipPolyline(projected,box))roads.push({name:tag.name||'',kind:tag.highway,width:highwayWidth[tag.highway]||.3,points:points.map(p=>p.map(v=>Number(v.toFixed(3))))});}continue;}
    const destination=tag.building?buildings:(tag.natural==='water'||tag.landuse==='reservoir')?waters:tag.amenity==='university'?campuses:null;if(!destination)continue;
    for(const raw of sets){const points=clipPolygon(raw.map(p=>project(p.lat,p.lon,r)),box);if(points.length<3)continue;const xs=points.map(p=>p[0]),zs=points.map(p=>p[1]),bw=Math.max(...xs)-Math.min(...xs),bd=Math.max(...zs)-Math.min(...zs);if(bw<.08||bd<.08)continue;destination.push({name:tag.name||'',osmType:el.type,osmId:el.id,levels:Number(tag['building:levels']||0)||0,points:points.map(p=>p.map(v=>Number(v.toFixed(3))))});}
  }
  roads.sort((a,b)=>b.points.length-a.points.length);buildings.sort((a,b)=>b.points.length-a.points.length);
  result[r.id]={label:r.label,bbox:r.bbox,width:r.width,depth:r.depth,offsetX:r.offsetX,roads,buildings,waters,campuses,lamps,landmarks,terrain:await fetchTerrain(r)};
  console.log(r.id,`${roads.length} roads`,`${buildings.length} buildings`,`${waters.length} water`,`${lamps.length} mapped lamps`,`${landmarks.length} landmarks`);
}
await fs.mkdir('src',{recursive:true});
await fs.writeFile('src/osm-map-data.ts',`// Generated ${new Date().toISOString()} from OpenStreetMap (ODbL) and Open-Meteo elevation data.\n// WGS84 equirectangular projection; full unclipped feature counts are preserved inside each declared bbox.\nexport const osmRegions = ${JSON.stringify(result)} as const;\n`);
