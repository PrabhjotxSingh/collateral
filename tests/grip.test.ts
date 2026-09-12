import {test} from 'node:test';import assert from 'node:assert/strict';
import {NullEngine,Scene,TransformNode,Vector3,Matrix} from '@babylonjs/core';
import {Assets} from '../client/src/assets.js';import {loadHeadlessModel} from './model-helper.js';
import {DEFAULT_GRIP,parseGrip,applyGrip} from '../client/src/grip.js';
test('bundled SWAT Glock alignment matches the approved calibration',()=>{assert.deepEqual(DEFAULT_GRIP,{version:1,weapon:'glock',character:'swat',x:-.025,y:.037,z:.027,pitch:0,yaw:0,roll:0,scale:1});});
test('shareable grip values round-trip; invalid profiles cannot corrupt transforms',()=>{
 const profile={...DEFAULT_GRIP,x:.012,y:-.023,z:.045,pitch:12,yaw:-24,roll:3,scale:.85};
 assert.deepEqual(parseGrip(JSON.parse(JSON.stringify(profile))),profile);
 for(const change of [{scale:0},{x:Infinity},{y:NaN},{z:2},{roll:200},{weapon:'rifle'},{version:2}])assert.throws(()=>parseGrip({...profile,...change}));
});
test('live grip adjustment moves the gun AND muzzle without changing the SWAT hand',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 try{
  const assets=new Assets(scene),c=await loadHeadlessModel(new URL('../client/public/assets/characters/player.glb',import.meta.url),scene),w=await loadHeadlessModel(new URL('../client/public/assets/weapons/glock-world.glb',import.meta.url),scene);
  assets.load=async path=>path.includes('glock')?w:c;
  const root=new TransformNode('actor',scene),actor=await assets.instance('player',root,undefined,{characterHeight:1.8});assert.ok(actor?.grip&&actor.muzzle);
  const hand=root.getChildTransformNodes().find(n=>n.name.endsWith('mixamorig:RightHand'))!;
  hand.computeWorldMatrix(true);const before=hand.getWorldMatrix().clone();
  actor.muzzle.computeWorldMatrix(true);const muzzle=actor.muzzle.getAbsolutePosition().clone();
  applyGrip(actor.grip,{...DEFAULT_GRIP,x:.04,z:.02,yaw:15,scale:.8});
  hand.computeWorldMatrix(true);assert.ok(before.equalsWithEpsilon(hand.getWorldMatrix(),1e-5));
  actor.muzzle.computeWorldMatrix(true);assert.ok(Vector3.Distance(muzzle,actor.muzzle.getAbsolutePosition())>.015);
  const clip=actor.clips.groups.find(g=>g.name==='walk')!;actor.clips.stop();clip.start(true);clip.pause();
  let reference:Vector3|undefined;
  for(const phase of [0,.25,.5,.75,1]){
   clip.goToFrame(clip.from+(clip.to-clip.from)*phase);hand.computeWorldMatrix(true);actor.muzzle.computeWorldMatrix(true);
   const offset=Vector3.TransformCoordinates(actor.muzzle.getAbsolutePosition(),Matrix.Invert(hand.getWorldMatrix()));reference??=offset;
   assert.ok(Vector3.Distance(offset,reference)<.002,'adjusted gun stays rigid throughout locomotion');
  }
 }finally{scene.dispose();engine.dispose();}
});
test('death releases both arms from the aiming pose',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 try{
  const c=await loadHeadlessModel(new URL('../client/public/assets/characters/player.glb',import.meta.url),scene);c.addAllToScene();
  const death=c.animationGroups.find(g=>g.name==='death')!;death.start(false);death.pause();
  const get=(name:string)=>c.transformNodes.find(n=>n.name==='mixamorig:'+name)!;
  const relative=(side:string)=>{const spine=get('Spine2'),hand=get(side+'Hand');spine.computeWorldMatrix(true);hand.computeWorldMatrix(true);return Vector3.TransformCoordinates(hand.getAbsolutePosition(),Matrix.Invert(spine.getWorldMatrix()));};
  death.goToFrame(0);const start=['Left','Right'].map(relative);
  death.goToFrame(death.to);const end=['Left','Right'].map(relative);
  for(let i=0;i<2;i++)assert.ok(Vector3.Distance(start[i],end[i])>.25,'arm changes relative to torso, not just whole-body collapse');
 }finally{scene.dispose();engine.dispose();}
});
