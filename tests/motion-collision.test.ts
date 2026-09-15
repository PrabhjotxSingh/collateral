import {test} from 'node:test';import assert from 'node:assert/strict';
import {ViewmodelMotion,type MotionInput} from '../client/src/viewmodel.js';
import {RULES} from '../shared/rules.js';import {MAPS} from '../shared/maps.js';
import {makeBody,moveBody,resolvePlayerContact,validInput} from '../shared/simulation.js';
import {capsuleOverlapsMap} from '../shared/geometry.js';import {emptyInput} from '../shared/protocol.js';
import {CombatRoom} from '../server/src/CombatRoom.js';import {GameState,PlayerState} from '../server/src/state.js';
const base:MotionInput={yaw:0,pitch:0,vx:0,vy:0,vz:0,grounded:true,crouch:false,ads:false,sprint:false,reloading:false,stepPhase:0,lookActive:true};
function advance(m:ViewmodelMotion,i:MotionInput,seconds:number,fps=60){let pose=m.update(i,1/fps);for(let n=1;n<seconds*fps;n++)pose=m.update(i,1/fps);return pose;}
test('stationary hold has no autonomous loop; mouse lag settles at consistent frame rates',()=>{
 const m=new ViewmodelMotion(),first=m.update(base,1/60),last=advance(m,base,8);assert.deepEqual(first,last);
 m.update({...base,yaw:.2},1/60);const lag=m.update({...base,yaw:.2},1/60);assert.ok(lag.x<first.x);const settled=advance(m,{...base,yaw:.2},2);assert.ok(Math.abs(settled.x-first.x)<1e-5);
 const outcomes=[30,60,120].map(fps=>{const v=new ViewmodelMotion();v.update(base,1/fps);return advance(v,{...base,vx:2,vz:2,ads:true},1,fps);});
 for(const p of outcomes){assert.equal(p.ads,1);assert.ok(Math.abs(p.x-outcomes[0].x)<.001);}
});
test('bob follows footfall phase, strafe blends diagonally, ADS/reload suppress motion',()=>{
 const a=new ViewmodelMotion(),b=new ViewmodelMotion();const moving={...base,vx:2,vz:2,stepPhase:.5};
 const hip=advance(a,moving,2),opposite=advance(b,{...moving,vx:-2},2);assert.ok(hip.roll<0&&opposite.roll>0);assert.ok(hip.x>.18&&opposite.x<.18);
 const standing=advance(new ViewmodelMotion(),{...base,stepPhase:.5},2);assert.ok(hip.y!==standing.y);
 const aim=advance(a,{...moving,ads:true},2);assert.ok(Math.abs(aim.roll)<Math.abs(hip.roll)*.25);
 const reload=advance(a,{...moving,reloading:true},2);assert.ok(Math.abs(reload.roll)<1e-5);assert.ok(Math.abs(reload.y+.17)<1e-5);
 const neutral=advance(a,{...base,stepPhase:.5},2);assert.ok(Math.abs(neutral.x-.18)<1e-5);
});
test('sprint carry stays visible, landing dip is capped, recoil stacks and settles',()=>{
 const m=new ViewmodelMotion(),sprint=advance(m,{...base,sprint:true,vz:5.2},1);assert.equal(sprint.sprint,1);assert.ok(sprint.y<-.19&&sprint.y>-.25);assert.ok(sprint.pitch>.1&&sprint.pitch<.3);
 const one=m.update(base,1/60);assert.ok(one.sprint>0&&one.sprint<1);const raised=advance(m,base,.25);assert.equal(raised.sprint,0);
 m.update({...base,grounded:false,vy:4.3},1/60);assert.ok(m.update({...base,grounded:false,vy:-15},1/60).y<-.17);
 const landing=m.update(base,1/60);assert.ok(landing.y<-.17&&landing.y>-.2);
 advance(m,base,1);m.fire();const single=m.update(base,1/60);m.fire();const stacked=m.update(base,1/60);assert.ok(stacked.z<single.z);for(let i=0;i<30;i++)m.fire();assert.ok(m.update(base,1/60).z>.33);
 const settled=advance(m,base,1);assert.ok(Math.abs(settled.z-.4)<1e-5);
});
test('solid capsules block teammates and opponents, including crouch and jump contacts',()=>{
 const first=makeBody(-1,0),second=makeBody(0,0),floor={...MAPS[0],triangles:undefined,walls:[]};
 for(let i=0;i<240;i++){moveBody(first,{...emptyInput(),strafe:1},1/60,floor);resolvePlayerContact(first,second);}
 assert.ok(second.x-first.x>=RULES.radius*2-.001);second.crouch=true;first.x=-.2;resolvePlayerContact(first,second);assert.ok(Math.abs(first.x-second.x)>=.639);
 const above={...makeBody(0,0),y:1.0,vy:-2,grounded:false};resolvePlayerContact(above,second);assert.ok(above.y>=RULES.crouchHeight-.001);assert.ok(above.grounded);
});
test('complete arena blocks sustained movement at outer walls and cover without tunnelling',()=>{
 for(const spawn of [...MAPS[0].spawns.A,...MAPS[0].spawns.B])for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]){
  const b=makeBody(spawn.x,spawn.z);for(let i=0;i<700;i++)moveBody(b,{...emptyInput(),forward:1,sprint:true,yaw},1/60,MAPS[0]);
  assert.ok(Math.abs(b.x)<23&&Math.abs(b.z)<11&&b.y>-.1,'inside arena floor');assert.equal(capsuleOverlapsMap(b,RULES.height,MAPS[0],.01),false,'capsule stays outside solid surfaces');
 }
});
test('server cancels sprint and enforces raise delay before accepting queued fire',()=>{
 const room=new CombatRoom(),state=new GameState();room.setState(state);state.round=1;
 state.players.set('a',Object.assign(new PlayerState(),{id:'a',team:'A'}));state.players.set('b',Object.assign(new PlayerState(),{id:'b',team:'B'}));
 const sim=room as any;sim.prepRound();state.phase='live';sim.deadline=100;
 const runtime=sim.runtime.get('a'),p=state.players.get('a')!,fake={sessionId:'a'};
 runtime.input={...emptyInput(),forward:1,sprint:true,yaw:Math.PI/2};runtime.received=sim.simTime;sim.tick(1/60);assert.ok(p.sprint);
 sim.fire(fake);assert.equal(p.ammo,17);assert.ok(runtime.queuedFire);sim.tick(1/60);assert.equal(p.sprint,false);
 sim.fire(fake);assert.equal(p.ammo,17,'cannot fire while raising');for(let i=0;i<16;i++)sim.tick(1/60);sim.fire(fake);assert.equal(p.ammo,16);
 assert.equal(validInput({...emptyInput(),sprint:'yes'}),false);
});
test('authoritative room publishes blocked player positions instead of allowing model overlap',()=>{
 const room=new CombatRoom(),state=new GameState();room.setState(state);state.round=1;
 state.players.set('a',Object.assign(new PlayerState(),{id:'a',team:'A'}));state.players.set('b',Object.assign(new PlayerState(),{id:'b',team:'B'}));
 const sim=room as any;sim.prepRound();state.phase='live';sim.deadline=100;
 const moving=sim.runtime.get('a'),still=sim.runtime.get('b');Object.assign(moving.body,makeBody(-20,-7));Object.assign(still.body,makeBody(-19,-7));
 for(let i=0;i<240;i++){moving.input={...emptyInput(),strafe:1,sprint:true};moving.received=sim.simTime;sim.tick(1/60);}
 const a=state.players.get('a')!,b=state.players.get('b')!;assert.ok(b.x-a.x>=.639);assert.ok(a.x>-20);assert.ok(Math.abs(b.x+19)<.001);
});
