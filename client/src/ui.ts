import type { Network } from "./network";
import { defaults, ensureWeaponSelections, saveSettings, type Action, type Settings } from "./settings";
import { NEWS } from "./news";
import {
  ROUND_LIMITS,
  canStartMatch,
  winsRequired,
} from "../../shared/rules.js";
import type { DeathRecap, GameView } from "../../shared/protocol.js";
type Page = "news" | "play" | "loadout" | "settings";
const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const keyName = (key: string) =>
  ({
    Mouse0: "Left mouse",
    Mouse1: "Middle mouse",
    Mouse2: "Right mouse",
    ControlLeft: "Left Ctrl",
    ShiftLeft: "Left Shift",
    Space: "Space",
  })[key] ?? key.replace(/^Key|^Digit/, "");
const actionLabels: Record<Action, string> = {
  forward: "Move forward",
  back: "Move backward",
  left: "Move left",
  right: "Move right",
  jump: "Jump",
  crouch: "Crouch · hold",
  reload: "Reload",
  fire: "Fire",
  ads: "Aim · hold",
  sprint: "Sprint · hold",
};
export class UI {
  private root = document.querySelector<HTMLDivElement>("#ui")!;
  private hud = document.querySelector<HTMLDivElement>("#hud")!;
  private notice = document.querySelector<HTMLDivElement>("#notice")!;
  private page: Page = "play";
  private authenticated = false;
  private lobbySignature = "";
  private busy = false;
  private binding?: Action;
  private pauseSettings = false;
  private noticeTimer = 0;
  private recap?: DeathRecap;
  private damageAngle = 0;
  private damageUntil = 0;
  constructor(
    private net: Network,
    private settings: Settings,
    private onSettings: (s: Settings) => void,
    private onEnter: () => void,
  ) {
    this.root.addEventListener("click", (e) => void this.click(e));
    this.root.addEventListener("submit", (e) => void this.submit(e));
    this.root.addEventListener("input", (e) => this.input(e));
    this.root.addEventListener("change", (e) => {
      const select = e.target as HTMLSelectElement;
      if ("mapSelection" in select.dataset)
        this.net.send("map-selection", select.value);
    });
    net.addEventListener("lobbies", () => {
      if (this.authenticated && !net.match && this.page === "play")
        this.renderBrowser();
    });
    net.addEventListener("error", (e) =>
      this.message((e as CustomEvent).detail),
    );
    net.addEventListener("identity", () => {
      if(ensureWeaponSelections(this.settings,this.net.weapons))this.persist();
      this.authenticated = true;
      this.render();
    });
    net.addEventListener("state", () => this.renderState());
    net.addEventListener("left", () => {
      this.authenticated = !!net.identity;
      this.pauseSettings = false;
      this.lobbySignature = "";
      this.page = "play";
      this.render();
    });
    net.addEventListener("disconnected", () => {
      this.authenticated = false;
      this.render();
      this.message("Connection lost. Re-enter your username to connect.");
    });
    window.addEventListener("game-lock", () => {
      this.pauseSettings = false;
      this.render();
    });
    net.addEventListener("death-recap", (e) => {
      this.recap = (e as CustomEvent<DeathRecap>).detail;
      this.renderState();
    });
    window.addEventListener("game-hit", (e) => {
      const d = (e as CustomEvent<{ headshot: boolean; killed: boolean }>)
        .detail;
      this.hud.classList.remove("hit", "headshot", "kill");
      void this.hud.offsetWidth;
      this.hud.classList.add(
        d.killed ? "kill" : d.headshot ? "headshot" : "hit",
      );
      window.setTimeout(
        () => this.hud.classList.remove("hit", "headshot", "kill"),
        320,
      );
    });
    window.addEventListener("game-damage", (e) => {
      this.damageAngle = (e as CustomEvent<number>).detail;
      this.damageUntil = performance.now() + 650;
      this.renderState();
    });
    window.addEventListener(
      "keydown",
      (e) => {
        if (!this.binding) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.code === "Escape") {
          this.binding = undefined;
          this.render();
          return;
        }
        this.bind(e.code);
      },
      true,
    );
    window.addEventListener(
      "mousedown",
      (e) => {
        if (!this.binding) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.bind(`Mouse${e.button}`);
      },
      true,
    );
    this.render();
  }
  message(value: unknown) {
    this.notice.textContent = String(value);
    this.notice.classList.add("visible");
    clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(
      () => this.notice.classList.remove("visible"),
      5000,
    );
  }
  private async task(fn: () => Promise<unknown>) {
    if (this.busy) return;
    this.busy = true;
    this.root.setAttribute("aria-busy", "true");
    try {
      await fn();
    } catch (e) {
      this.message((e as Error).message);
    } finally {
      this.busy = false;
      this.root.removeAttribute("aria-busy");
    }
  }
  private async submit(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    if (form.id === "username-form")
      await this.task(async () => {
        await this.net.connect(String(data.get("username")));
        this.authenticated = true;
        this.render();
      });
    if (form.id === "create-form")
      await this.task(() =>
        this.net.create(String(data.get("name")), String(data.get("password"))),
      );
    if (form.id === "password-form")
      await this.task(async () => {
        await this.net.join(
          String(data.get("roomId")),
          String(data.get("password")),
        );
        this.root.querySelector("dialog")?.close();
      });
  }
  private async click(event: MouseEvent) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-action]",
    );
    if (!button || button.disabled) return;
    const action = button.dataset.action,
      value = button.dataset.value ?? "";
    if (action === "nav") {
      this.page = value as Page;
      this.render();
    }
    if (action === "join") {
      const lobby = this.net.lobbies.find((l) => l.roomId === value);
      if (!lobby) return;
      if (lobby.locked) this.passwordDialog(value, lobby.name);
      else await this.task(() => this.net.join(value));
    }
    if (action === "close-dialog") this.root.querySelector("dialog")?.close();
    if (action === "team") this.net.send("team", value);
    if (action === "start") this.net.send("start");
    if (action === "round-limit") this.net.send("round-limit", Number(value));
    if (action === "back-lobby") this.net.send("back-lobby");
    if (action === "leave") await this.task(() => this.net.leaveMatch());
    if (action === "signout") await this.task(() => this.net.leave());
    if (action === "enter") this.onEnter();
    if (action === "pause-settings") {
      this.pauseSettings = true;
      this.page = "settings";
      this.render();
    }
    if (action === "back-match") {
      this.pauseSettings = false;
      this.render();
    }
    if (action === "bind") {
      setTimeout(() => {
        this.binding = value as Action;
        button.textContent = "Press a key or mouse button…";
      }, 0);
    }
    if (action === "defaults") {
      Object.assign(this.settings, structuredClone(defaults));
      this.persist();
      this.render();
    }
    if (action === "equip-weapon") {
      const weapon = this.net.weapons.find((item) => item.path === value);
      if (!weapon) return;
      this.settings[weapon.slot] = weapon.id;
      this.persist();
      if (this.net.match) this.net.send("weapon", weapon.path);
      this.render();
    }
  }
  private bind(code: string) {
    if (!this.binding) return;
    if (/^(Control|Meta)/.test(code)) {
      this.binding = undefined;
      this.message(
        "Ctrl and Command are reserved by the browser. Use C or another key.",
      );
      this.render();
      return;
    }
    const old = this.settings.keys[this.binding];
    for (const action of Object.keys(this.settings.keys) as Action[])
      if (this.settings.keys[action] === code) this.settings.keys[action] = old;
    this.settings.keys[this.binding] = code;
    this.binding = undefined;
    this.persist();
    this.render();
  }
  private persist() {
    try {
      saveSettings(this.settings);
    } catch {
      this.message("Settings could not be saved on this browser.");
    }
    this.onSettings(this.settings);
  }
  private input(event: Event) {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    if (!input.dataset.setting) return;
    const setting = input.dataset.setting;
    if (setting === "crosshairMode")
      this.settings.crosshairMode =
        input.value === "static" ? "static" : "dynamic";
    else
      this.settings[
        setting as
          "sensitivity" | "fov" | "master" | "music" | "sfx" | "crosshairGap"
      ] = Number(input.value);
    const output = input.parentElement?.querySelector("output");
    if (output) output.textContent = this.format(setting, Number(input.value));
    this.persist();
  }
  private format(key: string, value: number) {
    return key === "fov"
      ? `${value}°`
      : key === "sensitivity"
        ? `${value.toFixed(2)}×`
        : `${Math.round(value * 100)}%`;
  }
  private shell(content: string) {
    return `<div class="shell"><header class="command-header"><div class="wordmark"><b>C/</b></div><div class="identity"><span class="signal-dot"></span><strong>${esc(this.net.username)}</strong><button class="signout" data-action="signout">SIGN OUT ↗</button></div></header><aside><nav aria-label="Main navigation">${(["play", "news", "loadout", "settings"] as Page[]).map((page, i) => `<button data-action="nav" data-value="${page}" class="nav-button ${this.page === page ? "selected" : ""}" ${this.page === page ? 'aria-current="page"' : ""}><span>0${i + 1}</span>${page}<i>↗</i></button>`).join("")}</nav></aside><main>${content}</main><footer class="command-footer"><span>COLLATERAL</span></footer></div>`;
  }
  render() {
    document.body.classList.toggle("is-menu", !this.net.state);
    const state = this.net.state;
    const playing = !!state && state.phase !== "waiting";
    document.body.classList.toggle("is-playing", playing);
    this.hud.hidden = !playing;
    if (!this.authenticated) {
      this.root.innerHTML = `<div class="entry"><section class="entry-panel"><p class="eyebrow">TACTICAL FPS</p><h1>COLLATERAL</h1><p class="entry-copy">Choose a callsign to continue.</p><form id="username-form"><label for="username">Callsign</label><div class="input-action"><input id="username" name="username" placeholder="Your callsign" autocomplete="nickname" minlength="3" maxlength="20" required><button class="primary" type="submit">CONNECT <span>↗</span></button></div><p class="muted">3–20 characters. No account required.</p></form></section></div>`;
      return;
    }
    if (state?.phase === "waiting") {
      this.renderLobby(state);
      return;
    }
    if (playing) {
      if (state.phase === "finished" || state.phase === "abandoned") {
        const host = state.hostId === this.net.match?.sessionId;
        const winners = Object.values(state.players)
          .filter((p) => p.team === state.winner)
          .map((p) => esc(p.username))
          .join(" · ");
        this.root.innerHTML = `<div class="match-overlay"><section class="result panel"><p class="eyebrow">${state.phase === "abandoned" ? "MATCH STOPPED" : "MATCH COMPLETE"}</p><h1>${state.phase === "abandoned" ? "PLAYERS HAVE LEFT" : `TEAM ${esc(state.winner)} WINS`}</h1><div class="result-score">${state.scoreA}<span>:</span>${state.scoreB}</div>${winners ? `<h2>${winners}</h2>` : ""}<p>${esc(state.reason || `First to ${winsRequired(state.roundLimit)}.`)}</p>${host ? '<button class="primary" data-action="back-lobby">BACK TO LOBBY</button>' : ""}<button data-action="leave">QUIT</button>${!host ? '<p class="muted">Waiting for the host to return everyone to the lobby.</p>' : ""}</section></div>`;
        if (document.pointerLockElement) document.exitPointerLock();
        return;
      }
      if (this.pauseSettings) {
        this.root.innerHTML = `<div class="match-settings"><button class="text-button" data-action="back-match">← Back to match</button>${this.settingsContent()}</div>`;
        return;
      }
      this.root.innerHTML = document.pointerLockElement
        ? ""
        : `<div class="match-overlay"><section class="pause panel"><p class="eyebrow">${esc(state.mapId)} / ROUND ${state.round}</p><h2>Ready when you are.</h2><p>Click to capture your mouse. Escape releases it.</p><button class="primary" data-action="enter">ENTER GAME</button><div class="pause-options"><button data-action="pause-settings">Settings</button><button data-action="leave">Leave match</button></div><p class="muted">The round continues while this panel is open.</p></section></div>`;
      return;
    }
    let content = "";
    if (this.page === "news")
      content = `<header class="page-heading"><p class="eyebrow">TRANSMISSIONS</p><h1>Latest intel.</h1><p>Select a transmission to read the full briefing.</p></header><div class="news-grid">${NEWS.map((n, i) => `<details class="news-card" ${i === 0 ? "open" : ""}><summary><span><small class="eyebrow">${n.tag}</small><strong>${n.title}</strong></span><i aria-hidden="true">+</i></summary><div class="news-body"><p>${n.text}</p></div></details>`).join("")}</div>`;
    if (this.page === "play")
      content = `<header class="page-heading"><p class="eyebrow">MULTIPLAYER</p><h1>Squad up.</h1><p>Choose your team. Make every round count.</p></header><div class="play-grid"><section class="panel browser"><div class="section-title"><h2>Server browser</h2><span class="eyebrow">LIVE</span></div><div id="lobby-list"></div></section><section class="panel create"><p class="eyebrow">HOST A MATCH</p><h2>Create lobby</h2><form id="create-form"><label for="lobby-name">Lobby name</label><input id="lobby-name" name="name" maxlength="40" placeholder="Friday night squad" required><label for="lobby-password">Password <span class="muted">optional</span></label><input id="lobby-password" name="password" type="password" maxlength="64" autocomplete="new-password" placeholder="Open lobby"><button class="primary">CREATE LOBBY</button></form><p class="muted">Start with 1v1 or 2v2. Balanced teams required.</p></section></div>`;
    if (this.page === "loadout") {
      const cards = (slot: "primary" | "secondary") =>
        this.net.weapons
          .filter((w) => w.slot === slot)
          .map(
            (w) =>
              `<button class="weapon panel ${this.settings[slot] === w.id ? "equipped" : ""}" data-action="equip-weapon" data-value="${esc(w.path)}"><p class="eyebrow">${slot.toUpperCase()} ${this.settings[slot] === w.id ? "/ EQUIPPED" : ""}</p><h2>${esc(w.name)}</h2><span>${this.settings[slot] === w.id ? "EQUIPPED" : "EQUIP"}</span></button>`,
          )
          .join("");
      content = `<header class="page-heading"><p class="eyebrow">STANDARD ISSUE</p><h1>Loadout.</h1><p>Load up and get ready for battle.</p></header><div class="loadout-groups"><section><h2>PRIMARY</h2><div class="loadout-grid">${cards("primary") || '<div class="panel locked-slot primary-slot"><p class="eyebrow">PRIMARY</p><h2>UNEQUIPPED</h2><p>Install a primary weapon package to unlock this slot.</p></div>'}</div></section><section><h2>SECONDARY</h2><div class="loadout-grid">${cards("secondary") || '<div class="panel locked-slot"><p class="eyebrow">SECONDARY</p><h2>UNEQUIPPED</h2><p>Install a secondary weapon package to unlock this slot.</p></div>'}</div></section></div>`;
    }
    if (this.page === "settings") content = this.settingsContent();
    this.root.innerHTML = this.shell(content);
    if (this.page === "play") this.renderBrowser();
  }
  private renderBrowser() {
    const root = this.root.querySelector("#lobby-list");
    if (!root) return;
    root.innerHTML = this.net.lobbies.length
      ? `<div class="lobby-head"><span>LOBBY / HOST</span><span>PLAYERS</span><span></span></div>${this.net.lobbies.map((l) => `<div class="lobby-row"><div><strong>${l.locked ? "&#128274; " : ""}${esc(l.name)}</strong><small>Hosted by ${esc(l.host)}</small></div><span>${l.players}<span class="muted"> / 4</span></span><button data-action="join" data-value="${esc(l.roomId)}" ${l.players >= 4 ? "disabled" : ""}>JOIN</button></div>`).join("")}`
      : `<div class="empty-state"><span class="empty-number">0 / 4</span><h3>No waiting lobbies.</h3><p>Create a lobby and invite three players to connect.</p></div>`;
  }
  private renderLobby(state: GameView) {
    const players = Object.values(state.players),
      me = this.net.match?.sessionId,
      host = state.hostId === me;
    const ready = canStartMatch(players);
    const first = winsRequired(state.roundLimit);
    this.root.innerHTML = `<div class="lobby-screen"><header><button class="text-button" data-action="leave">← Back to menu</button><span class="eyebrow">WAITING FOR DEPLOYMENT</span></header><div class="lobby-title"><div><p class="eyebrow">LOBBY</p><h1>${esc(state.lobbyName)}</h1></div><span>${players.length} / 4</span></div><div class="teams">${(
      ["A", "B"] as const
    )
      .map((team) => {
        const members = players.filter((p) => p.team === team);
        return `<section class="team team-${team}"><div class="section-title"><h2>TEAM ${team}</h2><span class="eyebrow">${members.length} / 2</span></div>${[0, 1].map((i) => (members[i] ? `<div class="player-slot"><span class="player-number">0${i + 1}</span><div><strong>${esc(members[i].username)}${members[i].id === me ? " <small>YOU</small>" : ""}</strong><small>${members[i].connected ? (members[i].id === state.hostId ? "Lobby host" : "Connected") : "Reconnecting…"}</small></div></div>` : `<button class="player-slot empty" data-action="team" data-value="${team}"><span>+</span> Join team ${team}</button>`)).join("")}</section>`;
      })
      .join(
        "",
      )}</div><div class="round-choice"><label><strong>MAP</strong><select data-map-selection ${!host ? "disabled" : ""}><option value="random" ${state.mapChoice === "random" ? "selected" : ""}>Random</option>${this.net.maps.map((map) => `<option value="${esc(map.id)}" ${state.mapChoice === map.id ? "selected" : ""}>${esc(map.name)}</option>`).join("")}</select></label><strong>MATCH LENGTH</strong>${ROUND_LIMITS.map((n) => `<button data-action="round-limit" data-value="${n}" class="${state.roundLimit === n ? "selected" : ""}" ${!host ? "disabled" : ""}>BEST OF ${n}</button>`).join("")}</div><div class="lobby-bottom"><div><strong>${state.mapChoice === "random" ? "RANDOM MAP" : esc(this.net.maps.find((m) => m.id === state.mapChoice)?.name ?? state.mapChoice)} · FIRST TO ${first}</strong><p>100-second rounds · Glock only · Best of ${state.roundLimit}</p></div><button class="primary" data-action="start" ${!host || !ready ? "disabled" : ""}>${host ? (ready ? "START MATCH" : "BALANCE TEAMS TO START") : "WAITING FOR HOST"}</button></div><p class="muted">Your callsign stays active in the menu. Sign out to release it.</p></div>`;
  }
  private settingsContent() {
    return `<header class="page-heading"><p class="eyebrow">MAKE IT YOURS</p><h1>Settings.</h1><p>Adjust the settings for your play style. Ctrl and Command are reserved by the browser.</p></header><div class="settings-grid"><section class="panel"><h2>Aim & audio</h2>${(
      [
        {
          key: "sensitivity",
          label: "Mouse sensitivity",
          min: 0.1,
          max: 3,
          step: 0.05,
        },
        { key: "fov", label: "Field of view", min: 80, max: 110, step: 1 },
        { key: "master", label: "Master volume", min: 0, max: 1, step: 0.05 },
        { key: "music", label: "Menu music", min: 0, max: 1, step: 0.05 },
        { key: "sfx", label: "Effects volume", min: 0, max: 1, step: 0.05 },
      ] as const
    )
      .map(
        (s) =>
          `<label class="slider-label">${s.label}<output>${this.format(s.key, this.settings[s.key])}</output><input aria-label="${s.label}" data-setting="${s.key}" type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${this.settings[s.key]}"></label>`,
      )
      .join(
        "",
      )}<h3>Crosshair</h3><label>Behavior<select data-setting="crosshairMode"><option value="dynamic" ${this.settings.crosshairMode === "dynamic" ? "selected" : ""}>Dynamic</option><option value="static" ${this.settings.crosshairMode === "static" ? "selected" : ""}>Static</option></select></label><label class="slider-label">Gap<output>${this.settings.crosshairGap}px</output><input data-setting="crosshairGap" type="range" min="2" max="18" step="1" value="${this.settings.crosshairGap}"></label><button class="text-button" data-action="defaults">Reset all settings</button></section><section class="panel"><h2>Key bindings</h2>${(Object.keys(defaults.keys) as Action[]).map((action) => `<div class="key-row"><label>${actionLabels[action]}</label><button data-action="bind" data-value="${action}" aria-label="Rebind ${actionLabels[action]}">${esc(keyName(this.settings.keys[action]))}</button></div>`).join("")}</section></div>`;
  }
  private passwordDialog(roomId: string, name: string) {
    this.root.querySelector("dialog")?.remove();
    const dialog = document.createElement("dialog");
    dialog.innerHTML = `<form id="password-form"><p class="eyebrow">LOCKED LOBBY</p><h2>${esc(name)}</h2><input type="hidden" name="roomId" value="${esc(roomId)}"><label for="join-password">Password</label><input autofocus id="join-password" type="password" name="password" maxlength="64" required autocomplete="current-password"><div class="dialog-actions"><button type="button" data-action="close-dialog">Cancel</button><button class="primary">JOIN LOBBY</button></div></form>`;
    this.root.append(dialog);
    dialog.showModal();
  }
  private renderState() {
    const s = this.net.state!;
    const signature = JSON.stringify({
      phase: s.phase,
      players: s.phase === "waiting" ? s.players : null,
      host: s.hostId,
      roundLimit: s.roundLimit,
      mapChoice: s.mapChoice,
      winner: s.winner,
      reason: s.reason,
    });
    if (signature !== this.lobbySignature) {
      this.lobbySignature = signature;
      this.render();
    }
    if (s.phase === "waiting") {
      this.hud.hidden = true;
      return;
    }
    const me = s.players[this.net.match?.sessionId ?? ""];
    if (!me) return;
    const target =
      me.health > 0
        ? me
        : Object.values(s.players).find(
            (p) => p.team === me.team && p.health > 0 && p.connected,
          );
    const time = Math.ceil(s.remaining),
      minutes = Math.floor(time / 60),
      seconds = String(time % 60).padStart(2, "0");
    const alive = (team: string) =>
      Object.values(s.players).filter(
        (p) => p.team === team && p.health > 0 && p.connected,
      ).length;
    const recap =
      me.health <= 0 && this.recap?.round === s.round
        ? `<div class="death-recap"><strong>COMBAT REPORT</strong>${this.recap.exchanges.map((x) => `<p>${esc(x.username)} did ${x.taken} damage to you with ${x.takenHits} ${x.takenHits === 1 ? "hit" : "hits"}.<br>You did ${x.dealt} damage with ${x.dealtHits} ${x.dealtHits === 1 ? "hit" : "hits"}.</p>`).join("")}</div>`
        : "";
    const damage =
      performance.now() < this.damageUntil
        ? `<div class="damage-direction" style="--damage-angle:${this.damageAngle}deg"><i></i></div>`
        : "";
    const equipped = this.net.weapons.find(
      (weapon) => weapon.path === me.weapon,
    );
    const weaponName = equipped?.name ?? me.weapon.split("/").pop() ?? "Weapon";
    const weaponSlot = equipped?.slot === "primary" ? "1" : "2";
    this.hud.innerHTML = `<div class="scoreboard"><div class="score team-a">A <strong>${s.scoreA}</strong><small>${alive("A")} alive</small></div><div class="clock"><span>ROUND ${s.round}</span><strong>${minutes}:${seconds}</strong><small>${s.phase === "prep" ? "PREPARE" : s.phase === "post" ? "ROUND OVER" : `ELIMINATION`}</small></div><div class="score team-b"><strong>${s.scoreB}</strong> B<small>${alive("B")} alive</small></div></div>${s.reason === "Waiting for a player to reconnect…" ? `<div class="round-banner"><span>MATCH PAUSED</span><strong>PLAYER DISCONNECTED</strong><p>${esc(s.reason)}</p></div>` : s.phase === "prep" ? `<div class="round-banner"><span>GET READY</span><strong>Round ${s.round}</strong><p>Look around while movement and weapons are frozen.</p></div>` : s.phase === "post" ? `<div class="round-banner"><span>ROUND COMPLETE</span><strong>${s.winner === "draw" ? "DRAW — NO POINTS" : `Team ${s.winner} wins`}</strong><p>${esc(s.reason)}</p></div>` : ""}${me.health > 0 ? '<div class="crosshair" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></div>' : `<div class="spectator">${target ? `SPECTATING ${esc(target.username)}` : "ELIMINATED · WAITING FOR NEXT ROUND"}</div>${recap}`}${damage}<div class="vitals"><div><small>HEALTH</small><strong>${me.health}</strong></div><p>TEAM ${me.team}</p><div class="ammo"><small>${me.reloading ? "RELOADING…" : esc(equipped?.name ?? me.weapon.split("/").at(-1) ?? "WEAPON")}</small><strong>${me.ammo}<span> / ${me.reserve}</span></strong></div></div><div class="escape-hint">ESC · Release mouse</div>`;
    this.hud.innerHTML = this.hud.innerHTML.replace("GLOCK", esc(weaponName));
    this.hud.insertAdjacentHTML(
      "beforeend",
      `<div class="weapon-switch-label"><small>${weaponSlot}</small>${esc(weaponName)}</div>`,
    );
  }
}
