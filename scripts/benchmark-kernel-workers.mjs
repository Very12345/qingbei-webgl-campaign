// Compare private Node workers using the production stdio protocol. No rooms,
// accounts or sockets are created on the game server. Pass two bundles, a seed,
// an offline save, and the node_runtime.cjs path. Linux includes worker CPU/RSS.
import {spawn,execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const [before,after,seedPath,savePath,workerPath]=process.argv.slice(2);
if(!workerPath)throw Error('Usage: node benchmark-kernel-workers.mjs before.js after.js seed.json.gz save.json node_runtime.cjs');
const {navGrid}=JSON.parse(gunzipSync(readFileSync(seedPath)));
const save=JSON.parse(readFileSync(savePath,'utf8')),state=save.state??save.State;
const frames=Number(process.env.QBB_BENCH_FRAMES||120);
const ticks=process.platform==='linux'?Number(execFileSync('getconf',['CLK_TCK'])):null;
const guard=async()=>{
  if(!process.env.QBB_BENCH_IDLE_SERVER)return;
  const info=await (await fetch(process.env.QBB_BENCH_IDLE_SERVER+'/api/info')).json();
  if(info.battles?.length)throw Error('Live battle detected; benchmark deferred/discarded.');
};
function usage(pid) {
  if(!ticks)return null;
  const fields=readFileSync(`/proc/${pid}/stat`,'utf8').split(') ')[1].split(' ');
  const rss=Number(readFileSync(`/proc/${pid}/status`,'utf8').match(/VmRSS:\s+(\d+)/)[1])*1024;
  return {cpu:(Number(fields[11])+Number(fields[12]))/ticks*1000,rss};
}
function worker() {
  const child=spawn(process.execPath,['--max-old-space-size=256',workerPath],{windowsHide:true,stdio:['pipe','pipe','inherit']});
  const pending=[];
  createInterface({input:child.stdout}).on('line',line=>{
    const item=pending.shift();if(!item)return;
    clearTimeout(item.timer);
    try {const value=JSON.parse(line);if(value.error)item.reject(Error(value.error));else item.resolve(value.result);}catch(e){item.reject(e);}
  });
  child.on('error',error=>pending.splice(0).forEach(p=>{clearTimeout(p.timer);p.reject(error);}));
  child.on('exit',()=>pending.splice(0).forEach(p=>{clearTimeout(p.timer);p.reject(Error('Worker exited'));}));
  return {child,request(data){return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(Error('Worker timeout'));},30000);
    pending.push({resolve,reject,timer});child.stdin.write(JSON.stringify(data)+'\n');
  });}};
}
async function sample(bundle,rooms) {
  const workers=[];
  try {
    for(let i=0;i<rooms;i++) {
      const w=worker();workers.push(w);
      await w.request({op:'init',bundle:readFileSync(bundle,'utf8')});
      const created=await w.request({op:'create',args:[state,{navGrid,aiTeams:['thu'],fixedStepMilliseconds:100}]});
      w.call=(method,...args)=>w.request({op:'call',instance:created.id,method,args});
      await w.call('dispatch',{type:'set_time_scale',value:4});
      for(let n=0;n<12;n++)await w.call('advanceOnly',100);
      await w.call('networkFull');
      w.networkHash=createHash('sha256');
    }
    const initial=workers.map(w=>usage(w.child.pid));
    const parentCPU=process.cpuUsage(),times=[];let bytes=0;
    const started=performance.now();
    for(let n=0;n<frames;n++) {
      const start=performance.now();
      await Promise.all(workers.map(async w=>{
        await w.call('advanceOnly',100);
        if(n%2===0) {const encoded=await w.call('networkDeltaJSON');bytes+=Buffer.byteLength(encoded);w.networkHash.update(encoded.length+':'+encoded);}
      }));
      times.push(performance.now()-start);
    }
    const elapsedMs=performance.now()-started,parent=process.cpuUsage(parentCPU),end=workers.map(w=>usage(w.child.pid));
    const cpuMs=ticks?end.reduce((sum,u,i)=>sum+u.cpu-initial[i].cpu,0)+(parent.user+parent.system)/1000:null;
    const hashes=await Promise.all(workers.map(async w=>createHash('sha256').update(JSON.stringify((await w.call('snapshot')).state)).digest('hex')));
    times.sort((a,b)=>a-b);
    return {rooms,frames,elapsedMs,batchP50Ms:times[Math.floor(frames*.5)],batchP95Ms:times[Math.floor(frames*.95)],cpuMs,
      projectedCPUPercentAt10Hz:cpuMs==null?null:cpuMs/(frames*100)*100,
      workerRSSBytes:ticks?end.reduce((sum,u)=>sum+u.rss,0):null,bytes,hashes,networkHashes:workers.map(w=>w.networkHash.digest('hex'))};
  } finally {await Promise.all(workers.map(w=>new Promise(resolve=>{
    if(w.child.exitCode!=null){resolve();return;}
    const timer=setTimeout(()=>w.child.kill(),2000);
    w.child.once('exit',()=>{clearTimeout(timer);resolve();});w.child.stdin.end();
  })));}
}
for(const rooms of (process.env.QBB_BENCH_ROOMS||'1,2,4').split(',').map(Number)) {
  if(!Number.isInteger(rooms)||rooms<1||rooms>4)throw Error('Use 1–4 offline rooms');
  await guard();
  let baseline,optimized;
  if(process.env.QBB_BENCH_REVERSE==='1') {optimized=await sample(after,rooms);await guard();baseline=await sample(before,rooms);}
  else {baseline=await sample(before,rooms);await guard();optimized=await sample(after,rooms);}
  await guard();
  assert.deepEqual(optimized.hashes,baseline.hashes,'Optimization changed authoritative game state');
  assert.equal(optimized.bytes,baseline.bytes,'Optimization changed network output');
  assert.deepEqual(optimized.networkHashes,baseline.networkHashes,'Optimization changed an intermediate network message');
  console.log(JSON.stringify({baseline,optimized}));
}
