import type { AnimationGroup } from "@babylonjs/core";
import type { AnimationBinding } from "../../shared/weapons.js";

export type ClipAction =
  | "idle"
  | "walk"
  | "walkBackward"
  | "strafeLeft"
  | "strafeRight"
  | "run"
  | "jump"
  | "draw"
  | "fire"
  | "reload"
  | "crouch"
  | "crouchWalk"
  | "death";
const aliases: Record<ClipAction, string[]> = {
  idle: ["idle", "idlepose"],
  walk: ["walk", "walking", "walkforward"],
  walkBackward: ["walkbackward"],
  strafeLeft: ["strafeleft"],
  strafeRight: ["straferight"],
  run: ["run", "running", "runforward"],
  jump: ["jump", "jump2"],
  draw: ["draw", "equip", "deploy", "takeout"],
  fire: ["fire", "shoot", "shot"],
  reload: ["reload", "reloadempty", "reloadfull"],
  crouch: ["crouch", "crouchidle"],
  crouchWalk: ["crouchwalk"],
  death: ["death", "die"],
};
const normalize = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]/g, "");
// Explicit mapping for the supplied soldier, not a fuzzy match on demo timelines.
const suppliedClips: Partial<Record<ClipAction, string[]>> = {
  idle: ["Mark_Idle_Pose"],
};

// Exact named clips only. A single unnamed demonstration timeline must be split after inspection.
export function findClip(groups: AnimationGroup[], action: ClipAction) {
  return groups.find(
    (group) =>
      suppliedClips[action]?.includes(group.name) ||
      aliases[action].some(
        (alias) =>
          normalize(group.name) === alias ||
          normalize(group.name.split(/[|:]/).at(-1) ?? "") === alias,
      ),
  );
}

