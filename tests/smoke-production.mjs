import {spawn} from 'node:child_process';
import {readdir,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const child=spawn(process.execPath,['dist/server/src/index.js'],{cwd:'server',env:{...process.env,PORT:'2569'},stdio:['ignore','pipe','inherit']});
try{
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Production server did not start')),10000);child.stdout.on('data',data=>{if(String(data).includes('listening')){clearTimeout(t);resolve();}});child.on('exit',code=>{if(code)reject(new Error(`Exit ${code}`));});});
  const response=await fetch('http://127.0.0.1:2569/');assert.equal(response.status,200);const html=await response.text();assert.ok(html.includes('<title>Collateral</title>'));
  for(const match of html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)){const response=await fetch(`http://127.0.0.1:2569${match[1]}`);assert.equal(response.status,200,match[1]);}
  const wasm=(await readdir('client/dist/assets')).find(name=>name.endsWith('.wasm'));assert.ok(wasm);
  const bytes=await(await fetch(`http://127.0.0.1:2569/assets/${wasm}`)).arrayBuffer();assert.equal(new DataView(bytes).getUint32(0,true),0x6d736100);
  assert.equal((await(await fetch('http://127.0.0.1:2569/api/health')).json()).ok,true);
  for(const path of ['weapons/glock.glb','characters/player.glb','maps/depot.glb','menu/operator.glb']){
    const response=await fetch(`http://127.0.0.1:2569/assets/${path}`);assert.equal(response.status,200,path);
    const served=Buffer.from(await response.arrayBuffer());assert.equal(served.readUInt32LE(0),0x46546c67,path);
    assert.deepEqual(served,await readFile(`client/public/assets/${path}`),'served model must match bundled bytes');
  }
  for(const path of ['sounds/glock-shot.ogg','sounds/reload.ogg']){
    const response=await fetch(`http://127.0.0.1:2569/assets/${path}`);assert.equal(response.status,200,path);
    const served=Buffer.from(await response.arrayBuffer());assert.equal(served.subarray(0,4).toString(),'OggS');
    assert.deepEqual(served,await readFile(`client/public/assets/${path}`));
  }
  console.log('PASS: production serves app, all four model/map assets and both complete Ogg sound files.');
}finally{child.kill('SIGTERM');const t=setTimeout(()=>child.kill('SIGKILL'),1500);t.unref();}
