import {capsuleOverlapsMap,resolveMap} from './geometry.js';
import { RULES } from './rules.js';
import type { Box,GameMap } from './maps.js';
import type { Input } from './protocol.js';
export interface Body {x:number;y:number;z:number;vx:number;vy:number;vz:number;grounded:boolean;crouch:boolean;ads:boolean;lastJump:boolean;sprint:boolean}
export interface Vec {x:number;y:number;z:number}
export function rayBox(origin:Vec,dir:Vec,box:Box):number {
  let lo=0,hi:number=RULES.maxRange;
  for(const [axis,size]of [['x','w'],['y','h'],['z','d']] as const){
    const min=box[axis]-box[size]/2,max=box[axis]+box[size]/2;
    if(Math.abs(dir[axis])<1e-8){if(origin[axis]<min||origin[axis]>max)return Infinity;continue;}
    const a=(min-origin[axis])/dir[axis],b=(max-origin[axis])/dir[axis];
    lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));if(lo>hi)return Infinity;
  }return lo;
}
export const direction=(yaw:number,pitch:number):Vec=>({x:Math.sin(yaw)*Math.cos(pitch),y:-Math.sin(pitch),z:Math.cos(yaw)*Math.cos(pitch)});
export function intersects(b:Body,wall:Box,height=b.crouch?RULES.crouchHeight:RULES.height){
  return b.x+RULES.radius>wall.x-wall.w/2&&b.x-RULES.radius<wall.x+wall.w/2&&b.z+RULES.radius>wall.z-wall.d/2&&b.z-RULES.radius<wall.z+wall.d/2&&b.y+height>wall.y-wall.h/2+0.001&&b.y<wall.y+wall.h/2-0.001;
}
export function moveBody(b:Body,input:Input,dt:number,map:GameMap){
  b.crouch=input.crouch||(b.crouch&&(map.walls.some(w=>intersects(b,w,RULES.height))||capsuleOverlapsMap(b,RULES.height,map)));b.ads=input.ads;
  b.sprint=!!input.sprint&&!b.crouch&&!b.ads&&input.forward>0;
  const speed=b.crouch?RULES.crouchSpeed:b.ads?RULES.adsSpeed:b.sprint?RULES.sprintSpeed:RULES.walkSpeed;
  const length=Math.max(1,Math.hypot(input.forward,input.strafe));
  const forward=input.forward/length,strafe=input.strafe/length;
  const targetX=(Math.sin(input.yaw)*forward+Math.cos(input.yaw)*strafe)*speed;
  const targetZ=(Math.cos(input.yaw)*forward-Math.sin(input.yaw)*strafe)*speed;
  const blend=b.grounded?1:Math.min(1,dt*RULES.airControl*10);
  b.vx+=(targetX-b.vx)*blend;b.vz+=(targetZ-b.vz)*blend;
  if(input.jump&&!b.lastJump&&b.grounded){b.vy=RULES.jumpSpeed;b.grounded=false;}b.lastJump=input.jump;
  b.vy-=RULES.gravity*dt;
  if(map.triangles){
    const steps=Math.max(1,Math.ceil(Math.hypot(b.vx,b.vy,b.vz)*dt/0.08));b.grounded=false;
    for(let i=0;i<steps;i++){b.x+=b.vx*dt/steps;b.y+=b.vy*dt/steps;b.z+=b.vz*dt/steps;resolveMap(b,b.crouch?RULES.crouchHeight:RULES.height,map);}
    return;
  }
  for(const [axis,v]of [['x','vx'],['z','vz']] as const){const old=b[axis];b[axis]+=b[v]*dt;if(map.walls.some(w=>intersects(b,w))){b[axis]=old;b[v]=0;}}
  const oldY=b.y;b.y+=b.vy*dt;b.grounded=false;
  for(const wall of map.walls)if(intersects(b,wall)){
    if(b.vy<=0&&oldY>=wall.y+wall.h/2-0.03){b.y=wall.y+wall.h/2;b.grounded=true;}
    else b.y=oldY;b.vy=0;
  }
  if(b.y<=0){b.y=0;b.vy=0;b.grounded=true;}
}
export const makeBody=(x=0,z=0):Body=>({x,y:0,z,vx:0,vy:0,vz:0,grounded:true,crouch:false,ads:false,lastJump:false,sprint:false});
export function validInput(value:unknown):value is Input {
  if(!value||typeof value!=='object')return false;const v=value as Input;
  return (v.sprint===undefined||typeof v.sprint==='boolean')&&Number.isSafeInteger(v.seq)&&v.seq>=0&&v.seq<2**31&&Number.isFinite(v.forward)&&Math.abs(v.forward)<=1&&Number.isFinite(v.strafe)&&Math.abs(v.strafe)<=1&&Number.isFinite(v.yaw)&&Math.abs(v.yaw)<=Math.PI*100&&Number.isFinite(v.pitch)&&Math.abs(v.pitch)<=1.55&&['jump','crouch','ads'].every(k=>typeof (v as any)[k]==='boolean');
}

// Solid upright capsules for living players. Cosmetic limbs never own collision.
export function resolvePlayerContact(body:Body,other:Body){
  const r=RULES.radius,h=body.crouch?RULES.crouchHeight:RULES.height,oh=other.crouch?RULES.crouchHeight:RULES.height;
  const low=body.y+r,high=body.y+h-r,olow=other.y+r,ohigh=other.y+oh-r;
  const dy=low>ohigh?low-ohigh:high<olow?high-olow:0;let dx=body.x-other.x,dz=body.z-other.z;
  let distance=Math.hypot(dx,dy,dz);if(distance>=r*2)return false;if(distance<1e-8){dx=1;dz=0;distance=1;}
  const nx=dx/distance,ny=dy/distance,nz=dz/distance,depth=r*2-(distance===1&&dx===1&&dz===0?0:distance)+1e-5;
  body.x+=nx*depth;body.y+=ny*depth;body.z+=nz*depth;const inward=body.vx*nx+body.vy*ny+body.vz*nz;
  if(inward<0){body.vx-=nx*inward;body.vy-=ny*inward;body.vz-=nz*inward;}if(ny>0.65)body.grounded=true;return true;
}
