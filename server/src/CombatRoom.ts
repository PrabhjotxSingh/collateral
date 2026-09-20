import type { Client } from "@colyseus/core";
import { TacticalRoom } from "./TacticalRoom.js";
import type { PlayerState } from "./state.js";
import { RULES, winsRequired, type Team } from "../../shared/rules.js";
import { mapById } from "../../shared/maps.js";
import {
  emptyInput,
  type Input,
  type ShotEvent,
  type FireRequest,
  type KillFeedEvent,
} from "../../shared/protocol.js";
import {
  makeBody,
  moveBody,
  resolvePlayerContact,
  validInput,
  type Body,
} from "../../shared/simulation.js";
import { resolveMap } from "../../shared/geometry.js";
import {
  roundWinner,
  traceShot,
  deathmatchWinner,
  hillControl,
} from "./combat.js";
import { WEAPONS } from "./weapon-registry.js";
import { DEFAULT_WEAPON_GAMEPLAY } from "../../shared/weapons.js";
interface Runtime {
  body: Body;
  input: Input;
  received: number;
  lastShot: number;
  reloadEnd: number;
  lastStep: number;
  recoil: number;
  raiseEnd: number;
  sprintSuppressed: boolean;
  queuedFire: boolean;
  pendingFire?: FireRequest;
  respawnAt: number;
  protectionEnd: number;
  respawnReady: boolean;
  inventory: Map<string, { ammo: number; reserve: number }>;
}
export function switchWeaponAmmo(
  inventory: Map<string, { ammo: number; reserve: number }>,
  previous: string,
  next: string,
  current: { ammo: number; reserve: number },
  fresh: { magazine: number; reserve: number },
) {
  inventory.set(previous, { ...current });
  const restored = inventory.get(next) ?? {
    ammo: fresh.magazine,
    reserve: fresh.reserve,
  };
  inventory.set(next, { ...restored });
  return { ...restored };
}
export class CombatRoom extends TacticalRoom {
  private runtime = new Map<string, Runtime>();
  private roundDamage = new Map<string, { damage: number; hits: number }>();
  private simTime = 0;
  private accumulator = 0;
  private deadline = 0;
  // Large custom maps can take a while to download and bake client-side; the
  // prep countdown is held until the host confirms it has loaded, so nobody
  // burns round time (or worse, the whole prep phase) staring at a loading bar.
  private hostReady = false;
  private hostWait = 0;
  private ticketA = 0;
  private ticketB = 0;
  private stats(p: PlayerState) {
    return WEAPONS.get(p.weapon)?.gameplay ?? DEFAULT_WEAPON_GAMEPLAY;
  }
  async onCreate(options: any) {
    await super.onCreate(options);
    this.onMessage("ping", (client, sent) => client.send("pong", sent));
    this.onMessage("latency", (client, value) => {
      const p = this.state.players.get(client.sessionId);
      if (p && Number.isFinite(value))
        p.ping = Math.max(0, Math.min(5000, Math.round(value)));
    });
    this.onMessage("input", (client, input) => {
      const rt = this.runtime.get(client.sessionId),
        p = this.state.players.get(client.sessionId);
      if (!rt || !p || !validInput(input) || input.seq <= rt.input.seq) return;
      rt.input = input;
      rt.received = this.simTime;
      p.yaw = input.yaw;
      p.pitch = input.pitch;
    });
    this.onMessage("ready", (client) => {
      if (client.sessionId === this.state.hostId) this.hostReady = true;
    });
    this.onMessage("respawn", (client) => {
      const p=this.state.players.get(client.sessionId),rt=this.runtime.get(client.sessionId);
      if(!p||!rt||p.health>0||!rt.respawnReady||this.simTime<rt.respawnAt)return;
      if(this.state.phase!=="live"||(this.state.gameMode!=="deathmatch"&&this.state.gameMode!=="king-of-the-hill"))return;
      this.respawn(p,rt);
    });
    this.onMessage("fire", (client, request) => {
      if (
        request !== undefined &&
        (!Number.isSafeInteger(request?.shotId) ||
          request.shotId < 0 ||
          !Number.isFinite(request.yaw) ||
          !Number.isFinite(request.pitch) ||
          Math.abs(request.pitch) > 1.6 ||
          Math.abs(request.yaw) > Math.PI * 4)
      )
        return;
      this.fire(client, request);
    });
    this.onMessage("reload", (client) => {
      const p = this.state.players.get(client.sessionId),
        rt = this.runtime.get(client.sessionId);
      if (
        p &&
        rt &&
        this.state.phase === "live" &&
        p.health > 0 &&
        !p.reloading &&
        p.ammo < this.stats(p).magazine &&
        p.reserve > 0
      ) {
        p.reloading = true;
        rt.queuedFire = false;
        rt.sprintSuppressed = true;
        rt.reloadEnd = this.simTime + this.stats(p).reloadSeconds;
        this.broadcast("reload", {
          id: p.id,
          x: p.x,
          y: p.y + RULES.eyeHeight,
          z: p.z,
        });
      }
    });
    this.setSimulationInterval((dt) => {
      this.accumulator += Math.min(dt / 1000, 0.1);
      while (this.accumulator >= 1 / RULES.tickRate) {
        this.tick(1 / RULES.tickRate);
        this.accumulator -= 1 / RULES.tickRate;
      }
    }, 1000 / RULES.tickRate);
  }
  protected startMatch(client: Client) {
    this.hostReady = false;
    this.hostWait = 0;
    this.ticketA = 0;
    this.ticketB = 0;
    super.startMatch(client);
    this.prepRound();
    if (this.devSolo) {
      this.hostReady = true;
      this.state.phase = "live";
      this.state.remaining = 0;
      this.state.reason = "DEV SANDBOX · UNLIMITED TIME";
    }
  }
  protected setWeapon(client: Client, value: unknown) {
    const p = this.state.players.get(client.sessionId),
      rt = this.runtime.get(client.sessionId);
    if (!p || p.weapon === value) return super.setWeapon(client, value);
    const previous = p.weapon,
      current = { ammo: p.ammo, reserve: p.reserve };
    super.setWeapon(client, value);
    if (!rt) return;
    const restored = switchWeaponAmmo(
      rt.inventory,
      previous,
      p.weapon,
      current,
      this.stats(p),
    );
    p.ammo = restored.ammo;
    p.reserve = restored.reserve;
    p.reloading = false;
    this.broadcast("reload-stop", { id: p.id });
    rt.reloadEnd = 0;
    rt.queuedFire = false;
    rt.pendingFire = undefined;
  }
  private prepRound() {
    const s = this.state,
      map = mapById(s.mapId);
    this.roundDamage.clear();
    s.phase = "prep";
    s.remaining = RULES.prepSeconds;
    s.winner = "";
    s.reason = "";
    this.deadline = this.simTime + RULES.prepSeconds;
    const count = { A: 0, B: 0 };
    for (const p of s.players.values()) {
      const side = s.round % 2 === 1 ? p.team : p.team === "A" ? "B" : "A";
      const list = map.spawns[side], index=count[p.team]++, base=list[index % list.length] ?? list[0];
      // A map may provide fewer spawn markers than the lobby has players. Fan
      // overflow players out beside the authored marker instead of stacking
      // capsules at exactly the same coordinates (which previously caused a
      // large collision correction that looked like a teleport to map centre).
      const overflow=Math.floor(index/Math.max(1,list.length)), lateral=overflow?((overflow+1)>>1)*(overflow%2?1:-1)*RULES.radius*2.35:0;
      const spawn={...base,x:base.x+Math.cos(base.yaw)*lateral,z:base.z-Math.sin(base.yaw)*lateral};
      const stats = this.stats(p);
      p.x = spawn.x;
      p.y = spawn.y ?? 0;
      p.z = spawn.z;
      p.yaw = spawn.yaw;
      p.pitch = 0;
      p.health = p.connected ? RULES.health : 0;
      p.ammo = stats.magazine;
      p.reserve = stats.reserve;
      p.reloading = false;
      p.crouch = false;
      p.ads = false;
      p.sprint = false;
      p.vx = 0;
      p.vy = 0;
      p.vz = 0;
      p.grounded = true;
      p.stepPhase = 0;
      p.spawnProtected = false;
      p.ack = 0;
      this.runtime.set(p.id, {
        body: { ...makeBody(p.x, p.z), y: p.y },
        input: { ...emptyInput(), yaw: p.yaw },
        received: this.simTime,
        lastShot: -Infinity,
        reloadEnd: 0,
        lastStep: 0,
        recoil: 0,
        raiseEnd: 0,
        sprintSuppressed: false,
        queuedFire: false,
        inventory: new Map([
          [p.weapon, { ammo: stats.magazine, reserve: stats.reserve }],
        ]),
        respawnAt: 0,
        protectionEnd: 0,
        respawnReady: false,
      });
    }
  }
  private tick(dt: number) {
    this.simTime += dt;
    const s = this.state;
    if (
      s.phase === "waiting" ||
      s.phase === "finished" ||
      s.phase === "abandoned"
    )
      return;
    if (this.devSolo) {
      s.phase = "live";
      s.remaining = 0;
      s.reason = "DEV SANDBOX · UNLIMITED TIME";
    }
    const teams = this.connectedTeams();
    if (
      !this.devSolo &&
      (s.phase === "prep" || s.phase === "live" || s.phase === "post") &&
      (!teams.A || !teams.B)
    ) {
      // Hold the clock while a dropped connection is inside its reconnection window.
      this.deadline += dt;
      s.remaining = Math.max(0, this.deadline - this.simTime);
      s.reason = "Waiting for a player to reconnect…";
      return;
    }
    if (s.reason === "Waiting for a player to reconnect…") s.reason = "";
    if (
      s.phase === "prep" &&
      !this.hostReady &&
      (this.hostWait += dt) <= RULES.hostLoadTimeoutSeconds
    ) {
      this.deadline += dt;
      s.remaining = Math.max(0, this.deadline - this.simTime);
      s.reason = "Waiting for the host to finish loading the map…";
      return;
    }
    if (s.reason === "Waiting for the host to finish loading the map…")
      s.reason = "";
    s.remaining = Math.max(0, this.deadline - this.simTime);
    if (s.phase === "prep") {
      if (s.remaining <= 0) {
        s.phase = "live";
        const seconds =
          s.gameMode === "deathmatch" || s.gameMode === "king-of-the-hill"
            ? s.matchSeconds
            : RULES.roundSeconds;
        this.deadline = this.simTime + seconds;
        s.remaining = seconds;
      }
      return;
    }
    if (s.phase === "post") {
      if (s.remaining <= 0) {
        s.round++;
        this.prepRound();
      }
      return;
    }
    for (const p of s.players.values()) {
      const rt = this.runtime.get(p.id);
      if (!rt || !p.connected) continue;
      if (p.spawnProtected && this.simTime >= rt.protectionEnd)
        p.spawnProtected = false;
      if (p.health <= 0) {
        if (
          (s.gameMode === "deathmatch" || s.gameMode === "king-of-the-hill") &&
          rt.respawnAt > 0 && this.simTime >= rt.respawnAt
        ) rt.respawnReady=true;
        continue;
      }
      const input = { ...rt.input };
      if (this.simTime - rt.received > RULES.inputTimeoutMs / 1000) {
        input.forward = 0;
        input.strafe = 0;
        input.jump = false;
        input.sprint = false;
      }
      if (!input.sprint) rt.sprintSuppressed = false;
      input.sprint = !!input.sprint && !rt.sprintSuppressed && !p.reloading;
      const oldX = rt.body.x,
        oldZ = rt.body.z;
      moveBody(rt.body, input, dt, mapById(s.mapId));
      if(![rt.body.x,rt.body.y,rt.body.z,rt.body.vx,rt.body.vy,rt.body.vz].every(Number.isFinite)){
        rt.body={...makeBody(oldX,oldZ),y:Number.isFinite(p.y)?p.y:0};
      }
      // Resolve against all living bodies, then map contacts again at crowded walls.
      for (let pass = 0; pass < 4; pass++) {
        let touched = false;
        for (const other of s.players.values())
          if (other.id !== p.id && other.connected && other.health > 0) {
            const body = this.runtime.get(other.id)?.body;
            if (body) touched = resolvePlayerContact(rt.body, body) || touched;
          }
        if (!touched) break;
        resolveMap(
          rt.body,
          rt.body.crouch ? RULES.crouchHeight : RULES.height,
          mapById(s.mapId),
        );
      }
      p.x = rt.body.x;
      p.y = rt.body.y;
      p.z = rt.body.z;
      p.crouch = rt.body.crouch;
      p.ads = rt.body.ads;
      p.sprint = rt.body.sprint;
      p.vx = rt.body.vx;
      p.vy = rt.body.vy;
      p.vz = rt.body.vz;
      p.grounded = rt.body.grounded;
      p.ack = rt.input.seq;
      if (p.sprint) rt.raiseEnd = this.simTime + RULES.weaponRaiseSeconds;
      if (p.y < -8) {
        p.health = 0;
        p.deaths++;
        this.broadcast("kill-feed", {
          victimId: p.id,
          victimName: p.username,
          victimTeam: p.team,
          cause: "environment",
        } satisfies KillFeedEvent);
        if (s.gameMode === "deathmatch" || s.gameMode === "king-of-the-hill")
          rt.respawnAt = this.simTime + 3, rt.respawnReady=false;
        continue;
      }
      if (p.reloading && this.simTime >= rt.reloadEnd) {
        const n = Math.min(this.stats(p).magazine - p.ammo, p.reserve);
        p.ammo += n;
        p.reserve -= n;
        p.reloading = false;
      }
      if (p.grounded) {
        p.stepPhase += Math.hypot(p.x - oldX, p.z - oldZ) / RULES.stepDistance;
        if (Math.floor(p.stepPhase) > rt.lastStep) {
          rt.lastStep = Math.floor(p.stepPhase);
          this.broadcast("step", {
            id: p.id,
            x: p.x,
            y: p.y,
            z: p.z,
            phase: p.stepPhase,
            volume: p.crouch ? 0.25 : p.ads ? 0.55 : 1,
          });
        }
      }
      if (rt.queuedFire && !p.sprint && this.simTime >= rt.raiseEnd) {
        rt.queuedFire = false;
        const client = this.clients.find((c) => c.sessionId === p.id);
        if (client) this.fire(client, rt.pendingFire);
        rt.pendingFire = undefined;
      }
    }
    if (!this.devSolo && s.gameMode === "king-of-the-hill") {
      const map = mapById(s.mapId),
        fallback = map.bounds
          ? {
              x: (map.bounds.minX + map.bounds.maxX) / 2,
              y: 0,
              z: (map.bounds.minZ + map.bounds.maxZ) / 2,
              radius: 4,
              height: 3,
            }
          : { x: 0, y: 0, z: 0, radius: 4, height: 3 },
        zone = map.kingZone ?? fallback;
      let a = 0,
        b = 0;
      for (const p of s.players.values())
        if (
          p.connected &&
          p.health > 0 &&
          Math.hypot(p.x - zone.x, p.z - zone.z) <= zone.radius &&
          p.y >= zone.y - 0.25 &&
          p.y <= zone.y + zone.height
        ) {
          if (p.team === "A") a++;
          else b++;
        }
      const control = hillControl(a, b);
      s.zoneA = a;
      s.zoneB = b;
      s.zoneAdvantage = control.advantage;
      s.zoneTeam = control.team;
      if (s.zoneTeam === "A") this.ticketA += s.zoneAdvantage * dt;
      else if (s.zoneTeam === "B") this.ticketB += s.zoneAdvantage * dt;
      s.scoreA = Math.floor(this.ticketA);
      s.scoreB = Math.floor(this.ticketB);
      const reached =
        s.scoreA >= s.ticketLimit
          ? "A"
          : s.scoreB >= s.ticketLimit
            ? "B"
            : undefined;
      if (reached || s.remaining <= 0) {
        s.winner =
          reached ??
          (s.scoreA === s.scoreB ? "draw" : s.scoreA > s.scoreB ? "A" : "B");
        s.reason = reached
          ? `Team ${reached} reached ${s.ticketLimit} tickets`
          : s.winner === "draw"
            ? "Time expired — tied tickets"
            : "Time expired";
        s.phase = "finished";
        s.remaining = 0;
        return;
      }
    }
    if (!this.devSolo && s.gameMode === "deathmatch" && s.remaining <= 0) {
      s.winner = deathmatchWinner(s.scoreA, s.scoreB, s.killLimit, true)!;
      s.reason =
        s.winner === "draw" ? "Time expired — tied score" : "Time expired";
      s.phase = "finished";
      s.remaining = 0;
      return;
    }
    const winner =
      this.devSolo || s.gameMode !== "elimination"
        ? undefined
        : roundWinner(s.players.values(), s.round, s.remaining <= 0);
    if (winner)
      this.endRound(
        winner,
        winner === "draw"
          ? "Equal survivors — no points"
          : s.remaining <= 0
            ? "More survivors at the buzzer"
            : "Team eliminated",
      );
  }
  private fire(client: Client, request?: FireRequest) {
    const p = this.state.players.get(client.sessionId),
      rt = this.runtime.get(client.sessionId);
    if (
      !p ||
      !rt ||
      !p.connected ||
      p.health <= 0 ||
      this.state.phase !== "live" ||
      p.reloading ||
      p.ammo <= 0 ||
      this.simTime - rt.lastShot < 60 / this.stats(p).rpm
    ) {
      if (request) client.send("fire-rejected", { shotId: request.shotId });
      return;
    }
    if (p.sprint || this.simTime < rt.raiseEnd) {
      rt.sprintSuppressed = true;
      rt.queuedFire = true;
      rt.pendingFire = request;
      return;
    }
    if (request) {
      p.yaw = request.yaw;
      p.pitch = request.pitch;
    }
    const stats = this.stats(p),
      gap = this.simTime - rt.lastShot;
    rt.recoil = Math.max(
      0,
      rt.recoil - Math.max(0, gap - 0.25) * stats.recoil.recovery,
    );
    const recoilPitch =
      ((Math.min(rt.recoil, 8) * stats.recoil.pitch * Math.PI) / 180) * 0.04;
    const recoilYaw =
      ((Math.sin(rt.recoil * 1.7) * stats.recoil.yaw * Math.PI) / 180) * 0.04;
    const speed = Math.hypot(rt.body.vx, rt.body.vz),
      spread = !rt.body.grounded
        ? stats.spread.moving * 2
        : rt.body.ads
          ? stats.spread.ads
          : rt.body.crouch
            ? stats.spread.crouched
            : speed > 0.2
              ? stats.spread.moving
              : stats.spread.standing,
      angle = Math.random() * Math.PI * 2,
      radius = Math.sqrt(Math.random()) * spread;
    rt.lastShot = this.simTime;
    rt.recoil++;
    p.ammo--;
    // Recoil is applied here, so a modified client cannot disable the ballistic penalty.
    const shot = traceShot(
      p,
      this.state.players.values(),
      mapById(this.state.mapId),
      p.yaw + recoilYaw + Math.cos(angle) * radius,
      p.pitch - recoilPitch + Math.sin(angle) * radius,
      stats.range,
    );
    let damage = 0,
      killed = false;
    if (shot.target) {
      const raw = stats.damage * (shot.headshot ? stats.headshotMultiplier : 1);
      damage = Math.min(shot.target.health, raw);
      shot.target.health = Math.max(0, shot.target.health - raw);
      killed = shot.target.health === 0;
      const key = `${p.id}|${shot.target.id}`,
        record = this.roundDamage.get(key) ?? { damage: 0, hits: 0 };
      record.damage += damage;
      record.hits++;
      this.roundDamage.set(key, record);
      if (killed) {
        p.kills++;
        shot.target.deaths++;
        shot.target.spawnProtected = false;
        this.broadcast("kill-feed", {
          killerId: p.id,
          killerName: p.username,
          killerTeam: p.team,
          victimId: shot.target.id,
          victimName: shot.target.username,
          victimTeam: shot.target.team,
          weapon:
            WEAPONS.get(p.weapon)?.name ??
            p.weapon.split("/").at(-1) ??
            "Weapon",
          cause: "weapon",
        } satisfies KillFeedEvent);
        this.sendDeathRecap(shot.target);
        if (this.state.gameMode === "deathmatch") {
          if (p.team === "A") this.state.scoreA++;
          else this.state.scoreB++;
          const victimRuntime = this.runtime.get(shot.target.id);
          if (victimRuntime) victimRuntime.respawnAt = this.simTime + 3, victimRuntime.respawnReady=false;
          const winner = deathmatchWinner(
            this.state.scoreA,
            this.state.scoreB,
            this.state.killLimit,
            false,
          );
          if (winner) {
            this.state.winner = winner;
            this.state.reason = `Team ${winner} reached ${this.state.killLimit} kills`;
            this.state.phase = "finished";
            this.state.remaining = 0;
          }
        }
        if (this.state.gameMode === "king-of-the-hill") {
          const victimRuntime = this.runtime.get(shot.target.id);
          if (victimRuntime) victimRuntime.respawnAt = this.simTime + 3, victimRuntime.respawnReady=false;
        }
      }
    }
    const event: ShotEvent = {
      id: p.id,
      weapon: p.weapon,
      shotId: request?.shotId,
      targetId: shot.target?.id,
      damage,
      killed,
      ...shot.origin,
      dx: shot.dir.x,
      dy: shot.dir.y,
      dz: shot.dir.z,
      distance: shot.distance,
      hit: !!shot.target,
      headshot: shot.headshot,
    };
    this.broadcast("shot", event);
    const winner =
      this.devSolo || this.state.gameMode !== "elimination"
        ? undefined
        : roundWinner(this.state.players.values(), this.state.round, false);
    if (winner) this.endRound(winner, "Team eliminated");
  }
  private respawn(p: PlayerState, rt: Runtime) {
    const map = mapById(this.state.mapId),
      list = [...map.spawns.A, ...map.spawns.B];
    // Deathmatch spawns are neutral. Prefer locations furthest from living
    // opponents, then randomize between the two safest choices.
    const enemies = [...this.state.players.values()].filter(
      (other) => other.id !== p.id && other.connected && other.health > 0,
    );
    const ranked = [...list].sort((a, b) => {
      const safe = (s: typeof a) =>
        enemies.length
          ? Math.min(...enemies.map((e) => (e.x - s.x) ** 2 + (e.z - s.z) ** 2))
          : Infinity;
      return safe(b) - safe(a);
    });
    const candidates = ranked.slice(0, Math.min(2, ranked.length)),
      spawn =
        candidates[Math.floor(Math.random() * candidates.length)] ?? list[0],
      stats = this.stats(p);
    p.x = spawn.x;
    p.y = spawn.y ?? 0;
    p.z = spawn.z;
    p.yaw = spawn.yaw;
    p.pitch = 0;
    p.health = RULES.health;
    p.ammo = stats.magazine;
    p.reserve = stats.reserve;
    p.reloading = false;
    p.crouch = false;
    p.ads = false;
    p.sprint = false;
    p.vx = p.vy = p.vz = 0;
    p.grounded = true;
    p.stepPhase = 0;
    rt.body = { ...makeBody(p.x, p.z), y: p.y };
    rt.input = { ...emptyInput(), yaw: p.yaw };
    rt.reloadEnd = 0;
    rt.recoil = 0;
    rt.raiseEnd = 0;
    rt.queuedFire = false;
    rt.pendingFire = undefined;
    rt.respawnAt = 0;
    rt.respawnReady = false;
    rt.inventory.set(p.weapon, { ammo: p.ammo, reserve: p.reserve });
    p.spawnProtected = true;
    rt.protectionEnd = this.simTime + 1;
  }
  private endRound(winner: Team | "draw", reason: string) {
    const s = this.state;
    if (s.phase !== "live") return;
    if (winner === "A") s.scoreA++;
    else if (winner === "B") s.scoreB++;
    s.winner = winner;
    s.reason = reason;
    if (Math.max(s.scoreA, s.scoreB) >= winsRequired(s.roundLimit)) {
      s.phase = "finished";
      s.remaining = 0;
    } else {
      s.phase = "post";
      this.deadline = this.simTime + RULES.postSeconds;
      s.remaining = RULES.postSeconds;
    }
  }
  protected onDisconnected(p: PlayerState) {
    // Dropped players die for this round; reconnection restores their seat, never grants a live-round respawn.
    p.health = 0;
    const rt = this.runtime.get(p.id);
    if (rt) rt.input = emptyInput();
  }
  protected onPlayerJoined(p:PlayerState){
    if(this.state.phase==="waiting")return;
    const stats=this.stats(p);
    p.health=0;
    this.runtime.set(p.id,{body:makeBody(),input:emptyInput(),received:this.simTime,lastShot:-Infinity,reloadEnd:0,lastStep:0,recoil:0,raiseEnd:0,sprintSuppressed:false,queuedFire:false,respawnAt:this.simTime,respawnReady:this.state.gameMode!=="elimination",protectionEnd:0,inventory:new Map([[p.weapon,{ammo:stats.magazine,reserve:stats.reserve}]])});
  }
  protected onReconnected(p: PlayerState) {
    if (this.state.phase === "prep") p.health = RULES.health;
    if (this.state.reason === "Waiting for a player to reconnect…")
      this.state.reason = "";
  }
  protected onDepartureFinal(_p: PlayerState) {
    if (!["prep", "live", "post"].includes(this.state.phase)) return;
    const teams = this.connectedTeams();
    if (teams.A && teams.B) return;
    this.state.phase = "abandoned";
    this.state.remaining = 0;
    this.state.winner = "";
    this.state.reason = "A team has left the match.";
  }
  private connectedTeams() {
    const count = { A: 0, B: 0 };
    for (const p of this.state.players.values())
      if (p.connected) count[p.team]++;
    return count;
  }
  private sendDeathRecap(victim: PlayerState) {
    const enemies = [...this.state.players.values()].filter(
      (p) => p.team !== victim.team,
    );
    const exchanges = enemies
      .map((opponent) => {
        const dealt = this.roundDamage.get(`${victim.id}|${opponent.id}`) ?? {
            damage: 0,
            hits: 0,
          },
          taken = this.roundDamage.get(`${opponent.id}|${victim.id}`) ?? {
            damage: 0,
            hits: 0,
          };
        return {
          opponentId: opponent.id,
          username: opponent.username,
          dealt: Math.round(dealt.damage),
          dealtHits: dealt.hits,
          taken: Math.round(taken.damage),
          takenHits: taken.hits,
        };
      })
      .filter((x) => x.dealtHits || x.takenHits);
    this.clients
      .find((c) => c.sessionId === victim.id)
      ?.send("death-recap", { round: this.state.round, exchanges });
    // A recap describes one life. Respawn modes do not start new rounds, so
    // clear every exchange involving the victim after sending it.
    for(const key of [...this.roundDamage.keys()])
      if(key.startsWith(`${victim.id}|`)||key.endsWith(`|${victim.id}`))this.roundDamage.delete(key);
  }
}
