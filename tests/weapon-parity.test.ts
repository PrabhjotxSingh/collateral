import {test} from "node:test";
import assert from "node:assert/strict";
import {Animation,AnimationGroup,NullEngine,Scene,TransformNode,Vector3,Quaternion,Matrix} from "@babylonjs/core";
import {blendFrame,frameMatrix,applyMatrix,readFrame} from "../shared/weapon-transforms.js";
import {ClipPlayer} from "../client/src/animation.js";
import {usesProcedural} from "../shared/weapons.js";
import {Assets} from "../client/src/assets.js";
import {loadHeadlessModel} from "./model-helper.js";
import {readFileSync} from "node:fs";
import {makeBody,moveBody} from "../shared/simulation.js";
import {emptyInput} from "../shared/protocol.js";
import {MAPS} from "../shared/maps.js";
const pose={x:0,y:0,z:0,pitch:0,yaw:0,roll:0,scale:1};
test("ADS uses the short rotation arc and captures quaternion gizmo changes",()=>{
 const e=new NullEngine(),s=new Scene(e),n=new TransformNode("gun",s);
 try{
  blendFrame(n,{...pose,yaw:350},{...pose,yaw:730,x:.2},.5);
  assert.ok(Math.abs(n.rotationQuaternion!.toEulerAngles().y)<1e-5);
  assert.equal(n.position.x,.1);
  n.rotationQuaternion=Quaternion.FromEulerAngles(.2,.3,.4);
  const roundtrip=frameMatrix(readFrame(n)),actual=n.computeWorldMatrix(true);
  assert.ok(roundtrip.equalsWithEpsilon(actual,1e-5));
 }finally{s.dispose();e.dispose();}
});
test("one timeline supports independent frame ranges; explicit model/none never enable procedural fallback",()=>{
 const e=new NullEngine(),s=new Scene(e),n=new TransformNode("animated",s);
 try{
  const a=new Animation("track","position.x",60,Animation.ANIMATIONTYPE_FLOAT);
  a.setKeys([{frame:0,value:0},{frame:100,value:10}]);
  const g=new AnimationGroup("all actions",s);g.addTargetedAnimation(a,n);
  const p=new ClipPlayer([g],{fire:{clip:g.name,from:10,to:20},reload:{clip:g.name,from:30,to:50},draw:"missing"});
  assert.ok(p.play("fire",false));p.tick(1);p.phase(.5);assert.ok(Math.abs(n.position.x-1.5)<.001);
  assert.ok(p.play("reload",false));p.tick(1);p.phase(.5);assert.ok(Math.abs(n.position.x-4)<.001);
  assert.equal(p.has("draw"),false);
  assert.equal(usesProcedural("missing",false),false);
  assert.equal(usesProcedural("@collateral-none",false),false);
  assert.equal(usesProcedural("@collateral-built-in",true),true);
  p.dispose();
 }finally{s.dispose();e.dispose();}
});
test("exported editor weapon stays at the captured character-relative position after hand attachment",async()=>{
 const e=new NullEngine(),s=new Scene(e);
 try{
  const soldier=await loadHeadlessModel(new URL("../client/public/assets/characters/player.glb",import.meta.url),s);
  const gun=await loadHeadlessModel(new URL("../client/public/weapons/secondary/glock/world.glb",import.meta.url),s);
  const assets=new Assets(s);assets.load=async path=>path==="soldier"?soldier:gun;
  const parent=new TransformNode("player",s);
  parent.position.set(13,2,-9);parent.rotation.y=.7;
  const actor=await assets.instance("soldier",parent,undefined,{characterHeight:1.8});assert.ok(actor?.gripBindMatrix);
  const manifest=JSON.parse(readFileSync("client/public/weapons/secondary/glock/weapon.json","utf8"));
  const wanted={...pose,x:.12,y:1.27,z:.48,scale:.8,yaw:12};
  manifest.thirdPerson={...manifest.thirdPerson,space:"character",character:pose,weapon:wanted};
  const weapon=await assets.worldWeapon(manifest,actor!);assert.ok(weapon);
  const actual=weapon!.root.computeWorldMatrix(true);
  const expected=frameMatrix(wanted).multiply(parent.computeWorldMatrix(true));
  assert.ok(actual.equalsWithEpsilon(expected,.001),JSON.stringify({actual:actual.getTranslation(),expected:expected.getTranslation()}));
  // The old editor saved native-size reference coordinates. Migration must also
  // remove that scale difference, not merely subtract the socket's height.
  manifest.firstPerson.editorFramed=true;
  manifest.assets.character="soldier";
  manifest.thirdPerson.space=undefined;
  const old=new TransformNode("old-editor-weapon",s);
  applyMatrix(old,frameMatrix(wanted).multiply(Matrix.Invert(actor!.referenceFit!)));
  manifest.thirdPerson.weapon=readFrame(old);
  const migrated=await assets.worldWeapon(manifest,actor!);
  assert.ok(migrated!.root.computeWorldMatrix(true).equalsWithEpsilon(expected,.001));
  actor!.dispose();
 }finally{s.dispose();e.dispose();}
});
function stairs(ceiling=false,high=false){
 const tris:number[][]=[];
 const quad=(a:number[],b:number[],c:number[],d:number[])=>{tris.push([...a,...b,...c],[...a,...c,...d]);};
 quad([-3,0,-3],[3,0,-3],[3,0,0],[-3,0,0]);
 for(let i=0;i<5;i++){const h=(i+1)*(high?.6:.18),old=i*(high?.6:.18),z=i*.5;
  quad([-3,old,z],[3,old,z],[3,h,z],[-3,h,z]);
  quad([-3,h,z],[3,h,z],[3,h,z+.5],[-3,h,z+.5]);
 }
 if(ceiling)quad([-3,1.84,-2],[3,1.84,-2],[3,1.84,2.5],[-3,1.84,2.5]);
 return {...MAPS[0],walls:[],triangles:tris};
}
test("stairs climb and descend; high risers and low ceilings remain solid",()=>{
 const map=stairs(),b=makeBody(0,-1);
 for(let i=0;i<55;i++)moveBody(b,{...emptyInput(),forward:1},1/60,map);
 assert.ok(b.z>1.6 && b.y>.65,JSON.stringify(b));
 for(let i=0;i<55;i++)moveBody(b,{...emptyInput(),forward:-1},1/60,map);
 assert.ok(b.z<0 && b.y<.02,JSON.stringify(b));
 for(const blocked of [stairs(true),stairs(false,true)]){
  const c=makeBody(0,-1);
  for(let i=0;i<90;i++)moveBody(c,{...emptyInput(),forward:1},1/60,blocked);
  assert.ok(c.z<0,JSON.stringify(c));
 }
});
