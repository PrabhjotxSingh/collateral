import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CombatRoom, switchWeaponAmmo } from "../server/src/CombatRoom.js";
import {GameState,PlayerState} from "../server/src/state.js";
import {WEAPONS,loadInstalledWeapons} from "../server/src/weapon-registry.js";
import {ensureWeaponSelections} from "../client/src/settings.js";

test("each weapon preserves its own magazine and reserve", () => {
  const inventory = new Map<string, { ammo: number; reserve: number }>();
  const rifle = switchWeaponAmmo(inventory, "secondary/glock", "primary/rifle", { ammo: 9, reserve: 34 }, { magazine: 30, reserve: 90 });
  assert.deepEqual(rifle, { ammo: 30, reserve: 90 });
  const pistol = switchWeaponAmmo(inventory, "primary/rifle", "secondary/glock", { ammo: 17, reserve: 61 }, { magazine: 17, reserve: 51 });
  assert.deepEqual(pistol, { ammo: 9, reserve: 34 });
  const rifleAgain = switchWeaponAmmo(inventory, "secondary/glock", "primary/rifle", pistol, { magazine: 30, reserve: 90 });
  assert.deepEqual(rifleAgain, { ammo: 17, reserve: 61 });
});

test("loadout renders every discovered weapon grouped by slot", () => {
  const ui = readFileSync(new URL("../client/src/ui.ts", import.meta.url), "utf8");
  assert.match(ui, /filter\(\(w\) => w\.slot === slot\)/);
  assert.match(ui, /cards\("primary"\)/);
  assert.match(ui, /cards\("secondary"\)/);
  assert.match(ui, /this\.settings\[weapon\.slot\] = weapon\.id/);
  const game=readFileSync(new URL("../client/src/game.ts",import.meta.url),"utf8");
  assert.match(game,/this\.network\.weapons\.some\(\(weapon\) => weapon\.path === path\)/);
});

test("unfinished reload is cancelled on switch and never awards ammo later",()=>{
  loadInstalledWeapons("client/public/weapons");
  const secondary=structuredClone(WEAPONS.get("secondary/glock")!);
  WEAPONS.set("primary/test-rifle",{...secondary,id:"test-rifle",name:"Test Rifle",slot:"primary",gameplay:{...secondary.gameplay,magazine:30,reserve:90}});
  const room=new CombatRoom(),state=new GameState();room.setState(state);
  const p=Object.assign(new PlayerState(),{id:"p",weapon:"secondary/glock",ammo:5,reserve:10,reloading:true});
  state.players.set("p",p);
  const runtime={body:{},input:{},received:0,lastShot:0,reloadEnd:1,lastStep:0,recoil:0,raiseEnd:0,sprintSuppressed:false,queuedFire:false,inventory:new Map()};
  (room as any).runtime.set("p",runtime);
  (room as any).setWeapon({sessionId:"p"},"primary/test-rifle");
  assert.equal(p.reloading,false);assert.equal(runtime.reloadEnd,0);
  (room as any).setWeapon({sessionId:"p"},"secondary/glock");
  assert.deepEqual({ammo:p.ammo,reserve:p.reserve},{ammo:5,reserve:10});
  WEAPONS.delete("primary/test-rifle");
});
test("the first installed primary is always selected when one is available",()=>{
  const settings:any={primary:"removed",secondary:"glock"};
  assert.equal(ensureWeaponSelections(settings,[{id:"rifle-a",slot:"primary"},{id:"glock",slot:"secondary"}]),true);
  assert.equal(settings.primary,"rifle-a");
  assert.equal(ensureWeaponSelections(settings,[{id:"rifle-a",slot:"primary"},{id:"glock",slot:"secondary"}]),false);
});
