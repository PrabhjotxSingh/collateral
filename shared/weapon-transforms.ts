import { Matrix, Mesh, Quaternion, TransformNode, Vector3 } from "@babylonjs/core";
import type { FrameTransform } from "./weapons.js";
const radians = Math.PI / 180;
export const rotationFor = (t: FrameTransform) => Quaternion.FromEulerAngles(t.pitch*radians,t.yaw*radians,t.roll*radians);
export function readFrame(node: TransformNode): FrameTransform {
  const e=(node.rotationQuaternion ?? Quaternion.FromEulerVector(node.rotation)).toEulerAngles();
  return {x:node.position.x,y:node.position.y,z:node.position.z,pitch:e.x/radians,yaw:e.y/radians,roll:e.z/radians,scale:node.scaling.x};
}
export function frameMatrix(t: FrameTransform) {
  return Matrix.Compose(Vector3.One().scale(t.scale),rotationFor(t),new Vector3(t.x,t.y,t.z));
}
export function applyMatrix(node: TransformNode, matrix: Matrix) {
  node.rotationQuaternion ??= Quaternion.Identity();
  matrix.decompose(node.scaling,node.rotationQuaternion,node.position);
}
export function blendFrame(node: TransformNode, hip: FrameTransform, ads: FrameTransform, amount: number) {
  const t=Math.max(0,Math.min(1,amount));
  node.position.set(hip.x+(ads.x-hip.x)*t,hip.y+(ads.y-hip.y)*t,hip.z+(ads.z-hip.z)*t);
  // Slerp chooses the short quaternion arc, ignoring extra authored Euler turns.
  node.rotationQuaternion=Quaternion.Slerp(rotationFor(hip),rotationFor(ads),t);
  node.scaling.setAll(hip.scale+(ads.scale-hip.scale)*t);
}
export function fitCharacter(root: TransformNode, height: number) {
  for(const mesh of root.getChildMeshes()) {
    mesh.computeWorldMatrix(true);
    if(mesh instanceof Mesh){mesh.skeleton?.prepare(true);mesh.refreshBoundingInfo(true);}
  }
  const {min,max}=root.getHierarchyBoundingVectors(true),size=max.y-min.y;
  if(!Number.isFinite(size)||size<=0)throw Error("Character has no valid bounds");
  const scale=height/size;
  root.scaling.setAll(scale);
  root.position.set(-(min.x+max.x)*scale/2,-min.y*scale,-(min.z+max.z)*scale/2);
  return {scale,min:min.clone(),max:max.clone()};
}
