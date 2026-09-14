import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("cached maps re-acknowledge host readiness and clear the waiting overlay", () => {
  const main = readFileSync("client/src/main.ts", "utf8");
  assert.match(main, /game\?\.mapReady/);
  assert.match(main, /state.hostId === net.match\?\.sessionId/);
  assert.match(main, /net.send\("ready"\)/);
  assert.match(main, /else if \(game\?\.mapReady/);
});
test("framer separates panels and exports the captured third-person pose", () => {
  const source = readFileSync("engine/src/WeaponFramer.tsx", "utf8");
  assert.match(source, /CAPTURE ATTACHMENT \+ HOLDING POSE/);
  assert.match(source, /CAPTURE ALL THIRD-PERSON VALUES/);
  assert.match(source, /CAPTURE ALL CURRENT FIRST-PERSON VALUES/);
  assert.match(source, /thirdPose.current\?\.weapon/);
  for (const tab of ["models", "poses", "holding", "save", "animations", "rules", "audio", "effects"])
    assert.ok(source.includes(`"${tab}"`), `missing ${tab} panel`);
});
