// SWAT native living poses preserved; derived lower-body motion and relaxed-arm death fallback.
import {NullEngine,Scene,TransformNode,Vector3,Quaternion,Matrix} from '@babylonjs/core';
import {loadHeadlessModel} from '../tests/model-helper.js';
import {readGLB,writeGLB,appendData} from './glb-utils.js';
const src=new URL('../asset-staging/swat/source.glb',import.meta.url);
const {json,binary}=await readGLB(src),chunks=[binary];
const engine=new NullEngine(),scene=new Scene(engine),c=await loadHeadlessModel(src,scene);c.addAllToScene();
for(const n of c.transformNodes)n.name=n.name.replace(/(mixamorig:[^_]+)_\d+$/, '$1');
for(const n of json.nodes)n.name=n.name?.replace(/(mixamorig:[^_]+)_\d+$/, '$1');
const get=(s:string)=>c.transformNodes.find(n=>n.name==='mixamorig:'+s)!;
const pos=(n:TransformNode)=>{n.computeWorldMatrix(true);return n.getAbsolutePosition().clone();};
function aim(n:TransformNode,child:TransformNode,target:Vector3){
 const desired=Vector3.TransformCoordinates(target,Matrix.Invert(n.computeWorldMatrix(true))).normalize();
 const delta=Quaternion.Identity();Quaternion.FromUnitVectorsToRef(child.position.normalizeToNew(),desired,delta);
 n.rotationQuaternion=n.rotationQuaternion!.multiply(delta).normalize();n.computeWorldMatrix(true);
}
function ik(a:TransformNode,b:TransformNode,end:TransformNode,target:Vector3,pole:Vector3){
 const start=pos(a),u=Vector3.Distance(start,pos(b)),l=Vector3.Distance(pos(b),pos(end)),dir=target.subtract(start).normalize();
 const d=Math.max(.001,Math.min(Vector3.Distance(start,target),u+l-.003)),along=(u*u-l*l+d*d)/(2*d);
 const bend=pole.subtract(start);bend.subtractInPlace(dir.scale(Vector3.Dot(bend,dir))).normalize();
 aim(a,b,start.add(dir.scale(along)).add(bend.scale(Math.sqrt(Math.max(0,u*u-along*along)))));aim(b,end,start.add(dir.scale(d)));
}
function moveWorld(n:TransformNode,target:Vector3){n.position.copyFrom(Vector3.TransformCoordinates(target,Matrix.Invert((n.parent as TransformNode).computeWorldMatrix(true))));n.computeWorldMatrix(true);}
function rotateWorld(n:TransformNode,axis:Vector3,angle:number){
 const local=Vector3.TransformNormal(axis,Matrix.Invert(n.computeWorldMatrix(true))).normalize(),sign=n.getWorldMatrix().determinant()<0?-1:1;
 n.rotationQuaternion=n.rotationQuaternion!.multiply(Quaternion.RotationAxis(local,angle*sign));n.computeWorldMatrix(true);
}
const nodes=c.transformNodes.filter(n=>json.nodes.some((v:any)=>v.name===n.name));for(const n of nodes)n.rotationQuaternion??=Quaternion.FromEulerVector(n.rotation);
const rest=nodes.map(n=>({n,p:n.position.clone(),q:n.rotationQuaternion!.clone(),s:n.scaling.clone()}));
const restore=()=>{for(const r of rest){r.n.position.copyFrom(r.p);r.n.rotationQuaternion!.copyFrom(r.q);r.n.scaling.copyFrom(r.s);r.n.computeWorldMatrix(true);}};
const smooth=(x:number)=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
const profiles=[['idle','Idle',1.3],['walk','walk1',.8],['walkBackward','walk1',.8],['strafeLeft','walk1',.8],['strafeRight','walk1',.8],['run','walk1',.6],['jump','jump2',.8],['crouch','Idle',1.3],['crouchWalk','walk1',.8],['death','Idle',1.2]] as const;
const ranges=new Map(json.animations.map((a:any)=>[a.name,{from:Math.min(...a.samplers.map((s:any)=>json.accessors[s.input].min[0]))*60,to:Math.max(...a.samplers.map((s:any)=>json.accessors[s.input].max[0]))*60}]));
json.animations=[];
for(const [name,sourceName,duration]of profiles){
 const group=c.animationGroups.find(g=>g.name===sourceName)!;restore();group.start(true);group.pause();
 const values=nodes.map(()=>({p:[] as number[],q:[] as number[],s:[] as number[]}));const count=Math.round(duration*60);
 for(let frame=0;frame<=count;frame++){
  const t=frame/count;restore();const range=ranges.get(sourceName) as {from:number;to:number};group.goToFrame(range.from+(range.to-range.from)*(name==='walkBackward'?1-t:t));
  const hip=get('Hips');const hp=pos(hip);moveWorld(hip,new Vector3(0,hp.y,0));
  const hip0=pos(hip),crouch=name.startsWith('crouch'),death=name==='death';
  if(name==='jump')moveWorld(hip,new Vector3(hip0.x,1.626,hip0.z));
  const feet=['Left','Right'].map(side=>({side,p:pos(get(side+'Foot')),toe:pos(get(side+'ToeBase')).subtract(pos(get(side+'Foot')))}));
  if(crouch)moveWorld(hip,hip0.add(new Vector3(0,-.97,-.12)));
  if(name.startsWith('strafe')||crouch)for(const {side,p,toe}of feet){
   if(name.startsWith('strafe')){const travel=p.z;p.x+=(name==='strafeLeft'?1:-1)*travel*.6;p.z=.15;}
   ik(get(side+'UpLeg'),get(side+'Leg'),get(side+'Foot'),p,pos(get(side+'UpLeg')).add(new Vector3(0,-.3,1)));aim(get(side+'Foot'),get(side+'ToeBase'),pos(get(side+'Foot')).add(toe));
  }
  if(death){
   // Release the aiming posture before the torso falls. Only death changes the arms.
   const relax=smooth(t/.38);
   for(const side of ['Left','Right']){
    const sign=side==='Left'?-1:1;
    const hand=get(side+'Hand'),target=Vector3.Lerp(pos(hand),hip0.add(new Vector3(sign*.48,-.25,.12)),relax);
    ik(get(side+'Arm'),get(side+'ForeArm'),hand,target,hip0.add(new Vector3(sign*.8,.1,.25)));
   }
   const fall=smooth((t-.08)/.75);rotateWorld(hip,Vector3.Right(),-Math.PI*.48*fall);moveWorld(hip,new Vector3(hip0.x,hip0.y*(1-fall)+.22*fall,hip0.z-.15*fall));
   for(const {side,p,toe}of feet){const target=Vector3.Lerp(p,new Vector3(side==='Left'?-.22:.22,.11,1.05),fall);ik(get(side+'UpLeg'),get(side+'Leg'),get(side+'Foot'),target,new Vector3(side==='Left'?-.26:.26,1,.4));aim(get(side+'Foot'),get(side+'ToeBase'),pos(get(side+'Foot')).add(Vector3.Lerp(toe,new Vector3(0,.025,.23),fall)));}
   c.skeletons.forEach(s=>s.prepare(true));let minY=Infinity;for(const mesh of c.meshes){mesh.computeWorldMatrix(true);const v=mesh.getPositionData(true);if(!v)continue;for(let i=0;i<v.length;i+=3)minY=Math.min(minY,Vector3.TransformCoordinates(Vector3.FromArray(v,i),mesh.getWorldMatrix()).y);}if(minY<.015)moveWorld(hip,pos(hip).add(new Vector3(0,.015-minY,0)));
  }
  nodes.forEach((n,i)=>{values[i].p.push(...n.position.asArray());let q=n.rotationQuaternion!.clone();const last=values[i].q.slice(-4);if(last.length&&Quaternion.Dot(q,Quaternion.FromArray(last))<0)q=q.scale(-1);values[i].q.push(...q.asArray());values[i].s.push(...n.scaling.asArray());});
 }
 if(name!=='death'&&name!=='jump')for(const value of values){
  const blendFrames=6;
  for(let f=count-blendFrames;f<=count;f++){
   const weight=smooth((f-(count-blendFrames))/blendFrames);
   for(const key of ['p','s'] as const)for(let k=0;k<3;k++)value[key][f*3+k]=value[key][f*3+k]*(1-weight)+value[key][k]*weight;
   const q=Quaternion.Slerp(Quaternion.FromArray(value.q,f*4),Quaternion.FromArray(value.q,0),weight);value.q.splice(f*4,4,...q.asArray());
  }
 }
 const input=appendData(json,chunks,Array.from({length:count+1},(_,i)=>i/60),'SCALAR'),anim={name,samplers:[] as any[],channels:[] as any[]};
 nodes.forEach((n,i)=>{for(const [key,path,type]of [['p','translation','VEC3'],['q','rotation','VEC4'],['s','scale','VEC3']]as const){const output=appendData(json,chunks,values[i][key],type),sampler=anim.samplers.push({input,output,interpolation:'LINEAR'})-1;anim.channels.push({sampler,target:{node:json.nodes.findIndex((v:any)=>v.name===n.name),path}});}});json.animations.push(anim);group.stop();
}
const bin=Buffer.concat(chunks);json.buffers[0].byteLength=bin.length;await writeGLB(new URL('../client/public/assets/characters/player.glb',import.meta.url),json,bin);scene.dispose();engine.dispose();
