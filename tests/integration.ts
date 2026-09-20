import assert from 'node:assert/strict';
import { Client, type Room } from 'colyseus.js';
const endpoint=process.env.TEST_SERVER??'ws://127.0.0.1:2567';
const client=new Client(endpoint),identities:Room[]=[],matches:Room[]=[];
const suffix=Date.now().toString(36);
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(fn:()=>boolean,label:string){for(let i=0;i<100;i++){if(fn())return;await pause(40);}throw new Error(`Timeout: ${label}`);}
async function identity(name:string){const room=await client.create('session',{username:name});identities.push(room);room.onMessage('lobbies',()=>{});const auth=await new Promise<{username:string;token:string}>(resolve=>room.onMessage('identity',resolve));return auth;}
try {
  const users:{username:string;token:string}[]=[];for(let i=0;i<4;i++)users.push(await identity(`Test${i}_${suffix}`));
  await assert.rejects(()=>client.create('session',{username:users[0].username.toUpperCase()}),/in use/);
  const lobby=await client.create('tactical',{name:'Integration lobby',password:'secret',token:users[0].token});matches.push(lobby);
  const errors:string[]=[];lobby.onMessage('error',m=>errors.push(m));
  lobby.send('start');await until(()=>errors.length===1,'start requires opposing teams');assert.match(errors[0],/on each team/);
  await assert.rejects(()=>client.joinById(lobby.roomId,{token:users[1].token,password:'wrong'}),/Incorrect lobby password/);
  for(let i=1;i<4;i++){const r=await client.joinById(lobby.roomId,{token:users[i].token,password:'secret'});r.onMessage('error',()=>{});matches.push(r);}
  for(const r of matches){r.onMessage('step',()=>{});r.onMessage('reload',()=>{});r.onMessage('shot',()=>{});}
  await until(()=>lobby.state?.players?.size===4,'four players synchronized');
  assert.equal([...lobby.state.players.values()].filter((p:any)=>p.team==='A').length,2);
  lobby.send('team','B');await until(()=>lobby.state.players.get(lobby.sessionId).team==='B','uneven team switch allowed');lobby.send('team','A');await until(()=>lobby.state.players.get(lobby.sessionId).team==='A','host switches back');
  let listing:any[]=[];identities[0].onMessage('lobbies',m=>listing=m);identities[0].send('list');await until(()=>listing.some(l=>l.roomId===lobby.roomId),'live browser listing');
  assert.equal(listing.find(l=>l.roomId===lobby.roomId).locked,true);
  assert.ok(!JSON.stringify(listing).includes('secret'),'password absent from directory');
  const guest=matches[3];const reconnectToken=guest.reconnectionToken;
  guest.connection.close(4001);
  await until(()=>!lobby.state.players.get(guest.sessionId).connected,'dropped session reserved');
  const resumed=await client.reconnect(reconnectToken);matches[3]=resumed;resumed.onMessage('error',()=>{});resumed.onMessage('step',()=>{});resumed.onMessage('shot',()=>{});resumed.onMessage('reload',()=>{});
  await until(()=>lobby.state.players.get(guest.sessionId).connected,'same player reconnects');assert.equal(resumed.sessionId,guest.sessionId);
  lobby.send('start');await until(()=>lobby.state.phase==='prep','match start');
  await until(()=>listing.some(l=>l.roomId===lobby.roomId&&l.status==='in-game'),'in-game room remains joinable');
  const lateUser=await identity(`Late_${suffix}`),late=await client.joinById(lobby.roomId,{token:lateUser.token,password:'secret',team:'B'});matches.push(late);
  await until(()=>lobby.state.players.has(late.sessionId),'late player joins running match');assert.equal(lobby.state.players.get(late.sessionId).team,'B');assert.equal(lobby.state.players.get(late.sessionId).health,0);
  console.log('PASS: username uniqueness, private password validation, joinable live directory, uneven team switching, reconnect and four-human start.');
  const duelUsers=[await identity(`DuelA_${suffix}`),await identity(`DuelB_${suffix}`)];
  const duel=await client.create('tactical',{name:'1v1 integration',token:duelUsers[0].token});matches.push(duel);
  const duelErrors:string[]=[];duel.onMessage('error',m=>duelErrors.push(m));
  const opponent=await client.joinById(duel.roomId,{token:duelUsers[1].token});matches.push(opponent);
  const guestErrors:string[]=[];opponent.onMessage('error',m=>guestErrors.push(m));
  for(const r of [duel,opponent])for(const event of ['shot','step','reload'])r.onMessage(event,()=>{});
  await until(()=>duel.state?.players?.size===2,'two joined');assert.notEqual(duel.state.players.get(duel.sessionId).team,duel.state.players.get(opponent.sessionId).team);
  opponent.send('start');await until(()=>guestErrors.length===1,'guest cannot start');assert.match(guestErrors[0],/Only the host/);
  duel.send('start');await until(()=>duel.state.phase==='prep','host starts 1v1');assert.equal(duel.state.players.size,2);
  console.log('PASS: 1v1 starts only with opposing teams and host authorization.');
  const releaseName=`Release_${suffix}`,releaseAuth=await identity(releaseName),releaseRoom=identities.at(-1)!;
  await releaseRoom.leave();const replacement=await identity(releaseName.toUpperCase());assert.notEqual(replacement.token,releaseAuth.token);
  const oldToken=releaseAuth.token;await assert.rejects(()=>client.create('tactical',{name:'stale',token:oldToken}),/Connect with a username first/);
  const dropped=await identity(`Dropped_${suffix}`),dropRoom=identities.at(-1)!;dropRoom.connection.close(4001);
  let newOwner:any;await until(()=>!dropRoom.connection.isOpen,'identity transport closed');
  for(let i=0;i<20&&!newOwner;i++){try{newOwner=await identity(dropped.username);}catch{await pause(40);}}
  assert.ok(newOwner,'callsign immediately reusable after server detects disconnect');
  console.log('PASS: callsigns release on leave/drop, and old tokens cannot create lobbies.');
  const backUser=await identity(`Back_${suffix}`),back=await client.create('tactical',{name:'Back test',token:backUser.token});await back.leave();
  await assert.rejects(()=>client.create('session',{username:backUser.username}),/in use/);
  const again=await client.create('tactical',{name:'Back again',token:backUser.token});matches.push(again);
  console.log('PASS: leaving a lobby keeps the menu identity and permits another lobby without re-entering callsign.');

  const sandboxUser=await identity(`Sandbox_${suffix}`),sandbox=await client.create('tactical',{name:'Dev sandbox',token:sandboxUser.token,devSolo:true,mapId:'sandy'});matches.push(sandbox);
  for(const event of ['shot','step','reload'])sandbox.onMessage(event,()=>{});
  await until(()=>sandbox.state?.phase==='live','single-player sandbox starts');
  assert.equal(sandbox.state.mapId,'sandy');assert.equal(sandbox.state.remaining,0);assert.match(sandbox.state.reason,/UNLIMITED TIME/);
  const sandboxPlayer=sandbox.state.players.get(sandbox.sessionId),sandboxStart=sandboxPlayer.z;
  for(let i=0;i<10;i++){sandbox.send('input',{seq:i+1,forward:1,strafe:0,yaw:0,pitch:0,jump:false,crouch:false,ads:false,sprint:false});await pause(35);}
  assert.ok(sandboxPlayer.z>sandboxStart,'sandbox uses authoritative movement');
  console.log('PASS: development sandbox launches a selected map with one player and unlimited time.');

  if(process.env.TEST_COMBAT==='1'){
    await pause(6500);await until(()=>lobby.state.phase==='live','prep becomes live');
    const me=lobby.state.players.get(lobby.sessionId);const startZ=me.z;
    for(let i=0;i<12;i++){lobby.send('input',{seq:i+1,forward:1,strafe:0,yaw:0,pitch:0,jump:false,crouch:false,ads:false});await pause(35);}
    assert.ok(me.z>startZ+0.5,'server integrates movement');
    await pause(400);const stoppedZ=me.z;await pause(300);assert.ok(Math.abs(me.z-stoppedZ)<0.02,'stale movement stops after input timeout');
    const x=me.x;lobby.send('input',{seq:99,forward:1,strafe:0,yaw:NaN,pitch:0,jump:false,crouch:false,ads:false,x:999});await pause(100);assert.ok(Number.isFinite(me.x)&&Math.abs(me.x-x)<1,'invalid input cannot teleport');
    const ammo=me.ammo;for(let i=0;i<15;i++)lobby.send('fire');await pause(150);assert.equal(me.ammo,ammo-1,'server limits fire cadence');
    lobby.send('reload');await pause(2000);assert.equal(me.ammo,17,'manual reload completes');assert.equal(me.reserve,50);
    const acknowledgements:any[]=[];lobby.onMessage('shot',event=>acknowledgements.push(event));lobby.onMessage('fire-rejected',()=>{});
    lobby.send('fire',{shotId:77,yaw:1,pitch:0});await until(()=>acknowledgements.some(s=>s.shotId===77),'shot acknowledgement');
    const shot=acknowledgements.find(s=>s.shotId===77);assert.ok(Math.abs(shot.dx-Math.sin(1))<.06,'uses trigger-time aim');
    console.log('PASS: shot IDs acknowledge prediction and the server uses trigger-time aim.');
    await matches[2].leave();await matches[3].leave();await until(()=>lobby.state.scoreA===1,'elimination on opposing disconnect');
    console.log('PASS: timed prep, authoritative movement, invalid input, fire cadence, reload and elimination.');
  }
} finally {await Promise.allSettled(matches.filter(r=>r.connection.isOpen).map(r=>r.leave()));await Promise.allSettled(identities.filter(r=>r.connection.isOpen).map(r=>r.leave()));}
