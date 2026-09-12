# Assets and rebuilding

All paths below are relative to the project root. Assets are bundled; no downloads are needed.

| File | Purpose |
| --- | --- |
| client/public/assets/characters/player.glb | Generated SWAT match character |
| asset-staging/swat/source.glb | Unmodified uploaded SWAT, required to rebuild |
| client/public/assets/weapons/glock.glb | Animated first-person Glock and arms |
| client/public/assets/weapons/glock-world.glb | Gun-only static third-person Glock |
| client/public/assets/menu/operator.glb | Separate menu idle character |
| client/public/assets/maps/depot.glb | Complete uploaded neon map and collision source |
| client/public/assets/sounds/ | Mono positional effects |
| client/public/assets/music/menu-theme.mp3 | Menu soundtrack |

## Rebuild derived assets

After npm ci:

- node --import tsx scripts/build-character.ts
- node --import tsx scripts/build-world-glock.ts
- node --import tsx scripts/build-depot.ts
- npm run build

The character builder trims the source clips' nonzero start times, removes root travel,
closes locomotion loops and derives lower-body crouch/strafe on the same rig.
Jump uses jump2 with pelvis height supplied by the server. It never substitutes an
unrelated skeleton or repaints the authored finger rotations.
Crouch bends hips/knees; it does not squash the body. Death is a generated collapse with relaxed arms
fallback, not a native mocap clip. This source has no third-person reload animation;
the native ready pose remains during reload. The first-person reload still plays fully.

## Gun attachment and future weapons

The SWAT has a right-hand bone but no authored weapon socket. Runtime attachment
in client/src/assets.ts measures its right wrist and middle-finger knuckle in the
fitted idle pose, computes a fixed hand-local grip transform, and parents the
gun-only Glock to that transform. All subsequent animation moves the socket with
the hand. The original arm and finger poses remain intact.
The first-person arms belong only to the viewmodel; they are never attached to SWAT.

For additional weapons, use this repeatable authoring workflow:

1. Import the character and a gun-only mesh into Blender. Keep the existing rig and bind pose.
2. At the held pose, fit the gun backstrap to the right palm and check trigger-finger contact
   from front, side and underneath. Match the game character's fitted 1.8m scale.
3. Add weapon_socket_r under the right-hand bone. Record its local position and orientation.
4. Give each weapon grip_r, grip_l and muzzle helpers. Align grip_r with the character socket
   using the inverse grip transform. Store offsets in a per-weapon profile.
5. For a different grip family, author a pistol/rifle upper-body pose. Use left-arm IK targeting
   grip_l plus a stable elbow pole. Finger curl still needs an authored pose.
6. Export embedded-texture GLBs and verify hold, walk, crouch, jump, recoil and reload.
   A bone socket keeps a weapon attached; it cannot make every hand pose fit every gun.

## Maps and lighting

Server collision comes from every nondegenerate source mesh triangle, generated into
shared/depot-geometry.ts. The renderer and server share the floor offset in shared/maps.ts.
A new map needs its scale, floor, bounds and team spawns inspected before rebuilding;
dropping arbitrary geometry alone cannot choose fair or safe spawn positions.

client/src/lighting.ts supplies daylight, procedural sky/ground reflections, filtered
sun shadows, ACES tone mapping, FXAA and half-resolution ambient occlusion.
AO uses WebGL2; older contexts retain direct/ambient lighting and shadows.
This is a lighting pass: the supplied neon map's original colors and geometry remain.

## Validation

npm run typecheck
npm test
TEST_COMBAT=1 npm run test:integration

Optional offline rig pose inspection:
node --import tsx scripts/inspect-runtime-character.ts
python3 scripts/render-poses.py

The Python viewer requires moderngl, numpy and pillow. It checks skinned geometry and
weapon placement, not browser materials or GPU post-processing. A real browser
playtest remains necessary for lighting quality, performance and animation feel.


Grip calibration is an additive child transform under the right-hand socket.
client/src/grip.ts defines the approved X −0.025, Y 0.037, Z 0.027 versioned SWAT/Glock profile (metres, degrees,
relative uniform scale), validates imports, and applies the same transform to
the gun and muzzle. See README.md for the F2 controls. A copied profile is local
calibration data; it is not automatically published to other players.
