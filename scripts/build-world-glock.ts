import {NullEngine,Scene,Vector3} from '@babylonjs/core';
import {loadHeadlessModel} from '../tests/model-helper.js';
import {readGLB,writeGLB,appendData,compactStaticGLB} from './glb-utils.js';
const path=new URL('../client/public/assets/weapons/glock.glb',import.meta.url),{json,binary}=await readGLB(path),chunks=[binary];
const engine=new NullEngine(),scene=new Scene(engine),c=await loadHeadlessModel(path,scene);c.addAllToScene();const clip=c.animationGroups[0];clip.start(true);clip.pause();clip.goToFrame(468);
const sourceNodes=json.nodes,sourceMeshes=json.meshes;json.nodes=[];json.meshes=[];json.scenes=[{nodes:[]}];json.scene=0;delete json.animations;delete json.skins;
for(const mesh of c.meshes.filter(m=>m.name.startsWith('g17_')&&m.getTotalVertices()>0)){
 mesh.computeWorldMatrix(true);const raw=mesh.getVerticesData('position')!,normals=mesh.getVerticesData('normal')!,p:number[]=[],n:number[]=[];
 for(let i=0;i<raw.length;i+=3){const v=Vector3.TransformCoordinates(Vector3.FromArray(raw,i),mesh.getWorldMatrix());p.push(v.x,v.y-.043,-v.z-.165);const normal=Vector3.TransformNormal(Vector3.FromArray(normals,i),mesh.getWorldMatrix()).normalize();n.push(normal.x,normal.y,-normal.z);}
 const position=appendData(json,chunks,p,'VEC3'),normal=appendData(json,chunks,n,'VEC3'),bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};for(let i=0;i<p.length;i++){bounds.min[i%3]=Math.min(bounds.min[i%3],p[i]);bounds.max[i%3]=Math.max(bounds.max[i%3],p[i]);}Object.assign(json.accessors[position],bounds);
 const uv=Array.from(mesh.getVerticesData('uv')!).map((v,i)=>i%2?1-v:v),uvAccessor=appendData(json,chunks,uv,'VEC2');
 const indices=Array.from(mesh.getIndices()!);
 const indexBuffer=Buffer.from(new Uint32Array(indices).buffer),io=chunks.reduce((a,b)=>a+b.length,0);chunks.push(indexBuffer);const iv=json.bufferViews.push({buffer:0,byteOffset:io,byteLength:indexBuffer.length})-1,ia=json.accessors.push({bufferView:iv,componentType:5125,count:indices.length,type:'SCALAR'})-1;
 const original=sourceNodes.find((v:any)=>v.name===mesh.name),material=sourceMeshes[original.mesh].primitives[0].material;
 const mi=json.meshes.push({name:mesh.name,primitives:[{attributes:{POSITION:position,NORMAL:normal,TEXCOORD_0:uvAccessor},indices:ia,material}]})-1;json.scenes[0].nodes.push(json.nodes.push({name:mesh.name,mesh:mi})-1);
}
json.asset.extras={...json.asset.extras,modifications:'Gun-only world model. Arms removed; grip origin; original materials preserved.'};
const bin=compactStaticGLB(json,Buffer.concat(chunks));await writeGLB(new URL('../client/public/assets/weapons/glock-world.glb',import.meta.url),json,bin);scene.dispose();engine.dispose();
