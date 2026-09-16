import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {MAPS,installMaps,type GameMap} from '../../shared/maps.js';

const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value);
export function validateMap(value:unknown,idFromFolder?:string):GameMap{
  const m=value as Partial<GameMap>,id=idFromFolder??m.id;
  if(m.version!==1||typeof id!=='string'||!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id))throw new Error('Invalid map id/version');
  if(typeof m.name!=='string'||!m.name.trim()||m.name.length>60)throw new Error(`Invalid name for ${id}`);
  if(!m.spawns||!Array.isArray(m.spawns.A)||!Array.isArray(m.spawns.B)||m.spawns.A.length<1||m.spawns.B.length<1||m.spawns.A.length>5||m.spawns.B.length>5)throw new Error(`${id} needs one to five spawns per team`);
  for(const spawn of [...m.spawns.A,...m.spawns.B])if(!finite(spawn.x)||!finite(spawn.y??0)||!finite(spawn.z)||!finite(spawn.yaw))throw new Error(`Invalid spawn in ${id}`);
  if(!Array.isArray(m.triangles)||!m.triangles.length||m.triangles.length>2_000_000||m.triangles.some(t=>!Array.isArray(t)||t.length!==9||t.some(n=>!finite(n))))throw new Error(`${id} needs valid baked collision triangles`);
  const lights=Array.isArray(m.lights)?m.lights:[];
  if(lights.length>128||lights.some(l=>l.type!=='point'||![l.x,l.y,l.z,l.intensity,l.range].every(finite)||typeof l.color!=='string'))throw new Error(`Invalid lights in ${id}`);
  const preset=m.skybox?.preset??'blue-day';if(!['blue-day','overcast','night','custom'].includes(preset))throw new Error(`Invalid skybox in ${id}`);
  const sun=m.sun;
  if(sun&&(![sun.x,sun.y,sun.z,sun.intensity].every(finite)||typeof sun.color!=='string'||typeof sun.enabled!=='boolean'))throw new Error(`Invalid sun in ${id}`);
  const kingZone=m.kingZone;
  if(kingZone&&(![kingZone.x,kingZone.y,kingZone.z,kingZone.radius,kingZone.height].every(finite)||kingZone.radius<.5||kingZone.radius>100||kingZone.height<.5||kingZone.height>20))throw new Error(`Invalid king-of-the-hill zone in ${id}`);
  return {...m,id,name:m.name.trim(),asset:`/maps/${id}/map.glb`,walls:[],scale:finite(m.scale)?m.scale:1,offsetX:finite(m.offsetX)?m.offsetX:0,offsetY:finite(m.offsetY)?m.offsetY:0,offsetZ:finite(m.offsetZ)?m.offsetZ:0,rotationY:finite(m.rotationY)?m.rotationY:0,lights,skybox:{preset,asset:preset==='custom'?`/maps/${id}/skybox.env`:undefined},sun,kingZone} as GameMap;
}

export function loadInstalledMaps(root:string){
  const loaded:GameMap[]=[];
  if(existsSync(root))for(const entry of readdirSync(root,{withFileTypes:true}))if(entry.isDirectory())try{
    const folder=resolve(root,entry.name),manifest=validateMap(JSON.parse(readFileSync(resolve(folder,'map.json'),'utf8')),entry.name);
    if(!existsSync(resolve(folder,'map.glb')))throw new Error('map.glb is missing');if(manifest.skybox?.preset==='custom'&&!existsSync(resolve(folder,'skybox.env')))throw new Error('skybox.env is missing');loaded.push(manifest);
  }catch(error){console.warn(`Skipping map ${entry.name}:`,(error as Error).message);}
  if(loaded.length)installMaps(loaded.sort((a,b)=>a.name.localeCompare(b.name)));
  return MAPS;
}
