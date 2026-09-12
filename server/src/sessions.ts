import {EventEmitter} from 'node:events';
export const sessionEvents=new EventEmitter();sessionEvents.setMaxListeners(0);
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { RULES } from '../../shared/rules.js';
export interface Session {username:string;token:string;refs:Set<string>;expires:number;matchId?:string}
export class SessionRegistry {
  readonly activeNames = new Set<string>();
  private sessions = new Map<string,Session>();
  claim(requested:unknown,resume:unknown):Session {
    this.sweep();
    if(typeof requested!=='string'|| !/^[a-zA-Z0-9_ -]{3,20}$/.test(requested.trim())) throw new Error('Use 3–20 letters, numbers, spaces, underscores or hyphens.');
    const username=requested.trim(),key=username.toLowerCase(),old=this.sessions.get(key);
    if(old){
      const valid=typeof resume==='string'&&resume.length===old.token.length&&timingSafeEqual(Buffer.from(resume),Buffer.from(old.token));
      if(!valid||[...old.refs].some(r=>r.startsWith('identity:'))) throw new Error('That username is already connected or in use.');
      return old;
    }
    const session={username,token:randomBytes(32).toString('hex'),refs:new Set<string>(),expires:Date.now()+RULES.reconnectSeconds*1000};
    this.sessions.set(key,session);this.activeNames.add(key);return session;
  }
  get(token:unknown){this.sweep();return typeof token==='string'?[...this.sessions.values()].find(s=>s.token===token):undefined;}
  release(s:Session){const key=s.username.toLowerCase();if(this.sessions.get(key)!==s)return;s.refs.clear();s.expires=0;this.sessions.delete(key);this.activeNames.delete(key);sessionEvents.emit('released',s);}
  attach(s:Session,ref:string){if(this.sessions.get(s.username.toLowerCase())!==s)throw new Error('Session ended. Choose your callsign again.');s.refs.add(ref);s.expires=Infinity;}
  detach(s:Session,ref:string){s.refs.delete(ref);if(s.refs.size===0)this.release(s);}
  sweep(now=Date.now()){for(const [key,s]of this.sessions)if(s.refs.size===0&&s.expires<=now){this.sessions.delete(key);this.activeNames.delete(key);}}
}
export const sessions=new SessionRegistry();
