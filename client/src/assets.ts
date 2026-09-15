import { HoldingRig, createWeaponSocket } from "../../shared/holding-pose";
import { fitCharacter, frameMatrix, applyMatrix } from "../../shared/weapon-transforms";
export { fitCharacter } from "../../shared/weapon-transforms";
import { applyGrip, storedGrip } from "./grip";
import {
  Scene,
  AssetContainer,
  LoadAssetContainerAsync,
  TransformNode,
  Mesh,
  Vector3,
  Matrix,
  Quaternion,
  AnimationGroup,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { ClipPlayer } from "./animation";
import { createGlockClips } from "./model-animation";
import type { FrameTransform, WeaponManifest } from "../../shared/weapons.js";
export interface AssetInstance {
  clips: ClipPlayer;
  combat?: ClipPlayer;
  root: TransformNode;
  grip?: TransformNode;
  gripBindMatrix?: Matrix;
  referenceFit?: Matrix;
  muzzle?: TransformNode;
  worldWeapon?: AssetInstance;
  weaponAction?: { action:"draw"|"fire"|"reload"; elapsed:number; duration:number };
  handPose?: Map<TransformNode, Quaternion>;
  holdingRig?: HoldingRig;
  holding?: WeaponManifest["thirdPerson"]["holding"];
  dispose: () => void;
}
// Run while detached from the moving player, so position/yaw/crouch cannot
// contaminate the measured dimensions. Uniform scaling preserves proportions.
export class Assets {
  private cache = new Map<string, Promise<AssetContainer | null>>();
  private worldLoads = new WeakMap<AssetInstance,object>();
  private referenceFits = new Map<string,Promise<Matrix | undefined>>();
  constructor(private scene: Scene) {}
  async preload(...paths: Array<string | undefined>) {
    await Promise.all(paths.filter((p): p is string => !!p).map((p) => this.load(p)));
  }
  private frame(node: TransformNode, value: FrameTransform) {
    node.position.set(value.x, value.y, value.z);
    node.rotationQuaternion = null;
    node.rotation.set(
      (value.pitch * Math.PI) / 180,
      (value.yaw * Math.PI) / 180,
      (value.roll * Math.PI) / 180,
    );
    node.scaling.setAll(value.scale);
  }
  async viewWeapon(
    manifest: WeaponManifest,
    parent: TransformNode,
    placeholder?: Mesh,
  ) {
    const disposers: AssetInstance[] = [];
    // Legacy two-file packages still load, but new packages contain arms in view.glb.
    if (manifest.assets.arms) {
      const arms = await this.instance(manifest.assets.arms, parent);
      if (arms) {
        this.frame(arms.root, manifest.firstPerson.arms);
        for (const mesh of arms.root.getChildMeshes())
          mesh.renderingGroupId = 1;
        for (const node of arms.root.getChildTransformNodes()) {
          const pose = Object.entries(manifest.firstPerson.fingers).find(
            ([name]) => node.name.endsWith(name),
          );
          if (pose)
            node.rotationQuaternion = new Quaternion(
              pose[1].x,
              pose[1].y,
              pose[1].z,
              pose[1].w,
            );
        }
        disposers.push(arms);
      }
    }
    if (!manifest.assets.view) return null;
    const weapon = await this.instance(
      manifest.assets.view,
      parent,
      placeholder,
      {
        weapon: true,
        exactWeaponTransform: manifest.firstPerson.editorFramed === true,
        animationMap: manifest.firstPerson.animations,
      },
    );
    if (!weapon) {
      for (const item of disposers) item.dispose();
      return null;
    }
    this.frame(weapon.root, manifest.firstPerson.weapon);
    for (const node of weapon.root.getChildTransformNodes()) {
      const value = Object.entries(manifest.firstPerson.fingers).find(
        ([name]) => node.name.endsWith(name),
      )?.[1];
      if (value) node.rotationQuaternion = new Quaternion(value.x, value.y, value.z, value.w);
    }
    // The original G17 barrel moves inside its animation hierarchy. Its measured
    // barrel tip is authoritative; the old generic world-gun offset was wrong here.
    if(!weapon.muzzle || manifest.firstPerson.editorFramed || manifest.effects.muzzleNode?.firstPerson) {
      weapon.muzzle?.dispose();
      const muzzle = new TransformNode(`${manifest.id}-view-muzzle`, this.scene);
      muzzle.parent = this.muzzleParent(weapon.root,manifest.effects.muzzleNode?.firstPerson);
      this.frame(muzzle, manifest.effects.muzzle.firstPerson);
      weapon.muzzle = muzzle;
    }
    disposers.push(weapon);
    const original = weapon.dispose;
    weapon.dispose = () => {
      original();
      for (const item of disposers) if (item !== weapon) item.dispose();
    };
    return weapon;
  }
  async worldWeapon(manifest: WeaponManifest, actor: AssetInstance) {
    if (!actor.grip || !manifest.assets.world) return null;
    const request={};this.worldLoads.set(actor,request);
    actor.worldWeapon?.clips.resetToIdle();
    actor.worldWeapon?.dispose();
    if (actor.gripBindMatrix && (manifest.thirdPerson.space === "character" ||
        (!manifest.thirdPerson.space && manifest.firstPerson.editorFramed))) {
      let desired=frameMatrix(manifest.thirdPerson.weapon).multiply(Matrix.Invert(frameMatrix(manifest.thirdPerson.character)));
      // Older editor exports used the reference GLB's native units, before height normalization.
      if(!manifest.thirdPerson.space && manifest.firstPerson.editorFramed){
        const fit=manifest.assets.character ? await this.referenceNormalization(manifest.assets.character) : actor.referenceFit;
        if(fit)desired=desired.multiply(fit);
      }
      if(actor.root.isDisposed()||this.worldLoads.get(actor)!==request)return null;
      applyMatrix(actor.grip,desired.multiply(Matrix.Invert(actor.gripBindMatrix)));
    } else this.frame(actor.grip, manifest.thirdPerson.weapon);
    const weapon = await this.instance(manifest.assets.world, actor.grip, undefined, {
      animationMap: manifest.thirdPerson.animations,
    });
    if(this.worldLoads.get(actor)!==request||actor.root.isDisposed()){weapon?.dispose();return null;}
    actor.worldWeapon = weapon ?? undefined;
    if (weapon) {
      const muzzle = new TransformNode(
        `${manifest.id}-world-muzzle`,
        this.scene,
      );
      muzzle.parent = this.muzzleParent(weapon.root,manifest.effects.muzzleNode?.thirdPerson);
      this.frame(muzzle, manifest.effects.muzzle.thirdPerson);
      actor.muzzle = muzzle;
    }
    actor.holdingRig?.restore();
    actor.holding = manifest.thirdPerson.holding;
    actor.handPose = new Map();
    for (const [name, value] of Object.entries(
      manifest.thirdPerson.fingers ?? {},
    )) {
      const node = actor.root
        .getChildTransformNodes()
        .find((candidate) => candidate.name.endsWith(name));
      if (node)
        actor.handPose.set(
          node,
          new Quaternion(value.x, value.y, value.z, value.w),
        );
    }
    return weapon;
  }
  private referenceNormalization(path:string){
    if(!this.referenceFits.has(path))this.referenceFits.set(path,(async()=>{
      const container=await this.load(path);if(!container)return undefined;
      const instance=container.instantiateModelsToScene(n=>n,false,{doNotInstantiate:true});
      instance.animationGroups.forEach((g,i)=>g.name=container.animationGroups[i].name);
      const root=new TransformNode("reference-normalization",this.scene);
      for(const node of instance.rootNodes)node.parent=root;
      const clips=new ClipPlayer(instance.animationGroups);clips.play("idle");clips.tick(1);
      for(const group of instance.animationGroups)if(group.isPlaying)group.goToFrame(group.from);
      try{fitCharacter(root,1.8);return root.computeWorldMatrix(true).clone();}
      finally{clips.dispose();instance.dispose();root.dispose();}
    })());
    return this.referenceFits.get(path)!;
  }
  private muzzleParent(root:TransformNode,name?:string){
    return name ? root.getChildTransformNodes(false).find(n=>n.name===name||n.name.endsWith("-"+name)) ?? root : root;
  }
  load(path: string) {
    if (!this.cache.has(path))
      this.cache.set(
        path,
        (async () => {
          try {
            // Vite serves index.html for absent assets: verify GLB magic before asking the loader to parse it.
            const response = await fetch(path);
            if (!response.ok) return null;
            const bytes = await response.arrayBuffer();
            if (
              bytes.byteLength < 12 ||
              new DataView(bytes).getUint32(0, true) !== 0x46546c67
            )
              return null;
            const url = URL.createObjectURL(
              new Blob([bytes], { type: "model/gltf-binary" }),
            );
            try {
              return await LoadAssetContainerAsync(url, this.scene, {
                pluginExtension: ".glb",
              });
            } finally {
              URL.revokeObjectURL(url);
            }
          } catch (error) {
            console.warn(`Using placeholder for ${path}`, error);
            return null;
          }
        })(),
      );
    return this.cache.get(path)!;
  }
  async instance(
    path: string,
    parent: TransformNode,
    placeholder?: Mesh,
    options: {
      characterHeight?: number;
      weapon?: boolean;
      exactWeaponTransform?: boolean;
      menu?: boolean;
      animationMap?: Partial<Record<import("./animation").ClipAction, import("../../shared/weapons").AnimationBinding>>;
    } = {},
  ): Promise<AssetInstance | null> {
    const container = await this.load(path);
    if (!container || parent.isDisposed()) return null;
    const instance = container.instantiateModelsToScene(
      (name) => `${parent.name}-${name}`,
      false,
      { doNotInstantiate: true },
    );
    instance.animationGroups.forEach((group, index) => {
      group.name = container.animationGroups[index].name;
    });
    const fitted = new TransformNode(`${parent.name}-fitted`, this.scene);
    for (const root of instance.rootNodes) root.parent = fitted;
    if (options.menu && instance.animationGroups[0])
      instance.animationGroups[0].name = "idle";
    if (options.weapon && !options.animationMap && /(?:\/secondary\/glock\/view|\/assets\/weapons\/glock)\.glb$/.test(path) && instance.animationGroups[0])
      instance.animationGroups.push(
        ...createGlockClips(instance.animationGroups[0]),
      );
    const clips = new ClipPlayer(instance.animationGroups, options.animationMap);
    clips.play("idle");
    // Evaluate the supplied idle stance before fitting, including skinning.
    for (const group of instance.animationGroups)
      if (group.isPlaying) {
        group.setWeightForAllAnimatables(1);
        group.goToFrame(group.from);
      }
    try {
      if (options.characterHeight) {
        fitCharacter(fitted, options.characterHeight);
        // SWAT's native forward direction is +Z, matching authoritative yaw.
      }
      if (options.weapon && !options.exactWeaponTransform) {
        fitted.rotation.y = Math.PI; // Source muzzle faces -Z; game camera looks +Z.
      }
      if (options.weapon) {
        for (const mesh of fitted.getChildMeshes()) mesh.renderingGroupId = 1;
      }
    } catch (error) {
      instance.dispose();
      fitted.dispose();
      console.warn("Using character placeholder", error);
      return null;
    }
    let grip: TransformNode | undefined;
    let gripBindMatrix: Matrix | undefined;
    let muzzle: TransformNode | undefined;
    let combat: ClipPlayer | undefined;
    let worldWeapon: AssetInstance | undefined;
    if (options.weapon) {
      const barrel = fitted
        .getChildMeshes()
        .find((m) => m.name.includes("01_Barrel"));
      if (barrel) {
        barrel.computeWorldMatrix(true);
        const box = barrel.getBoundingInfo().boundingBox,
          point = new Vector3(
            box.centerWorld.x,
            box.centerWorld.y,
            box.maximumWorld.z + 0.006,
          );
        muzzle = new TransformNode(parent.name + "-muzzle", this.scene);
        muzzle.parent = barrel;
        muzzle.position.copyFrom(
          Vector3.TransformCoordinates(
            point,
            Matrix.Invert(barrel.getWorldMatrix()),
          ),
        );
      }
    }
    if (options.characterHeight && !options.menu) {
      const layers = instance.animationGroups
        .filter((g) => g.name === "fire" || g.name === "reload")
        .map((g) => {
          const layer = g.clone(g.name, undefined, true);
          for (const track of [...layer.targetedAnimations])
            if (!/Shoulder|Arm|Hand/.test(track.target.name))
              layer.removeTargetedAnimation(track.animation);
          AnimationGroup.MakeAnimationAdditive(layer, layer.from);
          return layer;
        });
      combat = new ClipPlayer(layers);
      parent.onDisposeObservable.addOnce(() =>
        layers.forEach((g) => g.dispose()),
      );
      const socket = createWeaponSocket(fitted);
      if (socket) {
        grip = new TransformNode(parent.name + "-grip-adjustment", this.scene);
        grip.parent = socket;
        gripBindMatrix = socket.computeWorldMatrix(true).clone();
        applyGrip(grip, storedGrip());
        muzzle = new TransformNode(parent.name + "-muzzle", this.scene);
        muzzle.parent = grip;
        muzzle.position.set(0, 0.059, 0.166);
        worldWeapon =
          (await this.instance("/assets/weapons/glock-world.glb", grip)) ??
          undefined;
      }
    }
    if (parent.isDisposed()) {
      instance.dispose();
      fitted.dispose();
      return null;
    }
    const referenceFit=fitted.computeWorldMatrix(true).clone();
    fitted.parent = parent;
    if (placeholder) placeholder.isVisible = false;
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      clips.resetToIdle();
      clips.dispose();
      combat?.dispose();
      worldWeapon?.dispose();
      instance.dispose();
      fitted.dispose();
    };
    parent.onDisposeObservable.addOnce(dispose);
    return { clips, combat, root: fitted, grip, gripBindMatrix, referenceFit, muzzle, worldWeapon, holdingRig:options.characterHeight&&!options.menu?new HoldingRig(fitted):undefined, dispose };
  }
}
