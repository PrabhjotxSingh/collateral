import {Scene,Engine,ArcRotateCamera,HemisphericLight,DirectionalLight,Vector3,Color3,Color4,Mesh,MeshBuilder,StandardMaterial,TransformNode} from '@babylonjs/core';
import {Assets,type AssetInstance} from './assets';
import {DEFAULT_GRIP,GRIP_KEY,parseGrip,storedGrip,type GripProfile,applyGrip} from './grip';
import {RULES} from '../../shared/rules.js';
import type {GameView,ShotEvent} from '../../shared/protocol.js';
import type {ClipAction} from './animation';
import './dev-tools.css';

/** Local visual diagnostics. Never sends positions, damage or grip settings to the server. */
export class DevTools {
 readonly available=import.meta.env.DEV||new URLSearchParams(location.search).get('dev')==='1';
 private panel?:HTMLElement;private profile=storedGrip();private boxes=new Map<string,Mesh[]>();private marks:Mesh[]=[];
 private boxMaterial?:StandardMaterial;private headMaterial?:StandardMaterial;private capsuleMaterial?:StandardMaterial;private markMaterials:StandardMaterial[]=[];
 private preview?:{engine:Engine;scene:Scene;actor?:AssetInstance};private open=false;private showBoxes=false;private showImpacts=false;
 private status?:HTMLElement;private timing?:HTMLElement;private output?:HTMLTextAreaElement;private last=performance.now();private peak=0;private shotStart=0;private shotPeak=0;
 constructor(private scene:Scene,private actors:()=>Iterable<AssetInstance>){
  if(!this.available)return;
  window.addEventListener('keydown',e=>{if(e.code==='F2'){e.preventDefault();this.toggle();}});
  this.build();
 }
 private apply(){for(const actor of this.actors())if(actor.grip)applyGrip(actor.grip,this.profile);if(this.preview?.actor?.grip)applyGrip(this.preview.actor.grip,this.profile);try{localStorage.setItem(GRIP_KEY,JSON.stringify(this.profile));}catch{}if(this.output)this.output.value=JSON.stringify(this.profile,null,2);}
 private build(){
  const panel=this.panel=document.createElement('aside');panel.id='collateral-dev';panel.hidden=true;
  panel.innerHTML='<header><strong>COLLATERAL / DEV</strong><button data-close>Close · F2</button></header><p>Local diagnostics. Grip changes affect the third-person Glock only.</p><canvas aria-label="SWAT grip preview"></canvas><small>Drag to orbit · scroll to zoom. Available without another player.</small><div data-poses></div><div data-fields></div><div class="dev-actions"><button data-copy>Copy settings</button><button data-import>Apply JSON</button><button data-reset>Reset grip</button></div><textarea aria-label="Shareable Glock grip settings" spellcheck="false"></textarea><label><input type="checkbox" data-boxes> Hit volumes + collision capsules</label><label><input type="checkbox" data-impacts> Server shot rays + impact markers</label><button data-clear>Clear impacts</button><small>Yellow: server hit box · red: headshot band · cyan: movement capsule. Snapshot positions may differ slightly from smoothed visuals.</small><p data-status>F2 opens/closes this panel; Escape releases the game mouse.</p><output data-timing></output>';
  document.body.append(panel);this.status=panel.querySelector('[data-status]')!;this.timing=panel.querySelector('[data-timing]')!;this.output=panel.querySelector('textarea')!;
  panel.querySelector('[data-close]')!.addEventListener('click',()=>this.toggle());
  const fields=panel.querySelector('[data-fields]')!;
  for(const key of ['x','y','z','pitch','yaw','roll','scale'] as const){
   const label=document.createElement('label');label.textContent=key+(['x','y','z'].includes(key)?' (m)':key==='scale'?'':' (°)');
   const input=document.createElement('input');input.type='number';input.dataset.key=key;input.step=key==='scale'?'.01':['x','y','z'].includes(key)?'.001':'1';
   input.min=key==='scale'?'.25':['x','y','z'].includes(key)?'-.5':'-180';input.max=key==='scale'?'2':['x','y','z'].includes(key)?'.5':'180';input.value=String(this.profile[key]);
   input.addEventListener('input',()=>{try{this.profile=parseGrip({...this.profile,[key]:input.valueAsNumber});this.apply();this.status!.textContent='Saved locally. Copy settings and send the JSON back.';}catch(e){this.status!.textContent=String(e);}});label.append(input);fields.append(label);
  }
  const refresh=()=>{panel.querySelectorAll<HTMLInputElement>('[data-key]').forEach(input=>input.value=String(this.profile[input.dataset.key as keyof GripProfile]));this.apply();};
  panel.querySelector('[data-copy]')!.addEventListener('click',async()=>{this.output!.select();try{await navigator.clipboard.writeText(this.output!.value);this.status!.textContent='Copied. Paste these values into our chat.';}catch{this.status!.textContent='Text selected. Press Ctrl+C to copy.';}});
  panel.querySelector('[data-import]')!.addEventListener('click',()=>{try{this.profile=parseGrip(JSON.parse(this.output!.value));refresh();this.status!.textContent='Profile applied.';}catch(e){this.status!.textContent=String(e);}});
  panel.querySelector('[data-reset]')!.addEventListener('click',()=>{this.profile={...DEFAULT_GRIP};refresh();});
  panel.querySelector<HTMLInputElement>('[data-boxes]')!.onchange=e=>{this.showBoxes=(e.target as HTMLInputElement).checked;};
  panel.querySelector<HTMLInputElement>('[data-impacts]')!.onchange=e=>{this.showImpacts=(e.target as HTMLInputElement).checked;if(!this.showImpacts)this.clearMarks();};
  panel.querySelector('[data-clear]')!.addEventListener('click',()=>this.clearMarks());
  for(const action of ['idle','walk','crouch','jump','death'] as ClipAction[]){const button=document.createElement('button');button.textContent=action;button.onclick=()=>this.preview?.actor?.clips.play(action,action!=='death'&&action!=='jump');panel.querySelector('[data-poses]')!.append(button);}
  refresh();
 }
 private toggle(){if(!this.panel)return;this.open=!this.open;this.panel.hidden=!this.open;if(this.open){document.exitPointerLock();void this.ensurePreview();}}
 private async ensurePreview(){
  if(this.preview){this.preview.engine.resize();return;}
  const canvas=this.panel!.querySelector('canvas')!,engine=new Engine(canvas,true),scene=new Scene(engine);scene.clearColor=new Color4(.055,.065,.075,1);
  const camera=new ArcRotateCamera('grip-camera',Math.PI/3,Math.PI/2.5,1.4,new Vector3(0,1.35,.3),scene);camera.lowerRadiusLimit=.25;camera.upperRadiusLimit=4;camera.minZ=.015;camera.wheelPrecision=80;camera.attachControl(canvas,true);
  new HemisphericLight('fill',Vector3.Up(),scene).intensity=.85;const sun=new DirectionalLight('key',new Vector3(-1,-1,-1),scene);sun.intensity=1.4;
  const preview=this.preview={engine,scene,actor:undefined as AssetInstance|undefined};engine.resize();
  engine.runRenderLoop(()=>{if(this.open){preview.actor?.clips.tick(Math.min(engine.getDeltaTime()/1000,.05));scene.render();}});
  const root=new TransformNode('grip-preview',scene);
  try{preview.actor=await new Assets(scene).instance('/assets/characters/player.glb',root,undefined,{characterHeight:1.8})??undefined;this.apply();if(!preview.actor)this.status!.textContent='Preview could not load. Check the asset files.';}catch(e){this.status!.textContent='Preview failed: '+String(e);}
 }
 private wire(name:string,color:Color3){const m=new StandardMaterial(name,this.scene);m.disableLighting=true;m.emissiveColor=color;m.wireframe=true;return m;}
 tick(state:GameView|undefined){
  if(!this.available)return;
  const now=performance.now(),dt=now-this.last;this.last=now;this.peak=Math.max(this.peak,dt);
  if(now-this.shotStart<1000)this.shotPeak=Math.max(this.shotPeak,dt);
  if(this.open&&this.timing)this.timing.textContent='Frame '+dt.toFixed(1)+' ms · peak '+this.peak.toFixed(1)+' ms · last shot window '+this.shotPeak.toFixed(1)+' ms';
  const live=new Set<string>();
  if(this.showBoxes&&state)for(const p of Object.values(state.players)){
   if(!p.connected||p.health<=0)continue;live.add(p.id);
   let meshes=this.boxes.get(p.id);
   if(!meshes){this.boxMaterial??=this.wire('debug-hit',new Color3(1,.85,.1));this.headMaterial??=this.wire('debug-head',new Color3(1,.15,.12));this.capsuleMaterial??=this.wire('debug-capsule',new Color3(.1,.8,1));
    const body=MeshBuilder.CreateBox('server-hit-'+p.id,{size:1},this.scene),head=MeshBuilder.CreateBox('head-band-'+p.id,{size:1},this.scene);
    const standing=MeshBuilder.CreateCapsule('collision-standing-'+p.id,{height:RULES.height,radius:RULES.radius},this.scene),crouched=MeshBuilder.CreateCapsule('collision-crouched-'+p.id,{height:RULES.crouchHeight,radius:RULES.radius},this.scene);
    body.material=this.boxMaterial;head.material=this.headMaterial;standing.material=crouched.material=this.capsuleMaterial;
    meshes=[body,head,standing,crouched];meshes.forEach(m=>{m.isPickable=false;m.receiveShadows=false;});this.boxes.set(p.id,meshes);
   }
   const h=p.crouch?RULES.crouchHeight:RULES.height;
   meshes[0].scaling.set(RULES.radius*2,h,RULES.radius*2);meshes[0].position.set(p.x,p.y+h/2,p.z);meshes[0].setEnabled(true);
   meshes[1].scaling.set(RULES.radius*2,.3,RULES.radius*2);meshes[1].position.set(p.x,p.y+h-.15,p.z);meshes[1].setEnabled(true);
   meshes[2].position.set(p.x,p.y+RULES.height/2,p.z);meshes[2].setEnabled(!p.crouch);
   meshes[3].position.set(p.x,p.y+RULES.crouchHeight/2,p.z);meshes[3].setEnabled(p.crouch);
  }
  for(const [id,meshes]of this.boxes)if(!live.has(id)){meshes.forEach(m=>m.dispose());this.boxes.delete(id);}
 }
 shotStarted(){if(this.available){this.shotStart=performance.now();this.shotPeak=0;}}
 shot(shot:ShotEvent){
  if(!this.available||!this.showImpacts)return;
  const start=new Vector3(shot.x,shot.y,shot.z),end=start.add(new Vector3(shot.dx,shot.dy,shot.dz).scale(shot.distance));
  const ray=MeshBuilder.CreateLines('server-shot',{points:[start,end]},this.scene);ray.color=new Color3(.1,.85,1);ray.isPickable=false;this.marks.push(ray);
  if(shot.distance<RULES.maxRange-.01){
   const marker=MeshBuilder.CreateSphere('server-impact',{diameter:.055,segments:6},this.scene);marker.position.copyFrom(end);marker.isPickable=false;
   const index=shot.hit?1:0;this.markMaterials[index]??=this.wire('debug-impact-'+index,shot.hit?new Color3(1,.1,.1):new Color3(1,.85,.1));marker.material=this.markMaterials[index];this.marks.push(marker);
  }
  while(this.marks.length>40)this.marks.shift()!.dispose();
  if(this.status)this.status.textContent='Server impact '+[end.x,end.y,end.z].map(v=>v.toFixed(3)).join(', ')+' · '+(shot.hit?shot.headshot?'head hit':'body hit':shot.distance>=RULES.maxRange-.01?'max range':'surface / blocked');
 }
 private clearMarks(){this.marks.forEach(m=>m.dispose());this.marks=[];}
 reset(){this.clearMarks();this.boxes.forEach(ms=>ms.forEach(m=>m.dispose()));this.boxes.clear();this.peak=0;}
}
