import {RULES} from '../../shared/rules.js';
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const ease=(v:number)=>v*v*(3-2*v);
// Closed-form critically damped spring: stable across frame rates, no hard snap.
class Spring {
  value=0;velocity=0;
  step(target:number,dt:number,frequency=16){const y=this.value-target,j=this.velocity+frequency*y,e=Math.exp(-frequency*dt);this.value=target+(y+j*dt)*e;this.velocity=(this.velocity-frequency*j*dt)*e;return this.value;}
}
export interface MotionInput {yaw:number;pitch:number;vx:number;vy:number;vz:number;grounded:boolean;crouch:boolean;ads:boolean;sprint:boolean;reloading:boolean;stepPhase:number;lookActive:boolean;proceduralIdle?:boolean}
export interface WeaponPose {x:number;y:number;z:number;pitch:number;yaw:number;roll:number;ads:number;sprint:number}
export class ViewmodelMotion {
  private sx=new Spring();private sy=new Spring();private strafe=new Spring();private lateral=new Spring();private inertiaX=new Spring();private inertiaZ=new Spring();private dip=new Spring();private crouch=new Spring();private bobWeight=new Spring();private reloadWeight=new Spring();
  private previous?:MotionInput;private adsT=0;private sprintT=0;private recoil=0;private recoilPitch=0;private fallSpeed=0;private phase=0;
  reset(){this.previous=undefined;this.adsT=0;this.sprintT=0;this.recoil=0;this.recoilPitch=0;this.fallSpeed=0;this.phase=0;for(const s of [this.sx,this.sy,this.strafe,this.lateral,this.inertiaX,this.inertiaZ,this.dip,this.crouch,this.bobWeight,this.reloadWeight]){s.value=0;s.velocity=0;}}
  fire(){this.recoil=Math.min(.065,this.recoil+.024);this.recoilPitch=Math.min(.085,this.recoilPitch+.037);}
  update(input:MotionInput,dt:number):WeaponPose{
    dt=clamp(dt,.001,.05);const old=this.previous??input,speed=Math.hypot(input.vx,input.vz);
    const yawDelta=Math.atan2(Math.sin(input.yaw-old.yaw),Math.cos(input.yaw-old.yaw));
    const yawRate=input.lookActive?clamp(yawDelta/dt,-8,8):0,pitchRate=input.lookActive?clamp((input.pitch-old.pitch)/dt,-8,8):0;
    const swayX=this.sx.step(-yawRate*.008,dt,13),swayY=this.sy.step(-pitchRate*.006,dt,13);
    this.sprintT=clamp(this.sprintT+(input.sprint&&!input.ads&&!input.reloading?1:-1)*dt/RULES.weaponRaiseSeconds,0,1);
    this.adsT=clamp(this.adsT+(input.ads&&!input.sprint&&!input.reloading?1:-1)*dt/.18,0,1);
    const ads=ease(this.adsT),sprint=ease(this.sprintT),crouch=this.crouch.step(input.crouch?1:0,dt,18);
    const clean=1-this.reloadWeight.step(input.reloading?1:0,dt,35),steadiness=(1-.82*ads)*clean*(input.proceduralIdle===false?0:1);
    const side=(input.vx*Math.cos(input.yaw)-input.vz*Math.sin(input.yaw))/RULES.walkSpeed;
    const roll=this.strafe.step(clamp(-side*.035,-.05,.05),dt,15),offset=this.lateral.step(clamp(side*.007,-.01,.01),dt,15);
    const ax=clamp((input.vx-old.vx)/dt,-22,22),az=clamp((input.vz-old.vz)/dt,-22,22);
    const sideAccel=ax*Math.cos(input.yaw)-az*Math.sin(input.yaw),forwardAccel=ax*Math.sin(input.yaw)+az*Math.cos(input.yaw);
    const inertiaX=this.inertiaX.step(-sideAccel*.00065,dt,18),inertiaZ=this.inertiaZ.step(-forwardAccel*.0007,dt,18);
    if(old.grounded&&!input.grounded&&input.vy>0)this.dip.velocity-=.32;
    if(!input.grounded)this.fallSpeed=Math.max(this.fallSpeed,-input.vy);
    if(!old.grounded&&input.grounded){this.dip.velocity-=clamp(.35+this.fallSpeed*.045,.35,.85);this.fallSpeed=0;}
    const dip=clamp(this.dip.step(0,dt,23),-.025,.005);
    this.phase+=(input.stepPhase-this.phase)*(1-Math.exp(-24*dt));
    const weight=this.bobWeight.step(input.grounded?clamp(speed/RULES.walkSpeed,0,1.2):0,dt,18)*steadiness*(1-.45*ads);
    const angle=this.phase*Math.PI,bobX=Math.sin(angle)*.0025*weight,bobY=-Math.cos(angle*2)*.005*weight;
    this.recoil*=Math.exp(-16*dt);this.recoilPitch*=Math.exp(-19*dt);
    this.previous={...input};
    return {x:.18*(1-ads)+.055*sprint+bobX+(swayX*.16+offset+inertiaX)*steadiness,
      y:-.17+.051*ads-.14*sprint-.014*crouch*(1-ads)+bobY+dip+swayY*.12*steadiness,
      z:.4-.035*sprint+.012*crouch*(1-ads)+inertiaZ*steadiness-this.recoil,
      pitch:.5*sprint+swayY*steadiness-inertiaZ*2*steadiness-this.recoilPitch,
      yaw:swayX*steadiness+.12*sprint,roll:.18*sprint+roll*steadiness,ads,sprint};
  }
}
