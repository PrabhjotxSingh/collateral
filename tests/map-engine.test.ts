import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateMap} from '../server/src/map-registry.js';

const packageData={version:1,id:'yard',name:'Training Yard',asset:'map.glb',walls:[],triangles:[[0,0,0,1,0,0,0,0,1]],scale:1,offsetY:0,bounds:{minX:0,maxX:1,minZ:0,maxZ:1},spawns:{A:[{x:0,y:0,z:0,yaw:0},{x:1,y:0,z:0,yaw:0}],B:[{x:0,y:0,z:1,yaw:3.14},{x:1,y:0,z:1,yaw:3.14}]},lights:[{id:'light-1',type:'point',x:0,y:2,z:0,color:'#ffffff',intensity:2,range:8}]};

test('map-engine packages validate and server owns their public asset path',()=>{
 const map=validateMap(packageData,'yard');assert.equal(map.asset,'/maps/yard/map.glb');assert.equal(map.spawns.A.length,2);assert.equal(map.lights?.length,1);
 assert.throws(()=>validateMap({...packageData,spawns:{A:[],B:[]}},'bad-map'),/spawns/i);
 assert.throws(()=>validateMap({...packageData,triangles:[]},'bad-map'),/collision/i);
 assert.throws(()=>validateMap(packageData,'../escape'),/id/i);
});
