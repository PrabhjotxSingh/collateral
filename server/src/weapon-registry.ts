import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  DEFAULT_WEAPON_EFFECTS,
  DEFAULT_WEAPON_GAMEPLAY,
  type WeaponManifest,
  type WeaponSlot,
  type WeaponSummary,
} from "../../shared/weapons.js";

const validId = /^[a-z0-9][a-z0-9-]{0,39}$/;
const number = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
export const WEAPONS = new Map<string, WeaponManifest>();
export const WEAPON_SUMMARIES: WeaponSummary[] = [];

export function loadInstalledWeapons(root: string) {
  WEAPONS.clear();
  WEAPON_SUMMARIES.length = 0;
  for (const slot of ["primary", "secondary"] as WeaponSlot[]) {
    const slotRoot = resolve(root, slot);
    let ids: string[] = [];
    try {
      ids = readdirSync(slotRoot).sort((a,b)=>a.localeCompare(b));
    } catch {
      continue;
    }
    for (const id of ids) {
      try {
        if (!validId.test(id) || !statSync(join(slotRoot, id)).isDirectory())
          continue;
        const manifest = JSON.parse(
          readFileSync(join(slotRoot, id, "weapon.json"), "utf8"),
        ) as WeaponManifest;
        if (
          manifest.version !== 1 ||
          manifest.id !== id ||
          manifest.slot !== slot ||
          typeof manifest.name !== "string"
        )
          continue;
        const base = `/weapons/${slot}/${id}/`;
        manifest.gameplay = {
          ...DEFAULT_WEAPON_GAMEPLAY,
          ...manifest.gameplay,
          spread: {
            ...DEFAULT_WEAPON_GAMEPLAY.spread,
            ...manifest.gameplay?.spread,
          },
          recoil: {
            ...DEFAULT_WEAPON_GAMEPLAY.recoil,
            ...manifest.gameplay?.recoil,
          },
        };
        manifest.effects = {
          ...DEFAULT_WEAPON_EFFECTS,
          ...manifest.effects,
          muzzle: {
            firstPerson: {
              ...DEFAULT_WEAPON_EFFECTS.muzzle.firstPerson,
              ...(manifest.effects?.muzzle as any)?.firstPerson,
            },
            thirdPerson: {
              ...DEFAULT_WEAPON_EFFECTS.muzzle.thirdPerson,
              ...(manifest.effects?.muzzle as any)?.thirdPerson,
            },
          },
          flash: {
            ...DEFAULT_WEAPON_EFFECTS.flash,
            ...manifest.effects?.flash,
          },
          tracer: {
            ...DEFAULT_WEAPON_EFFECTS.tracer,
            ...manifest.effects?.tracer,
          },
        };
        const g = manifest.gameplay;
        g.damage = number(g.damage, 34, 1, 500);
        g.headshotMultiplier = number(g.headshotMultiplier, 3, 1, 10);
        g.range = number(g.range, 80, 1, 500);
        g.fireMode = g.fireMode === "auto" ? "auto" : "semi";
        g.rpm = number(g.rpm, 480, 30, 1800);
        g.magazine = Math.round(number(g.magazine, 17, 1, 500));
        g.reserve = Math.round(number(g.reserve, 51, 0, 2000));
        g.reloadSeconds = number(g.reloadSeconds, 1.7, 0.1, 20);
        g.spread.standing = number(g.spread.standing, 0.002, 0, 0.5);
        g.spread.moving = number(g.spread.moving, 0.018, 0, 0.5);
        g.spread.crouched = number(g.spread.crouched, 0.0012, 0, 0.5);
        g.spread.ads = number(g.spread.ads, 0.0008, 0, 0.5);
        manifest.assets = Object.fromEntries(
          Object.entries(manifest.assets).map(([key, value]) => [
            key,
            value ? base + value : undefined,
          ]),
        );
        WEAPONS.set(`${slot}/${id}`, manifest);
        WEAPON_SUMMARIES.push({
          id,
          name: manifest.name,
          slot,
          path: `${slot}/${id}`,
        });
      } catch (error) {
        console.warn(`Skipping invalid weapon package ${slot}/${id}`, error);
      }
    }
  }
}
