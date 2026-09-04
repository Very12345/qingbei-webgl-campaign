'use strict';
const readline=require('node:readline');
const vm=require('node:vm');
let kernel=null,next=0;
const instances=new Map();
const allowed=new Set(['dispatch','dispatchMany','drainCommandReceipts','advanceOnly','step','run','snapshot','networkFull','networkDelta','networkDeltaJSON','battleStats','performanceProfile']);
readline.createInterface({input:process.stdin,crlfDelay:Infinity}).on('line',line=>{
  let request;
  try {
    if(line.length>32*1024*1024)throw Error('request too large');
    request=JSON.parse(line);let result;
    if(request.op==='init') {vm.runInThisContext(request.bundle,{filename:'shared-kernel.js'});kernel=globalThis.QingbeiKernel;result=kernel.healthCheck();}
    else if(request.op==='health')result=kernel.healthCheck();
    else if(request.op==='create'){const id=++next;instances.set(id,kernel.createKernel(...request.args));result={id};}
    else if(request.op==='call') {
      if(!allowed.has(request.method))throw Error('unsupported kernel method');
      const instance=instances.get(request.instance);if(!instance)throw Error('unknown kernel');
      result=instance[request.method](...(request.args||[]));
    } else if(request.op==='dispose'){instances.delete(request.instance);result=null;}
    else throw Error('unsupported operation');
    process.stdout.write(JSON.stringify({result:result??null})+'\n');
  }catch(error){process.stdout.write(JSON.stringify({error:String(error?.message||error)})+'\n');}
});
