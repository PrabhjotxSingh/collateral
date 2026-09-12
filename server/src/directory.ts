import { EventEmitter } from 'node:events';
import type { Lobby } from '../../shared/protocol.js';
export const directory = new Map<string,Lobby>();
export const directoryEvents = new EventEmitter();
directoryEvents.setMaxListeners(0);
export function publishLobby(id:string,lobby?:Lobby){if(lobby)directory.set(id,lobby);else directory.delete(id);directoryEvents.emit('change');}
