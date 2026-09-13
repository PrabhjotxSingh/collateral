import type { Client } from '@colyseus/core';
import { TacticalRoom } from './TacticalRoom.js';
import type { PlayerState } from './state.js';
import { RULES,winsRequired,type Team } from '../../shared/rules.js';
import { mapById } from '../../shared/maps.js';
import { emptyInput,type Input,type ShotEvent,type FireRequest } from '../../shared/protocol.js';
import { makeBody,moveBody,resolvePlayerContact,validInput,type Body } from '../../shared/simulation.js';
import {resolveMap} from '../../shared/geometry.js';
import { roundWinner,traceShot,spreadRadians } from './combat.js';
interface Runtime {body:Body;input:Input;received:number;lastShot:number;reloadEnd:number;lastStep:number;recoil:number;raiseEnd:number;sprintSuppressed:boolean;queuedFire:boolean;pendingFire?:FireRequest}
export class CombatRoom extends TacticalRoom {
  private runtime=new Map<string,Runtime>();
  private roundDamage=new Map<string,{damage:number;hits:number}>();
  private simTime=0;private accumulator=0;private deadline=0;
  // Large custom maps can take a while to download and bake client-side; the
  // prep countdown is held until the host confirms it has loaded, so nobody
  // burns round time (or worse, the whole prep phase) staring at a loading bar.
  private hostReady=false;private hostWait=0;
  async onCreate(options:any){
    await super.onCreate(options);
    this.onMessage('input',(client,input)=>{
      const rt=this.runtime.get(client.sessionId),p=this.state.players.get(client.sessionId);
      if(!rt||!p||!validInput(input)||input.seq<=rt.input.seq)return;
      rt.input=input;rt.received=this.simTime;p.yaw=input.yaw;p.pitch=input.pitch;
    });
    this.onMessage('ready',client=>{if(client.sessionId===this.state.hostId)this.hostReady=true;});
    this.onMessage('fire',(client,request)=>{if(request!==undefined&&(!Number.isSafeInteger(request?.shotId)||request.shotId<0||!Number.isFinite(request.yaw)||!Number.isFinite(request.pitch)||Math.abs(request.pitch)>1.6||Math.abs(request.yaw)>Math.PI*4))return;this.fire(client,request);});
    this.onMessage('reload',client=>{
      const p=this.state.players.get(client.sessionId),rt=this.runtime.get(client.sessionId);
      if(p&&rt&&this.state.phase==='live'&&p.health>0&&!p.reloading&&p.ammo<RULES.magazine&&p.reserve>0){p.reloading=true;rt.queuedFire=false;rt.sprintSuppressed=true;rt.reloadEnd=this.simTime+RULES.reloadSeconds;this.broadcast('reload',{id:p.id,x:p.x,y:p.y+RULES.eyeHeight,z:p.z});}
    });
    this.setSimulationInterval(dt=>{
      this.accumulator+=Math.min(dt/1000,0.1);
      while(this.accumulator>=1/RULES.tickRate){this.tick(1/RULES.tickRate);this.accumulator-=1/RULES.tickRate;}
    },1000/RULES.tickRate);
  }
  protected startMatch(client:Client){this.hostReady=false;this.hostWait=0;super.startMatch(client);this.prepRound();}
  private prepRound(){
    const s=this.state,map=mapById(s.mapId);this.roundDamage.clear();s.phase='prep';s.remaining=RULES.prepSeconds;s.winner='';s.reason='';this.deadline=this.simTime+RULES.prepSeconds;
    const count={A:0,B:0};
    for(const p of s.players.values()){
      const side=s.round%2===1?p.team:(p.team==='A'?'B':'A');const spawn=map.spawns[side][count[p.team]++];
      p.x=spawn.x;p.y=spawn.y??0;p.z=spawn.z;p.yaw=spawn.yaw;p.pitch=0;p.health=p.connected?RULES.health:0;p.ammo=RULES.magazine;p.reserve=RULES.reserve;p.reloading=false;p.crouch=false;p.ads=false;p.sprint=false;p.vx=0;p.vy=0;p.vz=0;p.grounded=true;p.stepPhase=0;p.ack=0;
      this.runtime.set(p.id,{body:{...makeBody(p.x,p.z),y:p.y},input:{...emptyInput(),yaw:p.yaw},received:this.simTime,lastShot:-Infinity,reloadEnd:0,lastStep:0,recoil:0,raiseEnd:0,sprintSuppressed:false,queuedFire:false});
    }
  }
  private tick(dt:number){
    this.simTime+=dt;const s=this.state;
    if(s.phase==='waiting'||s.phase==='finished'||s.phase==='abandoned')return;
    const teams=this.connectedTeams();
    if((s.phase==='prep'||s.phase==='live'||s.phase==='post')&&(!teams.A||!teams.B)){
      // Hold the clock while a dropped connection is inside its reconnection window.
      this.deadline+=dt;s.remaining=Math.max(0,this.deadline-this.simTime);s.reason='Waiting for a player to reconnect…';return;
    }
    if(s.reason==='Waiting for a player to reconnect…')s.reason='';
    if(s.phase==='prep'&&!this.hostReady&&(this.hostWait+=dt)<=RULES.hostLoadTimeoutSeconds){
      this.deadline+=dt;s.remaining=Math.max(0,this.deadline-this.simTime);s.reason='Waiting for the host to finish loading the map…';return;
    }
    if(s.reason==='Waiting for the host to finish loading the map…')s.reason='';
    s.remaining=Math.max(0,this.deadline-this.simTime);
    if(s.phase==='prep'){
      if(s.remaining<=0){s.phase='live';this.deadline=this.simTime+RULES.roundSeconds;s.remaining=RULES.roundSeconds;}
      return;
    }
    if(s.phase==='post'){if(s.remaining<=0){s.round++;this.prepRound();}return;}
    for(const p of s.players.values()){
      const rt=this.runtime.get(p.id);if(!rt||p.health<=0||!p.connected)continue;
      const input={...rt.input};
      if(this.simTime-rt.received>RULES.inputTimeoutMs/1000){input.forward=0;input.strafe=0;input.jump=false;input.sprint=false;}
      if(!input.sprint)rt.sprintSuppressed=false;
      input.sprint=!!input.sprint&&!rt.sprintSuppressed&&!p.reloading;
      const oldX=rt.body.x,oldZ=rt.body.z;
      moveBody(rt.body,input,dt,mapById(s.mapId));
      // Resolve against all living bodies, then map contacts again at crowded walls.
      for(let pass=0;pass<4;pass++){
        let touched=false;for(const other of s.players.values())if(other.id!==p.id&&other.connected&&other.health>0){const body=this.runtime.get(other.id)?.body;if(body)touched=resolvePlayerContact(rt.body,body)||touched;}
        if(!touched)break;resolveMap(rt.body,rt.body.crouch?RULES.crouchHeight:RULES.height,mapById(s.mapId));
      }
      p.x=rt.body.x;p.y=rt.body.y;p.z=rt.body.z;p.crouch=rt.body.crouch;p.ads=rt.body.ads;p.sprint=rt.body.sprint;p.vx=rt.body.vx;p.vy=rt.body.vy;p.vz=rt.body.vz;p.grounded=rt.body.grounded;p.ack=rt.input.seq;
      if(p.sprint)rt.raiseEnd=this.simTime+RULES.weaponRaiseSeconds;
      if(p.y<-8){p.health=0;continue;}
      if(p.reloading&&this.simTime>=rt.reloadEnd){const n=Math.min(RULES.magazine-p.ammo,p.reserve);p.ammo+=n;p.reserve-=n;p.reloading=false;}
      if(p.grounded){p.stepPhase+=Math.hypot(p.x-oldX,p.z-oldZ)/RULES.stepDistance;
        if(Math.floor(p.stepPhase)>rt.lastStep){rt.lastStep=Math.floor(p.stepPhase);this.broadcast('step',{id:p.id,x:p.x,y:p.y,z:p.z,phase:p.stepPhase,volume:p.crouch?0.25:p.ads?0.55:1});}}
      if(rt.queuedFire&&!p.sprint&&this.simTime>=rt.raiseEnd){rt.queuedFire=false;const client=this.clients.find(c=>c.sessionId===p.id);if(client)this.fire(client,rt.pendingFire);rt.pendingFire=undefined;}

    }
    const winner=roundWinner(s.players.values(),s.round,s.remaining<=0);if(winner)this.endRound(winner,winner==='draw'?'Equal survivors — no points':s.remaining<=0?'More survivors at the buzzer':'Team eliminated');
  }
  private fire(client:Client,request?:FireRequest){
    const p=this.state.players.get(client.sessionId),rt=this.runtime.get(client.sessionId);
    if(!p||!rt||!p.connected||p.health<=0||this.state.phase!=='live'||p.reloading||p.ammo<=0||this.simTime-rt.lastShot<RULES.shotSeconds){if(request)client.send('fire-rejected',{shotId:request.shotId});return;}
    if(p.sprint||this.simTime<rt.raiseEnd){rt.sprintSuppressed=true;rt.queuedFire=true;rt.pendingFire=request;return;}
    if(request){p.yaw=request.yaw;p.pitch=request.pitch;}
    const gap=this.simTime-rt.lastShot;rt.recoil=Math.max(0,rt.recoil-Math.max(0,gap-0.25)*8);
    const recoilPitch=Math.min(rt.recoil,8)*0.004;const recoilYaw=Math.sin(rt.recoil*1.7)*0.002;
    const spread=spreadRadians(rt.body),angle=Math.random()*Math.PI*2,radius=Math.sqrt(Math.random())*spread;
    rt.lastShot=this.simTime;rt.recoil++;p.ammo--;
    // Recoil is applied here, so a modified client cannot disable the ballistic penalty.
    const shot=traceShot(p,this.state.players.values(),mapById(this.state.mapId),p.yaw+recoilYaw+Math.cos(angle)*radius,p.pitch-recoilPitch+Math.sin(angle)*radius);
    let damage=0,killed=false;
    if(shot.target){const raw=RULES.damage*(shot.headshot?RULES.headshotMultiplier:1);damage=Math.min(shot.target.health,raw);shot.target.health=Math.max(0,shot.target.health-raw);killed=shot.target.health===0;
      const key=`${p.id}|${shot.target.id}`,record=this.roundDamage.get(key)??{damage:0,hits:0};record.damage+=damage;record.hits++;this.roundDamage.set(key,record);
      if(killed){p.kills++;this.sendDeathRecap(shot.target);}
    }
    const event:ShotEvent={id:p.id,shotId:request?.shotId,targetId:shot.target?.id,damage,killed,...shot.origin,dx:shot.dir.x,dy:shot.dir.y,dz:shot.dir.z,distance:shot.distance,hit:!!shot.target,headshot:shot.headshot};this.broadcast('shot',event);
    const winner=roundWinner(this.state.players.values(),this.state.round,false);if(winner)this.endRound(winner,'Team eliminated');
  }
  private endRound(winner:Team|'draw',reason:string){
    const s=this.state;if(s.phase!=='live')return;
    if(winner==='A')s.scoreA++;else if(winner==='B')s.scoreB++;s.winner=winner;s.reason=reason;
    if(Math.max(s.scoreA,s.scoreB)>=winsRequired(s.roundLimit)){s.phase='finished';s.remaining=0;}
    else{s.phase='post';this.deadline=this.simTime+RULES.postSeconds;s.remaining=RULES.postSeconds;}
  }
  protected onDisconnected(p:PlayerState){
    // Dropped players die for this round; reconnection restores their seat, never grants a live-round respawn.
    p.health=0;const rt=this.runtime.get(p.id);if(rt)rt.input=emptyInput();
  }
  protected onReconnected(p:PlayerState){
    if(this.state.phase==='prep')p.health=RULES.health;
    if(this.state.reason==='Waiting for a player to reconnect…')this.state.reason='';
  }
  protected onDepartureFinal(_p:PlayerState){
    if(!['prep','live','post'].includes(this.state.phase))return;
    const teams=this.connectedTeams();if(teams.A&&teams.B)return;
    this.state.phase='abandoned';this.state.remaining=0;this.state.winner='';this.state.reason='A team has left the match.';
  }
  private connectedTeams(){const count={A:0,B:0};for(const p of this.state.players.values())if(p.connected)count[p.team]++;return count;}
  private sendDeathRecap(victim:PlayerState){
    const enemies=[...this.state.players.values()].filter(p=>p.team!==victim.team);
    const exchanges=enemies.map(opponent=>{const dealt=this.roundDamage.get(`${victim.id}|${opponent.id}`)??{damage:0,hits:0},taken=this.roundDamage.get(`${opponent.id}|${victim.id}`)??{damage:0,hits:0};return {opponentId:opponent.id,username:opponent.username,dealt:Math.round(dealt.damage),dealtHits:dealt.hits,taken:Math.round(taken.damage),takenHits:taken.hits};}).filter(x=>x.dealtHits||x.takenHits);
    this.clients.find(c=>c.sessionId===victim.id)?.send('death-recap',{round:this.state.round,exchanges});
  }
}
