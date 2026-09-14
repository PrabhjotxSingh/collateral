# Collateral — tactical 2v2 FPS prototype
 
Babylon.js + Vite client, Node.js + Colyseus server, and shared rules/collision.
Includes the uploaded SWAT character with native idle/walk/jump, derived crouch/strafe,
a gun-only Glock attached to its right hand, and a combined animated first-person
Glock-and-arms view model. Daylight uses warm sun, cool ambient fill, environment reflections,
2048px filtered shadows, ACES tone mapping and subtle half-resolution SSAO on WebGL2.
The menu operator and soundtrack remain separate from match actors.
See ASSETS.md for rebuilding and attachment details; CREDITS.md lists bundled sources.

## Run on your computer

Install Node.js 22 or newer. Extract this folder, open a terminal in `collateral`, then:

```sh
npm ci
npm run dev
```

Open **http://localhost:5173**. Enter a username, select Play, and create a lobby. Open one or three additional independent tabs with different usernames, or invite players to the same server address. Avoid duplicating an already-connected tab: browsers may copy its session storage. The host can start a balanced 1v1 or 2v2. For 1v1, one player must switch to Team B. Click **Enter game** to capture the mouse; Escape releases it.

On your LAN, other players can use `http://YOUR-LAN-IP:5173` while the dev server runs. Allow inbound port 5173 in the host computer's firewall. Browser support for pointer lock/audio may vary on non-local HTTP; use HTTPS for remote play.

### Production build / one-process hosting

```sh
npm run build
npm start
```

Open **http://localhost:2567**. The Node server serves the built client and WebSockets on the same port. For Internet play, run this Node process on a server and place it behind an HTTPS reverse proxy with WebSocket upgrades enabled. A static web host alone cannot run the Colyseus server. No live Internet server is deployed by this deliverable.

Environment variables:

- `PORT`: authoritative server port; defaults to `2567`.
- `CLIENT_DIST`: optional absolute path to built client assets.
- `VITE_SERVER_URL`: optional client endpoint compiled in at build time. Normally leave unset: development uses the Vite `/socket` proxy and production uses the same origin. A separate origin requires an appropriate server origin policy and TLS configuration.

## Controls and rules

| Action | Default |
| --- | --- |
| Move | W / A / S / D |
| Aim down sights | Hold right mouse |
| Fire | Left mouse, once per shot |
| Reload | R |
| Sprint | Hold left Shift + forward |
| Crouch | Hold C |
| Jump | Space |
| Release mouse | Escape |

Gameplay bindings can be changed in Settings; Escape, Ctrl and Command remain reserved. Saved Ctrl crouch bindings migrate to C. Sensitivity, horizontal FOV, master volume, effects volume and bindings save in localStorage. Usernames and reconnection secrets use tab-scoped sessionStorage; they are session identities, not accounts.

- The host selects best-of-3, 5, 7 or 9 and can choose any installed map or a random map.
- 100 seconds live, 6 seconds preparation, 3 seconds round-result display.
- Team A and Team B have identical rules. Spawn sides alternate each round for map fairness; teams and scores stay intact.
- A round ends on the first casualty. At timeout, the team with more living connected players wins; equal survivors means a draw with no points. If a team leaves completely, the match stops without awarding more rounds.
- No mid-round respawns, healing, economy, progression or bots. Dead players spectate their surviving teammate.
- Glock: 17-round magazine, 51 reserve, manual 1.7-second reload, 40 body damage, 2.5× head multiplier, minimum 190 ms between shots. Teammates block shots; friendly damage is disabled.
- Walking 3.6 m/s, sprinting 5.2 m/s, ADS walking 2.1 m/s, crouching 1.65 m/s. Air control is capped, and holding jump cannot repeatedly jump.
- Ground movement produces distance-timed positional footsteps; crouch/ADS steps are quieter. Only footsteps retain a synthesized fallback. Firing from sprint first raises the weapon for 240 ms; a shot is queued until it is ready.
- Back from a lobby/match returns to the menu and retains the callsign. Explicit sign-out immediately frees it. Identity disconnection also frees it as soon as detected by the server; old tokens are invalidated and their match connection is closed. A match-only transport drop can reconnect within 30 seconds if the identity connection remains alive, with no mid-round respawn. Refreshing the page now requires a new callsign connection.

## Structure

```text
client/src/       Babylon view, input, assets, audio, settings, isolated HTML/CSS UI
client/public/    Runtime assets, including the tactical soldier (see ASSETS.md)
engine/           Separate React + Babylon map-authoring application
server/src/       Identity registry, live lobby directory, room state, authoritative combat
shared/          Rules, maps/colliders, protocol, deterministic movement and ray tests
tests/           Rule tests and four-client WebSocket integration
```

