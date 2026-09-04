(function(root) {
  const widths = {small:[480,256], medium:[960,512], large:[1536,960]};
  function choose({width=0,dpr=1,connection}={}) {
    if (!connection) return 'small';
    const {saveData,effectiveType,downlink,rtt}=connection;
    if(saveData || ['slow-2g','2g','3g'].includes(effectiveType) || (downlink>0 && downlink<1.5) || rtt>500) return 'small';
    const pixels=width*Math.min(1.5,Math.max(1,dpr));
    if(pixels<=600) return 'small';
    if(effectiveType==='4g' && downlink>=5 && (!rtt || rtt<=200) && pixels>1000) return 'large';
    if(downlink>=1.5 || effectiveType==='4g') return 'medium';
    return 'small';
  }
  function measuredTier(entry, width, dpr=1) {
    // Cached responses say nothing about network speed. Include server/latency
    // time, so a quick transfer after a long wait doesn't trigger an upgrade.
    if(!entry || entry.transferSize<=0 || entry.duration<=0 || entry.duration>500) return 'small';
    const mbps=entry.encodedBodySize*8/entry.duration/1000;
    return choose({width,dpr,connection:{effectiveType:'4g',downlink:mbps,rtt:entry.duration}});
  }
  root.QingbeiAdaptiveImages={choose,measuredTier,widths};
  if(!root.document) return;
  const doc=root.document, base=doc.currentScript?.dataset.assetBase || 'assets/';
  const connection=root.navigator?.connection;
  let tier=choose({width:root.innerWidth,dpr:root.devicePixelRatio,connection});
  const apply=next=>{
    tier=next;
    const [campus,field]=widths[tier];
    doc.documentElement.style.setProperty('--campus-art',`url("${base}campus-command-v1-${campus}.webp")`);
    doc.documentElement.style.setProperty('--field-art',`url("${base}field-table-v1-${field}.webp")`);
    doc.documentElement.dataset.imageQuality=tier;
  };
  apply(tier);
  // Without the optional Network Information API, render the small version
  // immediately and allow one idle upgrade only after a real fast download.
  if(!connection && root.PerformanceObserver) {
    try {
      const observer=new PerformanceObserver(list=>{
        const entry=list.getEntries().find(e=>e.name.includes('/campus-command-v1-480.webp'));
        if(!entry)return;
        observer.disconnect();
        const next=measuredTier(entry,root.innerWidth,root.devicePixelRatio);
        if(next==='small')return;
        const upgrade=()=>apply(next);
        if(root.requestIdleCallback)root.requestIdleCallback(upgrade,{timeout:3000});
        else root.setTimeout(upgrade,500);
      });
      observer.observe({type:'resource',buffered:true});
      root.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
    } catch {} // Small artwork remains usable without performance APIs.
  }
})(globalThis);
