export type WeaponSlot = "primary" | "secondary";
export interface FrameTransform {
  x: number;
  y: number;
  z: number;
  pitch: number;
  yaw: number;
  roll: number;
  scale: number;
}
export type JointPose = Record<string,{x:number;y:number;z:number;w:number}>;
export interface HoldingPose {
  preset: "pistol" | "rifle" | "custom";
  arms: JointPose;
  supportHand: { enabled: boolean; target: FrameTransform; orient: boolean };
}
export interface WeaponManifest {
  version: 1;
  id: string;
  name: string;
  slot: WeaponSlot;
  assets: {
    /** @deprecated View models now include their own arms. */
    arms?: string;
    view?: string;
    character?: string;
    world?: string;
    shotSound?: string;
    reloadSound?: string;
  };
  gameplay: {
    damage: number;
    headshotMultiplier: number;
    range: number;
    rpm: number;
    fireMode?: "semi" | "auto";
    magazine: number;
    reserve: number;
    reloadSeconds: number;
    spread: { standing: number; moving: number; crouched: number; ads: number };
    recoil: { pitch: number; yaw: number; recovery: number };
  };
  effects: {
    muzzle: { firstPerson: FrameTransform; thirdPerson: FrameTransform };
    /** Optional animated model node; offsets are local to this node, otherwise the weapon root. */
    muzzleNode?: { firstPerson?: string; thirdPerson?: string };
    flash: { color: string; size: number; intensity: number; duration: number };
    tracer: {
      color: string;
      width: number;
      length: number;
      speed: number;
      smoke: boolean;
    };
  };
  firstPerson: {
    /** @deprecated Kept so older packages remain loadable. */
    arms: FrameTransform;
    weapon: FrameTransform;
    ads: FrameTransform;
    adsFov: number;
    fingers: Record<string, { x: number; y: number; z: number; w: number }>;
    animations?: Partial<Record<WeaponAnimationAction, AnimationBinding>>;
    /** Layer camera/movement-driven sway, bob, inertia and sprint carry over the selected clips. */
    proceduralMotion?: boolean;
    /** True when transforms were authored camera-relative in Collateral Engine. */
    editorFramed?: boolean;
    /** Editor preview FOV; informative only, player settings remain authoritative. */
    previewFov?: number;
  };
  thirdPerson: {
    /** Shared runtime rig. Reference GLBs are optional editor-only data. */
    characterId?: "swat";
    holding?: HoldingPose;
    /** Pose relative to the normalized reference, converted once at the hand. */
    space?: "character" | "socket";
    character: FrameTransform;
    weapon: FrameTransform;
    fingers?: Record<string, { x: number; y: number; z: number; w: number }>;
    animations?: Partial<Record<WeaponAnimationAction, AnimationBinding>>;
  };
}
export type AnimationBinding = string | { clip: string; from: number; to: number; speed?: number };
export const PROCEDURAL_ANIMATION = "@collateral-built-in";
export const NO_ANIMATION = "@collateral-none";
export function usesProcedural(binding: AnimationBinding | undefined, hasClip = false) {
  return binding === PROCEDURAL_ANIMATION || (binding === undefined && !hasClip);
}
export function usesProceduralMotion(firstPerson: WeaponManifest["firstPerson"], hasIdleClip = false) {
  return firstPerson.proceduralMotion ?? usesProcedural(firstPerson.animations?.idle, hasIdleClip);
}
export type WeaponAnimationAction =
  | "idle"
  | "draw"
  | "fire"
  | "reload";
export interface WeaponSummary {
  id: string;
  name: string;
  slot: WeaponSlot;
  path: string;
}
export const DEFAULT_WEAPONS: Record<WeaponSlot, string> = {
  primary: "",
  secondary: "glock",
};
export const DEFAULT_WEAPON_GAMEPLAY: WeaponManifest["gameplay"] = {
  damage: 34,
  headshotMultiplier: 3,
  range: 80,
  rpm: 480,
  fireMode: "semi",
  magazine: 17,
  reserve: 51,
  reloadSeconds: 1.7,
  spread: { standing: 0.002, moving: 0.018, crouched: 0.0012, ads: 0.0008 },
  recoil: { pitch: 1.25, yaw: 0.35, recovery: 12 },
};
export const DEFAULT_WEAPON_EFFECTS: WeaponManifest["effects"] = {
  muzzle: {
    firstPerson: {
      x: 0,
      y: 0.059,
      z: 0.166,
      pitch: 0,
      yaw: 0,
      roll: 0,
      scale: 1,
    },
    thirdPerson: {
      x: 0,
      y: 0.059,
      z: 0.166,
      pitch: 0,
      yaw: 0,
      roll: 0,
      scale: 1,
    },
  },
  flash: { color: "#ffd28a", size: 0.09, intensity: 2.4, duration: 0.045 },
  tracer: {
    color: "#ffd7a0",
    width: 0.012,
    length: 1.4,
    speed: 160,
    smoke: true,
  },
};
export function weaponKey(slot: WeaponSlot, id: string) {
  return `${slot}/${id}`;
}
