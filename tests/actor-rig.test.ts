import {test} from 'node:test';import assert from 'node:assert/strict';
import {NullEngine,Scene,TransformNode,Vector3,Matrix} from '@babylonjs/core';
import {loadHeadlessModel} from './model-helper.js';import {Assets} from '../client/src/assets.js';
test('assembled rig keeps gun in its hand, bends for crouch, and collapses only on death',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine),assets=new Assets(scene);
 try{
  const c=await loadHeadlessModel(new URL('../client/public/assets/characters/player.glb',import.meta.url),scene),w=await loadHeadlessModel(new URL('../client/public/assets/weapons/glock-world.glb',import.meta.url),scene);
  assert.equal(w.skeletons.length,0,'world gun contains no arm rig');assert.ok(w.meshes.filter(m=>m.getTotalVertices()).every(m=>m.name.startsWith('g17_')),'world gun has no arms');assets.load=async p=>p.includes('glock')?w:c;
  const root=new TransformNode('actor',scene),a=await assets.instance('actor',root,undefined,{characterHeight:1.8});assert.ok(a?.muzzle&&a.combat);a.clips.stop();
  const hand=root.getChildTransformNodes().find(n=>n.name.endsWith('mixamorig:RightHand'))!,head=root.getChildTransformNodes().find(n=>n.name.endsWith('mixamorig:Head'))!;
  let reference:Vector3|undefined;const heights:Record<string,number>={};
  for(const action of ['idle','walk','walkBackward','strafeLeft','strafeRight','crouch','death']){
   const clip=a.clips.groups.find(g=>g.name===action)!;clip.start(false);clip.pause();
   for(const t of [0,.25,.5,.75,1]){
    clip.goToFrame(clip.from+(clip.to-clip.from)*t);head.computeWorldMatrix(true);hand.computeWorldMatrix(true);a.muzzle.computeWorldMatrix(true);
    const local=Vector3.TransformCoordinates(a.muzzle.getAbsolutePosition(),Matrix.Invert(hand.getWorldMatrix()));reference??=local;assert.ok(Vector3.Distance(local,reference)<.002,'socket remains rigidly attached');
    const y=head.getAbsolutePosition().y;assert.ok(Number.isFinite(y));if(action!=='crouch'&&action!=='death')assert.ok(y>1.4&&y<1.85,'living head stays upright');if(t===1)heights[action]=y;
   }clip.stop();
  }
  assert.ok(heights.crouch<heights.idle-.5,'crouch bends the skeleton');assert.ok(heights.death<.65,'death settles near the floor');assert.equal(root.scaling.y,1,'no whole-body squash');
  root.dispose();
 }finally{scene.dispose();engine.dispose();}
});

test('SWAT preserves authored fingers and strips movement from its jump root',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 try{
  const original=await loadHeadlessModel(new URL('../asset-staging/swat/source.glb',import.meta.url),scene);
  const baked=await loadHeadlessModel(new URL('../client/public/assets/characters/player.glb',import.meta.url),scene);
  original.addAllToScene();baked.addAllToScene();
  const native=original.animationGroups.find(g=>g.name==='Idle')!,idle=baked.animationGroups.find(g=>g.name==='idle')!;
  native.start(false);native.pause();native.goToFrame(136);idle.start(false);idle.pause();idle.goToFrame(0);
  const fingers=original.transformNodes.filter(n=>/Hand(Thumb|Index|Middle|Ring|Pinky)/.test(n.name));
  assert.ok(fingers.length>=30);
  for(const n of fingers){const other=baked.transformNodes.find(b=>b.name===n.name.replace(/_\d+$/,''))!;
   assert.ok(other);assert.ok(Math.abs(n.rotationQuaternion!.dot(other.rotationQuaternion!))>.9999,'native finger rotation is preserved');
  }
  idle.stop();const jump=baked.animationGroups.find(g=>g.name==='jump')!;jump.start(false);jump.pause();
  const hip=baked.transformNodes.find(n=>n.name==='mixamorig:Hips')!;
  for(const phase of [0,.25,.5,.75,1]){jump.goToFrame(jump.from+(jump.to-jump.from)*phase);hip.computeWorldMatrix(true);const p=hip.getAbsolutePosition();assert.ok(Math.abs(p.x)<.001&&Math.abs(p.z)<.001);assert.ok(Math.abs(p.y-1.626)<.001);}
 }finally{scene.dispose();engine.dispose();}
});
