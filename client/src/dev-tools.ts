import {Scene,Engine,ArcRotateCamera,HemisphericLight,DirectionalLight,Vector3,Color3,Color4,Mesh,MeshBuilder,StandardMaterial,TransformNode} from '@babylonjs/core';
import {Assets,type AssetInstance} from './assets';
import {DEFAULT_GRIP,parseGrip,storedGrip,type GripProfile,applyGrip} from './grip';
import {RULES} from '../../shared/rules.js';
import type {GameView,ShotEvent} from '../../shared/protocol.js';
import type {ClipAction} from './animation';
import type {Network} from './network';
import './dev-tools.css';

/** Local visual diagnostics. Never sends positions, damage or grip settings to the server. */
export class DevTools {
 readonly available=import.meta.env.DEV||new URLSearchParams(location.search).get('dev')==='1';
 private panel?:HTMLElement;private profile=storedGrip();private boxes=new Map<string,Mesh[]>();private marks:Mesh[]=[];
 private boxMaterial?:StandardMaterial;private headMaterial?:StandardMaterial;private capsuleMaterial?:StandardMaterial;private markMaterials:StandardMaterial[]=[];
 private preview?:{engine:Engine;scene:Scene;actor?:AssetInstance};private open=false;private showBoxes=false;private showImpacts=false;
 private status?:HTMLElement;private timing?:HTMLElement;private output?:HTMLTextAreaElement;private last=performance.now();private peak=0;private shotStart=0;private shotPeak=0;
 constructor(private scene:Scene,private actors:()=>Iterable<AssetInstance>,private network:Network){
  if(!this.available)return;
  window.addEventListener('keydown',e=>{if(e.code==='F2'){e.preventDefault();this.toggle();}});
  this.build();
 }
 private apply(){for(const actor of this.actors())if(actor.grip)applyGrip(actor.grip,this.profile);if(this.preview?.actor?.grip)applyGrip(this.preview.actor.grip,this.profile);if(this.output)this.output.value=JSON.stringify(this.profile,null,2);}
 private build(){
  const panel=this.panel=document.createElement('aside');panel.id='collateral-dev';panel.hidden=true;
  panel.innerHTML='<header><strong>COLLATERAL / DEV</strong><button data-close>Close · F2</button></header><nav class="dev-tabs"><button data-tab="camera" class="active">Third-person camera</button><button data-tab="sandbox">Sandbox</button><button data-tab="collision">Collision</button><button data-tab="performance">Performance</button></nav><section data-panel="camera"><h3>THIRD-PERSON CAMERA</h3><p>Preview the live player from behind without changing authoritative gameplay.</p><label><input type="checkbox" data-third-person> Enable third-person camera</label><label>Distance <input type="range" min="1.5" max="6" step=".1" value="3.2" data-camera-distance></label><label>Height <input type="range" min="0" max="2" step=".05" value=".65" data-camera-height></label><small>Session-only development view. Disabled in production builds.</small></section><section data-panel="sandbox" hidden><h3>SINGLE-PLAYER MAP TEST</h3><p>Launch one player with unlimited time. Server collision, movement and weapons remain active.</p><label>Map<select data-sandbox-map></select></label><button data-launch-sandbox>Launch sandbox</button><small>Choose a callsign first. Sandbox rooms are development-only.</small></section><section data-panel="collision" hidden><label><input type="checkbox" data-boxes> Hit volumes + collision capsules</label><label><input type="checkbox" data-impacts> Server shot rays + impact markers</label><button data-clear>Clear impacts</button><small>Yellow: body · red: head · cyan: movement capsule.</small></section><section data-panel="performance" hidden><p>Live rendering timing and first-shot hitch diagnostics.</p><output data-timing></output></section><p data-status>F2 opens/closes this panel; Escape releases the game mouse.</p>';
  document.body.append(panel);this.status=panel.querySelector('[data-status]')!;this.timing=panel.querySelector('[data-timing]')!;
  panel.querySelector('[data-close]')!.addEventListener('click',()=>this.toggle());
  panel.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(tab=>tab.onclick=()=>{panel.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===tab));panel.querySelectorAll<HTMLElement>('[data-panel]').forEach(x=>x.hidden=x.dataset.panel!==tab.dataset.tab);if(tab.dataset.tab==='sandbox')void this.refreshSandboxMaps();});
  const cameraEvent=()=>window.dispatchEvent(new CustomEvent('dev-third-person',{detail:{enabled:panel.querySelector<HTMLInputElement>('[data-third-person]')!.checked,distance:panel.querySelector<HTMLInputElement>('[data-camera-distance]')!.valueAsNumber,height:panel.querySelector<HTMLInputElement>('[data-camera-height]')!.valueAsNumber}}));
  panel.querySelectorAll<HTMLInputElement>('[data-third-person],[data-camera-distance],[data-camera-height]').forEach(input=>input.addEventListener('input',cameraEvent));
  panel.querySelector<HTMLInputElement>('[data-boxes]')!.onchange=e=>{this.showBoxes=(e.target as HTMLInputElement).checked;};
  panel.querySelector<HTMLInputElement>('[data-impacts]')!.onchange=e=>{this.showImpacts=(e.target as HTMLInputElement).checked;if(!this.showImpacts)this.clearMarks();};
  panel.querySelector('[data-clear]')!.addEventListener('click',()=>this.clearMarks());
  panel.querySelector('[data-launch-sandbox]')!.addEventListener('click',async()=>{const map=(panel.querySelector('[data-sandbox-map]') as HTMLSelectElement).value;try{this.status!.textContent='Launching single-player sandbox…';await this.network.startDevSolo(map);this.toggle();}catch(e){this.status!.textContent=(e as Error).message;}});
 }
 private async refreshSandboxMaps(){if(!this.panel)return;const select=this.panel.querySelector('[data-sandbox-map]') as HTMLSelectElement;select.disabled=true;select.innerHTML='<option>Loading installed maps…</option>';try{const maps=await this.network.refreshMaps();select.innerHTML=maps.length?maps.map(map=>`<option value="${map.id}">${map.name}</option>`).join(''):'<option value="">No installed maps found</option>';select.disabled=!maps.length;}catch(e){select.innerHTML='<option value="">Map list unavailable</option>';this.status!.textContent=(e as Error).message;} }
 private toggle(){if(!this.panel)return;this.open=!this.open;this.panel.hidden=!this.open;if(this.open){document.exitPointerLock();void this.refreshSandboxMaps();}}
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
  if(this.open&&this.timing)this.timing.textContent='FPS '+(1000/Math.max(1,dt)).toFixed(0)+' · frame '+dt.toFixed(1)+' ms · peak '+this.peak.toFixed(1)+' ms · last shot window '+this.shotPeak.toFixed(1)+' ms';
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
   const bodyHeight=Math.max(.1,h-RULES.headHeight-RULES.headTopInset);
   meshes[0].scaling.set(RULES.radius*2,bodyHeight,RULES.radius*2);meshes[0].position.set(p.x,p.y+bodyHeight/2,p.z);meshes[0].setEnabled(true);
   meshes[1].scaling.set(RULES.headRadius*2,RULES.headHeight,RULES.headRadius*2);meshes[1].position.set(p.x,p.y+h-RULES.headTopInset-RULES.headHeight/2,p.z);meshes[1].setEnabled(true);
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
