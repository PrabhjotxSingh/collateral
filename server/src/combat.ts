import {rayMap} from '../../shared/geometry.js';
import type { PlayerState,GameState } from './state.js';
import { RULES,type Team } from '../../shared/rules.js';
import { direction,rayBox,type Body,type Vec } from '../../shared/simulation.js';
import type { GameMap } from '../../shared/maps.js';
export function roundWinner(players:Iterable<Pick<PlayerState,'team'|'health'|'connected'>>,_round:number,expired:boolean):Team|'draw'|undefined{
  let a=0,b=0,totalA=0,totalB=0;for(const p of players)if(p.connected){if(p.team==='A'){totalA++;if(p.health>0)a++;}else{totalB++;if(p.health>0)b++;}}
  if(a===0&&b===0)return 'draw';
  if(a===0)return 'B';if(b===0)return 'A';if(expired)return a===b?'draw':a>b?'A':'B';
}
export function traceShot(shooter:PlayerState,players:Iterable<PlayerState>,map:GameMap,yaw:number,pitch:number){
  const origin={x:shooter.x,y:shooter.y+(shooter.crouch?RULES.crouchEyeHeight:RULES.eyeHeight),z:shooter.z};
  const dir=direction(yaw,pitch);let distance:number=Math.min(RULES.maxRange,rayMap(origin,dir,map)),target:PlayerState|undefined,headshot=false;
  for(const box of map.walls)distance=Math.min(distance,rayBox(origin,dir,box));
  for(const player of players){
    if(player.id===shooter.id||player.health<=0||!player.connected)continue;
    const height=player.crouch?RULES.crouchHeight:RULES.height;
    const headY=player.y+height-RULES.headTopInset-RULES.headHeight/2;
    const headDistance=rayBox(origin,dir,{x:player.x,y:headY,z:player.z,w:RULES.headRadius*2,h:RULES.headHeight,d:RULES.headRadius*2});
    const bodyHeight=height-RULES.headTopInset-RULES.headHeight;
    const bodyDistance=rayBox(origin,dir,{x:player.x,y:player.y+bodyHeight/2,z:player.z,w:RULES.radius*2,h:bodyHeight,d:RULES.radius*2});
    const d=Math.min(headDistance,bodyDistance);
    if(d<distance){distance=d;target=player;headshot=headDistance<=bodyDistance;}
  }
  // Teammates block shots, but friendly fire is disabled in v1.
  if(target?.team===shooter.team)target=undefined;
  return {origin,dir,distance,target,headshot:!!target&&headshot};
}
export function spreadRadians(body:Body){return (body.grounded?0.0025:0.045)+(Math.hypot(body.vx,body.vz)>0.2?0.018:0)+(body.crouch?-0.001:0)+(body.ads?-0.001:0);}
