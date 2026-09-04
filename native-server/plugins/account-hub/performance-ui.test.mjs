import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
vm.runInThisContext(readFileSync(new URL('./static/performance-ui.js',import.meta.url),'utf8'));
test('diagnostics distinguish missing telemetry, paused play, server overload and client FPS',()=>{
 const diagnose=QingbeiPerformance.diagnosis,server={sampledAt:1000};
 assert.match(diagnose(null,null,{},1000),/不能区分/);
 assert.match(diagnose(server,{pausedForPlayers:true},{fps:1},1000),/正常暂停/);
 assert.match(diagnose(server,{tickP95Ms:150},{fps:60,stateAgeMs:20},1000),/服务器单步/);
 assert.match(diagnose(server,{tickP95Ms:20},{fps:10,stateAgeMs:20},1000),/客户端帧率/);
 assert.match(diagnose(server,{tickP95Ms:20},{fps:60,stateAgeMs:2500},1000),/状态延迟/);
});
