import {test} from 'node:test';import assert from 'node:assert/strict';
import {ViewmodelMotion,type MotionInput} from '../client/src/viewmodel.js';
import {defaults,loadSettings} from '../client/src/settings.js';
const input:MotionInput={yaw:0,pitch:0,vx:0,vy:0,vz:0,grounded:true,crouch:false,ads:true,sprint:false,reloading:false,stepPhase:0,lookActive:true};
test('crouched and standing ADS have identical sight baselines, while hip crouch remains lower',()=>{
 const standing=new ViewmodelMotion(),crouching=new ViewmodelMotion();let a,b;
 for(let i=0;i<240;i++){a=standing.update(input,1/60);b=crouching.update({...input,crouch:true},1/60);}
 assert.equal(a!.ads,1);for(const key of ['x','y','z','pitch','yaw','roll'] as const)assert.ok(Math.abs(a![key]-b![key])<1e-8,key);
 for(let i=0;i<240;i++){a=standing.update({...input,ads:false},1/60);b=crouching.update({...input,ads:false,crouch:true},1/60);}assert.ok(b!.y<a!.y);
});
test('saved browser-conflicting crouch bindings migrate to C',()=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 try{Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>JSON.stringify({keys:{...defaults.keys,crouch:'ControlLeft'},sensitivity:1.7})}});
 const settings=loadSettings();assert.equal(settings.keys.crouch,'KeyC');assert.equal(settings.keys.forward,'KeyW');assert.equal(settings.sensitivity,1.7);
 }finally{if(old)Object.defineProperty(globalThis,'localStorage',old);else delete (globalThis as any).localStorage;}
});
