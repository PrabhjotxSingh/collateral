export type Team = 'A' | 'B';
export type Phase = 'waiting' | 'prep' | 'live' | 'post' | 'finished' | 'abandoned';
export const ROUND_LIMITS=[3,5,7,9] as const;
export const DEATHMATCH_KILL_LIMITS=[10,20,30,50] as const;
export const DEATHMATCH_MINUTES=[5,10,15,20] as const;
export type GameMode='elimination'|'deathmatch';
export const RULES = Object.freeze({maxPlayers:4, teamSize:2, defaultRoundLimit:9, roundSeconds:100, prepSeconds:6, postSeconds:3, reconnectSeconds:30, hostLoadTimeoutSeconds:60, tickRate:60, patchRate:20, health:100, walkSpeed:3.6, sprintSpeed:5.2, weaponRaiseSeconds:0.2, stepDistance:1.25, stepHeight:.42, groundSnap:.46, adsSpeed:2.1, crouchSpeed:1.65, jumpSpeed:4.3, gravity:15, airControl:0.18, radius:0.32, height:1.8, crouchHeight:1.15, eyeHeight:1.62, crouchEyeHeight:1.0, headRadius:0.18, headHeight:0.23, headTopInset:0.06, magazine:17, reserve:51, reloadSeconds:1.7, shotSeconds:0.14, damage:40, headshotMultiplier:2.5, maxRange:100, inputTimeoutMs:250});
export const winsRequired=(roundLimit:number)=>Math.floor(roundLimit/2)+1;
export const otherTeam = (team:Team):Team => team === 'A' ? 'B' : 'A';
export function canStartMatch(players:Iterable<{team:Team;connected:boolean}>){
  const list=Array.from(players),a=list.filter(p=>p.team==='A').length,b=list.filter(p=>p.team==='B').length;
  return list.every(p=>p.connected)&&a===b&&(a===1||a===2);
}
