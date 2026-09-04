import {test} from 'node:test';
import assert from 'node:assert/strict';
import './static/adaptive-images.js';
const {choose,measuredTier}=globalThis.QingbeiAdaptiveImages;
test('slow/unknown networks and Save-Data never request large artwork',()=>{
 assert.equal(choose({width:1920,dpr:2}),'small');
 for(const connection of [{saveData:true,effectiveType:'4g',downlink:20},{effectiveType:'3g',downlink:8},{effectiveType:'4g',downlink:.5},{effectiveType:'4g',downlink:10,rtt:800}])
  assert.equal(choose({width:1920,dpr:2,connection}),'small');
 assert.equal(choose({width:390,dpr:3,connection:{effectiveType:'4g',downlink:10}}),'small');
 assert.equal(choose({width:800,dpr:1,connection:{effectiveType:'4g',downlink:10}}),'medium');
 assert.equal(choose({width:1920,dpr:2,connection:{effectiveType:'4g',downlink:10,rtt:50}}),'large');
});
test('fallback measures actual resource transfer, including latency, excluding cache',()=>{
 assert.equal(measuredTier({transferSize:0,encodedBodySize:15000,duration:1},1920),'small');
 assert.equal(measuredTier({transferSize:15300,encodedBodySize:15000,duration:900},1920),'small');
 assert.equal(measuredTier({transferSize:15300,encodedBodySize:15000,duration:50},1920),'medium');
 assert.equal(measuredTier({transferSize:15300,encodedBodySize:15000,duration:15},1920),'large');
});
