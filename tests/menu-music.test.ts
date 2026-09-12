import {test} from 'node:test';import assert from 'node:assert/strict';import {MenuMusic} from '../client/src/menu-music.js';
test('per-frame menu class updates cannot starve the music fade',()=>{
 const names=['Audio','window','document','MutationObserver','requestAnimationFrame','cancelAnimationFrame','performance'] as const;
 const saved=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));let now=0,inMenu=true,observe=()=>{};const listeners:Record<string,()=>void>={},frames=new Map<number,(n:number)=>void>();let id=0;
 class MockAudio{loop=false;preload='';volume=0;paused=true;play(){this.paused=false;return Promise.resolve();}pause(){this.paused=true;}}
 try{
  const mocks={Audio:MockAudio,window:{addEventListener:(n:string,f:()=>void)=>listeners[n]=f},document:{body:{classList:{contains:()=>inMenu}}},MutationObserver:class{constructor(f:()=>void){observe=f;}observe(){}},requestAnimationFrame:(f:(n:number)=>void)=>{frames.set(++id,f);return id;},cancelAnimationFrame:(n:number)=>frames.delete(n),performance:{now:()=>now}};
  for(const n of names)Object.defineProperty(globalThis,n,{value:mocks[n],configurable:true,writable:true});
  const music=new MenuMusic(()=>({master:1}) as any),audio=(music as any).audio as MockAudio;listeners.pointerdown();
  const step=()=>{const f=[...frames.values()];frames.clear();f.forEach(cb=>cb(now));};
  for(now=16;now<1900;now+=16){observe();step();}assert.ok(audio.volume>.3);assert.equal(audio.paused,false);
  inMenu=false;music.sync();assert.equal(audio.paused,false);now+=1200;step();assert.equal(audio.volume,0);assert.equal(audio.paused,true);
 }finally{for(const n of names){const d=saved.get(n);if(d)Object.defineProperty(globalThis,n,d);else delete (globalThis as any)[n];}}
});