`SessionRoom` provides session identity and pushes lobby changes. `TacticalRoom` owns lobby access, passwords, team capacity and reconnect lifecycle. `CombatRoom` extends it with the fixed 60 Hz simulation and 20 Hz schema patches. Client packets contain input intent, never trusted position, damage, ammo or winners.

Movement and cover use shared kinematic collision on the server. Havok runs client-side casing physics against the same triangle surface. Living players collide as upright capsules on both teams. Client physics never determines damage or authoritative positions. The client interpolates server snapshots and handles mouse-look locally. Full movement prediction/reconciliation, server rewind for lag compensation and an anti-cheat visibility system are not implemented.

## Verification

```sh
npm run typecheck
npm test
npm run test:integration
```

Integration launches and stops its own server. Include the movement/shooting/reload flow:

```sh
# Bash / macOS / Linux
TEST_COMBAT=1 npm run test:integration
```

```powershell
# Windows PowerShell
$env:TEST_COMBAT = '1'
npm run test:integration
```

Tests cover duplicate names, immediate callsign release, stale-token rejection, hashed password rejection, live browser updates, team limits, 1v1 and 2v2 starts, socket reconnect, cover occlusion, head/body hits, friendly blocking, speed/collision limits, held-jump behavior, input expiry, fire cadence, reload, elimination and draw rounds beyond round nine and survivor-count victories.

## Current limits / next work

This is a playable prototype with supplied models, the complete original map, and sample-based gun audio. Builds and model/network tests are validated; a browser playtest, latency tuning, GPU/audio verification and game-feel balancing still need real players. The UI has not received browser visual QA. The source map is copied intact and its world-space triangles are baked by `scripts/build-depot.ts`. A different map requires re-inspecting floor offset, spawns and bounds, then rebuilding collision.

Keep this version to one Node process. All names/lobbies are in memory and disappear on restart. Multi-process scaling, persistent auth/stats/friends, public-service abuse controls, detailed animation, mobile touch controls and matchmaking regions are future work. Desktop mouse and keyboard are required for gameplay.

