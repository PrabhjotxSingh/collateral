import { Room, type Client, ServerError } from '@colyseus/core';
import { sessions,type Session } from './sessions.js';
import { directory,directoryEvents } from './directory.js';
import { RULES } from '../../shared/rules.js';
export class SessionRoom extends Room {
  maxClients=1;
  maxMessagesPerSecond=10;
  private identity?:Session;
  private changed=()=>this.broadcast('lobbies',[...directory.values()]);
  onCreate(){this.setPrivate(true);directoryEvents.on('change',this.changed);this.onMessage('list',client=>client.send('lobbies',[...directory.values()]));}
  onAuth(_client:Client,options:any){try{return sessions.claim(options.username,options.resumeToken);}catch(e){throw new ServerError(400,String((e as Error).message));}}
  onJoin(client:Client,_options:any,auth:Session){this.identity=auth;sessions.attach(auth,`identity:${this.roomId}`);client.send('identity',{username:auth.username,token:auth.token});this.changed();}
  onLeave(_client:Client,_consented:boolean){if(this.identity)sessions.release(this.identity);}
  onDispose(){directoryEvents.off('change',this.changed);if(this.identity)sessions.release(this.identity);}
}
