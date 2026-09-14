import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine,Scene,TransformNode,Vector3,Mesh} from '@babylonjs/core';
import {loadHeadlessModel} from './model-helper.js';
import {Assets,fitCharacter} from '../client/src/assets.js';
import {createGlockClips} from '../client/src/model-animation.js';
import {ClipPlayer,findClip} from '../client/src/animation.js';

test('soldier gait bends the real rig, lifts alternate feet, and blends back to idle',async()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    const c=await loadHeadlessModel(new URL('../client/public/assets/characters/player.glb',import.meta.url),scene);
    c.addAllToScene();const root=new TransformNode('soldier',scene);for(const n of c.rootNodes)n.parent=root;
    const idle=c.animationGroups[0];idle.start(true);idle.goToFrame(0);idle.stop();fitCharacter(root,1.8);
    const groups=c.animationGroups;assert.ok(findClip(groups,'death'));
    const foot=(side:string)=>c.transformNodes.find(n=>n.name==='mixamorig:'+(side==='L'?'Left':'Right')+'Foot')!;
    const left=foot('L'),right=foot('R');
    const walk=findClip(groups,'walk')!;walk.start(true);walk.pause();
    const positions=[];const deformations:number[][]=[];
    for(const frame of [0,.25,.5,.75,1].map(t=>walk.from+(walk.to-walk.from)*t)){
      walk.goToFrame(frame);left.computeWorldMatrix(true);right.computeWorldMatrix(true);
      positions.push([left.getAbsolutePosition().clone(),right.getAbsolutePosition().clone()]);
      c.skeletons.forEach(s=>s.prepare(true));
      deformations.push(c.meshes.flatMap(m=>{m.computeWorldMatrix(true);const p=m.getPositionData(true)??[],out:number[]=[];for(let i=0;i<p.length;i+=3)out.push(...Vector3.TransformCoordinates(Vector3.FromArray(p,i),m.getWorldMatrix()).asArray());return out;}));
    }
    assert.ok(deformations[0].some((v,i)=>Math.abs(v-deformations[2][i])>0.05),'skinned mesh vertices actually deform');
    assert.ok(Math.max(...positions.map(p=>p[0].z))-Math.min(...positions.map(p=>p[0].z))>.3,'left foot travels');
    for(const i of [0,1])assert.ok(Math.max(...positions.map(p=>p[i].y))-Math.min(...positions.map(p=>p[i].y))>.015,'alternate feet lift');
    assert.ok(Vector3.Distance(positions[0][0],positions[4][0])<0.001,'cycle closes');
    for(const pose of positions)for(const foot of pose)assert.ok(foot.y>0.025&&foot.y<0.35);
    const clips=new ClipPlayer(groups);assert.ok(clips.play('walk'));clips.tick(0.2);
    assert.ok(clips.play('idle'));clips.tick(0.2);assert.equal(walk.isPlaying,false);assert.ok(idle.isPlaying);
    groups.forEach(g=>g.dispose());
  }finally{scene.dispose();engine.dispose();}
});

test('runtime Glock contains visible geometry and isolated fire/reload/idle clips',async()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    const c=await loadHeadlessModel(new URL('../client/public/assets/weapons/glock.glb',import.meta.url),scene);
    c.addAllToScene();const root=new TransformNode('weapon',scene);root.rotation.y=Math.PI;root.position.set(0.18,-0.17,0.4);
    for(const n of c.rootNodes)n.parent=root;
    const clips=createGlockClips(c.animationGroups[0]);const idle=findClip(clips,'idle')!,fire=findClip(clips,'fire')!,reload=findClip(clips,'reload')!;
    assert.ok(idle&&fire&&reload);assert.ok(fire.to<reload.from);assert.ok(reload.to<idle.from);
    idle.start(true);idle.goToFrame(idle.from);idle.stop();
    const meshes=c.meshes.filter(m=>m.name.includes('g17_')&&m.getTotalVertices()>0);assert.ok(meshes.length>5);
    for(const m of meshes){m.computeWorldMatrix(true);if(m instanceof Mesh)m.refreshBoundingInfo(true);}
    const muzzle=meshes.find(m=>m.name.includes('Barrel'))!.getBoundingInfo().boundingBox;
    assert.ok(muzzle.centerWorld.z>0.4,'barrel points ahead of camera');
    assert.ok(muzzle.centerWorld.y<0&&muzzle.centerWorld.y>-0.3,'weapon framed below center');
    const magazine=c.transformNodes.find(n=>n.name==='g17_magazine')!;
    reload.start(false);reload.pause();reload.goToFrame(reload.from);magazine.computeWorldMatrix(true);const initial=magazine.getAbsolutePosition().clone();
    reload.goToFrame(72);magazine.computeWorldMatrix(true);
    assert.ok(Vector3.Distance(initial,magazine.getAbsolutePosition())>0.1,'reload actually removes magazine');
    const slide=c.transformNodes.find(n=>n.name==='g17_slide')!;reload.stop();
    fire.start(false);fire.pause();fire.goToFrame(fire.from);slide.computeWorldMatrix(true);const rest=slide.getAbsolutePosition().clone();
    fire.goToFrame(12);slide.computeWorldMatrix(true);
    assert.ok(Vector3.Distance(rest,slide.getAbsolutePosition())>0.02,'firing actually moves slide');
    clips.forEach(g=>g.dispose());
  }finally{scene.dispose();engine.dispose();}
});

test('runtime instancing hides the block and installs walk clips on independent player rigs',async()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    const assets=new Assets(scene);
    const soldier=await loadHeadlessModel(new URL('../client/public/assets/characters/player.glb',import.meta.url),scene);
    const weapon=await loadHeadlessModel(new URL('../client/public/assets/weapons/glock.glb',import.meta.url),scene);
    assets.load=async path=>path==='soldier'?soldier:weapon;
    const first=new TransformNode('first-player',scene),second=new TransformNode('second-player',scene);
    const a=await assets.instance('soldier',first,undefined,{characterHeight:1.8});
    const b=await assets.instance('soldier',second,undefined,{characterHeight:1.8});
    assert.ok(a&&b);assert.ok(a.clips.has('walk')&&b.clips.has('walk'));
    const one=findClip(a.clips.groups,'walk')!,two=findClip(b.clips.groups,'walk')!;
    assert.notEqual(one.targetedAnimations[0].target,two.targetedAnimations[0].target);
    const block=new Mesh('glock-placeholder',scene);const w=await assets.instance('/assets/weapons/glock.glb',block,block,{weapon:true});
    assert.ok(w?.clips.has('fire')&&w.clips.has('reload')&&w.clips.has('idle'));
    assert.equal(block.isVisible,false);assert.ok(block.getChildMeshes().some(m=>m.getTotalVertices()>1000&&m.isEnabled()&&m.isVisible));
    first.dispose();second.dispose();block.dispose();
  }finally{scene.dispose();engine.dispose();}
});
