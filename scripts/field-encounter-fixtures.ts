// Only writes synthetic benchmark artifacts to an explicitly provided directory.
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {makeFreshGame} from '../src/game/create-game';
import {EVENT_CARDS} from '../src/game/events/event-cards';
import {CALENDAR_EVENTS} from '../src/campaign-content';
import {TACTICAL_EVENTS} from '../src/tactical-events';
const output=process.argv[2];if(!output)throw Error('Specify an artifact directory');mkdirSync(output,{recursive:true});
const size=64*64,navGrid={cols:64,rows:64,cell:.7,minX:0,minZ:0,blocked:Array(size).fill(0),building:Array(size).fill(0),water:Array(size).fill(0),road:Array(size).fill(1),elevation:Array(size).fill(0),component:Array(size).fill(0),mainComponent:0};
for(const scenario of ['none','dense']) {
 const game=makeFreshGame(),site=game.sites[0],template=game.units[0];
 game.sites=[{...site,id:0,team:'pku',type:'teaching',name:'PKU',x:.35,z:14.35,navX:.35,navZ:14.35},
 {...site,id:1,team:'thu',type:'teaching',name:'THU',x:40.25,z:14.35,navX:40.25,navZ:14.35}];
 game.units=Array.from({length:3000},(_,id)=>{
  const team=id<1500?'pku':'thu',home=game.sites[team==='pku'?0:1];
  const x=scenario==='none'?home.x:14.35;
  return {...template,id,team,siteId:home.id,x,z:14.35,tx:x,tz:14.35,hp:100,morale:100,supply:100,strength:1,targetSiteId:undefined,movementOrder:undefined};
 });
 game.campaign.elapsedHours=90;game.campaign.warUnlocked=true;game.campaign.lastProductionCycle=15;game.campaign.lastDiningCycle=7;
 game.campaign.statuses=[];game.campaign.decisions.completed=[];
 game.campaign.firedEvents=[...new Set([...Object.keys(EVENT_CARDS),...CALENDAR_EVENTS.map(e=>e.id),...TACTICAL_EVENTS.map(e=>e.id)])];
 writeFileSync(join(output,`field-${scenario}.json`),JSON.stringify({state:game}));
 writeFileSync(join(output,'field-seed.json.gz'),gzipSync(JSON.stringify({state:game,navGrid})));
}
