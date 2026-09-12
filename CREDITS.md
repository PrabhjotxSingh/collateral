# Asset credits and modifications

## In-match SWAT character

SWAT_ANIMATED by inssa24.
https://sketchfab.com/3d-models/swat-animated-3df6d65da9c44755b8ed10587dfd1e01
https://sketchfab.com/diediouissa24

Embedded license: CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/
User supplied source retained at asset-staging/swat/source.glb.
Modifications: normalized bone names, trimmed timeline offsets, removed locomotion
root travel, loop seam blending, derived backward/strafe/run cycles, skeletal crouch
and a simple collapse fallback with relaxed arms. Living hand/finger poses are preserved.
The supplied jump2 is used with authoritative airborne state.
Previous Vanguard and cross-rig animation sources have been removed.

## Glock and first-person arms

G17 Pistol - Animated by user77 (CC BY 4.0), with arms/animations credited to DJMaesen
and weapon credited to 3dvachevsky:
https://sketchfab.com/3d-models/animated-pistol-bd896167e7ca44f19597d3afe6a8d83f
https://sketchfab.com/3d-models/g17-9mm-pistol-b4136758508c486cadcd96c74d7882b8

The third-person `glock-world.glb` is extracted from user77's credited G17 below:
https://sketchfab.com/3d-models/g17-pistol-animated-7723ab14e70446ef8e06a134984f287f
CC BY 4.0. Modifications: baked held pose, removed arms/skin/unused data,
grip-centered origin and separate hand attachment. First-person arms are unchanged.

## Depot source

FPS MAP PVP ,PVE GAME NEON by neosearch.
https://sketchfab.com/3d-models/fps-map-pvp-pve-game-neon-5ed434ead37d4f409de7780c72414e40

Embedded license: CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/
Source GLB unchanged, installed complete at `client/public/assets/maps/depot.glb`.
Runtime adjustment: vertical translation to place its floor at zero. Collision
triangles are derived from all 50 meshes. The previous modular adaptation was
removed. The runtime GLB is also the collision builder source.

## Menu operator

S.W.A.T. Operator by Mateusz Woliński (jeandiz).
https://sketchfab.com/3d-models/swat-operator-9e82fabf26194896b5ad4a364d864eab

Embedded license: CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/
Source GLB unchanged. Runtime modifications: scaling, placement, lighting,
and explicit mapping of the supplied standing animation to menu idle.

## Gunfire sample

`gun_fire.wav` from A collection of gun sounds by AVW.
https://opengameart.org/content/collection-gun-sounds

License: CC BY 3.0 — https://creativecommons.org/licenses/by/3.0/
Modifications: mono/48kHz Ogg conversion, high-pass filtering, low-mid reduction, presence EQ, slight pitch lift,
gain reduction, peak limiting, and shortened tail fade. This is a licensed game sound
effect; its source does not certify a particular Glock model or microphone setup.

## Reload sample

Handgun Reload Sound Effect by zer0_sol.
https://opengameart.org/content/handgun-reload-sound-effect

License: CC0 — https://creativecommons.org/publicdomain/zero/1.0/
Modifications: stereo-to-mono downmix, 48kHz Ogg conversion, filtering,
compression/gain, and padding/fade to the 1.7-second gameplay reload duration.

## Main menu soundtrack

User-supplied edit sourced from this video:
https://www.youtube.com/watch?v=iVRV-K9FHuw

Installed as the looping main-menu soundtrack. Playback begins after the first
user interaction to comply with browser autoplay rules and pauses during play.
