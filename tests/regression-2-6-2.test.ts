import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { AnimationGroup } from "@babylonjs/core";
import { ClipPlayer } from "../client/src/animation.js";

test("standing blends out of the crouch clip instead of hard-resetting", () => {
  const stopped: string[] = [];
  const group = (name: string) =>
    ({
      name,
      from: 0,
      to: 60,
      targetedAnimations: [
        { animation: { framePerSecond: 60, enableBlending: false } },
      ],
      start() {},
      stop() { stopped.push(name); },
      pause() {},
      goToFrame() {},
      setWeightForAllAnimatables() {},
    }) as unknown as AnimationGroup;
  const player = new ClipPlayer([group("idle"), group("crouch")]);
  player.play("crouch");
  player.tick(1);
  stopped.length = 0;
  player.play("idle");
  assert.deepEqual(stopped, []);
  player.tick(1);
  assert.deepEqual(stopped, ["crouch"]);
});

test("v2.6.2 UI, sandbox, and framer regressions stay wired", async () => {
  const [ui, css, network, framer] = await Promise.all([
    readFile("client/src/ui.ts", "utf8"),
    readFile("client/src/style.css", "utf8"),
    readFile("client/src/network.ts", "utf8"),
    readFile("engine/src/WeaponFramer.tsx", "utf8"),
  ]);
  assert.match(ui, /button\.closest\("dialog"\)/);
  assert.doesNotMatch(ui, /radar-sweep/);
  assert.match(ui, /private renderKillFeed\(\)/);
  assert.match(ui, /dataset\.killKey/);
  assert.doesNotMatch(ui, /const killFeed = `<div class="kill-feed"/);
  assert.match(css, /\.hill-hud\{position:absolute;z-index:4;top:128px/);
  assert.match(css, /\.round-buttons\{[^}]*padding-top:8px/);
  assert.match(network, /await this\.connect\("DEVMODE"\)/);
  assert.match(framer, /PLAY ATTACHED AUDIO/);
  assert.match(framer, /holding:\s*\{\s*\.\.\.holdingRef\.current/);
});
