import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PerformanceController} from "../src/performance-controller";
import {isMobileSignals,mobileSiteHitRadius} from "../src/mobile-support";

assert.equal(isMobileSignals({width:390,height:844,coarsePointer:true,touchPoints:5}),true);
assert.equal(isMobileSignals({width:844,height:390,coarsePointer:false,touchPoints:5}),true,"landscape phones must not fall back to desktop layout");
assert.equal(isMobileSignals({width:1440,height:900,coarsePointer:false,touchPoints:0}),false);
assert.equal(mobileSiteHitRadius(8),28);
assert.ok(Math.abs(mobileSiteHitRadius(24)-39.6)<1e-9);

const mobile=new PerformanceController(true);
mobile.setMode("auto");
assert.equal(mobile.level,"low");
assert.equal(mobile.profile.pixelRatio,.62);
assert.equal(mobile.profile.shadowSize,0);
assert.ok(mobile.profile.detailedUnits<=36);
mobile.reportFrame(10,11_000);mobile.reportFrame(10,27_000);
assert.equal(mobile.level,"medium");
mobile.reportFrame(10,38_000);mobile.reportFrame(10,55_000);
assert.equal(mobile.level,"medium","mobile auto quality exceeded its performance cap");
mobile.setMode("high");
assert.equal(mobile.profile.shadowSize,1024,"manual quality choice was ignored");

const play=readFileSync(new URL("../native-server/plugins/account-hub/static/play.html",import.meta.url),"utf8");
const mobileScript=readFileSync(new URL("../native-server/plugins/account-hub/static/mobile-play.js",import.meta.url),"utf8");
const css=readFileSync(new URL("../app/globals.css",import.meta.url),"utf8");
const game=readFileSync(new URL("../app/game-3d.tsx",import.meta.url),"utf8");
const engine=readFileSync(new URL("../src/game/engine/use-battlefield.ts",import.meta.url),"utf8");
for(const text of ["viewport-fit=cover","mobile-immersion","全屏并横屏","mobile-play.js"])
  assert.ok(play.includes(text),`mobile play shell is missing ${text}`);
for(const text of ["requestFullscreen","orientation","visualViewport","fullscreenchange"])
  assert.ok(mobileScript.includes(text),`mobile immersion controller is missing ${text}`);
for(const text of ["mobile-battle-controls","touch-route-action","safe-area-inset-bottom","100dvh"])
  assert.ok(css.includes(text),`mobile game layout is missing ${text}`);
for(const text of ["放大地图","缩小地图","beginTouchRoute"])
  assert.ok(game.includes(text),`mobile game controls are missing ${text}`);
for(const text of ["mobileSiteHitRadius","closestDistance = mobileClient ? 46 : 32","issueTouchRoute","portraitViewport ? 58 : 38"])
  assert.ok(engine.includes(text),`mobile battlefield interaction is missing ${text}`);

console.log("PASS: phone detection, mobile auto quality cap, large hit targets, safe-area layout, fullscreen/landscape entry and touch controls");
