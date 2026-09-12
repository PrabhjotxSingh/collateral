import {Scene,Mesh,MeshBuilder,StandardMaterial,DynamicTexture,Color3,Vector3,Quaternion,PointLight,Material,TransformNode} from '@babylonjs/core';
export function tracerSegment(distance:number,age:number){const head=Math.min(distance,.45+age*350),tail=Math.max(0,head-1.25);return {head,tail,alpha:Math.max(0,1-Math.max(0,age-distance/350)/.035)};}
interface Effect {age:number;life:number;tick:(age:number)=>void;dispose:()=>void}
export class ShotEffects {
 readonly ready:Promise<void>;private light:PointLight;private lightAge=1;
 private effects:Effect[]=[];private flash:DynamicTexture;private soft:DynamicTexture;
 constructor(private scene:Scene){this.soft=this.texture(false);this.flash=this.texture(true);
 this.light=new PointLight('persistent-shot-light',Vector3.Zero(),scene);this.light.diffuse=new Color3(1,.72,.35);this.light.range=2.5;this.light.intensity=0;
 this.ready=this.warmup();void this.ready.catch(error=>console.warn('Effect warmup failed',error));
 scene.onBeforeRenderObservable.add(()=>this.update(Math.min(scene.getEngine().getDeltaTime()/1000,.05)));scene.onDisposeObservable.addOnce(()=>{this.clear();this.flash.dispose();this.soft.dispose();this.light.dispose();});}
 private async warmup(){
  const mesh=MeshBuilder.CreatePlane('effect-warmup',{size:.01},this.scene);mesh.isVisible=false;mesh.applyFog=false;mesh.billboardMode=Mesh.BILLBOARDMODE_ALL;
  const materials=[this.material('warm-flash',Color3.White(),this.flash),this.material('warm-smoke',Color3.White(),this.soft),this.material('warm-tracer',Color3.White())];
  try{for(const m of materials){mesh.billboardMode=m===materials[2]?Mesh.BILLBOARDMODE_NONE:Mesh.BILLBOARDMODE_ALL;mesh.material=m;await m.forceCompilationAsync(mesh);}}finally{mesh.dispose();materials.forEach(m=>m.dispose());}
 }
 private texture(flame:boolean){
  const t=new DynamicTexture(flame?'muzzle-flame':'soft-particle',128,this.scene,false);t.hasAlpha=true;const ctx=t.getContext(),gradient=ctx.createRadialGradient(64,64,0,64,64,62);
  gradient.addColorStop(0,'rgba(255,255,235,1)');gradient.addColorStop(.18,flame?'rgba(255,230,150,.95)':'rgba(255,255,255,.7)');gradient.addColorStop(.48,flame?'rgba(255,140,35,.35)':'rgba(255,255,255,.3)');gradient.addColorStop(1,'rgba(255,255,255,0)');ctx.clearRect(0,0,128,128);ctx.fillStyle=gradient;
  if(flame){ctx.save();ctx.translate(64,64);ctx.scale(1,.42);ctx.translate(-64,-64);ctx.beginPath();ctx.arc(64,64,61,0,Math.PI*2);ctx.fill();ctx.restore();}else ctx.fillRect(0,0,128,128);t.update();return t;
 }
 private material(name:string,color:Color3,texture?:DynamicTexture){const m=new StandardMaterial(name,this.scene);m.disableLighting=true;m.emissiveColor=color;m.diffuseColor=color;m.backFaceCulling=false;m.disableDepthWrite=true;m.transparencyMode=Material.MATERIAL_ALPHABLEND;if(texture){m.diffuseTexture=texture;m.opacityTexture=texture;}return m;}
 private add(e:Effect){this.effects.push(e);while(this.effects.length>100)this.effects.shift()!.dispose();e.tick(0);}
 muzzle(anchor:TransformNode|undefined,fallback:Vector3,local=false){
  anchor?.computeWorldMatrix(true);const position=anchor?.getAbsolutePosition().clone()??fallback,flash=MeshBuilder.CreatePlane('muzzle-flash',{size:local?.115:.16},this.scene);flash.position.copyFrom(position);flash.billboardMode=Mesh.BILLBOARDMODE_ALL;flash.isPickable=false;flash.applyFog=false;flash.renderingGroupId=local?1:0;
  const mat=this.material('muzzle-emission',new Color3(1,.82,.48),this.flash);flash.material=mat;flash.rotation.z=(Math.random()-.5)*.2;const light=this.light;this.lightAge=0;light.position.copyFrom(position);light.intensity=.75;
  this.add({age:0,life:.032,tick:t=>{mat.alpha=1-t/.032;if(anchor&&!anchor.isDisposed()){anchor.computeWorldMatrix(true);flash.position.copyFrom(anchor.getAbsolutePosition());}},dispose:()=>{flash.dispose();mat.dispose();}});
  const forward=anchor?Vector3.TransformNormal(Vector3.Forward(),anchor.getWorldMatrix()).normalize():new Vector3(0,0,1);for(let i=0;i<3;i++)this.puff(position.add(forward.scale(i*.025)),forward.scale(.2+i*.06).add(new Vector3((Math.random()-.5)*.05,.04+Math.random()*.04,(Math.random()-.5)*.05)),.035+i*.012,.38+i*.08,new Color3(.5,.52,.53),.075-i*.012);
 }
 tracer(start:Vector3,end:Vector3){
  const delta=end.subtract(start),distance=delta.length();if(distance<.5)return;const direction=delta.scale(1/distance),mesh=MeshBuilder.CreateCylinder('bullet-streak',{height:1,diameterTop:.003,diameterBottom:.012,tessellation:5},this.scene);mesh.isPickable=false;mesh.applyFog=false;mesh.rotationQuaternion=Quaternion.Identity();Quaternion.FromUnitVectorsToRef(Vector3.Up(),direction,mesh.rotationQuaternion);const mat=this.material('streak-emission',new Color3(1,.88,.63));mesh.material=mat;
  this.add({age:0,life:distance/350+.035,tick:t=>{const s=tracerSegment(distance,t);mesh.position.copyFrom(start.add(direction.scale((s.head+s.tail)/2)));mesh.scaling.y=Math.max(.001,s.head-s.tail);mat.alpha=s.alpha*.65;},dispose:()=>{mesh.dispose();mat.dispose();}});
 }
 impact(position:Vector3,direction:Vector3,hit:boolean){for(let i=0;i<(hit?3:6);i++){const velocity=direction.scale(-.12).add(new Vector3((Math.random()-.5)*.6,Math.random()*.45,(Math.random()-.5)*.6));this.puff(position,velocity,hit?.025:.035,.18+Math.random()*.12,hit?new Color3(.38,.22,.18):new Color3(.63,.59,.48),hit?.3:.55);}}
 private puff(start:Vector3,velocity:Vector3,size:number,life:number,color:Color3,alpha:number){const mesh=MeshBuilder.CreatePlane('impact-smoke',{size},this.scene);mesh.billboardMode=Mesh.BILLBOARDMODE_ALL;mesh.isPickable=false;mesh.applyFog=false;const mat=this.material('particle',color,this.soft);mesh.material=mat;this.add({age:0,life,tick:t=>{mesh.position.copyFrom(start.add(velocity.scale(t)));mesh.scaling.setAll(1+t*3);mat.alpha=alpha*(1-t/life);},dispose:()=>{mesh.dispose();mat.dispose();}});}
 private update(dt:number){this.lightAge+=dt;this.light.intensity=.75*Math.max(0,1-this.lightAge/.032);for(let i=this.effects.length-1;i>=0;i--){const e=this.effects[i];if(e.age>=e.life){e.dispose();this.effects.splice(i,1);}else{e.tick(e.age);e.age+=dt;}}}
 clear(){this.lightAge=1;this.light.intensity=0;for(const e of this.effects)e.dispose();this.effects=[];}
}
