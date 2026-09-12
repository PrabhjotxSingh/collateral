import { Client, type Room } from 'colyseus.js';
import type { GameView,Input,Lobby,ShotEvent } from '../../shared/protocol.js';
const endpoint=import.meta.env.VITE_SERVER_URL??`${location.origin}${import.meta.env.DEV?'/socket':''}`;
export class Network extends EventTarget {
  constructor(){super();window.addEventListener('pagehide',()=>{void this.leave();});}
  private client=new Client(endpoint);identity?:Room;match?:Room;
  username='';token='';lobbies:Lobby[]=[];state?:GameView;private intentional=new Set<Room>();
  private emit(name:string,value?:unknown){this.dispatchEvent(new CustomEvent(name,{detail:value}));}
  async connect(username:string){
    const saved=this.readSaved('collateral.identity');let room:Room;
    if(saved?.reconnectionToken&&saved.username.toLowerCase()===username.toLowerCase()){
      try{room=await this.client.reconnect(saved.reconnectionToken);}catch{room=await this.client.create('session',{username,resumeToken:saved.token});}
    }else room=await this.client.create('session',{username});
    await this.bindIdentity(room);
    const old=sessionStorage.getItem('collateral.match');
    if(old)try{this.bindMatch(await this.client.reconnect(old));}catch{sessionStorage.removeItem('collateral.match');}
  }
  private readSaved(key:string){try{return JSON.parse(sessionStorage.getItem(key)??'null');}catch{return null;}}
  private bindIdentity(room:Room){
    this.identity=room;
    return new Promise<void>(resolve=>{
      room.onMessage('identity',auth=>{this.username=auth.username;this.token=auth.token;sessionStorage.setItem('collateral.identity',JSON.stringify({...auth,reconnectionToken:room.reconnectionToken}));resolve();this.emit('identity');});
      room.onMessage('lobbies',lobbies=>{this.lobbies=lobbies;this.emit('lobbies');});
      room.onError((_code,message)=>this.emit('error',message));
      room.onLeave(code=>{if(!this.intentional.has(room)&&code!==1000)this.recoverIdentity(room);});
    });
  }
  private async recoverIdentity(_room:Room){
    // Names are released immediately when this connection ends. Never silently
    // reconnect an old identity after another player may have claimed its name.
    await this.leave();this.emit('disconnected');
  }
  async create(name:string,password:string){this.bindMatch(await this.client.create('tactical',{name,password,token:this.token}));}
  async join(roomId:string,password=''){this.bindMatch(await this.client.joinById(roomId,{password,token:this.token}));}
  private bindMatch(room:Room){
    this.match=room;sessionStorage.setItem('collateral.match',room.reconnectionToken);
    room.onStateChange(state=>{this.state=state.toJSON() as GameView;this.emit('state',this.state);});
    room.onMessage('error',message=>this.emit('error',message));
    room.onMessage('shot',(shot:ShotEvent)=>this.emit('shot',shot));
    room.onMessage('fire-rejected',event=>this.emit('fire-rejected',event));
    room.onMessage('step',step=>this.emit('step',step));room.onMessage('reload',event=>this.emit('reload',event));
    room.onError((_code,message)=>this.emit('error',message));
    room.onLeave(code=>{if(!this.intentional.has(room)&&code!==1000)this.recoverMatch(room);});
    this.emit('match');
  }
  private async recoverMatch(room:Room){
    if(this.match!==room||!this.identity)return;
    this.emit('error','Match connection interrupted. Reconnecting…');
    for(let attempt=0;attempt<12;attempt++){
      if(this.match!==room||!this.identity)return;
      await new Promise(r=>setTimeout(r,Math.min(500+attempt*150,2000)));
      try{const restored=await this.client.reconnect(room.reconnectionToken);if(this.match!==room||!this.identity){await restored.leave();return;}this.bindMatch(restored);return;}catch{}
    }
    if(this.match!==room)return;await this.leave();this.emit('error','Could not reconnect to the match.');
  }
  send(type:'team'|'start'|'input'|'fire'|'reload',value?:unknown){this.match?.send(type,value);}
  async leaveMatch(){
    const room=this.match;if(room)this.intentional.add(room);
    this.match=undefined;this.state=undefined;sessionStorage.removeItem('collateral.match');
    await room?.leave();this.emit('left');
  }
  async leave(){
    const room=this.match,identity=this.identity;
    if(room)this.intentional.add(room);if(identity)this.intentional.add(identity);
    this.match=undefined;this.identity=undefined;this.state=undefined;this.token='';this.username='';
    sessionStorage.removeItem('collateral.match');sessionStorage.removeItem('collateral.identity');
    await Promise.allSettled([room?.leave(),identity?.leave()]);this.emit('left');
  }
}
