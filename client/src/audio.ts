import { ASSETS } from "../../shared/maps.js";
import type { Settings } from "./settings";
import type { Vec } from "../../shared/simulation.js";
import type { WeaponManifest } from "../../shared/weapons.js";
type Cue = "shot" | "hit" | "step" | "reload" | "empty";
export class TacticalAudio {
  private context?: AudioContext;
  private output?: GainNode;
  private loading?: Promise<void>;
  private buffers = new Map<string, AudioBuffer>();
  private active = new Map<string, {source: AudioBufferSourceNode | OscillatorNode; panner?: PannerNode}>();
  constructor(private settings: () => Settings) {}
  async unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      this.output = this.context.createGain();
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -4;
      limiter.knee.value = 6;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.09;
      this.output.connect(limiter);
      limiter.connect(this.context.destination);
      this.loading = this.load();
    }
    await this.context.resume();
    await this.loading;
  }
  private async load() {
    await Promise.all(
      (["shot", "hit", "step", "reload", "empty"] as Cue[]).map(async (kind) => {
        try {
          const response = await fetch(ASSETS[kind]);
          if (
            !response.ok ||
            response.headers.get("content-type")?.includes("text/html")
          )
            return;
          this.buffers.set(
            kind,
            await this.context!.decodeAudioData(await response.arrayBuffer()),
          );
        } catch {
          console.warn(`Sound unavailable: ${kind}`);
        }
      }),
    );
  }
  async weapon(path: string, manifest: WeaponManifest) {
    if (!this.context) return;
    await Promise.all(
      (["shot", "reload"] as const).map(async (kind) => {
        const asset =
          kind === "shot"
            ? manifest.assets.shotSound
            : manifest.assets.reloadSound;
        if (!asset) return;
        try {
          const response = await fetch(asset);
          if (response.ok)
            this.buffers.set(
              `${path}:${kind}`,
              await this.context!.decodeAudioData(await response.arrayBuffer()),
            );
        } catch {
          console.warn(`Weapon sound unavailable: ${path}:${kind}`);
        }
      }),
    );
  }
  listener(position: Vec, yaw: number, pitch: number) {
    const ctx = this.context;
    if (!ctx || !this.output) return;
    this.output.gain.value = this.settings().master * this.settings().sfx;
    const l = ctx.listener;
    // Babylon uses a left-handed world while WebAudio's listener space is
    // right-handed. Mirroring X keeps left/right spatial cues honest.
    l.positionX.value = -position.x;
    l.positionY.value = position.y;
    l.positionZ.value = position.z;
    l.forwardX.value = -Math.sin(yaw) * Math.cos(pitch);
    l.forwardY.value = -Math.sin(pitch);
    l.forwardZ.value = Math.cos(yaw) * Math.cos(pitch);
    l.upX.value = 0;
    l.upY.value = 1;
    l.upZ.value = 0;
  }
  play(kind: Cue, position?: Vec, volume = 1, weaponPath?: string, ownerId?: string) {
    const ctx = this.context;
    if (!ctx || ctx.state !== "running" || !this.output) return;
    const recorded =
      this.buffers.get(weaponPath ? `${weaponPath}:${kind}` : kind) ??
      this.buffers.get(kind);
    if (!recorded && kind !== "step") return;
    const gain = ctx.createGain();
    let destination: AudioNode = this.output;
    let panner: PannerNode | undefined;
    if (position) {
      const p = (panner = ctx.createPanner());
      p.panningModel = "HRTF";
      p.distanceModel = "inverse";
      p.refDistance = kind === "shot" ? 3.5 : 1.5;
      p.maxDistance = kind === "shot" ? 70 : 30;
      p.rolloffFactor = kind === "shot" ? 1.15 : 1.7;
      p.coneInnerAngle = 180;
      p.coneOuterAngle = 270;
      p.coneOuterGain = .45;
      p.positionX.value = -position.x;
      p.positionY.value = position.y;
      p.positionZ.value = position.z;
      p.connect(this.output);
      destination = p;
    }
    const cueVolume = Math.max(0, Math.min(1, volume));
    gain.connect(destination);
    const now = ctx.currentTime;
    const duration =
      kind === "shot"
        ? 0.12
        : kind === "hit"
          ? 0.1
          : kind === "step"
            ? 0.075
            : 0.18;
    let source: AudioBufferSourceNode | OscillatorNode;
    if (recorded) {
      source = ctx.createBufferSource();
      source.buffer = recorded;
      gain.gain.value =
        (kind === "shot" ? 0.65 : kind === "hit" ? 0.5 : kind === "empty" ? .55 : 0.4) * cueVolume;
      source.connect(gain);
      source.start();
    } else {
      source = ctx.createOscillator();
      source.type = kind === "step" ? "sine" : "triangle";
      source.frequency.setValueAtTime(kind === "step" ? 120 : 700, now);
      source.frequency.exponentialRampToValueAtTime(
        kind === "step" ? 45 : 200,
        now + duration,
      );
      gain.gain.setValueAtTime(0.2 * cueVolume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      source.connect(gain);
      source.start();
      source.stop(now + duration);
    }
    const activeKey = ownerId ? `${kind}:${ownerId}` : "";
    if (activeKey) {
      try { this.active.get(activeKey)?.source.stop(); } catch {}
      this.active.set(activeKey, {source,panner});
    }
    source.onended = () => {
      if (activeKey && this.active.get(activeKey)?.source === source) this.active.delete(activeKey);
      source.disconnect();
      gain.disconnect();
      if (destination !== this.output) destination.disconnect();
    };
  }
  stop(kind: Cue, ownerId: string) {
    const key = `${kind}:${ownerId}`;
    const source = this.active.get(key)?.source;
    this.active.delete(key);
    try { source?.stop(); } catch {}
  }
  move(kind: Cue, ownerId: string, position: Vec) {
    const panner=this.active.get(`${kind}:${ownerId}`)?.panner;
    if(!panner)return;
    // Same Babylon-left-handed to WebAudio-right-handed conversion as play().
    panner.positionX.value=-position.x;
    panner.positionY.value=position.y;
    panner.positionZ.value=position.z;
  }
}
