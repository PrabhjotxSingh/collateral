import type { Team } from './rules.js';
import {DEPOT_OFFSET_Y,DEPOT_TRIANGLES} from './depot-geometry.js';
export interface Box {x:number; y:number; z:number; w:number; h:number; d:number}
export interface Spawn {x:number;y?:number;z:number;yaw:number}
export interface MapLight {id:string;type:'point';x:number;y:number;z:number;color:string;intensity:number;range:number}
export interface MapSkybox {preset:'blue-day'|'overcast'|'night'|'custom';asset?:string}
export interface MapSun {enabled:boolean;x:number;y:number;z:number;color:string;intensity:number}
export const SUN_INTENSITIES=[.4,.8,1.2,2.1,2.8] as const;
export interface GameMap {version?:1;id:string;name:string;asset:string;walls:Box[];triangles?:number[][];offsetY?:number;scale?:number;bounds?:{minX:number;maxX:number;minZ:number;maxZ:number};spawns:Record<Team,Spawn[]>;lights?:MapLight[];skybox?:MapSkybox;sun?:MapSun}
// Metres, Babylon left-handed coordinates. Render transform and collision bake
// share the same offset. Original neon arena layout and all materials preserved.
export const MAPS:GameMap[]=[{version:1,id:'depot',name:'Depot — Neon Arena',asset:'/assets/maps/depot.glb',walls:[],triangles:DEPOT_TRIANGLES,offsetY:DEPOT_OFFSET_Y,scale:1,bounds:{minX:-23.007,maxX:23.007,minZ:-11.079,maxZ:11.079},spawns:{A:[{x:-19,y:0,z:-7,yaw:Math.PI/2},{x:-19,y:0,z:7,yaw:Math.PI/2}],B:[{x:19,y:0,z:7,yaw:-Math.PI/2},{x:19,y:0,z:-7,yaw:-Math.PI/2}]},lights:[],skybox:{preset:'blue-day'}}];
export function installMaps(maps:GameMap[]){if(!maps.length)return;MAPS.splice(0,MAPS.length,...maps);}
export const mapById=(id:string)=>MAPS.find(m=>m.id===id)??MAPS[0];
export const ASSETS={glock:'/assets/weapons/glock.glb',player:'/assets/characters/player.glb',shot:'/assets/sounds/glock-shot.ogg',hit:'/assets/sounds/hitmarker.mp3',step:'/assets/sounds/footstep.ogg',reload:'/assets/sounds/reload.ogg',empty:'/assets/sounds/empty-clip.mp3'};
