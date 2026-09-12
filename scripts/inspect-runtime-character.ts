import {writeFile} from 'node:fs/promises';
import {NullEngine,Scene,TransformNode,Vector3} from '@babylonjs/core';
import {loadHeadlessModel} from '../tests/model-helper.js';import {Assets} from '../client/src/assets.js';
const engine=new NullEngine(),scene=new Scene(engine),assets=new Assets(scene);
const soldier=await loadHeadlessModel(new URL('../client/public/assets/characters/player.glb',import.meta.url),scene),gun=await loadHeadlessModel(new URL('../client/public/assets/weapons/glock-world.glb',import.meta.url),scene);
assets.load=async path=>path.includes('glock')?gun:soldier;
const root=new TransformNode('actor',scene),actor=await assets.instance('player',root,undefined,{characterHeight:1.8});if(!actor)throw new Error('Character instancing failed');
const poses=[];actor.clips.stop();
for(const name of ['idle','walk','strafeLeft','crouch','jump','death']){
 const g=actor.clips.groups.find(g=>g.name===name)!;g.start(false);g.pause();
 for(const t of [0,.25,.5,.75,1]){
  g.goToFrame(g.from+(g.to-g.from)*t);
  const meshes=root.getChildMeshes().filter(m=>m.getTotalVertices()>0).map(m=>{m.computeWorldMatrix(true);m.skeleton?.prepare(true);const p=m.getPositionData(true)!,positions=[];for(let i=0;i<p.length;i+=3)positions.push(...Vector3.TransformCoordinates(Vector3.FromArray(p,i),m.getWorldMatrix()).asArray());return {positions,indices:Array.from(m.getIndices()!),name:m.name};});poses.push({name,t,meshes});
 }g.stop();
}
await writeFile('/tmp/collateral-poses.json',JSON.stringify(poses));scene.dispose();engine.dispose();
