import {readFile} from 'node:fs/promises';
import {LoadAssetContainerAsync,type Scene} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
export async function loadHeadlessModel(path:URL,scene:Scene){
  const bytes=await readFile(path);const length=bytes.readUInt32LE(12);
  const gltf=JSON.parse(bytes.subarray(20,20+length).toString());
  for(const mesh of gltf.meshes)for(const primitive of mesh.primitives)delete primitive.material;
  delete gltf.materials;delete gltf.textures;delete gltf.images;
  gltf.buffers[0].uri='data:application/octet-stream;base64,'+bytes.subarray(28+length).toString('base64');
  return LoadAssetContainerAsync('data:'+JSON.stringify(gltf),scene,{pluginExtension:'.gltf'});
}
