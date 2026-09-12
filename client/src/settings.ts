export type Action='forward'|'back'|'left'|'right'|'jump'|'crouch'|'reload'|'fire'|'ads'|'sprint';
export interface Settings {sensitivity:number;fov:number;master:number;sfx:number;keys:Record<Action,string>}
export const defaults:Settings={sensitivity:1,fov:95,master:0.7,sfx:0.8,keys:{forward:'KeyW',back:'KeyS',left:'KeyA',right:'KeyD',jump:'Space',crouch:'KeyC',reload:'KeyR',fire:'Mouse0',ads:'Mouse2',sprint:'ShiftLeft'}};
export function loadSettings():Settings{
  try{const s=JSON.parse(localStorage.getItem('collateral.settings')??'{}');const clamp=(v:unknown,fallback:number,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback;
    const keys={...defaults.keys,...Object.fromEntries(Object.entries(s.keys??{}).filter(([key,value])=>key in defaults.keys&&typeof value==='string'))};
    // Migrate existing installs too; Ctrl/Cmd+W cannot reliably be blocked by a page.
    for(const action of Object.keys(keys) as Action[])if(/^(Control|Meta)/.test(keys[action]))keys[action]=defaults.keys[action];
    if(keys.crouch==='KeyC')for(const action of Object.keys(keys) as Action[])if(action!=='crouch'&&keys[action]==='KeyC')keys[action]=defaults.keys[action];
    return {sensitivity:clamp(s.sensitivity,1,0.1,3),fov:clamp(s.fov,95,80,110),master:clamp(s.master,0.7,0,1),sfx:clamp(s.sfx,0.8,0,1),keys};
  }catch{return structuredClone(defaults);}
}
export function saveSettings(s:Settings){localStorage.setItem('collateral.settings',JSON.stringify(s));}
