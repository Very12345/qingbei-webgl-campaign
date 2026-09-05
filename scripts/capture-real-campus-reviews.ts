import {mkdirSync,mkdtempSync,writeFileSync} from "node:fs";
import {spawn} from "node:child_process";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {REAL_CAMPUS_LANDMARKS} from "../src/game/real-campus-data";

const baseUrl=process.env.QBB_REVIEW_BASE_URL||"http://127.0.0.1:4173/qingbei-webgl-campaign/";
const chrome=process.env.QBB_CHROME_PATH||"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const output=resolve(process.env.QBB_REVIEW_OUTPUT||"work/real-campus-review");
const concurrency=Math.max(1,Math.min(4,Number(process.env.QBB_REVIEW_CONCURRENCY||2)));
mkdirSync(output,{recursive:true});
const safe=(value:string)=>value.replace(/[\\/:*?"<>|]/g,"-");
const capture=(landmark:(typeof REAL_CAMPUS_LANDMARKS)[number])=>new Promise<void>((resolveCapture,reject)=>{
  const filename=`${String(landmark.siteId).padStart(3,"0")}-${safe(landmark.name)}.png`,profile=mkdtempSync(join(tmpdir(),`qbb-campus-${landmark.siteId}-`)),target=new URL(baseUrl);
  target.searchParams.set("map-profile","real-campus-v1");
  target.searchParams.set("render-benchmark","1");
  target.searchParams.set("quality","high");
  target.searchParams.set("review-site",String(landmark.siteId));
  const child=spawn(chrome,["--headless=new","--hide-scrollbars","--enable-unsafe-swiftshader","--use-angle=swiftshader","--window-size=1280,720","--virtual-time-budget=15000",`--user-data-dir=${profile}`,`--screenshot=${join(output,filename)}`,target.toString()],{windowsHide:true,stdio:"ignore"});
  child.once("error",reject);child.once("exit",code=>code===0?resolveCapture():reject(new Error(`Chrome exited ${code} for ${landmark.name}`)));
});
let cursor=0;
await Promise.all(Array.from({length:concurrency},async()=>{while(cursor<REAL_CAMPUS_LANDMARKS.length){const landmark=REAL_CAMPUS_LANDMARKS[cursor++];await capture(landmark);}}));
const cards=REAL_CAMPUS_LANDMARKS.map(landmark=>`<article><img loading="lazy" src="${String(landmark.siteId).padStart(3,"0")}-${safe(landmark.name)}.png"><h2>${landmark.siteId} · ${landmark.name}</h2><p>${landmark.campus.toUpperCase()} · ${landmark.material} · ${landmark.roof} · ${landmark.heightMeters}m · ${landmark.confidence}</p><p>${landmark.features.join(" · ")}</p><p><a href="${landmark.outlineUrl}">轮廓</a> · <a href="${landmark.photoSearch}">照片核验</a></p></article>`).join("\n");
writeFileSync(join(output,"index.html"),`<!doctype html><meta charset="utf-8"><title>real-campus-v1 据点验收</title><style>body{margin:24px;background:#172019;color:#eee;font:14px system-ui;display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:20px}article{background:#263029;padding:12px;border:1px solid #76836f}img{width:100%;aspect-ratio:16/9;object-fit:cover}h2{margin:10px 0 4px}p{margin:4px 0;color:#cdd5c6}a{color:#e5ca76}</style>${cards}`);
console.log(`PASS: ${REAL_CAMPUS_LANDMARKS.length} fixed strategic review images written to ${output}`);
