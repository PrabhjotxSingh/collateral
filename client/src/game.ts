import {DevTools} from './dev-tools';
import {daylight} from './lighting';
import {Engine,Scene,Camera,UniversalCamera,Vector3,Matrix,ShadowGenerator,MeshBuilder,StandardMaterial,ShaderMaterial,Color3,Color4,Mesh,TransformNode,VertexData,PointLight,CubeTexture,BaseTexture} from '@babylonjs/core';
import {mapById,ASSETS} from '../../shared/maps.js';
import {rayMap} from '../../shared/geometry.js';
import {rayBox} from '../../shared/simulation.js';
import {RULES} from '../../shared/rules.js';
import type {GameView,PlayerView,ShotEvent} from '../../shared/protocol.js';
import type {Network} from './network';
import type {Settings,Action} from './settings';
import {Assets,type AssetInstance} from './assets';
import {drawPose,DRAW_SECONDS,type ClipAction} from './animation';
import {TacticalAudio} from './audio';
import {ViewmodelMotion} from './viewmodel';
import {CosmeticPhysics} from './physics';
import {ShotEffects} from './shot-effects';
import {ShotPrediction} from './shot-prediction';
export class Game {
  readonly engine:Engine;readonly scene:Scene;readonly camera:UniversalCamera;
  private shadows:ShadowGenerator;
  private players=new Map<string,Mesh>();private keys=new Set<string>();private mapId='';private environment:Mesh[]=[];
  private mapLights:PointLight[]=[];
  private sky:Mesh;private skyMaterial:ShaderMaterial;private customSky?:Mesh;private customEnvironment?:BaseTexture;private defaultEnvironment?:BaseTexture;
  private yaw=0;private pitch=0;private seq=0;private elapsed=0;private lastRound=0;private state?:GameView;private gun:Mesh;
  settings:Settings;active=false;private spectatorId='';private assets:Assets;private audio:TacticalAudio;private physics:CosmeticPhysics;private mapModel?:TransformNode;private kick=0;
  private motion=new ViewmodelMotion();private cancelSprint=false;private lastPoseAds=0;private actorPhases=new Map<string,number>();private actorDead=new Set<string>();
  private weapon?:AssetInstance;private actorAssets=new Map<string,AssetInstance>();private drawElapsed=DRAW_SECONDS;private bakedDraw=false;private reloadWasActive=false;private shotAnimRemaining=0;
  private dev:DevTools;private effects:ShotEffects;private prediction=new ShotPrediction();private fireRequested=false;private lastSprintPose=0;private actorReloading=new Set<string>();
  private nameTags=new Map<string,HTMLDivElement>();private tags=document.createElement('div');private damageShake=0;private crouchedActors=new Set<string>();
  constructor(private canvas:HTMLCanvasElement,private network:Network,settings:Settings){
    this.settings=settings;this.engine=new Engine(canvas,true);this.scene=new Scene(this.engine);this.scene.clearColor=new Color4(0.065,0.077,0.084,1);
    this.scene.fogMode=Scene.FOGMODE_LINEAR;this.scene.fogStart=45;this.scene.fogEnd=115;this.scene.fogColor=new Color3(.67,.81,.94);
    this.camera=new UniversalCamera('eyes',new Vector3(0,2,-14),this.scene);this.camera.minZ=0.05;this.camera.maxZ=120;this.camera.fovMode=Camera.FOVMODE_HORIZONTAL_FIXED;this.camera.fov=settings.fov*Math.PI/180;
    const sky=this.sky=MeshBuilder.CreateSphere('map-sky',{diameter:180,segments:24},this.scene);sky.infiniteDistance=true;sky.isPickable=false;sky.applyFog=false;
    const skyMaterial=this.skyMaterial=new ShaderMaterial('sky-gradient',this.scene,{vertexSource:'precision highp float;attribute vec3 position;uniform mat4 worldViewProjection;varying float elevation;void main(){elevation=max(0.0,position.y/90.0);gl_Position=worldViewProjection*vec4(position,1.0);}',fragmentSource:'precision highp float;varying float elevation;uniform vec3 horizonColor;uniform vec3 topColor;void main(){gl_FragColor=vec4(mix(horizonColor,topColor,pow(elevation,.65)),1.0);}'},{attributes:['position'],uniforms:['worldViewProjection','horizonColor','topColor']});skyMaterial.backFaceCulling=false;skyMaterial.setColor3('horizonColor',new Color3(.72,.85,.98));skyMaterial.setColor3('topColor',new Color3(.12,.43,.86));sky.material=skyMaterial;
    this.shadows=daylight(this.scene,this.camera);this.defaultEnvironment=this.scene.environmentTexture??undefined;
    this.gun=MeshBuilder.CreateBox('glock-placeholder',{width:0.08,height:0.12,depth:0.3},this.scene);this.gun.parent=this.camera;this.gun.position.set(0.18,-0.17,0.4);this.gun.material=this.material('gun',new Color3(0.12,0.13,0.14));
    this.assets=new Assets(this.scene);this.audio=new TacticalAudio(()=>this.settings);this.physics=new CosmeticPhysics(this.scene);
    this.effects=new ShotEffects(this.scene);this.dev=new DevTools(this.scene,()=>this.actorAssets.values());this.tags.id='name-tags';document.body.append(this.tags);
    this.scene.setRenderingAutoClearDepthStencil(1,true,true,true);
    void this.assets.instance(ASSETS.glock,this.gun,this.gun,{weapon:true}).then(asset=>{this.weapon=asset??undefined;if(this.active)this.beginDraw();});
    network.addEventListener('shot',e=>this.shot((e as CustomEvent<ShotEvent>).detail));
    network.addEventListener('fire-rejected',e=>this.prediction.acknowledge((e as CustomEvent).detail.shotId));
    network.addEventListener('step',e=>{const step=(e as CustomEvent).detail;this.audio.play('step',step,step.volume??1);});
    network.addEventListener('reload',e=>this.audio.play('reload',(e as CustomEvent).detail));
    window.addEventListener('resize',()=>this.engine.resize());
    window.addEventListener('keydown',e=>{if(e.code==='F2'&&this.dev.available)return;if(!this.locked)return;e.preventDefault();if(!this.keys.has(e.code))this.press(e.code);this.keys.add(e.code);});
    window.addEventListener('keyup',e=>this.keys.delete(e.code));
    window.addEventListener('blur',()=>this.keys.clear());
    document.addEventListener('pointerlockchange',()=>{this.keys.clear();window.dispatchEvent(new Event('game-lock'));});
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    canvas.addEventListener('mousedown',e=>{void this.audio.unlock();if(!this.locked){if(this.active)void canvas.requestPointerLock();return;}const key=`Mouse${e.button}`;this.press(key);this.keys.add(key);});
    window.addEventListener('mouseup',e=>this.keys.delete(`Mouse${e.button}`));
    window.addEventListener('mousemove',e=>{if(!this.locked||!this.active)return;const me=this.state?.players[this.network.match?.sessionId??''];if(!me||me.health<=0)return;const factor=0.002*this.settings.sensitivity*(this.held('ads')?0.72:1);this.yaw=(this.yaw+e.movementX*factor)%(Math.PI*2);this.pitch=Math.max(-1.5,Math.min(1.5,this.pitch+e.movementY*factor));});
    this.engine.runRenderLoop(()=>{this.frame(Math.min(this.engine.getDeltaTime()/1000,0.05));this.scene.render();});
  }
  get locked(){return document.pointerLockElement===this.canvas;}
  enter(){void this.audio.unlock();void this.canvas.requestPointerLock();}
  private held(action:Action){return this.keys.has(this.settings.keys[action]);}
  private press(key:string){if(this.drawElapsed<DRAW_SECONDS)return;if(key===this.settings.keys.fire){this.cancelSprint=true;this.fireRequested=true;this.tryFire();}if(key===this.settings.keys.reload){this.fireRequested=false;this.network.send('reload');}}
  private tryFire(){
    const me=this.state?.players[this.network.match?.sessionId??''];if(!this.fireRequested||!me)return;
    if(me.sprint||this.lastSprintPose>.02)return;this.fireRequested=false;
    if(!this.active||!this.locked||this.state?.phase!=='live'||me.health<=0||me.reloading||this.drawElapsed<DRAW_SECONDS)return;
    const shotId=this.prediction.request(performance.now(),me.ammo);if(shotId===undefined)return;
    this.localShot();this.network.send('fire',{shotId,yaw:this.yaw,pitch:this.pitch});
  }
  private localShot(){
    this.dev.shotStarted();
    this.audio.play('shot');this.motion.fire();this.weapon?.clips.play('fire',false,RULES.shotSeconds);this.shotAnimRemaining=RULES.shotSeconds;this.kick=Math.min(.06,this.kick+.025);
    this.effects.muzzle(this.weapon?.muzzle,this.camera.position.add(this.camera.getDirection(Vector3.Forward()).scale(.6)),true);void this.physics.casing(this.camera.position.add(new Vector3(.15,-.15,.15)),this.yaw);
  }
  private beginDraw(){this.prediction.reset();this.fireRequested=false;this.motion.reset();this.cancelSprint=false;this.drawElapsed=0;this.bakedDraw=this.weapon?.clips.play('draw',false,DRAW_SECONDS)??false;}
  private material(name:string,color:Color3){const m=new StandardMaterial(name,this.scene);m.diffuseColor=color;m.specularColor=new Color3(0.08,0.08,0.08);return m;}
  private loadMap(id:string){
    document.body.classList.add('map-loading');const label=document.querySelector('#loading-label');if(label)label.textContent='PREPARING MAP';
    this.mapId=id;this.mapModel?.dispose();for(const mesh of this.environment)mesh.dispose();this.environment=[];for(const light of this.mapLights)light.dispose();this.mapLights=[];
    const map=mapById(id);
    this.applySkybox(map.skybox?.preset??'blue-day',map.skybox?.asset);
    if(map.triangles){
      // The same baked surface used by the server also supplies a safe fallback
      // and Havok casing collision; no obsolete greybox walls remain.
      const mesh=new Mesh('map-collision-surface',this.scene),data=new VertexData();
      data.positions=map.triangles.flat();data.indices=Array.from({length:data.positions.length/3},(_,i)=>i);const normals:number[]=[];VertexData.ComputeNormals(data.positions,data.indices,normals);data.normals=normals;data.applyToMesh(mesh);
      const mat=this.material('map-fallback',new Color3(.3,.32,.34));mat.backFaceCulling=false;mesh.material=mat;this.environment.push(mesh);
      void this.physics.setMap([mesh],true);
    }else{
      for(const [i,w]of map.walls.entries()){const mesh=MeshBuilder.CreateBox(`cover-${i}`,{width:w.w,height:w.h,depth:w.d},this.scene);mesh.position.set(w.x,w.y,w.z);this.environment.push(mesh);}
      void this.physics.setMap(this.environment);
    }
    const root=this.mapModel=new TransformNode('map-model',this.scene);root.position.y=map.offsetY??0;root.scaling.setAll(map.scale??1);const placeholders=[...this.environment];
    for(const source of map.lights??[]){const light=new PointLight(`map-light-${source.id}`,new Vector3(source.x,source.y,source.z),this.scene);light.diffuse=Color3.FromHexString(source.color);light.intensity=source.intensity;light.range=source.range;this.mapLights.push(light);}
    void this.assets.instance(map.asset,root).then(async loaded=>{
      await this.effects.ready.catch(()=>{});
      if(loaded){
        for(const mesh of placeholders)if(!mesh.isDisposed())mesh.isVisible=false;
        for(const mesh of root.getChildMeshes()){mesh.receiveShadows=true;this.shadows.addShadowCaster(mesh,false);mesh.onDisposeObservable.addOnce(()=>this.shadows.removeShadowCaster(mesh,false));}
      }
    }).finally(()=>{document.body.classList.remove('map-loading');if(label)label.textContent='INITIALIZING COLLATERAL';});
  }
  private applySkybox(preset:'blue-day'|'overcast'|'night'|'custom',asset?:string){
    this.customSky?.dispose();this.customSky=undefined;this.customEnvironment?.dispose();this.customEnvironment=undefined;this.scene.environmentTexture=this.defaultEnvironment??null;this.sky.setEnabled(true);
    const colors=preset==='night'?{h:new Color3(.035,.06,.13),t:new Color3(.005,.012,.04),fog:new Color3(.07,.1,.16)}:preset==='overcast'?{h:new Color3(.63,.67,.7),t:new Color3(.28,.33,.38),fog:new Color3(.52,.57,.61)}:{h:new Color3(.72,.85,.98),t:new Color3(.12,.43,.86),fog:new Color3(.67,.81,.94)};
    this.skyMaterial.setColor3('horizonColor',colors.h);this.skyMaterial.setColor3('topColor',colors.t);this.scene.fogColor=colors.fog;
    if(preset==='custom'&&asset){const texture=this.customEnvironment=CubeTexture.CreateFromPrefilteredData(asset,this.scene);this.scene.environmentTexture=texture;this.customSky=this.scene.createDefaultSkybox(texture,true,180)??undefined;this.sky.setEnabled(false);}
  }
  update(state:GameView){
    this.state=state;this.active=!['waiting','finished','abandoned'].includes(state.phase);
    if(state.phase==='waiting')return;
    if(this.mapId!==state.mapId)this.loadMap(state.mapId);
    const me=state.players[this.network.match?.sessionId??''];
    if(me&&state.round!==this.lastRound){this.lastRound=state.round;this.yaw=me.yaw;this.pitch=0;this.seq=Math.max(this.seq,me.ack);this.kick=0;this.reloadWasActive=false;this.shotAnimRemaining=0;this.beginDraw();this.actorPhases.clear();this.actorReloading.clear();this.actorDead.clear();for(const actor of this.actorAssets.values()){actor.clips.play('idle');actor.combat?.stop();}this.camera.position.set(me.x,me.y+RULES.eyeHeight,me.z);}
    for(const p of Object.values(state.players)){
      if(!this.players.has(p.id)){
        const mesh=MeshBuilder.CreateCapsule(p.id,{height:RULES.height,radius:RULES.radius},this.scene);
        mesh.material=this.material(p.id,p.team==='A'?new Color3(0.35,0.62,0.67):new Color3(0.85,0.44,0.2));
        mesh.position.set(p.x,p.y+RULES.height/2,p.z);this.players.set(p.id,mesh);
        const root=new TransformNode(`${p.id}-model`,this.scene);root.parent=mesh;root.position.y=-RULES.height/2;
        void this.assets.instance(ASSETS.player,root,undefined,{characterHeight:RULES.height}).then(loaded=>{
          if(!loaded)return;
          if(mesh.isDisposed()||this.players.get(p.id)!==mesh){loaded.dispose();return;}
          mesh.isVisible=false;this.actorAssets.set(p.id,loaded);
          for(const part of root.getChildMeshes()){
            part.receiveShadows=true;this.shadows.addShadowCaster(part,false);
            part.onDisposeObservable.addOnce(()=>this.shadows.removeShadowCaster(part,false));
          }
        });
      }
    }
  }
  private frame(dt:number){
    this.dev.tick(this.active?this.state:undefined);
    if(!this.state||!this.active){this.gun.setEnabled(false);document.body.classList.remove('is-ads');for(const tag of this.nameTags.values())tag.hidden=true;return;}
    const me=this.state.players[this.network.match?.sessionId??''];if(!me)return;
    const wasDrawing=this.drawElapsed<DRAW_SECONDS;this.drawElapsed=Math.min(DRAW_SECONDS,this.drawElapsed+dt);
    if(wasDrawing&&this.drawElapsed===DRAW_SECONDS)this.weapon?.clips.play('idle');
    if(me.reloading&&!this.reloadWasActive)this.weapon?.clips.play('reload',false,RULES.reloadSeconds);
    if(!me.reloading&&this.reloadWasActive)this.weapon?.clips.play('idle');this.reloadWasActive=me.reloading;
    if(this.shotAnimRemaining>0){this.shotAnimRemaining-=dt;if(this.shotAnimRemaining<=0&&!me.reloading)this.weapon?.clips.play('idle');}
    this.weapon?.clips.tick(dt);
    if(!this.held('sprint'))this.cancelSprint=false;
    const sprint=this.state.phase==='live'&&this.locked&&this.held('sprint')&&!this.cancelSprint&&!this.held('ads')&&!this.held('crouch')&&!me.reloading&&this.held('forward');
    this.elapsed+=dt;
    if(this.elapsed>=1/30){this.elapsed=0;this.network.send('input',{seq:++this.seq,forward:this.locked?Number(this.held('forward'))-Number(this.held('back')):0,strafe:this.locked?Number(this.held('right'))-Number(this.held('left')):0,yaw:this.yaw,pitch:this.pitch,jump:this.locked&&this.held('jump'),crouch:this.locked&&this.held('crouch'),ads:this.locked&&this.held('ads'),sprint});}
    const target=me.health>0?me:Object.values(this.state.players).find(p=>p.team===me.team&&p.health>0&&p.connected);
    this.kick*=Math.exp(-12*dt);this.damageShake*=Math.exp(-10*dt);
    if(target){this.camera.position=Vector3.Lerp(this.camera.position,new Vector3(target.x,target.y+(target.crouch?RULES.crouchEyeHeight:RULES.eyeHeight),target.z),1-Math.exp(-18*dt));const local=target.id===me.id;this.camera.rotation.set(local?this.pitch-this.kick+Math.sin(performance.now()*.06)*this.damageShake*.01:target.pitch,local?this.yaw+Math.cos(performance.now()*.047)*this.damageShake*.008:target.yaw,0);}
    this.audio.listener(this.camera.position,this.camera.rotation.y,this.camera.rotation.x);
    for(const [id,mesh]of this.players){
      const p=this.state.players[id];if(!p)continue;
      const actor=this.actorAssets.get(id);
      const dead=p.health<=0;
      if(dead&&actor&&!this.actorDead.has(id)){this.actorDead.add(id);actor.combat?.stop();actor.clips.play('death',false);}
      if(!dead&&this.actorDead.delete(id))actor?.clips.play('idle');
      mesh.setEnabled(p.connected&&id!==me.id&&id!==target?.id&&(!dead||this.actorDead.has(id)));
      const dx=p.x-mesh.position.x,dz=p.z-mesh.position.z;
      const moving=p.grounded&&Math.hypot(p.vx,p.vz)>.12;
      const forward=p.vx*Math.sin(p.yaw)+p.vz*Math.cos(p.yaw),strafe=p.vx*Math.cos(p.yaw)-p.vz*Math.sin(p.yaw);
      let action:ClipAction='idle';
      if(moving)action=Math.abs(strafe)>Math.abs(forward)?strafe>0?'strafeRight':'strafeLeft':forward<0?'walkBackward':'walk';
      if(p.sprint&&moving)action='run';
      if(p.crouch&&actor?.clips.has('crouch'))action=moving?'crouchWalk':'crouch';
      if(!p.grounded)action='jump';
      if(actor&&!actor.clips.has(action))action='idle';
      if(!dead){
        const enteredCrouch=p.crouch&&!this.crouchedActors.has(id);if(p.crouch)this.crouchedActors.add(id);else this.crouchedActors.delete(id);
        actor?.clips.play(action);if(enteredCrouch)actor?.clips.tick(.08);
        if(p.reloading){if(!this.actorReloading.has(id)){this.actorReloading.add(id);actor?.combat?.play('reload',false,RULES.reloadSeconds);}}else if(this.actorReloading.delete(id))actor?.combat?.stop();
      }
      // Two authoritative footfalls per full walk cycle; identical phase drives
      // viewmodel bob and server-emitted footsteps, including ADS/crouch speeds.
      const phase=(this.actorPhases.get(id)??p.stepPhase)+(p.stepPhase-(this.actorPhases.get(id)??p.stepPhase))*(1-Math.exp(-24*dt));this.actorPhases.set(id,phase);
      if(action==='jump'&&!dead)actor?.clips.phase(Math.max(.05,Math.min(.95,.5-(p.vy??0)/12)));
      if(moving&&!dead)actor?.clips.phase((phase/2)%1);
      actor?.clips.tick(dt);actor?.combat?.tick(dt);
      const h=p.crouch?RULES.crouchHeight:RULES.height;
      // Crouch is skeletal; do not squash the soldier's entire body.
      const scale=actor?1:h/RULES.height;
      mesh.scaling.y+=(scale-mesh.scaling.y)*(1-Math.exp(-18*dt));mesh.position=Vector3.Lerp(mesh.position,new Vector3(p.x,p.y+mesh.scaling.y*RULES.height/2,p.z),1-Math.exp(-18*dt));mesh.rotation.y=p.yaw;
    }
    const motion=this.motion.update({yaw:this.yaw,pitch:this.pitch,vx:me.vx??0,vy:me.vy??0,vz:me.vz??0,grounded:me.grounded??true,crouch:me.crouch,ads:me.health>0&&this.locked&&this.held('ads'),sprint,reloading:me.reloading,stepPhase:me.stepPhase??0,lookActive:this.locked},dt);
    this.lastPoseAds=motion.ads;document.body.classList.toggle('is-ads',me.health>0&&(this.held('ads')||motion.ads>.01));this.camera.fov=this.settings.fov*(1-.18*motion.ads)*Math.PI/180;
    const pose=drawPose(this.bakedDraw?DRAW_SECONDS:this.drawElapsed);
    this.gun.setEnabled(me.health>0);this.gun.position.set(motion.x+pose.x,motion.y+pose.y,motion.z+pose.z);
    this.gun.rotation.set(motion.pitch+pose.pitch+(me.reloading&&!this.weapon?.clips.has('reload')?-.65:0),motion.yaw,motion.roll+pose.roll);
    this.lastSprintPose=motion.sprint;this.tryFire();
    const speed=Math.hypot(me.vx??0,me.vz??0),gap=this.settings.crosshairGap+(this.settings.crosshairMode==='dynamic'?Math.min(13,speed*1.4+(!me.grounded?6:0)+this.kick*80):0);document.documentElement.style.setProperty('--crosshair-gap',`${gap.toFixed(1)}px`);
    this.updateNameTags(me,target);

  }
  private shot(shot:ShotEvent){
    this.dev.shot(shot);
    if(!this.active)return;
    const local=shot.id===this.network.match?.sessionId,origin=new Vector3(shot.x,shot.y,shot.z),direction=new Vector3(shot.dx,shot.dy,shot.dz),end=origin.add(direction.scale(shot.distance));
    const actor=this.actorAssets.get(shot.id),muzzle=local?this.weapon?.muzzle:actor?.muzzle;
    if(local){if(!this.prediction.acknowledge(shot.shotId))this.localShot();if(shot.hit)window.dispatchEvent(new CustomEvent('game-hit',{detail:{headshot:shot.headshot,killed:!!shot.killed}}));}
    else{this.audio.play('shot',shot);this.effects.muzzle(muzzle,origin);actor?.combat?.play('fire',false,RULES.shotSeconds);}
    const me=this.state?.players[this.network.match?.sessionId??''];if(!local&&me&&shot.targetId===me.id){const bearing=Math.atan2(shot.x-me.x,shot.z-me.z)-this.yaw;this.damageShake=1;window.dispatchEvent(new CustomEvent('game-damage',{detail:bearing*180/Math.PI}));}
    muzzle?.computeWorldMatrix(true);const start=muzzle?.getAbsolutePosition().clone()??origin;
    if(shot.distance>.65&&Vector3.Dot(end.subtract(start),direction)>0)this.effects.tracer(start,end);if(shot.distance<RULES.maxRange-.01)this.effects.impact(end,direction,shot.hit);
  }
  private updateNameTags(me:PlayerView,target?:PlayerView){
    const viewport=this.camera.viewport.toGlobal(this.engine.getRenderWidth(),this.engine.getRenderHeight()),visible=new Set<string>(),map=mapById(this.state!.mapId);
    for(const p of Object.values(this.state?.players??{})){if(p.id===me.id||p.id===target?.id||!p.connected||p.health<=0)continue;const height=p.crouch?RULES.crouchHeight:RULES.height,point=new Vector3(p.x,p.y+height+.18,p.z),to=point.subtract(this.camera.position);if(Vector3.Dot(to,this.camera.getForwardRay().direction)<=0)continue;
      // A tag is revealed only when at least one meaningful body point has
      // unobstructed line of sight through the authoritative map geometry.
      const seen=[.22,.56,.88].some(f=>{const sample=new Vector3(p.x,p.y+height*f,p.z),ray=sample.subtract(this.camera.position),distance=ray.length(),direction=ray.scale(1/distance);let obstruction=rayMap(this.camera.position,direction,map,distance);for(const wall of map.walls)obstruction=Math.min(obstruction,rayBox(this.camera.position,direction,wall));return obstruction>=distance-.06;});
      if(!seen)continue;const screen=Vector3.Project(point,Matrix.IdentityReadOnly,this.scene.getTransformMatrix(),viewport);if(screen.z<0||screen.z>1)continue;let tag=this.nameTags.get(p.id);if(!tag){tag=document.createElement('div');this.tags.append(tag);this.nameTags.set(p.id,tag);}tag.className=`name-tag ${p.team===me.team?'friendly':'enemy'}`;tag.textContent=p.username;tag.style.transform=`translate(${screen.x}px,${screen.y}px) translate(-50%,-100%)`;visible.add(p.id);}
    for(const [id,tag]of this.nameTags)tag.hidden=!visible.has(id);
  }
  reset(){this.dev.reset();document.body.classList.remove('is-ads');this.active=false;this.state=undefined;this.lastRound=0;this.keys.clear();for(const mesh of this.players.values())mesh.dispose();this.players.clear();this.actorAssets.clear();this.actorPhases.clear();this.actorDead.clear();this.actorReloading.clear();this.crouchedActors.clear();for(const tag of this.nameTags.values())tag.remove();this.nameTags.clear();this.prediction.reset();this.fireRequested=false;this.effects.clear();this.motion.reset();if(this.locked)document.exitPointerLock();}
}
