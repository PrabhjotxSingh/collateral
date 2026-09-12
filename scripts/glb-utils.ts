import {readFile,writeFile} from 'node:fs/promises';
export async function readGLB(path:URL){const b=await readFile(path),n=b.readUInt32LE(12);return {json:JSON.parse(b.subarray(20,20+n).toString()),binary:b.subarray(28+n)};}
export async function writeGLB(path:URL,json:any,binary:Buffer){
 const j=Buffer.from(JSON.stringify(json)),jl=Math.ceil(j.length/4)*4,bl=Math.ceil(binary.length/4)*4,out=Buffer.alloc(28+jl+bl);
 out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(jl,12);out.writeUInt32LE(0x4e4f534a,16);out.fill(32,20,20+jl);j.copy(out,20);out.writeUInt32LE(bl,20+jl);out.writeUInt32LE(0x004e4942,24+jl);binary.copy(out,28+jl);await writeFile(path,out);
}
export function appendData(json:any,chunks:Buffer[],values:number[],type:string){
 const data=Buffer.from(new Float32Array(values).buffer),offset=chunks.reduce((n,b)=>n+b.length,0);chunks.push(data);
 const view=json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:data.length})-1,components=type==='SCALAR'?1:type==='VEC3'?3:type==='VEC2'?2:4;
 return json.accessors.push({bufferView:view,componentType:5126,count:values.length/components,type,...(type==='SCALAR'?{min:[Math.min(...values)],max:[Math.max(...values)]}:{})})-1;
}
// Prune the extracted static gun's unused arm geometry, skin data and textures.
export function compactStaticGLB(json:any,binary:Buffer){
 const accessors=new Set<number>(),materials=new Set<number>(),textures=new Set<number>(),images=new Set<number>(),views=new Set<number>();
 for(const m of json.meshes)for(const p of m.primitives){Object.values(p.attributes).forEach(v=>accessors.add(v as number));if(p.indices!==undefined)accessors.add(p.indices);if(p.material!==undefined)materials.add(p.material);}
 const remap=(values:Set<number>)=>new Map([...values].sort((a,b)=>a-b).map((v,i)=>[v,i]));
 const ma=remap(materials);json.materials=[...ma.keys()].map(i=>json.materials[i]);
 const visitTextures=(o:any,fn:(o:any)=>void)=>{if(!o||typeof o!=='object')return;for(const [key,value]of Object.entries(o)){if(key.endsWith('Texture')&&value&&typeof value==='object'&&'index' in value)fn(value);else visitTextures(value,fn);}};
 json.materials.forEach((m:any)=>visitTextures(m,o=>textures.add(o.index)));const mt=remap(textures);json.textures=[...mt.keys()].map(i=>json.textures[i]);json.materials.forEach((m:any)=>visitTextures(m,o=>o.index=mt.get(o.index)));
 json.textures.forEach((t:any)=>images.add(t.source));const mi=remap(images);json.images=[...mi.keys()].map(i=>json.images[i]);json.textures.forEach((t:any)=>t.source=mi.get(t.source));
 const ac=remap(accessors);json.accessors=[...ac.keys()].map(i=>json.accessors[i]);json.accessors.forEach((a:any)=>views.add(a.bufferView));json.images.forEach((i:any)=>views.add(i.bufferView));
 for(const m of json.meshes)for(const p of m.primitives){for(const k in p.attributes)p.attributes[k]=ac.get(p.attributes[k]);if(p.indices!==undefined)p.indices=ac.get(p.indices);if(p.material!==undefined)p.material=ma.get(p.material);}
 const bv=remap(views),parts:Buffer[]=[];let offset=0;json.bufferViews=[...bv.keys()].map(i=>{const v=json.bufferViews[i],data=binary.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength),pad=Buffer.alloc((4-data.length%4)%4),out={...v,buffer:0,byteOffset:offset};parts.push(data,pad);offset+=data.length+pad.length;return out;});
 json.accessors.forEach((a:any)=>a.bufferView=bv.get(a.bufferView));json.images.forEach((i:any)=>i.bufferView=bv.get(i.bufferView));json.buffers=[{byteLength:offset}];return Buffer.concat(parts);
}
