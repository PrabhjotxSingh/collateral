import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {deathmatchWinner,hillControl} from "../server/src/combat.js";
import {ClipPlayer} from "../client/src/animation.js";
import type {AnimationGroup} from "@babylonjs/core";

test("deathmatch ends at the kill limit or clock and supports a tied clock",()=>{
  assert.equal(deathmatchWinner(20,17,20,false),"A");
  assert.equal(deathmatchWinner(4,7,20,true),"B");
  assert.equal(deathmatchWinner(6,6,20,true),"draw");
  assert.equal(deathmatchWinner(4,3,20,false),undefined);
});
test("king of the hill scores only the outnumbering team and caps at five",()=>{
  assert.deepEqual(hillControl(2,2),{team:"",advantage:0});
  assert.deepEqual(hillControl(4,1),{team:"A",advantage:3});
  assert.deepEqual(hillControl(0,8),{team:"B",advantage:5});
});

test("returning to a weapon starts a clean live idle instead of a frozen transient",()=>{
  let active="",frame=-1,weight=0;
  const group=(name:string,from:number,to:number)=>({name,from,to,targetedAnimations:[{animation:{framePerSecond:60,enableBlending:false}}],start(){active=name},stop(){if(active===name)active=""},pause(){},goToFrame(v:number){frame=v},setWeightForAllAnimatables(v:number){weight=v}}) as unknown as AnimationGroup;
  const idle=group("idle",10,20),reload=group("reload",30,80),player=new ClipPlayer([idle,reload]);
  player.play("reload",false);assert.equal(active,"reload");
  assert.equal(player.settleIdle(),true);assert.equal(active,"idle");assert.equal(frame,10);assert.equal(weight,1);
});

test("procedural idle restores the neutral frame of a combined weapon timeline",()=>{
  let active="",frame=-1,weight=0;
  const all={name:"allanims",from:0,to:240,targetedAnimations:[{animation:{framePerSecond:60,enableBlending:false}}],start(){active="allanims"},stop(){active=""},pause(){},goToFrame(v:number){frame=v},setWeightForAllAnimatables(v:number){weight=v}} as unknown as AnimationGroup;
  const player=new ClipPlayer([all],{idle:"@collateral-built-in",draw:"@collateral-built-in",reload:{clip:"allanims",from:0,to:135,speed:.5}});
  assert.equal(player.play("idle"),true);
  assert.equal(active,"allanims");assert.equal(frame,0);assert.equal(weight,1);
});

test("new feedback and diagnostics are wired into the shipped client",()=>{
  const game=readFileSync(new URL("../client/src/game.ts",import.meta.url),"utf8"),ui=readFileSync(new URL("../client/src/ui.ts",import.meta.url),"utf8"),dev=readFileSync(new URL("../client/src/dev-tools.ts",import.meta.url),"utf8"),effects=readFileSync(new URL("../client/src/shot-effects.ts",import.meta.url),"utf8");
  assert.match(game,/audio\.play\("empty"\)/);assert.match(game,/weaponLoadGeneration/);
  assert.match(ui,/e\.code==="Tab"/);assert.match(ui,/data-game-mode/);
  assert.match(dev,/Third-person camera/);assert.match(dev,/FPS /);
  assert.match(effects,/bullet-impact/);assert.match(effects,/pickedMesh/);
});