Implementation references: [Colyseus documentation](https://docs.colyseus.io/) and [Babylon.js ES modules](https://doc.babylonjs.com/setup/frameworkPackages/es6Support). Dependencies are locked in `package-lock.json`; this prototype deliberately uses the compatible Colyseus 0.16 / Schema 3 SDK family.


## Developer tools

In development (`npm run dev`), press F2. The panel is excluded from ordinary
production sessions. This opts into local diagnostics;
it does not change server rules, health, collision or shot validation.

The panel includes an orbitable SWAT/Glock preview, available even from the menu
without a second player. Drag to orbit and scroll to zoom. Adjust X/Y/Z in metres,
pitch/yaw/roll in degrees, and relative scale. Values apply live to third-person
Glocks for the current session only. They do not change the first-person viewmodel.
Use the pose buttons to check idle, walk, crouch, jump and death. Click Copy settings
and paste the JSON into chat; Apply JSON imports a profile, and Reset grip restores the approved X −0.025, Y 0.037, Z 0.027 fit. Close the panel with F2, then click the game to capture the mouse.

Hit-volume diagnostics show the server's axis-aligned body box and headshot band,
plus standing/crouched collision capsules at received snapshot positions.
These can differ slightly from the interpolated visible model. Impact diagnostics
show confirmed server rays and endpoints (up to 20 shots), rather than predicting hits.
Clear impacts removes the marks. Frame timing includes a one-second window after
each local shot to help identify remaining first-shot stalls on your GPU.

The Sandbox tab launches any installed map as a one-player authoritative test room
with unlimited time. Choose a callsign first, select the map, and launch it. It uses
the normal server movement, collision, weapons, effects, and map-loading paths, but
does not require an opposing team and cannot award rounds. The server accepts this
mode only while running outside production.
The map dropdown refreshes directly from the server whenever the Sandbox tab opens,
so maps added since page load appear without reconnecting.

Muzzle lighting now uses one persistent light instead of adding/removing scene lights
on every shot. Effect shaders and the casing material/physics path warm up before use.
The death clip releases both arms before the collapse; the pistol follows the relaxed hand.

## Collateral Engine

Run the separate editor from the project root:

```sh
npm run dev:engine
```

Open **http://localhost:5174**, import a binary `.glb`, and adjust its uniform
scale and vertical offset. Select the 1.8 m player-reference capsule, spawn, or
light in the viewport/list and move it with the colored position/rotation gizmos.
Add two spawns for Team A and two for Team B. Point lights can be edited for
color, power, and range. Each map may use Blue Day, Overcast, or Night, or bundle
a custom Babylon `.env` skybox. Export shows collision/compression progress and
produces one ZIP containing:

```text
map-id/
  map.glb
  map.json
  skybox.env        # custom sky only
  INSTALL.txt
```

Extract the exported map folder into `client/public/maps/`, restart the server,
and it appears automatically in the host's lobby map dropdown. `map.json` contains
the versioned metadata, bounds, spawns, lights, and baked world-space triangle
collision used by the authoritative server. Invalid packages and folders without
a matching `map.glb` are skipped safely at startup.
Open `http://localhost:5174` and choose Map Editor or Character / Weapon Framer.
The framer exports self-contained packages for `client/public/weapons/primary` and
`client/public/weapons/secondary`. Installed packages are discovered by the server and
appear in Loadout automatically. First-person packages use one combined arms-and-gun
`view.glb`; separate first-person arms are legacy-only. First Person and Third Person
are isolated tabs. The first-person Play Test switches to the fixed player-eye camera,
while Edit View exposes the model and muzzle gizmos. Map each GLB's own Idle, Draw,
Fire, and Reload clips in the Animation Connector before export.
The editor defines **+Z as front** in both views. First-person imports are automatically
fitted into the player viewport, and can be re-fitted with Auto-frame. Capture Hip
before ADS; the ADS preview always eases from that saved Hip baseline. Move, Rotate,
and Scale are separate gizmo modes. The muzzle flash color supports both a visual
picker and a six-digit hex value.

Exported weapon ZIPs can be imported back into the framer to continue editing their
models, sounds, transforms, effects, ballistics, and animation mappings. Hip and ADS
captures require confirmation. New packages use the same horizontal-FOV camera and
camera-relative transform hierarchy in both Play Test and the game; procedural motion
is layered as a zero-centered offset, so it cannot shift the authored sights. Each
animation action can use a model clip or Collateral's built-in fallback and can be
previewed independently.

Magazine size and reserve ammunition are defined per weapon. During a round, the
server stores ammunition independently for every weapon a player uses. The Loadout
groups every discovered package by Primary or Secondary and allows one selection from
each group; number keys and the mouse wheel switch between the equipped pair.

## Framer and movement update

- Third-person captured poses now declare their coordinate space. The game converts the reference-space pose into the hand socket once, rather than adding the character's height twice. Older editor-framed packages also migrate their saved reference's native scale. For a different/custom reference rig, import the package, load **GAME SWAT REFERENCE**, check the grip, capture the third-person pose and re-export.
- The reference GLB is a preview resource. It does not replace the match character or retarget animations. Different rigs/grips need separate fitted weapon poses and matching character integration. Use the game's SWAT reference for this game's current player.
- First-person editing has a persistent 16:9 live camera beside the orbit view. HIP and ADS use short-arc quaternion interpolation; capture reads quaternion gizmo rotations. Match the preview FOV with your game setting.
- Animation connector: choose a model clip, a **Start / End frame** range within one combined timeline, **COLLATERAL BUILT-IN**, or **NONE**, separately for each action. Frame numbers are the imported Babylon timeline (which can differ from the source application's FPS). A missing explicitly selected clip does not silently enable a procedural animation. The original G17 now declares its Scene timeline ranges explicitly.
- Ballistics includes **Semi automatic / Automatic**. Automatic repeats while the fire input is held; both obey the authoritative RPM, ammo and reload rules.
- **Muzzle follows** can attach the marker to an animated weapon part. Position the marker at the barrel opening. Exported coordinates are local to that selected part, or the weapon root when no part is selected. The bundled G17's flash now follows its barrel instead of using the separate world-Glock offset.
- The active loadout Glock comes from `client/public/weapons/secondary/glock`. The original `client/public/assets/weapons` files remain for legacy/fallback loading, including the initial third-person attachment. Editing those files alone does not update an installed weapon package. Keep both until legacy loading is retired.
- Triangle-map movement supports steps up to 0.30 m and downward ground snapping, with swept clearance checks. Larger obstacles remain solid. Bad collision meshes still need correction in the map editor.

Validation includes real SWAT hand-attachment matrices, quaternion ADS, combined animation ranges, stair ascent/descent, low ceilings and high risers. Browser visual and multiplayer feel checks remain necessary on your machine; the browser binary could not be downloaded in the build environment.

## Per-weapon SWAT holding poses

In the framer, load/import your weapon and choose **Third person → Holding**.

1. Choose **Pistol**, **Rifle**, or **Custom**. Rifle is a compact starting stance, not an automatic fit for every model.
2. Align the weapon using the Poses controls. It now follows the reference's right-hand socket while you pose the arm.
3. Enable **Left hand follows support target**, select **MOVE / ROTATE SUPPORT HAND TARGET**, and move the green marker onto the foregrip. Enable **Use target rotation for wrist** if needed, then rotate the marker to orient the palm.
4. Select shoulder, arm, forearm, hand, or finger joints in the joint list and use the rotation gizmo. Selecting a joint pauses the grip solver so it cannot fight your edits. **SAVE ARM POSE FOR THIS WEAPON** commits the arm rotations; **CAPTURE THIRD-PERSON POSE** also captures them.
5. Preview the saved grip, capture the attachment, and export the package. Install it in the normal primary/secondary folder and restart the server.

Each weapon stores its own arm rotations, finger rotations, starting stance, and weapon-local support target. Runtime applies the same support-arm solver after movement animations. The solver rotates existing bones, clamps unreachable targets, and releases arm/finger overrides for reload and death. The upper-body pose is intended for aiming; this is not an automatic retargeter or a complete authored reload animation.

New exports identify the shared game character as `swat` and store a socket-local weapon transform. They do not duplicate the built-in SWAT GLB. Old packages still import their embedded references and are converted when re-exported. A custom preview GLB is included only if **Include custom reference in ZIP** is checked; it still does not replace the playable character. Use the same SWAT rig for reliable editor/game parity.

Validation: builds and 47 tests passed, including real SWAT reach, unchanged bone lengths, repeated-frame stability, reload/death release, weapon-pose reset, and attachment parity. Browser visual playtesting remains pending.

## Save workflow and switching

The framer's **Save** tab collects all capture actions for the selected first- or third-person view. The first-person **Capture All** saves the currently visible HIP or ADS baseline, fingers and muzzle; switch to the other baseline and capture it separately after editing. Third-person **Capture All** saves the attachment, arm pose, fingers, support target and current muzzle placement.

Switching weapons cancels an active reload on the authoritative server. The unfinished weapon keeps its exact magazine and reserve values, receives no ammunition when the old timer would have ended, and returns at its idle pose. The client also evaluates idle before removing an interrupted model. Entering crouch now applies the first crouch frame immediately to avoid a one-frame standing flash.

When at least one primary package is installed, an empty or stale saved loadout automatically selects the first primary in deterministic folder order. The server also assigns an installed primary on join. If no primary exists, the normal secondary fallback remains available.

## v2.4 gameplay and rendering

- Hold **Tab** during a match for the player scoreboard.
- Hosts can choose **Elimination** or **Team Deathmatch**. Deathmatch supports 10/20/30/50-kill targets, 5/10/15/20-minute clocks and three-second respawns.
- Empty magazines use `client/public/assets/sounds/empty-clip.mp3`; the click respects the current weapon's configured fire cadence.
- Remote shots, reloads and footsteps use distance attenuation and HRTF directional panning. Local weapon feedback remains immediate.
- Bullet impacts remain visible for roughly twelve seconds and darken the sampled rendered-surface color.
- The F2 panel now provides a session-only third-person camera and live FPS/frame-time readout.
- Viewmodel loads are generation guarded: stale asynchronous loads are discarded, transient tracks stop, and the selected weapon restarts from idle before draw/ADS.
- Stair handling supports taller ordinary risers with stronger downward ground snapping. Shadows use higher-quality filtering, with restrained motion blur and tighter contact occlusion.

Diagonal ground shading on imported maps normally comes from split normals or triangulation in the source GLB, then becomes more visible under screen-space occlusion. This build reduces that amplification. Persistent lines should be repaired in the source map by merging coplanar vertices and exporting consistent smooth/flat normals.

### v2.4.1 corrections

Weapons whose Idle/Draw/Fire behavior is procedural can still contain a single combined model timeline for reload. The runtime now derives a deterministic neutral frame from the earliest mapped authored action, stops every original and cloned animation group, evaluates that baseline, and only then draws, switches, returns from reload/fire, or blends ADS. This prevents a weapon from inheriting a paused reload keyframe when no separate model Idle clip exists.

Triangle-map stair traversal now clears an ordinary riser before the generic collision sweep. This avoids repeatedly colliding with the vertical stair face and correcting upward afterward. Grounded camera height uses a separate softened vertical follow so collision stays authoritative while the view appears continuous.

The hold-Tab scoreboard includes synchronized kills and deaths. Lobby rendering now watches game mode, deathmatch kill limit and match clock, so those controls update immediately.

The framer's Poses and Effects panels include **Precision Alignment**. Set position, rotation and scale increments, optionally snap the gizmos to those increments, or use the X/Y/Z, Pitch/Yaw/Roll and Scale nudge buttons for exact adjustments. A 0.001 m position step equals one millimetre; reduce it to 0.0001 m for final ADS sight alignment.
