import { Room, type Client, ServerError } from "@colyseus/core";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { GameState, PlayerState } from "./state.js";
import { sessions, sessionEvents, type Session } from "./sessions.js";
import { publishLobby } from "./directory.js";
import {
  RULES,
  ROUND_LIMITS,
  canStartMatch,
  type Team,
} from "../../shared/rules.js";
import { MAPS } from "../../shared/maps.js";
import { WEAPONS } from "./weapon-registry.js";
const hash = promisify(scrypt);
export class TacticalRoom extends Room<GameState> {
  maxClients = 4;
  maxMessagesPerSecond = 100;
  private salt = randomBytes(16);
  private passwordHash?: Buffer;
  protected devSolo = false;
  private released = (identity: Session) => {
    for (const [id, s] of this.identities)
      if (s === identity) {
        const p = this.state.players.get(id);
        if (p?.connected) {
          p.connected = false;
          this.onDisconnected(p);
        }
        this.clients.find((c) => c.sessionId === id)?.leave(4001);
        this.updateListing();
      }
  };
  protected identities = new Map<string, Session>();
  async onCreate(options: any) {
    if (!sessions.get(options.token)?.refs.size)
      throw new ServerError(401, "Connect with a username first.");
    if (
      typeof options.name !== "string" ||
      options.name.trim().length < 1 ||
      options.name.trim().length > 40
    )
      throw new ServerError(400, "Lobby name must be 1–40 characters.");
    if (
      typeof options.password !== "undefined" &&
      (typeof options.password !== "string" || options.password.length > 64)
    )
      throw new ServerError(400, "Password must be at most 64 characters.");
    this.setState(new GameState());
    this.devSolo = options.devSolo === true && process.env.NODE_ENV !== "production";
    sessionEvents.on("released", this.released);
    this.state.lobbyName = options.name.trim();
    if (this.devSolo) {
      if (typeof options.mapId !== "string" || !MAPS.some((map) => map.id === options.mapId))
        throw new ServerError(400, "Choose an installed map.");
      this.state.mapChoice = options.mapId;
    }
    this.setPatchRate(1000 / RULES.patchRate);
    if (options.password)
      this.passwordHash = (await hash(
        options.password,
        this.salt,
        64,
      )) as Buffer;
    this.onMessage("team", (client, team) =>
      this.guard(client, () => this.changeTeam(client, team)),
    );
    this.onMessage("start", (client) =>
      this.guard(client, () => this.startMatch(client)),
    );
    this.onMessage("round-limit", (client, value) =>
      this.guard(client, () => this.setRoundLimit(client, value)),
    );
    this.onMessage("map-selection", (client, value) =>
      this.guard(client, () => this.setMap(client, value)),
    );
    this.onMessage("back-lobby", (client) =>
      this.guard(client, () => this.backToLobby(client)),
    );
    this.onMessage("weapon", (client, value) =>
      this.guard(client, () => this.setWeapon(client, value)),
    );
  }
  async onAuth(_client: Client, options: any) {
    const identity = sessions.get(options.token);
    if (!identity || !identity.refs.size)
      throw new ServerError(401, "Connect with a username first.");
    if (identity.matchId)
      throw new ServerError(409, "This session is already in a lobby.");
    if (this.state.phase !== "waiting")
      throw new ServerError(403, "This match has already started.");
    if (this.passwordHash) {
      if (typeof options.password !== "string" || options.password.length > 64)
        throw new ServerError(403, "Incorrect lobby password.");
      const candidate = (await hash(options.password, this.salt, 64)) as Buffer;
      if (!timingSafeEqual(candidate, this.passwordHash))
        throw new ServerError(403, "Incorrect lobby password.");
    }
    return identity;
  }
  onJoin(client: Client, _options: any, identity: Session) {
    if (sessions.get(identity.token) !== identity)
      throw new ServerError(401, "Session ended. Choose your callsign again.");
    if (identity.matchId)
      throw new ServerError(409, "This session is already in a lobby.");
    identity.matchId = this.roomId;
    this.identities.set(client.sessionId, identity);
    sessions.attach(identity, `match:${this.roomId}`);
    const p = new PlayerState();
    p.id = client.sessionId;
    p.username = identity.username;
    p.weapon = [...WEAPONS.entries()].find(([,weapon])=>weapon.slot==="primary")?.[0] ??
      [...WEAPONS.entries()].find(([,weapon])=>weapon.slot==="secondary")?.[0] ?? p.weapon;
    p.team =
      [...this.state.players.values()].filter((p) => p.team === "A").length < 2
        ? "A"
        : "B";
    const initial=WEAPONS.get(p.weapon)?.gameplay;
    if(initial){p.ammo=initial.magazine;p.reserve=initial.reserve;}
    this.state.players.set(p.id, p);
    if (!this.state.hostId) this.state.hostId = p.id;
    this.updateListing();
    if (this.devSolo) this.startMatch(client);
  }
  protected guard(client: Client, fn: () => void) {
    try {
      fn();
    } catch (e) {
      client.send("error", (e as Error).message);
    }
  }
  protected changeTeam(client: Client, team: Team) {
    if (this.state.phase !== "waiting")
      throw new Error("Teams are locked during a match.");
    if (team !== "A" && team !== "B") throw new Error("Unknown team.");
    const p = this.state.players.get(client.sessionId);
    if (!p || p.team === team) return;
    if (
      [...this.state.players.values()].filter((p) => p.team === team).length >=
      2
    )
      throw new Error("That team is full.");
    p.team = team;
    this.updateListing();
  }
  protected startMatch(client: Client) {
    if (
      client.sessionId !== this.state.hostId ||
      this.state.phase !== "waiting"
    )
      throw new Error("Only the host can start a waiting lobby.");
    const players = [...this.state.players.values()];
    if (!this.devSolo && !canStartMatch(players))
      throw new Error(
        "One or two connected players on each team are required.",
      );
    this.lock();
    this.state.mapId =
      this.state.mapChoice === "random"
        ? MAPS[Math.floor(Math.random() * MAPS.length)].id
        : this.state.mapChoice;
    this.state.phase = "prep";
    this.state.round = 1;
    this.state.remaining = RULES.prepSeconds;
    this.updateListing();
  }
  protected setRoundLimit(client: Client, value: unknown) {
    if (
      client.sessionId !== this.state.hostId ||
      this.state.phase !== "waiting"
    )
      throw new Error("Only the host can change match length.");
    if (
      typeof value !== "number" ||
      !(ROUND_LIMITS as readonly number[]).includes(value)
    )
      throw new Error("Choose best of 3, 5, 7, or 9.");
    this.state.roundLimit = value;
  }
  protected setMap(client: Client, value: unknown) {
    if (
      client.sessionId !== this.state.hostId ||
      this.state.phase !== "waiting"
    )
      throw new Error("Only the host can select a map.");
    if (
      value !== "random" &&
      (typeof value !== "string" || !MAPS.some((map) => map.id === value))
    )
      throw new Error("That map is not installed.");
    this.state.mapChoice = value;
  }
  protected setWeapon(client: Client, value: unknown) {
    if (typeof value !== "string" || !WEAPONS.has(value))
      throw new Error("That weapon is not installed.");
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.weapon = value;
    if (this.state.phase === "waiting") {
      const stats = WEAPONS.get(value)!.gameplay;
      player.ammo = stats.magazine;
      player.reserve = stats.reserve;
    }
  }
  protected backToLobby(client: Client) {
    if (
      client.sessionId !== this.state.hostId ||
      !["finished", "abandoned"].includes(this.state.phase)
    )
      throw new Error("Only the host can return everyone to the lobby.");
    this.unlock();
    const s = this.state;
    s.phase = "waiting";
    s.round = 0;
    s.scoreA = 0;
    s.scoreB = 0;
    s.remaining = 0;
    s.winner = "";
    s.reason = "";
    for (const [id, p] of s.players) {
      if (!p.connected) {
        s.players.delete(id);
        continue;
      }
      p.health = RULES.health;
      p.ammo = RULES.magazine;
      p.reserve = RULES.reserve;
      p.reloading = false;
      p.sprint = false;
      p.crouch = false;
      p.ads = false;
      p.vx = 0;
      p.vy = 0;
      p.vz = 0;
    }
    this.updateListing();
  }
  protected updateListing() {
    const s = this.state;
    publishLobby(
      this.roomId,
      !this.devSolo && s.phase === "waiting"
        ? {
            roomId: this.roomId,
            name: s.lobbyName,
            host: s.players.get(s.hostId)?.username ?? "",
            players: s.players.size,
            locked: !!this.passwordHash,
          }
        : undefined,
    );
  }
  async onLeave(client: Client, consented: boolean) {
    const p = this.state.players.get(client.sessionId),
      identity = this.identities.get(client.sessionId);
    if (!p || !identity) return;
    p.connected = false;
    this.onDisconnected(p);
    sessions.detach(identity, `match:${this.roomId}`);
    this.updateListing();
    // Leaving a match is not signing out. The identity room keeps the menu session alive.
    if (!consented && sessions.get(identity.token) === identity)
      try {
        await this.allowReconnection(client, RULES.reconnectSeconds);
        if (sessions.get(identity.token) !== identity) {
          client.leave(4001);
          throw new Error("Session ended");
        }
        p.connected = true;
        sessions.attach(identity, `match:${this.roomId}`);
        this.onReconnected(p);
        this.updateListing();
        return;
      } catch {}
    identity.matchId = undefined;
    this.identities.delete(client.sessionId);
    if (this.state.phase === "waiting")
      this.state.players.delete(client.sessionId);
    if (this.state.hostId === client.sessionId)
      this.state.hostId =
        [...this.state.players.values()].find((p) => p.connected)?.id ?? "";
    this.onDepartureFinal(p);
    this.updateListing();
  }
  protected onDisconnected(_player: PlayerState) {}
  protected onReconnected(_player: PlayerState) {}
  protected onDepartureFinal(_player: PlayerState) {}
  onDispose() {
    sessionEvents.off("released", this.released);
    publishLobby(this.roomId);
    for (const identity of this.identities.values()) {
      identity.matchId = undefined;
      sessions.detach(identity, `match:${this.roomId}`);
    }
  }
}
