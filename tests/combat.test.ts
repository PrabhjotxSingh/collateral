import { test } from "node:test";
import assert from "node:assert/strict";
import { MAPS } from "../shared/maps.js";
import { makeBody, moveBody, validInput } from "../shared/simulation.js";
import { emptyInput } from "../shared/protocol.js";
import { RULES } from "../shared/rules.js";
import { roundWinner, traceShot } from "../server/src/combat.js";
import { PlayerState } from "../server/src/state.js";
import { SessionRegistry } from "../server/src/sessions.js";
import { CombatRoom } from "../server/src/CombatRoom.js";
import { GameState } from "../server/src/state.js";
const oldMap = {
  ...MAPS[0],
  triangles: undefined,
  walls: [
    { x: 0, y: 1.5, z: 0, w: 5, h: 3, d: 8 },
    { x: 0, y: 2, z: 18, w: 36, h: 4, d: 1 },
  ],
};
const player = (id: string, team: "A" | "B", x: number, z: number) =>
  Object.assign(new PlayerState(), { id, team, x, z });
test("hitscan respects cover, body damage zone, heads and friendly blockers", () => {
  const a = player("a", "A", 0, -10),
    b = player("b", "B", 0, 10);
  assert.equal(traceShot(a, [a, b], oldMap, 0, 0).target, undefined);
  a.x = b.x = 14;
  assert.equal(traceShot(a, [a, b], oldMap, 0, 0).headshot, true);
  assert.equal(traceShot(a, [a, b], oldMap, 0, 0.04).headshot, false);
  const friend = player("c", "A", 14, 0);
  assert.equal(traceShot(a, [a, friend, b], oldMap, 0, 0).target, undefined);
});
test("symmetric elimination and survivor-count timeouts have no team-role advantage", () => {
  const a = player("a", "A", 0, 0),
    b = player("b", "B", 0, 0),
    c = player("c", "A", 0, 0),
    d = player("d", "B", 0, 0);
  assert.equal(roundWinner([a, b], 1, false), undefined);
  assert.equal(roundWinner([a, b], 1, true), "draw");
  assert.equal(roundWinner([a, b], 5, true), "draw");
  d.health = 0;
  assert.equal(roundWinner([a, b, c, d], 1, false), undefined);
  assert.equal(roundWinner([a, b, c, d], 1, true), "A");
  c.health = 0;
  assert.equal(roundWinner([a, b, c, d], 1, true), "draw");
  a.health = 0;
  assert.equal(roundWinner([a, b, c, d], 2, false), "B");
  b.health = 0;
  assert.equal(roundWinner([a, b, c, d], 2, false), "draw");
});
test("movement is speed capped, collision bounded and held jump cannot bunny hop", () => {
  const b = makeBody(14, 0),
    i = { ...emptyInput(), forward: 1, strafe: 1 };
  for (let n = 0; n < 60; n++) moveBody(b, i, 1 / 60, oldMap);
  assert.ok(Math.hypot(b.x - 14, b.z) <= RULES.walkSpeed + 0.001);
  for (let n = 0; n < 600; n++)
    moveBody(b, { ...i, strafe: 0 }, 1 / 60, oldMap);
  assert.ok(b.z < 17.2);
  const jumping = makeBody(14, 0);
  for (let n = 0; n < 180; n++)
    moveBody(jumping, { ...emptyInput(), jump: true }, 1 / 60, oldMap);
  assert.equal(jumping.y, 0);
  assert.equal(validInput({ ...emptyInput(), forward: Infinity }), false);
});
test("callsign is released immediately; late old-session cleanup cannot remove its new owner", () => {
  const r = new SessionRegistry(),
    old = r.claim("Gill", undefined);
  r.attach(old, "identity:x");
  assert.throws(() => r.claim("gILL", undefined));
  r.detach(old, "identity:x");
  const next = r.claim("Gill", undefined);
  assert.notEqual(next.token, old.token);
  r.attach(next, "identity:y");
  r.release(old);
  r.detach(old, "match:x");
  assert.equal(r.get(next.token), next);
  assert.equal(r.get(old.token), undefined);
  assert.throws(() => r.attach(old, "identity:z"));
});
test("draw rounds award no points, continue past round nine, and five decisive wins finish", () => {
  const room = new CombatRoom(),
    state = new GameState();
  room.setState(state);
  state.round = 1;
  for (const [id, team] of [
    ["a", "A"],
    ["b", "A"],
    ["c", "B"],
    ["d", "B"],
  ] as const)
    state.players.set(id, player(id, team, 0, 0));
  const engine = room as any;
  engine.prepRound();
  engine.hostReady = true;
  for (let round = 1; round <= 10; round++) {
    assert.equal(state.round, round);
    assert.equal(state.phase, "prep");
    assert.ok(
      round % 2 === 1
        ? state.players.get("a")!.x < 0
        : state.players.get("a")!.x > 0,
      "neutral sides alternate",
    );
    engine.simTime = engine.deadline;
    engine.tick(1 / 60);
    assert.equal(state.phase, "live");
    engine.simTime = engine.deadline;
    engine.tick(1 / 60);
    assert.equal(state.phase, "post");
    assert.equal(state.winner, "draw");
    assert.equal(state.scoreA, 0);
    assert.equal(state.scoreB, 0);
    engine.simTime = engine.deadline;
    engine.tick(1 / 60);
  }
  for (let win = 1; win <= 5; win++) {
    engine.simTime = engine.deadline;
    engine.tick(1 / 60);
    state.players.get("d")!.health = 0;
    engine.simTime = engine.deadline;
    engine.tick(1 / 60);
    assert.equal(state.scoreA, win);
    assert.equal(state.scoreB, 0);
    if (win < 5) {
      assert.equal(state.phase, "post");
      engine.simTime = engine.deadline;
      engine.tick(1 / 60);
    }
  }
  assert.equal(state.phase, "finished");
  assert.equal(state.winner, "A");
});
test("host match length controls the win target and an empty team abandons without awarding a round", () => {
  const room = new CombatRoom(),
    state = new GameState();
  room.setState(state);
  state.roundLimit = 3;
  state.phase = "live";
  const a = player("a", "A", 0, 0),
    b = player("b", "B", 0, 0);
  state.players.set("a", a);
  state.players.set("b", b);
  const engine = room as any;
  engine.endRound("A", "test");
  assert.equal(state.scoreA, 1);
  assert.equal(state.phase, "post");
  state.phase = "live";
  engine.endRound("A", "test");
  assert.equal(state.scoreA, 2);
  assert.equal(state.phase, "finished");
  state.scoreA = 0;
  state.phase = "live";
  b.connected = false;
  engine.onDepartureFinal(b);
  assert.equal(state.phase, "abandoned");
  assert.equal(state.scoreA, 0);
  assert.match(state.reason, /left/i);
  engine.tick(10);
  assert.equal(state.scoreA, 0);
});
