import { Schema, MapSchema, defineTypes } from "@colyseus/schema";
import type { Phase, Team, GameMode } from "../../shared/rules.js";
export class PlayerState extends Schema {
  id = "";
  username = "";
  team: Team = "A";
  connected = true;
  weapon = "secondary/glock";
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  pitch = 0;
  health = 100;
  ammo = 17;
  reserve = 51;
  vx = 0;
  vy = 0;
  vz = 0;
  grounded = true;
  stepPhase = 0;
  sprint = false;
  crouch = false;
  ads = false;
  reloading = false;
  ack = 0;
  kills = 0;
  deaths = 0;
  ping = 0;
  spawnProtected = false;
}
defineTypes(PlayerState, {
  id: "string",
  username: "string",
  team: "string",
  connected: "boolean",
  weapon: "string",
  x: "number",
  y: "number",
  z: "number",
  yaw: "number",
  pitch: "number",
  health: "number",
  ammo: "number",
  reserve: "number",
  vx: "number",
  vy: "number",
  vz: "number",
  grounded: "boolean",
  stepPhase: "number",
  sprint: "boolean",
  crouch: "boolean",
  ads: "boolean",
  reloading: "boolean",
  ack: "number",
  kills: "number",
  deaths: "number",
  ping: "number",
  spawnProtected: "boolean",
});
export class GameState extends Schema {
  players = new MapSchema<PlayerState>();
  phase: Phase = "waiting";
  mapId = "depot";
  mapChoice = "random";
  hostId = "";
  lobbyName = "";
  round = 0;
  roundLimit = 9;
  scoreA = 0;
  scoreB = 0;
  remaining = 0;
  winner = "";
  reason = "";
  gameMode: GameMode = "elimination";
  killLimit = 20;
  matchSeconds = 600;
  ticketLimit = 100;
  zoneTeam = "";
  zoneAdvantage = 0;
  zoneA = 0;
  zoneB = 0;
}
defineTypes(GameState, {
  players: { map: PlayerState },
  phase: "string",
  mapId: "string",
  mapChoice: "string",
  hostId: "string",
  lobbyName: "string",
  round: "number",
  roundLimit: "number",
  scoreA: "number",
  scoreB: "number",
  remaining: "number",
  winner: "string",
  reason: "string",
  gameMode: "string",
  killLimit: "number",
  matchSeconds: "number",
  ticketLimit: "number",
  zoneTeam: "string",
  zoneAdvantage: "number",
  zoneA: "number",
  zoneB: "number",
});
