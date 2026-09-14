import { Matrix, Quaternion, TransformNode, Vector3 } from "@babylonjs/core";
import type { HoldingPose } from "./weapons.js";
import { frameMatrix } from "./weapon-transforms.js";

export const isArmJoint=(name:string)=>/mixamorig:(Left|Right)(Shoulder|Arm|ForeArm|Hand)$/.test(name);
const rotation=(n:TransformNode)=>n.rotationQuaternion?.clone()??Quaternion.FromEulerVector(n.rotation);
const joint=(root:TransformNode,name:string)=>root.getChildTransformNodes(false).find(n=>n.name.endsWith("mixamorig:"+name));
export function createWeaponSocket(root:TransformNode) {
  const hand=joint(root,"RightHand"),middle=joint(root,"RightHandMiddle1");
  if(!hand)return undefined;
  hand.computeWorldMatrix(true);middle?.computeWorldMatrix(true);
  const position=Vector3.Lerp(hand.getAbsolutePosition(),middle?.getAbsolutePosition()??hand.getAbsolutePosition(),.72).add(new Vector3(0,-.035,0));
  const local=Matrix.Compose(Vector3.One(),Quaternion.Identity(),position).multiply(Matrix.Invert(hand.getWorldMatrix()));
  const socket=new TransformNode(root.name+"-weapon-socket",root.getScene());
  socket.rotationQuaternion=Quaternion.Identity();
  local.decompose(socket.scaling,socket.rotationQuaternion,socket.position);socket.parent=hand;
  return socket;
}

/** Rotates the existing two-bone chain; never moves joints or changes bone lengths. */
export function solveArm(upper:TransformNode,elbow:TransformNode,hand:TransformNode,target:Vector3) {
  const update=()=>{upper.computeWorldMatrix(true);elbow.computeWorldMatrix(true);hand.computeWorldMatrix(true);};
  update();
  const origin=upper.getAbsolutePosition().clone(),reach=Vector3.Distance(origin,elbow.getAbsolutePosition())+Vector3.Distance(elbow.getAbsolutePosition(),hand.getAbsolutePosition());
  const delta=target.subtract(origin);
  const reachable=delta.length()>reach*.995?origin.add(delta.normalize().scale(reach*.995)):target;
  for(let i=0;i<18;i++){
    for(const node of [elbow,upper]){
      update();
      const p=node.getAbsolutePosition(),inverse=Matrix.Invert(node.getWorldMatrix());
      const from=Vector3.TransformNormal(hand.getAbsolutePosition().subtract(p),inverse).normalize();
      const to=Vector3.TransformNormal(reachable.subtract(p),inverse).normalize();
      if(from.lengthSquared()<.5||to.lengthSquared()<.5)continue;
      const q=Quaternion.Identity();Quaternion.FromUnitVectorsToRef(from,to,q);
      node.rotationQuaternion=rotation(node).multiply(q).normalize();
    }
    update();if(Vector3.DistanceSquared(hand.getAbsolutePosition(),reachable)<1e-7)break;
  }
  return Vector3.Distance(hand.getAbsolutePosition(),target);
}

/** Both editor and game run this AFTER animation evaluation and restore BEFORE it. */
export class HoldingRig {
  private saved=new Map<TransformNode,Quaternion>();
  readonly left;
  readonly right;
  readonly joints:TransformNode[];
  constructor(readonly root:TransformNode){
    this.left={upper:joint(root,"LeftArm"),elbow:joint(root,"LeftForeArm"),hand:joint(root,"LeftHand")};
    this.right={upper:joint(root,"RightArm"),elbow:joint(root,"RightForeArm"),hand:joint(root,"RightHand")};
    this.joints=root.getChildTransformNodes(false).filter(n=>isArmJoint(n.name));
  }
  get supported(){return !!(this.left.upper&&this.left.elbow&&this.left.hand&&this.right.upper&&this.right.elbow&&this.right.hand);}
  restore(){for(const [node,q]of this.saved)if(!node.isDisposed())node.rotationQuaternion=q;this.saved.clear();}
  apply(pose:HoldingPose|undefined,weapon:TransformNode|undefined,active=true){
    if(!pose||!active||!weapon||!this.supported)return;
    for(const n of this.joints)this.saved.set(n,rotation(n));
    if(pose.preset==="rifle"){
      const {upper,elbow,hand}=this.right;
      hand!.computeWorldMatrix(true);
      // A compact rifle-ready starting stance. Final placement is authored per weapon.
      const basis=this.root.parent??this.root;
      const back=Vector3.TransformNormal(new Vector3(0,-.035,-.1),basis.computeWorldMatrix(true));
      solveArm(upper!,elbow!,hand!,hand!.getAbsolutePosition().add(back));
    }
    for(const [name,value] of Object.entries(pose.arms)){
      const n=this.joints.find(n=>n.name.endsWith(name));
      if(n&&[value.x,value.y,value.z,value.w].every(Number.isFinite)){
        const q=new Quaternion(value.x,value.y,value.z,value.w);
        if(q.lengthSquared()>1e-8)n.rotationQuaternion=q.normalize();
      }
    }
    if(pose.supportHand.enabled){
      for(const n of this.joints)n.computeWorldMatrix(true);
      const world=frameMatrix(pose.supportHand.target).multiply(weapon.computeWorldMatrix(true));
      solveArm(this.left.upper!,this.left.elbow!,this.left.hand!,world.getTranslation());
      if(pose.supportHand.orient){
        const parent=this.left.hand!.parent as TransformNode;
        const local=world.multiply(Matrix.Invert(parent.computeWorldMatrix(true)));
        const q=Quaternion.Identity();local.decompose(undefined,q);
        this.left.hand!.rotationQuaternion=q.normalize();
      }
    }
  }
}
