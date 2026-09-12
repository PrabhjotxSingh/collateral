import HavokPhysics from '@babylonjs/havok';
import havokWasm from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url';
import {Scene,HavokPlugin,Vector3,PhysicsAggregate,PhysicsShapeType,MeshBuilder,Mesh,StandardMaterial,Color3} from '@babylonjs/core';
// Havok runs client-side cosmetic physics. Shared kinematic collision owns gameplay on the server.
export class CosmeticPhysics {
  private brass:StandardMaterial;private ready:Promise<void>;private staticBodies:PhysicsAggregate[]=[];
  constructor(private scene:Scene){this.brass=new StandardMaterial('casing-brass',scene);this.brass.disableLighting=true;this.brass.emissiveColor=new Color3(.46,.32,.12);
 const brass=this.brass;this.ready=(async()=>{const havok=await HavokPhysics({locateFile:()=>havokWasm});scene.enablePhysics(new Vector3(0,-15,0),new HavokPlugin(true,havok));
 const warm=MeshBuilder.CreateBox('casing-warmup',{size:.018},scene);warm.position.y=-1000;warm.isVisible=false;warm.material=brass;warm.applyFog=false;
 const body=new PhysicsAggregate(warm,PhysicsShapeType.BOX,{mass:.008,restitution:.3},scene);
 try{await brass.forceCompilationAsync(warm);}finally{body.dispose();warm.dispose();}
 })();void this.ready.catch(()=>{});}
  async setMap(meshes:Mesh[],triangles=false){
    try{await this.ready;for(const p of this.staticBodies)p.dispose();this.staticBodies=[];for(const mesh of meshes)if(!mesh.isDisposed())this.staticBodies.push(new PhysicsAggregate(mesh,triangles?PhysicsShapeType.MESH:PhysicsShapeType.BOX,{mass:0},this.scene));}catch(error){console.warn('Cosmetic physics unavailable',error);}
  }
  async casing(position:Vector3,yaw:number){
    try{await this.ready;const mesh=MeshBuilder.CreateBox('casing',{width:0.018,height:0.018,depth:0.035},this.scene);mesh.position.copyFrom(position);mesh.material=this.brass;mesh.applyFog=false;mesh.isPickable=false;const body=new PhysicsAggregate(mesh,PhysicsShapeType.BOX,{mass:0.008,restitution:0.3},this.scene);body.body.setLinearVelocity(new Vector3(Math.cos(yaw)*1.5,1,-Math.sin(yaw)*1.5));setTimeout(()=>{body.dispose();mesh.dispose();},2200);}catch{}
  }
}
