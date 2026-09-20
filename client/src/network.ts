import { Client, type Room } from "colyseus.js";
import type {
  GameView,
  Input,
  Lobby,
  ShotEvent,
  DeathRecap,
  MapSummary,
  KillFeedEvent,
} from "../../shared/protocol.js";
import { MAPS, installMaps, type GameMap } from "../../shared/maps.js";
import type { WeaponManifest, WeaponSummary } from "../../shared/weapons.js";
const endpoint =
  import.meta.env.VITE_SERVER_URL ??
  `${location.origin}${import.meta.env.DEV ? "/socket" : ""}`;
export class Network extends EventTarget {
  constructor() {
    super();
    window.addEventListener("pagehide", () => {
      void this.leave();
    });
  }
  private client = new Client(endpoint);
  identity?: Room;
  match?: Room;
  username = "";
  token = "";
  lobbies: Lobby[] = [];
  maps: MapSummary[] = [];
  weapons: WeaponSummary[] = [];
  state?: GameView;
  private intentional = new Set<Room>();
  private weaponCache = new Map<string, WeaponManifest>();
  ping = 0;
  private pingTimer = 0;
  async refreshMaps() {
    const response = await fetch("/api/maps", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load installed maps.");
    this.maps = (await response.json()) as MapSummary[];
    return this.maps;
  }
  private emit(name: string, value?: unknown) {
    this.dispatchEvent(new CustomEvent(name, { detail: value }));
  }
  async connect(username: string) {
    if (!this.maps.length) await this.refreshMaps();
    if (!this.weapons.length) {
      const response = await fetch("/api/weapons");
      if (!response.ok) throw new Error("Could not load installed weapons.");
      this.weapons = (await response.json()) as WeaponSummary[];
    }
    const saved = this.readSaved("collateral.identity");
    let room: Room;
    if (
      saved?.reconnectionToken &&
      saved.username.toLowerCase() === username.toLowerCase()
    ) {
      try {
        room = await this.client.reconnect(saved.reconnectionToken);
      } catch {
        room = await this.client.create("session", {
          username,
          resumeToken: saved.token,
        });
      }
    } else room = await this.client.create("session", { username });
    await this.bindIdentity(room);
    const old = sessionStorage.getItem("collateral.match");
    if (old)
      try {
        this.bindMatch(await this.client.reconnect(old));
      } catch {
        sessionStorage.removeItem("collateral.match");
      }
  }
  private readSaved(key: string) {
    try {
      return JSON.parse(sessionStorage.getItem(key) ?? "null");
    } catch {
      return null;
    }
  }
  private bindIdentity(room: Room) {
    this.identity = room;
    return new Promise<void>((resolve) => {
      room.onMessage("identity", (auth) => {
        this.username = auth.username;
        this.token = auth.token;
        sessionStorage.setItem(
          "collateral.identity",
          JSON.stringify({
            ...auth,
            reconnectionToken: room.reconnectionToken,
          }),
        );
        resolve();
        this.emit("identity");
      });
      room.onMessage("lobbies", (lobbies) => {
        this.lobbies = lobbies;
        this.emit("lobbies");
      });
      room.onError((_code, message) => this.emit("error", message));
      room.onLeave((code) => {
        if (!this.intentional.has(room) && code !== 1000)
          this.recoverIdentity(room);
      });
    });
  }
  private async recoverIdentity(_room: Room) {
    // Names are released immediately when this connection ends. Never silently
    // reconnect an old identity after another player may have claimed its name.
    await this.leave();
    this.emit("disconnected");
  }
  async create(name: string, password: string) {
    this.bindMatch(
      await this.client.create("tactical", {
        name,
        password,
        token: this.token,
      }),
    );
  }
  async startDevSolo(mapId: string) {
    if (!this.identity) await this.connect("DEVMODE");
    if (!this.maps.some((map) => map.id === mapId))
      throw new Error("Choose an installed map.");
    if (this.match) await this.leaveMatch();
    this.bindMatch(
      await this.client.create("tactical", {
        name: "Local Dev Sandbox",
        token: this.token,
        devSolo: true,
        mapId,
      }),
    );
  }
  async join(roomId: string, password = "", team?: "A"|"B") {
    this.bindMatch(
      await this.client.joinById(roomId, { password, token: this.token, team }),
    );
  }
  private bindMatch(room: Room) {
    window.clearInterval(this.pingTimer);
    this.match = room;
    sessionStorage.setItem("collateral.match", room.reconnectionToken);
    room.onStateChange((state) => {
      if(this.match!==room)return;
      this.state = state.toJSON() as GameView;
      this.emit("state", this.state);
    });
    room.onMessage("error", (message) => this.emit("error", message));
    room.onMessage("shot", (shot: ShotEvent) => this.emit("shot", shot));
    room.onMessage("kill-feed", (event: KillFeedEvent) =>
      this.emit("kill-feed", event),
    );
    room.onMessage("death-recap", (recap: DeathRecap) =>
      this.emit("death-recap", recap),
    );
    room.onMessage("fire-rejected", (event) =>
      this.emit("fire-rejected", event),
    );
    room.onMessage("step", (step) => this.emit("step", step));
    room.onMessage("reload", (event) => this.emit("reload", event));
    room.onMessage("reload-stop", (event) => this.emit("reload-stop", event));
    room.onMessage("pong", (sent: number) => {
      if (!Number.isFinite(sent)) return;
      this.ping = Math.max(0, Math.round(performance.now() - sent));
      room.send("latency", this.ping);
    });
    room.onError((_code, message) => this.emit("error", message));
    room.onLeave((code) => {
      if (!this.intentional.has(room) && code !== 1000) this.recoverMatch(room);
    });
    this.emit("match");
    const sample = () => room.send("ping", performance.now());
    sample();
    this.pingTimer = window.setInterval(sample, 2000);
  }
  private async recoverMatch(room: Room) {
    if (this.match !== room || !this.identity) return;
    this.emit("error", "Match connection interrupted. Reconnecting…");
    for (let attempt = 0; attempt < 12; attempt++) {
      if (this.match !== room || !this.identity) return;
      await new Promise((r) =>
        setTimeout(r, Math.min(500 + attempt * 150, 2000)),
      );
      try {
        const restored = await this.client.reconnect(room.reconnectionToken);
        if (this.match !== room || !this.identity) {
          await restored.leave();
          return;
        }
        this.bindMatch(restored);
        return;
      } catch {}
    }
    if (this.match !== room) return;
    await this.leave();
    this.emit("error", "Could not reconnect to the match.");
  }
  send(
    type:
      | "team"
      | "start"
      | "round-limit"
      | "game-mode"
      | "kill-limit"
      | "match-seconds"
      | "ticket-limit"
      | "play-again"
      | "map-selection"
      | "back-lobby"
      | "input"
      | "fire"
      | "reload"
      | "ready"
      | "weapon"
      | "ping"
      | "latency"
      | "respawn",
    value?: unknown,
  ) {
    this.match?.send(type, value);
  }
  async weapon(path: string) {
    if (this.weaponCache.has(path)) return this.weaponCache.get(path)!;
    const response = await fetch(`/api/weapons/${path}`);
    if (!response.ok)
      throw new Error("The selected weapon could not be loaded.");
    const weapon = (await response.json()) as WeaponManifest;
    this.weaponCache.set(path, weapon);
    return weapon;
  }
  async ensureMap(id: string, onProgress?: (fraction: number) => void) {
    if (MAPS.some((map) => map.id === id && map.asset.startsWith("/maps/")))
      return;
    const response = await fetch(`/api/maps/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error("The selected map could not be loaded.");
    const total = Number(response.headers.get("content-length")) || 0;
    let text: string;
    if (!response.body || !total) {
      onProgress?.(1);
      text = await response.text();
    } else {
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        onProgress?.(Math.min(1, received / total));
      }
      const bytes = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      text = new TextDecoder().decode(bytes);
    }
    const map = JSON.parse(text) as GameMap;
    installMaps([...MAPS.filter((m) => m.id !== map.id), map]);
  }
  async leaveMatch() {
    window.clearInterval(this.pingTimer);
    const room = this.match;
    if (room) this.intentional.add(room);
    this.match = undefined;
    this.state = undefined;
    sessionStorage.removeItem("collateral.match");
    this.emit("left");
    if(room)await Promise.race([room.leave(),new Promise<void>(resolve=>setTimeout(resolve,1200))]);
  }
  async leave() {
    const room = this.match,
      identity = this.identity;
    if (room) this.intentional.add(room);
    if (identity) this.intentional.add(identity);
    this.match = undefined;
    this.identity = undefined;
    this.state = undefined;
    this.token = "";
    this.username = "";
    sessionStorage.removeItem("collateral.match");
    sessionStorage.removeItem("collateral.identity");
    await Promise.allSettled([room?.leave(), identity?.leave()]);
    this.emit("left");
  }
}