export class ClipPlayer {
  private current?: AnimationGroup;
  private previous?: AnimationGroup;
  private blend = 1;
  private blendDuration = 0.12;
  constructor(
    readonly groups: AnimationGroup[],
    private mapping: Partial<Record<ClipAction, AnimationBinding>> = {},
  ) {
    for (const group of groups) {
      group.stop();
      for (const animation of group.targetedAnimations)
        animation.animation.enableBlending = false;
    }
  }
  private ranged = new Map<ClipAction, AnimationGroup>();
  private clip(action: ClipAction) {
    const binding = this.mapping[action];
    if (typeof binding !== "object")
      return binding
        ? this.groups.find((group) => group.name === binding)
        : findClip(this.groups, action);
    if (this.ranged.has(action)) return this.ranged.get(action);
    const source = this.groups.find((group) => group.name === binding.clip);
    if (
      !source ||
      !Number.isFinite(binding.from) ||
      !Number.isFinite(binding.to) ||
      binding.from < source.from ||
      binding.to > source.to ||
      binding.to < binding.from
    )
      return undefined;
    const clip = source.clone(`mapped-${action}`, undefined, true);
    clip.from = binding.from;
    clip.to = binding.to;
    clip.metadata = {
      playbackSpeed: Math.max(0.05, Math.min(4, binding.speed ?? 1)),
    };
    this.ranged.set(action, clip);
    return clip;
  }
  dispose() {
    this.stop();
    for (const group of this.ranged.values()) group.dispose();
    this.ranged.clear();
  }
  phase(value: number) {
    if (this.current) {
      this.current.pause();
      this.current.goToFrame(
        this.current.from + (this.current.to - this.current.from) * value,
      );
    }
  }
  has(action: ClipAction) {
    return !!this.clip(action);
  }
  private stopAll() {
    const all = new Set([...this.groups, ...this.ranged.values()]);
    for (const group of all) {
      group.stop();
      group.setWeightForAllAnimatables(0);
    }
    this.current = undefined;
    this.previous = undefined;
    this.blend = 1;
  }
  stop() {
    this.stopAll();
  }
  /**
   * Finds a stable authored frame even when Idle is procedural. Combined
   * weapon timelines normally start each mapped action from the held pose;
   * the earliest mapped frame is therefore the deterministic neutral pose.
   */
  private baseline() {
    const idle = this.clip("idle");
    if (idle) return { group: idle, frame: idle.from, loop: true };
    const mapped = (["draw", "fire", "reload"] as ClipAction[])
      .map((action) => this.mapping[action])
      .filter(
        (binding): binding is AnimationBinding & object =>
          typeof binding === "object",
      )
      .sort((a, b) => a.from - b.from)[0];
    const source =
      mapped && this.groups.find((group) => group.name === mapped.clip);
    if (source) return { group: source, frame: mapped.from, loop: false };
    const only = this.groups.length === 1 ? this.groups[0] : undefined;
    return only ? { group: only, frame: only.from, loop: false } : undefined;
  }
  private enterBaseline(live: boolean) {
    this.stopAll();
    const base = this.baseline();
    if (!base) return false;
    base.group.start(
      live && base.loop,
      base.group.metadata?.playbackSpeed ?? 1,
      base.frame,
      base.loop ? base.group.to : base.frame,
    );
    base.group.setWeightForAllAnimatables(1);
    base.group.goToFrame(base.frame);
    if (!base.loop) base.group.pause();
    this.current = base.group;
    this.blend = 1;
    return true;
  }
  /** Stop transient tracks and evaluate the authored idle/bind pose before hiding or disposing. */
  resetToIdle() {
    return this.enterBaseline(false);
  }
  /** Enter a clean, live idle loop without blending from a frozen transient pose. */
  settleIdle() {
    return this.enterBaseline(true);
  }
  speed(ratio: number) {
    if (this.current)
      this.current.speedRatio = Math.max(0.3, Math.min(2.6, ratio));
  }
  play(action: ClipAction, loop = true, duration?: number, immediate = false) {
    if (action === "idle") {
      const idle = this.clip("idle");
      if (!idle) return this.settleIdle();
      if (this.current === idle && loop) return true;
      this.previous?.stop();
      this.previous = this.current;
      this.current = idle;
      this.blend = immediate ? 1 : 0;
      this.blendDuration = 0.16;
      idle.start(loop, idle.metadata?.playbackSpeed ?? 1, idle.from, idle.to);
      idle.setWeightForAllAnimatables(immediate ? 1 : 0);
      return true;
    }
    const clip = this.clip(action);
    if (!clip) return false;
    if (this.current === clip) {
      if (loop) return true;
      clip.stop();
      this.current = undefined;
    }
    this.previous?.stop();
    this.previous = this.current;
    this.current = clip;
    this.blend = immediate ? 1 : 0;
    this.blendDuration = action === "fire" ? 0.025 : 0.12;
    const fps = clip.targetedAnimations[0]?.animation.framePerSecond ?? 60;
    const seconds = (clip.to - clip.from) / fps;
    clip.start(
      loop,
      duration && seconds > 0
        ? seconds / duration
        : (clip.metadata?.playbackSpeed ?? 1),
      clip.from,
      clip.to,
    );
    clip.setWeightForAllAnimatables(immediate ? 1 : 0);
    return true;
  }
  tick(dt: number) {
    this.blend = Math.min(1, this.blend + dt / this.blendDuration);
    this.current?.setWeightForAllAnimatables(this.blend);
    this.previous?.setWeightForAllAnimatables(1 - this.blend);
    if (this.blend === 1) {
      this.previous?.stop();
      this.previous = undefined;
    }
  }
}

export const DRAW_SECONDS = 0.55;
// A restrained eased raise with a small final settle; no bouncy spring or camera jerk.
export function drawPose(elapsed: number) {
  const t = Math.max(0, Math.min(1, elapsed / DRAW_SECONDS)),
    smooth = t * t * t * (t * (t * 6 - 15) + 10);
  const remaining = 1 - smooth,
    settle = Math.sin(Math.PI * t) * Math.sin(Math.PI * t) * 0.008;
  return {
    x: 0.055 * remaining,
    y: -0.34 * remaining,
    z: -0.1 * remaining - settle,
    pitch: 0.5 * remaining,
    roll: 0.18 * remaining,
    done: t === 1,
  };
}
