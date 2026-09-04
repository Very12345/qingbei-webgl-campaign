(() => {
  const number=(value,suffix='',digits=0)=>Number.isFinite(value)?value.toFixed(digits)+suffix:'—';
  const mb=value=>value>0?number(value/1048576,' MB',1):'—';
  function diagnosis(server,battle,client,now=Date.now()) {
    if(!server || now-(server.receivedAt??server.sampledAt)+(server.sampleAgeMs||0)>6000) return '诊断连接未就绪，暂不能区分服务器或网络问题';
    if(battle?.pausedForPlayers) return '等待玩家入场或重连，对局正常暂停';
    if(battle?.error) return '服务器内核异常：'+String(battle.error).slice(0,160);
    if(client.stateAgeMs>2000) return '战局状态延迟：检查网络积压或服务器是否停止推进';
    if(battle?.tickP95Ms>100) return '服务器单步超过100ms预算，模拟推进可能变慢';
    if(client.fps!=null&&client.fps<25) return '客户端帧率偏低，可能是渲染或主线程卡顿';
    if(client.oldestMs>1500) return client.processed?'服务器已处理，仍在等待命令状态匹配':'命令等待服务器接收或处理';
    return '当前采样未见明显积压';
  }
  function mount({room}) {
    const style=document.createElement('style');
    style.textContent=`#performance-root{position:absolute;left:14px;bottom:14px;z-index:95;font:13px/1.65 "Microsoft YaHei",sans-serif;color:#e2e0c8;pointer-events:auto}#performance-root[hidden],#performance-panel[hidden]{display:none}#performance-root button{background:#25312d;color:inherit;border:1px solid #818d70;padding:8px 12px;cursor:pointer;font:inherit}#performance-panel{width:min(350px,calc(100vw - 28px));max-height:65vh;overflow:auto;padding:16px;margin-bottom:8px;background:#182521f5;border:1px solid #818d70;box-shadow:0 5px 22px #0008}#performance-panel h3{margin:0 0 10px;font-size:17px}#performance-panel dl{display:grid;grid-template-columns:1fr auto;gap:5px 16px;margin:10px 0}#performance-panel dt,#performance-panel dd{margin:0}#performance-panel dd{font-variant-numeric:tabular-nums;text-align:right}#performance-diagnosis{color:#dfc773;margin:10px 0;line-height:1.6}#performance-panel small{color:#aab39c}#performance-toggle[data-alert="true"]{border-color:#d6a15b}`;
    document.head.append(style);
    const root=document.createElement('section');root.id='performance-root';root.hidden=true;
    root.innerHTML='<section id="performance-panel" aria-label="性能诊断" hidden><h3>性能诊断</h3><small>服务 CPU 含模拟内核；100% 表示占满一个核心</small><dl id="performance-values"></dl><p id="performance-diagnosis"></p><button id="performance-copy" type="button">复制诊断信息</button></section><button id="performance-toggle" type="button" aria-expanded="false">性能 · 等待采样</button>';
    document.body.append(root);
    const panel=root.querySelector('#performance-panel'),toggle=root.querySelector('#performance-toggle'),values=root.querySelector('#performance-values'),hint=root.querySelector('#performance-diagnosis');
    let bridge=null,socket=null,server=null,battle=null,polling=false,stopped=false,frames=0,longFrames=0,lastFrame=0,frameStart=performance.now(),fps=null,longCount=0,raf=0,latest=null;
    toggle.onclick=()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));paint();};
    root.addEventListener('pointerdown',e=>e.stopPropagation());root.addEventListener('wheel',e=>e.stopPropagation());
    root.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){panel.hidden=true;toggle.setAttribute('aria-expanded','false');}});
    root.querySelector('#performance-copy').onclick=async()=>{try{await navigator.clipboard.writeText(JSON.stringify(latest,null,2));root.querySelector('#performance-copy').textContent='已复制（不含账号或令牌）';}catch{hint.textContent='复制失败，可截图保存诊断数据';}};
    function frame(now){if(stopped)return;if(lastFrame&&now-lastFrame>50)longFrames++;frames++;lastFrame=now;raf=requestAnimationFrame(frame);}
    raf=requestAnimationFrame(frame);
    function paint(){
      const shell=document.querySelector('.game-shell');if(shell&&root.parentElement!==shell)shell.append(root);root.hidden=!shell;
      const now=Date.now(),network=bridge?.diagnostics?.()||{pending:0,oldestMs:0},stateAgeMs=network.lastStateAt?now-network.lastStateAt:null;
      const client={...network,fps:document.hidden?null:fps,longFramesPerSecond:longCount,stateAgeMs,socketOpen:socket?.readyState===1,bufferedBytes:socket?.bufferedAmount||0};
      latest={sampledAt:new Date().toISOString(),server,battle,client};
      const text=diagnosis(server,battle,client,now);
      toggle.textContent=`性能 · ${number(client.fps,' FPS')} · CPU ${number(server?.processCpuPercent,'%')}`;
      toggle.dataset.alert=String((stateAgeMs||0)>2000||(battle?.tickP95Ms||0)>100||(client.fps!=null&&client.fps<25));
      if(panel.hidden)return;
      const rows=[['内核运行时',server?.kernelEngine||'—'],['服务器核心',number(server?.cpuCores)],['服务 CPU',number(server?.processCpuPercent,'%',1)],['整机 CPU',number(server?.hostCpuPercent,'%',1)],['服务内存 RSS',mb(server?.processRSSBytes)],['Go 堆内存',mb(server?.heapAllocBytes)],['整机可用 / 总内存',`${mb(server?.hostMemoryAvailableBytes)} / ${mb(server?.hostMemoryTotalBytes)}`],['GC 暂停',number(server?.gcPauseMs,' ms/s',1)],['模拟更新（最近5秒）',number(battle?.tickHz,' 次/s',1)],['单步 P95',number(battle?.tickP95Ms,' ms',1)],['模拟 / 序列化平均',`${number(battle?.simulationMs,' ms',1)} / ${number(battle?.serializationMs,' ms',1)}`],['同步数据量',number(battle?.outboundBytesPerSecond/1024,' KB/s',1)],['待发状态 / 合并次数',`${number(battle?.queuedStateBytes/1024,' KB',1)} / ${number(battle?.mergedStatePackets)}`],['最近状态距今',number(stateAgeMs,' ms')],['待确认项 / 最长等待',`${network.pending||0} / ${number(network.oldestMs,' ms')}`],['已接收 / 已处理',`${network.totalReceived||0} / ${network.totalProcessed||0}`],['最近执行 / 生效确认',`${number(network.lastProcessedMs,' ms')} / ${number(network.lastConfirmMs,' ms')}`],['本机帧率 / 长帧',`${number(client.fps,' FPS')} / ${longCount}`]];
      if(values.children.length!==rows.length*2){values.replaceChildren();for(const [key]of rows){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;values.append(dt,dd);}}for(let i=0;i<rows.length;i++){const dd=values.children[i*2+1];if(dd.textContent!==rows[i][1])dd.textContent=rows[i][1];}hint.textContent=text;
    }
    const paintTimer=setInterval(()=>{const now=performance.now(),seconds=(now-frameStart)/1000;fps=frames/Math.max(.1,seconds);longCount=Math.round(longFrames/Math.max(.1,seconds));frames=longFrames=0;frameStart=now;paint();},1000);
    async function poll(){if(polling||stopped||document.hidden)return;polling=true;try{const response=await fetch('/api/performance?room='+encodeURIComponent(room),{cache:'no-store',signal:AbortSignal.timeout(2500)});if(response.ok){const data=await response.json();server={...data.server,version:data.version,receivedAt:Date.now(),sampleAgeMs:Math.max(0,(data.serverTime||data.server.sampledAt)-data.server.sampledAt)};battle=data.battle;}}catch{}finally{polling=false;}}
    const pollTimer=setInterval(poll,2000);void poll();
    addEventListener('pagehide',()=>{stopped=true;clearInterval(paintTimer);clearInterval(pollTimer);cancelAnimationFrame(raf);},{once:true});
    return {attach(nextBridge,nextSocket){bridge=nextBridge;socket=nextSocket;},paint};
  }
  globalThis.QingbeiPerformance={mount,diagnosis};
})();
