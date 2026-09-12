import { Schema, MapSchema, defineTypes } from '@colyseus/schema';
import type { Phase, Team } from '../../shared/rules.js';
export class PlayerState extends Schema {
  id='';username='';team:Team='A';connected=true;
  x=0;y=0;z=0;yaw=0;pitch=0;health=100;ammo=17;reserve=51;
  vx=0;vy=0;vz=0;grounded=true;stepPhase=0;sprint=false;crouch=false;ads=false;reloading=false;ack=0;kills=0;
}
defineTypes(PlayerState,{id:'string',username:'string',team:'string',connected:'boolean',x:'number',y:'number',z:'number',yaw:'number',pitch:'number',health:'number',ammo:'number',reserve:'number',vx:'number',vy:'number',vz:'number',grounded:'boolean',stepPhase:'number',sprint:'boolean',crouch:'boolean',ads:'boolean',reloading:'boolean',ack:'number',kills:'number'});
export class GameState extends Schema {
  players=new MapSchema<PlayerState>();phase:Phase='waiting';mapId='depot';hostId='';lobbyName='';round=0;scoreA=0;scoreB=0;remaining=0;winner='';reason='';
}
defineTypes(GameState,{players:{map:PlayerState},phase:'string',mapId:'string',hostId:'string',lobbyName:'string',round:'number',scoreA:'number',scoreB:'number',remaining:'number',winner:'string',reason:'string'});
