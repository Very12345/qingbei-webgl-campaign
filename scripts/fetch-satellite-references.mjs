import {mkdir,writeFile} from "node:fs/promises";

const directory=new URL("../work/references/satellite/",import.meta.url);
await mkdir(directory,{recursive:true});
const service="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export";
const specs={
  pku:{bbox:"116.292,39.979,116.322,40.004",size:"2000,1667"},
  thu:{bbox:"116.309,39.984,116.342,40.014",size:"2000,1818"},
};
for(const [name,spec] of Object.entries(specs)){
  const url=new URL(service);
  for(const [key,value] of Object.entries({bbox:spec.bbox,bboxSR:"4326",size:spec.size,imageSR:"4326",format:"jpg",f:"json"}))url.searchParams.set(key,value);
  const metadataResponse=await fetch(url,{headers:{"User-Agent":"QingbeiCampusReferenceBuilder/1.0"}});
  if(!metadataResponse.ok)throw new Error(`${name} metadata: ${metadataResponse.status}`);
  const metadata=await metadataResponse.json();
  const imageResponse=await fetch(metadata.href,{headers:{"User-Agent":"QingbeiCampusReferenceBuilder/1.0"}});
  if(!imageResponse.ok)throw new Error(`${name} image: ${imageResponse.status}`);
  await writeFile(new URL(`${name}-esri.json`,directory),JSON.stringify(metadata));
  await writeFile(new URL(`${name}-esri.jpg`,directory),Buffer.from(await imageResponse.arrayBuffer()));
  console.log(`${name}: ${metadata.width}x${metadata.height} ${metadata.extent.xmin},${metadata.extent.ymin},${metadata.extent.xmax},${metadata.extent.ymax}`);
}
