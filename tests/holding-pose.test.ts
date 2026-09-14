import {test} from "node:test";
import assert from "node:assert/strict";
import {NullEngine,Scene,TransformNode,Vector3,Matrix,Quaternion} from "@babylonjs/core";
import {loadHeadlessModel} from "./model-helper.js";
import {Assets} from "../client/src/assets.js";
import {readFileSync} from "node:fs";
import {readFrame,applyMatrix} from "../shared/weapon-transforms.js";
import type {HoldingPose} from "../shared/weapons.js";

test("SWAT support-hand solver reaches a weapon-local target without stretching and releases on death/reload",async()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 try{
  const soldier=await loadHeadlessModel(new URL("../client/public/assets/characters/player.glb",import.meta.url),scene);
  const gun=await loadHeadlessModel(new URL("../client/public/weapons/secondary/glock/world.glb",import.meta.url),scene);
  const assets=new Assets(scene);assets.load=async p=>p==="soldier"?soldier:gun;
  const parent=new TransformNode("player",scene);parent.position.set(5,2,-4);parent.rotation.y=.7;
  const actor=await assets.instance("soldier",parent,undefined,{characterHeight:1.8});assert.ok(actor?.holdingRig?.supported);
  const manifest=JSON.parse(readFileSync("client/public/weapons/secondary/glock/weapon.json","utf8"));
  const world=await assets.worldWeapon(manifest,actor!);assert.ok(world);
  const rig=actor!.holdingRig!,{upper,elbow,hand}=rig.left;
  for(const n of rig.joints)n.computeWorldMatrix(true);
  const before=hand!.getAbsolutePosition().clone();
  const lengths=[Vector3.Distance(upper!.getAbsolutePosition(),elbow!.getAbsolutePosition()),Vector3.Distance(elbow!.getAbsolutePosition(),before)];
  const goal=before.add(new Vector3(.02,-.04,.09));
  const marker=new TransformNode("target",scene);
  applyMatrix(marker,Matrix.Translation(goal.x,goal.y,goal.z).multiply(Matrix.Invert(world!.root.computeWorldMatrix(true))));
  const pose:HoldingPose={preset:"pistol",arms:{},supportHand:{enabled:true,orient:false,target:readFrame(marker)}};
  for(let i=0;i<60;i++){rig.restore();rig.apply(pose,world!.root);}
  hand!.computeWorldMatrix(true);
  const distance=Vector3.Distance(hand!.getAbsolutePosition(),goal);
  assert.ok(distance<.015,`support hand error ${distance}`);
  assert.ok(Math.abs(Vector3.Distance(upper!.getAbsolutePosition(),elbow!.getAbsolutePosition())-lengths[0])<.0001);
  assert.ok(Math.abs(Vector3.Distance(elbow!.getAbsolutePosition(),hand!.getAbsolutePosition())-lengths[1])<.0001);
  rig.restore();rig.apply(pose,world!.root,false);hand!.computeWorldMatrix(true);
  assert.ok(Vector3.Distance(hand!.getAbsolutePosition(),before)<.0001,"reload/death releases the grip");
  // Unreachable targets stop at normal reach and never create invalid rotations.
  rig.apply({...pose,supportHand:{...pose.supportHand,target:{...pose.supportHand.target,z:10000}}},world!.root);
  assert.ok(rig.joints.every(n=>n.rotationQuaternion?.asArray().every(Number.isFinite)));
  rig.restore();
  const custom={...pose,preset:"custom" as const,arms:{"mixamorig:RightArm":{x:0,y:0,z:0,w:1}},supportHand:{...pose.supportHand,enabled:false}};
  rig.apply(custom,world!.root);
  assert.ok(Quaternion.AreClose(rig.right.upper!.rotationQuaternion!,Quaternion.Identity(),.0001));
  rig.restore();rig.apply(undefined,world!.root);
  hand!.computeWorldMatrix(true);assert.ok(Vector3.Distance(hand!.getAbsolutePosition(),before)<.0001,"switching to an old weapon clears the pose");
 }finally{scene.dispose();engine.dispose();}
});
