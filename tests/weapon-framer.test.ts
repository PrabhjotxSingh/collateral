import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadInstalledWeapons,
  WEAPONS,
  WEAPON_SUMMARIES,
} from "../server/src/weapon-registry.js";

test("weapon registry discovers primary/secondary packages and normalizes asset URLs", async () => {
  const root = await mkdtemp(join(tmpdir(), "collateral-weapons-")),
    folder = join(root, "primary", "rifle");
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, "weapon.json"),
    JSON.stringify({
      version: 1,
      id: "rifle",
      name: "Test Rifle",
      slot: "primary",
      assets: { view: "view.glb", world: "world.glb" },
      firstPerson: { arms: {}, weapon: {}, fingers: {} },
      thirdPerson: { character: {}, weapon: {} },
    }),
  );
  loadInstalledWeapons(root);
  assert.equal(WEAPON_SUMMARIES.length, 1);
  assert.equal(WEAPON_SUMMARIES[0].path, "primary/rifle");
  assert.equal(
    WEAPONS.get("primary/rifle")?.assets.view,
    "/weapons/primary/rifle/view.glb",
  );
  assert.equal(WEAPONS.get("primary/rifle")?.gameplay.rpm, 480);
  assert.equal(WEAPONS.get("primary/rifle")?.effects.tracer.smoke, true);
});

test("engine exposes map and weapon workspaces with finger-bone authoring", async () => {
  const [main, framer] = await Promise.all([
    readFile("engine/src/main.tsx", "utf8"),
    readFile("engine/src/WeaponFramer.tsx", "utf8"),
  ]);
  assert.match(main, /CHARACTER \/ WEAPON FRAMER/);
  assert.match(main, /MAP EDITOR/);
  assert.match(framer, /isFinger/);
  assert.match(framer, /rotationQuaternion/);
  assert.match(framer, /firstPerson/);
  assert.match(framer, /thirdPerson/);
  assert.match(framer, /Fire rate \(RPM\)/);
  assert.match(framer, /CAPTURE ADS/);
  assert.match(framer, /SELECT MUZZLE SOCKET/);
  assert.match(framer, /PLAY TEST/);
  assert.match(framer, /shotSound/);
});
