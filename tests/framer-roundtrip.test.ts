import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("editor-authored viewmodels use exact camera-relative transforms", () => {
  const framer = readFileSync(new URL("../engine/src/WeaponFramer.tsx", import.meta.url), "utf8");
  const assets = readFileSync(new URL("../client/src/assets.ts", import.meta.url), "utf8");
  const game = readFileSync(new URL("../client/src/game.ts", import.meta.url), "utf8");
  assert.match(framer, /editorFramed: true/);
  assert.match(framer, /JSZip\.loadAsync/);
  assert.match(framer, /Replace the saved HIP pose/);
  assert.match(framer, /Replace the saved ADS pose/);
  assert.match(framer, /COLLATERAL BUILT-IN/);
  assert.match(assets, /!options\.exactWeaponTransform/);
  assert.match(game, /motion\.z - 0\.4 \+ pose\.z/);
});
