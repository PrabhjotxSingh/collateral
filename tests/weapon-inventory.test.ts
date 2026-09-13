import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { switchWeaponAmmo } from "../server/src/CombatRoom.js";

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
});
