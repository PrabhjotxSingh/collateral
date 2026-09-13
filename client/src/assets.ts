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
  muzzle?: TransformNode;
  worldWeapon?: AssetInstance;
  handPose?: Map<TransformNode, Quaternion>;
  dispose: () => void;
}
// Run while detached from the moving player, so position/yaw/crouch cannot
// contaminate the measured dimensions. Uniform scaling preserves proportions.
export function fitCharacter(root: TransformNode, height: number) {
  for (const mesh of root.getChildMeshes()) {
    mesh.computeWorldMatrix(true);
    if (mesh instanceof Mesh) {
      mesh.skeleton?.prepare(true);
      mesh.refreshBoundingInfo(true);
    }
  }
  const { min, max } = root.getHierarchyBoundingVectors(true);
  const size = max.y - min.y;
  if (!Number.isFinite(size) || size <= 0)
    throw new Error("Character has no valid bounds");
  const scale = height / size;
  root.scaling.setAll(scale);
  root.position.set(
    (-(min.x + max.x) * scale) / 2,
    -min.y * scale,
    (-(min.z + max.z) * scale) / 2,
  );
  return { scale, min: min.clone(), max: max.clone() };
}
export class Assets {
  private cache = new Map<string, Promise<AssetContainer | null>>();
  constructor(private scene: Scene) {}
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
      { weapon: true },
    );
    if (!weapon) {
      for (const item of disposers) item.dispose();
      return null;
    }
    this.frame(weapon.root, manifest.firstPerson.weapon);
    const muzzle = new TransformNode(`${manifest.id}-view-muzzle`, this.scene);
    muzzle.parent = weapon.root;
    this.frame(muzzle, manifest.effects.muzzle.firstPerson);
    weapon.muzzle = muzzle;
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
    actor.worldWeapon?.dispose();
    this.frame(actor.grip, manifest.thirdPerson.weapon);
    const weapon = await this.instance(manifest.assets.world, actor.grip);
    actor.worldWeapon = weapon ?? undefined;
    if (weapon) {
      const muzzle = new TransformNode(
        `${manifest.id}-world-muzzle`,
        this.scene,
      );
      muzzle.parent = weapon.root;
      this.frame(muzzle, manifest.effects.muzzle.thirdPerson);
      actor.muzzle = muzzle;
    }
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
      menu?: boolean;
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
    if (options.weapon && instance.animationGroups[0])
      instance.animationGroups.push(
        ...createGlockClips(instance.animationGroups[0]),
      );
    const clips = new ClipPlayer(instance.animationGroups);
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
      if (options.weapon) {
        fitted.rotation.y = Math.PI; // Source muzzle faces -Z; game camera looks +Z.
        for (const mesh of fitted.getChildMeshes()) mesh.renderingGroupId = 1;
      }
    } catch (error) {
      instance.dispose();
      fitted.dispose();
      console.warn("Using character placeholder", error);
      return null;
    }
    let grip: TransformNode | undefined;
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
      const hand = fitted
        .getChildTransformNodes()
        .find((n) => n.name.endsWith("mixamorig:RightHand"));
      if (hand) {
        hand.computeWorldMatrix(true);
        const socket = new TransformNode(
          parent.name + "-weapon-socket",
          this.scene,
        );
        const middle = fitted
          .getChildTransformNodes()
          .find((n) => n.name.endsWith("mixamorig:RightHandMiddle1"))!;
        middle.computeWorldMatrix(true);
        const position = Vector3.Lerp(
          hand.getAbsolutePosition(),
          middle.getAbsolutePosition(),
          0.72,
        ).add(new Vector3(0, -0.035, 0));
        const desired = Matrix.Compose(
            Vector3.One(),
            Quaternion.Identity(),
            position,
          ),
          local = desired.multiply(Matrix.Invert(hand.getWorldMatrix()));
        socket.rotationQuaternion = Quaternion.Identity();
        local.decompose(
          socket.scaling,
          socket.rotationQuaternion,
          socket.position,
        );
        socket.parent = hand;
        grip = new TransformNode(parent.name + "-grip-adjustment", this.scene);
        grip.parent = socket;
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
    fitted.parent = parent;
    if (placeholder) placeholder.isVisible = false;
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      instance.dispose();
      fitted.dispose();
    };
    parent.onDisposeObservable.addOnce(dispose);
    return { clips, combat, root: fitted, grip, muzzle, worldWeapon, dispose };
  }
}
