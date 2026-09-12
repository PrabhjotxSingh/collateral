import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {AnimationGroup} from '@babylonjs/core';
import {drawPose,DRAW_SECONDS,findClip} from '../client/src/animation.js';

test('draw settles in 0.55 seconds and clamps outside its duration',()=>{
  assert.deepEqual(drawPose(-1),drawPose(0));
  const end=drawPose(DRAW_SECONDS);
  assert.equal(end.done,true);
  assert.ok(Math.abs(end.y)<1e-10);
  assert.equal(end.pitch,0);
  assert.ok(Math.abs(end.z)<1e-10);
  assert.deepEqual(drawPose(5),end);
  let previous=-Infinity;
  for(let i=0;i<=100;i++){
    const pose=drawPose(DRAW_SECONDS*i/100);
    assert.ok(pose.y>=previous);previous=pose.y;
  }
});

test('named animation aliases do not play an arbitrary showcase timeline',()=>{
  const groups=[{name:'Armature|Equip'},{name:'Reload_Empty'},{name:'Take 001'}] as AnimationGroup[];
  assert.equal(findClip(groups,'draw'),groups[0]);
  assert.equal(findClip(groups,'reload'),groups[1]);
  assert.equal(findClip(groups,'idle'),undefined);
});
