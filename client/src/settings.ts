export type Action =
  | "forward"
  | "back"
  | "left"
  | "right"
  | "jump"
  | "crouch"
  | "reload"
  | "fire"
  | "ads"
  | "sprint";
export interface Settings {
  sensitivity: number;
  fov: number;
  master: number;
  music: number;
  sfx: number;
  primary: string;
  secondary: string;
  crosshairMode: "dynamic" | "static";
  crosshairGap: number;
  keys: Record<Action, string>;
}
export const defaults: Settings = {
  sensitivity: 1,
  fov: 95,
  master: 0.7,
  music: 0.65,
  sfx: 0.8,
  primary: "",
  secondary: "glock",
  crosshairMode: "dynamic",
  crosshairGap: 6,
  keys: {
    forward: "KeyW",
    back: "KeyS",
    left: "KeyA",
    right: "KeyD",
    jump: "Space",
    crouch: "KeyC",
    reload: "KeyR",
    fire: "Mouse0",
    ads: "Mouse2",
    sprint: "ShiftLeft",
  },
};
export function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem("collateral.settings") ?? "{}");
    const clamp = (v: unknown, fallback: number, min: number, max: number) =>
      typeof v === "number" && Number.isFinite(v)
        ? Math.max(min, Math.min(max, v))
        : fallback;
    const keys = {
      ...defaults.keys,
      ...Object.fromEntries(
        Object.entries(s.keys ?? {}).filter(
          ([key, value]) => key in defaults.keys && typeof value === "string",
        ),
      ),
    };
    // Migrate existing installs too; Ctrl/Cmd+W cannot reliably be blocked by a page.
    for (const action of Object.keys(keys) as Action[])
      if (/^(Control|Meta)/.test(keys[action]))
        keys[action] = defaults.keys[action];
    if (keys.crouch === "KeyC")
      for (const action of Object.keys(keys) as Action[])
        if (action !== "crouch" && keys[action] === "KeyC")
          keys[action] = defaults.keys[action];
    return {
      sensitivity: clamp(s.sensitivity, 1, 0.1, 3),
      fov: clamp(s.fov, 95, 80, 110),
      master: clamp(s.master, 0.7, 0, 1),
      music: clamp(s.music, 0.65, 0, 1),
      sfx: clamp(s.sfx, 0.8, 0, 1),
      primary: typeof s.primary === "string" ? s.primary : "",
      secondary: typeof s.secondary === "string" ? s.secondary : "glock",
      crosshairMode: s.crosshairMode === "static" ? "static" : "dynamic",
      crosshairGap: clamp(s.crosshairGap, 6, 2, 18),
      keys,
    };
  } catch {
    return structuredClone(defaults);
  }
}
export function ensureWeaponSelections(s:Settings,weapons:Array<{id:string;slot:"primary"|"secondary"}>){
  let changed=false;
  for(const slot of ["primary","secondary"] as const){
    const available=weapons.filter(w=>w.slot===slot);
    if(available.length && !available.some(w=>w.id===s[slot])){
      s[slot]=available[0].id;changed=true;
    }
    if(!available.length && s[slot]){s[slot]="";changed=true;}
  }
  return changed;
}
export function saveSettings(s: Settings) {
  localStorage.setItem("collateral.settings", JSON.stringify(s));
}
