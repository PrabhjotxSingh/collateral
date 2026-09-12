import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DEPOT_SOURCE_SHA256} from '../shared/depot-geometry.js';
import {capsuleOverlapsMap,rayMap} from '../shared/geometry.js';
import {RULES} from '../shared/rules.js';
import {emptyInput} from '../shared/protocol.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine,Scene,TransformNode,Vector3,Ray,Quaternion} from '@babylonjs/core';
import {MAPS} from '../shared/maps.js';
import {canStartMatch} from '../shared/rules.js';
import {intersects,makeBody,moveBody} from '../shared/simulation.js';
import {loadHeadlessModel} from './model-helper.js';
import {Assets} from '../client/src/assets.js';
import {createGlockClips} from '../client/src/model-animation.js';

test('full uploaded map remains byte-exact and collision rays match rendered triangles',async()=>{
  const e=new NullEngine(),s=new Scene(e);
  try{
    const installed=await readFile(new URL('../client/public/assets/maps/depot.glb',import.meta.url));
    assert.equal(createHash('sha256').update(installed).digest('hex'),DEPOT_SOURCE_SHA256);
    const c=await loadHeadlessModel(new URL('../client/public/assets/maps/depot.glb',import.meta.url),s);c.addAllToScene();
    for(const root of c.rootNodes)if(root instanceof TransformNode)root.position.y+=MAPS[0].offsetY??0;
    for(const m of c.meshes)m.computeWorldMatrix(true);
    assert.equal(c.meshes.filter(m=>m.getTotalVertices()).length,50);
    for(const spawns of Object.values(MAPS[0].spawns))for(const p of spawns){
      const b=makeBody(p.x,p.z);assert.equal(capsuleOverlapsMap(b,RULES.height,MAPS[0]),false,'spawn capsule clear');
      assert.ok(Math.abs(rayMap({x:p.x,y:1,z:p.z},{x:0,y:-1,z:0},MAPS[0],2)-1)<.001,'spawn on visible floor');
      for(let i=0;i<120;i++)moveBody(b,emptyInput(),1/60,MAPS[0]);assert.ok(Math.abs(b.y)<.001,'no floating floor');
    }
    for(const [x,z,dx,dz]of [[-19,-7,1,0],[19,7,-1,0],[0,0,1,0],[0,0,0,1],[-12,0,1,.2],[12,0,-1,-.2]]){
      const origin=new Vector3(x,1.2,z),dir=new Vector3(dx,0,dz).normalize(),ray=new Ray(origin,dir,100);
      const visible=Math.min(...c.meshes.filter(m=>m.getTotalVertices()).map(m=>ray.intersectsMesh(m)).filter(h=>h.hit).map(h=>h.distance));
      const collision=rayMap(origin,dir,MAPS[0]);assert.ok(Math.abs(visible-collision)<.002,`surface and hitscan align: ${visible} / ${collision}`);
    }
  }finally{s.dispose();e.dispose();}
});

test('menu character has an isolated idle-only instance and remains standing',async()=>{
  const e=new NullEngine(),s=new Scene(e);
  try{
    const c=await loadHeadlessModel(new URL('../client/public/assets/menu/operator.glb',import.meta.url),s);
    const assets=new Assets(s);assets.load=async()=>c;
    const root=new TransformNode('menu',s);const model=await assets.instance('menu',root,undefined,{characterHeight:1.9,menu:true});
    assert.ok(model);assert.equal(model.clips.groups.length,1);assert.ok(model.clips.has('idle'));assert.equal(model.clips.has('walk'),false);
    const group=model.clips.groups[0];group.setWeightForAllAnimatables(1);group.pause();
    const feet=root.getChildTransformNodes().filter(n=>/mixamorig:(Left|Right)Foot_/.test(n.name));assert.equal(feet.length,2);
    const samples=[];
    for(const f of [group.from,120,240,360,group.to]){group.goToFrame(f);samples.push(feet.map(n=>{n.computeWorldMatrix(true);return n.getAbsolutePosition().clone();}));}
    console.log('Menu foot motion',samples.map(p=>p.map(v=>v.asArray())));
    for(const sample of samples)for(let i=0;i<2;i++)assert.ok(Vector3.Distance(sample[i],samples[0][i])<0.18,'menu animation stays in place');
    root.dispose();
  }finally{s.dispose();e.dispose();}
});

test('Glock hold is static; procedural motion supplies input-driven sway',async()=>{
  const e=new NullEngine(),s=new Scene(e);
  try{
    const c=await loadHeadlessModel(new URL('../client/public/assets/weapons/glock.glb',import.meta.url),s);
    const source=c.animationGroups[0],clips=createGlockClips(source),idle=clips.find(g=>g.name==='idle')!;
    assert.equal(idle.metadata.playbackSpeed,0.65);
    let checked=0;
    for(let i=0;i<source.targetedAnimations.length;i++){
      const original=source.targetedAnimations[i].animation,limited=idle.targetedAnimations[i].animation;
      const rest=original.evaluate(468),before=original.evaluate(498),after=limited.evaluate(498);
      if(rest instanceof Vector3&&Vector3.Distance(rest,before)>0.0001){assert.ok(Vector3.Distance(rest,after)<0.000001);checked++;}
    }
    assert.ok(checked>0);clips.forEach(c=>c.dispose());
  }finally{s.dispose();e.dispose();}
});

test('start eligibility accepts connected 1v1 and 2v2 only',()=>{
  const a={team:'A' as const,connected:true},b={team:'B' as const,connected:true};
  assert.ok(canStartMatch([a,b]));assert.ok(canStartMatch([a,a,b,b]));
  for(const p of [[],[a],[a,a],[a,a,b],[a,{...b,connected:false}]])assert.equal(canStartMatch(p),false);
});
