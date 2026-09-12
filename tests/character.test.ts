import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {NullEngine,Scene,LoadAssetContainerAsync,TransformNode} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import {fitCharacter} from '../client/src/assets.js';
import {findClip} from '../client/src/animation.js';

test('bundled soldier loads, clones independent skeletons, fits 1.8m and exposes idle',async()=>{
  const bytes=await readFile(new URL('../client/public/assets/characters/player.glb',import.meta.url));
  const jsonLength=bytes.readUInt32LE(12);
  const gltf=JSON.parse(bytes.subarray(20,20+jsonLength).toString());
  assert.ok(Math.max(...gltf.skins.map((s:any)=>s.joints.length))>=40);
  assert.deepEqual(gltf.animations.map((a:any)=>a.name),['idle','walk','walkBackward','strafeLeft','strafeRight','run','jump','crouch','crouchWalk','death']);
  assert.ok(gltf.images.every((image:any)=>image.bufferView!==undefined));
  // Headless check: retain the actual geometry/rig/animations but skip image decoding.
  for(const mesh of gltf.meshes)for(const primitive of mesh.primitives)delete primitive.material;
  delete gltf.materials;delete gltf.textures;delete gltf.images;
  const binary=bytes.subarray(20+jsonLength+8);
  gltf.buffers[0].uri='data:application/octet-stream;base64,'+binary.toString('base64');
  const engine=new NullEngine();const scene=new Scene(engine);
  try{
    const container=await LoadAssetContainerAsync('data:'+JSON.stringify(gltf),scene,{pluginExtension:'.gltf'});
    assert.ok(findClip(container.animationGroups,'idle'));
    const first=container.instantiateModelsToScene(n=>'first-'+n,false,{doNotInstantiate:true});
    const second=container.instantiateModelsToScene(n=>'second-'+n,false,{doNotInstantiate:true});
    assert.notEqual(first.skeletons[0],second.skeletons[0]);
    const root=new TransformNode('fit',scene);for(const node of first.rootNodes)node.parent=root;
    first.animationGroups[0].start(true);first.animationGroups[0].goToFrame(0);
    const fit=fitCharacter(root,1.8);
    const foot=root.getChildTransformNodes().find(n=>n.name.endsWith('mixamorig:LeftFoot'))!;
    const toe=root.getChildTransformNodes().find(n=>n.name.endsWith('mixamorig:LeftToeBase'))!;
    foot.computeWorldMatrix(true);toe.computeWorldMatrix(true);
    assert.ok(Math.abs(toe.getAbsolutePosition().z-foot.getAbsolutePosition().z)>.01,'forward toe chain');
    assert.ok(fit.scale>0&&fit.scale<100);
    root.computeWorldMatrix(true);for(const mesh of root.getChildMeshes())mesh.computeWorldMatrix(true);
    const bounds=root.getHierarchyBoundingVectors(true);
    assert.ok(Math.abs(bounds.min.y)<0.001,`feet ${bounds.min.y}`);
    assert.ok(Math.abs(bounds.max.y-1.8)<0.001,`height ${bounds.max.y}`);
    assert.ok(bounds.max.x-bounds.min.x<.9,'standing body is not stretched sideways');
    console.log('Soldier fit:',fit.scale,'bounds',bounds.min.asArray(),bounds.max.asArray());
    first.dispose();second.dispose();container.dispose();
  }finally{scene.dispose();engine.dispose();}
});
