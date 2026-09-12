import {TransformNode} from '@babylonjs/core';
export interface GripProfile {version:1;weapon:'glock';character:'swat';x:number;y:number;z:number;pitch:number;yaw:number;roll:number;scale:number}
export const DEFAULT_GRIP:GripProfile={version:1,weapon:'glock',character:'swat',x:-0.025,y:0.037,z:0.027,pitch:0,yaw:0,roll:0,scale:1};
export function parseGrip(value:unknown):GripProfile{
 const v=value as Partial<GripProfile>;if(!v||v.version!==1||v.weapon!=='glock'||v.character!=='swat')throw new Error('Expected a SWAT/Glock v1 profile');
 const out={...DEFAULT_GRIP};
 for(const key of ['x','y','z','pitch','yaw','roll','scale'] as const){
  const n=v[key];if(typeof n!=='number'||!Number.isFinite(n))throw new Error('Invalid '+key);
  const limit=['x','y','z'].includes(key)?.5:180;
  if(key==='scale'?(n<.25||n>2):(Math.abs(n)>limit))throw new Error('Out of range: '+key);
  out[key]=n;
 }return out;
}
/** Dev tuning is deliberately session-only. Committed defaults are the source of truth. */
export function storedGrip():GripProfile{return {...DEFAULT_GRIP};}
export function applyGrip(node:TransformNode,p:GripProfile){node.position.set(p.x,p.y,p.z);node.rotation.set(p.pitch*Math.PI/180,p.yaw*Math.PI/180,p.roll*Math.PI/180);node.scaling.setAll(p.scale);}
