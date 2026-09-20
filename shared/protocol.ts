import type { Phase, Team, GameMode } from "./rules.js";
export interface Input {
  seq: number;
  forward: number;
  strafe: number;
  yaw: number;
  pitch: number;
  jump: boolean;
  crouch: boolean;
  ads: boolean;
  sprint?: boolean;
}
export interface PlayerView {
  id: string;
  username: string;
  team: Team;
  connected: boolean;
  weapon: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  ammo: number;
  reserve: number;
  crouch: boolean;
  ads: boolean;
  reloading: boolean;
  sprint: boolean;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  stepPhase: number;
  ack: number;
  kills: number;
  deaths: number;
  ping: number;
  spawnProtected: boolean;
}
export interface GameView {
  players: Record<string, PlayerView>;
  phase: Phase;
  mapId: string;
  mapChoice: string;
  hostId: string;
  lobbyName: string;
  round: number;
  roundLimit: number;
  scoreA: number;
  scoreB: number;
  remaining: number;
  winner: string;
  reason: string;
  gameMode: GameMode;
  killLimit: number;
  matchSeconds: number;
  ticketLimit: number;
  zoneTeam: string;
  zoneAdvantage: number;
  zoneA: number;
  zoneB: number;
}
export interface MapSummary {
  id: string;
  name: string;
}
export interface Lobby {
  roomId: string;
  name: string;
  host: string;
  players: number;
  locked: boolean;
  status: "waiting" | "in-game";
  teamA: number;
  teamB: number;
}
export interface ShotEvent {
  id: string;
  weapon: string;
  shotId?: number;
  targetId?: string;
  damage?: number;
  killed?: boolean;
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  distance: number;
  hit: boolean;
  headshot: boolean;
}
export interface KillFeedEvent {
  killerId?: string;
  killerName?: string;
  killerTeam?: Team;
  victimId: string;
  victimName: string;
  victimTeam: Team;
  weapon?: string;
  cause: "weapon" | "environment";
}
export interface DamageExchange {
  // Damage exchanged during the current round.
  opponentId: string;
  username: string;
  dealt: number;
  dealtHits: number;
  taken: number;
  takenHits: number;
}
export interface DeathRecap {
  round: number;
  exchanges: DamageExchange[];
}
export interface FireRequest {
  shotId: number;
  yaw: number;
  pitch: number;
}
export const emptyInput = (): Input => ({
  seq: 0,
  forward: 0,
  strafe: 0,
  yaw: 0,
  pitch: 0,
  jump: false,
  crouch: false,
  ads: false,
  sprint: false,
});
