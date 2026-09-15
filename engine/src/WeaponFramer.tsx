import { HoldingRig, createWeaponSocket, isArmJoint } from "../../shared/holding-pose";
import type { HoldingPose } from "../../shared/weapons";
import defaultCharacterUrl from "../../client/public/assets/characters/player.glb?url";
import { blendFrame, readFrame, fitCharacter, frameMatrix, applyMatrix } from "../../shared/weapon-transforms";
import { ClipPlayer, findClip, drawPose } from "../../client/src/animation";
import { type AnimationBinding, NO_ANIMATION } from "../../shared/weapons";
import React, { useEffect, useRef, useState } from "react";
import {
  ArcRotateCamera,
  Camera,
  Color3,
  Color4,
  Engine,
  GizmoManager,
  HemisphericLight,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  SceneLoader,
  StandardMaterial,
  TransformNode,
  UniversalCamera,
  Vector3,
  Viewport,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import JSZip from "jszip";
import {
  DEFAULT_WEAPON_EFFECTS,
  DEFAULT_WEAPON_GAMEPLAY,
  type WeaponManifest,
} from "../../shared/weapons";

type Slot = "primary" | "secondary";
type PoseMode = "first-person" | "third-person";
type AnimationAction = "idle" | "draw" | "fire" | "reload";
type TransformTool = "move" | "rotate" | "scale";
const BUILTIN_ANIMATION = "@collateral-built-in";
const animationLabels: Record<AnimationAction, string> = {
  idle: "Static hold + input sway",
  draw: "Procedural lower / raise",
  fire: "Procedural recoil kick",
  reload: "Procedural reload tilt",
};
type Transform = {
  x: number;
  y: number;
  z: number;
  pitch: number;
  yaw: number;
  roll: number;
  scale: number;
};
type FingerPose = Record<
  string,
  { x: number; y: number; z: number; w: number }
>;
const identity = (): Transform => ({
  x: 0,
  y: 0,
  z: 0,
  pitch: 0,
  yaw: 0,
  roll: 0,
  scale: 1,
});
const clean = (v: string) =>
  v
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
const download = (blob: Blob, name: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const readTransform = readFrame;
const applyTransform = (n: TransformNode, t: Transform) => {
  n.position.set(t.x, t.y, t.z);
  n.rotationQuaternion = null;
  n.rotation.set(
    (t.pitch * Math.PI) / 180,
    (t.yaw * Math.PI) / 180,
    (t.roll * Math.PI) / 180,
  );
  n.scaling.setAll(t.scale);
};
const isFinger = (name: string) =>
  /(thumb|index|middle|ring|pinky|little)(?:\D|$)/i.test(name);

export function WeaponFramer({ onHome }: { onHome: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null),
    scene = useRef<Scene | undefined>(undefined),
    gizmo = useRef<GizmoManager | undefined>(undefined),
    camera = useRef<ArcRotateCamera | undefined>(undefined),
    playerCamera = useRef<UniversalCamera | undefined>(undefined);
  const roots = useRef<Record<string, TransformNode>>({}),
    files = useRef<Record<string, File>>({}),
    importedGroups = useRef<
      Record<PoseMode, import("@babylonjs/core").AnimationGroup[]>
    >({
      "first-person": [],
      "third-person": [],
    }),
    fingerNodes = useRef(new Map<string, TransformNode>()),
    pose = useRef<FingerPose>({});
  const [mode, setMode] = useState<PoseMode>("first-person"),
    [livePreview, setLivePreview] = useState(true),
    [holding,setHolding]=useState<HoldingPose>({preset:"pistol",arms:{},supportHand:{enabled:false,target:identity(),orient:false}}),
    [holdingPreview,setHoldingPreview]=useState(true),
    [includeReference,setIncludeReference]=useState(false),
    [panel, setPanel] = useState("models"),
    [transformTool, setTransformTool] = useState<TransformTool>("move"),
    [positionStep,setPositionStep]=useState(.001),
    [rotationStep,setRotationStep]=useState(.1),
    [scaleStep,setScaleStep]=useState(.001),
    [snapEnabled,setSnapEnabled]=useState(true),
    [selected, setSelected] = useState("fp-gun"),
    [name, setName] = useState("Glock"),
    [id, setId] = useState("glock"),
    [slot, setSlot] = useState<Slot>("secondary"),
    [gameplay, setGameplay] = useState(
      structuredClone(DEFAULT_WEAPON_GAMEPLAY),
    ),
    [effects, setEffects] = useState(structuredClone(DEFAULT_WEAPON_EFFECTS)),
    [ads, setAds] = useState<Transform>(identity()),
    [adsFov, setAdsFov] = useState(0.82),
    [previewFov, setPreviewFov] = useState(95),
    [aiming, setAiming] = useState(false),
    [testing, setTesting] = useState(false),
    [status, setStatus] = useState(
      "Load a first-person weapon GLB with its arms already attached.",
    ),
    [clips, setClips] = useState<Record<PoseMode, string[]>>({
      "first-person": [],
      "third-person": [],
    }),
    [animationMap, setAnimationMap] = useState<
      Record<PoseMode, Partial<Record<AnimationAction, AnimationBinding>>>
    >({ "first-person": {}, "third-person": {} }),
    [fingers, setFingers] = useState<string[]>([]),
    [audioNames,setAudioNames]=useState({shotSound:"",reloadSound:""}),
    [exporting, setExporting] = useState(false);
  const previewPlayer = useRef<ClipPlayer | undefined>(undefined),
    proceduralFrame = useRef(0),
    restorePreview = useRef<(() => void) | undefined>(undefined);
  const stopPreview = () => { cancelAnimationFrame(proceduralFrame.current); previewPlayer.current?.dispose(); previewPlayer.current=undefined; restorePreview.current?.(); restorePreview.current=undefined; };
  const hip = useRef<Transform>(identity()),
    thirdPose = useRef<{ weapon: Transform; character: Transform } | undefined>(undefined),
    hipCaptured = useRef(false),
    transformToolRef = useRef<TransformTool>("move"),
    adsAnimation = useRef(0),
    previewUrls = useRef<string[]>([]),
    testTimer = useRef<number | undefined>(undefined);
  const referenceIdle=useRef<import("@babylonjs/core").AnimationGroup|undefined>(undefined);
  const holdingRig=useRef<HoldingRig|undefined>(undefined),
    weaponSocket=useRef<TransformNode|undefined>(undefined),
    sharedReference=useRef(false);
  const holdingRef=useRef(holding),holdingPreviewRef=useRef(holdingPreview);
  holdingRef.current=holding;holdingPreviewRef.current=holdingPreview;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  transformToolRef.current = transformTool;
  const attach = (key = selectedRef.current) => {
    const n = key.startsWith("finger:")
      ? fingerNodes.current.get(key.slice(7))
      : roots.current[key];
    if (!n) return;
    gizmo.current?.attachToNode(n);
    if (gizmo.current) {
      const finger = key.startsWith("finger:");
      gizmo.current.positionGizmoEnabled =
        !finger && transformToolRef.current === "move";
      gizmo.current.rotationGizmoEnabled =
        finger || transformToolRef.current === "rotate";
      gizmo.current.scaleGizmoEnabled =
        !finger && transformToolRef.current === "scale";
    }
  };
  useEffect(() => {
    const engine = new Engine(canvas.current!, true),
      s = (scene.current = new Scene(engine));
    s.clearColor = new Color4(0.035, 0.045, 0.052, 1);
    const cam = (camera.current = new ArcRotateCamera(
      "framer-camera",
      -Math.PI / 2,
      1.25,
      4,
      new Vector3(0, 1.2, 0),
      s,
    ));
    cam.attachControl(canvas.current!, true);
    cam.minZ = 0.02;
    cam.wheelPrecision = 45;
    const pov = (playerCamera.current = new UniversalCamera(
      "player-eye-camera",
      Vector3.Zero(),
      s,
    ));
    pov.setTarget(new Vector3(0, 0, 1));
    pov.minZ = 0.01;
    pov.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
    pov.fov = (95 * Math.PI) / 180;
    pov.inputs.clear();
    s.cameraToUseForPointers=cam;
    pov.layerMask = 0x0fffffff;
    cam.layerMask = 0x1fffffff;
    const light = new HemisphericLight("studio", new Vector3(0.2, 1, -0.3), s);
    light.intensity = 1.35;
    const ground = MeshBuilder.CreateGround(
        "ground",
        { width: 12, height: 12 },
        s,
      ),
      mat = new StandardMaterial("ground-mat", s);
    mat.diffuseColor = new Color3(0.07, 0.08, 0.09);
    ground.material = mat;
    roots.current["studio-ground"] = ground;
    for (const prefix of ["fp", "tp"]) {
      const marker = (roots.current[`${prefix}-muzzle`] = new TransformNode(
          `${prefix}-muzzle`,
          s,
        )),
        tip = MeshBuilder.CreateSphere(
          `${prefix}-muzzle-tip`,
          { diameter: 0.045 },
          s,
        ),
        tipMat = new StandardMaterial(`${prefix}-muzzle-material`, s);
      tipMat.emissiveColor = new Color3(1, 0.45, 0.08);
      tip.material = tipMat;
      tip.parent = marker;
      tip.layerMask = 0x10000000;
    }
    const gm = (gizmo.current = new GizmoManager(s));
    gm.utilityLayer.setRenderCamera(cam);
    gm.keepDepthUtilityLayer.setRenderCamera(cam);
    gm.usePointerToAttachGizmos = false;
    gm.positionGizmoEnabled = true;
    gm.rotationGizmoEnabled = false;
    gm.scaleGizmoEnabled = false;
    gm.boundingBoxGizmoEnabled = false;
    const direction = (roots.current["direction-guide"] = new TransformNode(
      "direction-guide",
      s,
    ));
    const arrow = MeshBuilder.CreateLines(
      "front-positive-z",
      {
        points: [
          new Vector3(0, 0.012, -0.6),
          new Vector3(0, 0.012, 1.8),
          new Vector3(-0.16, 0.012, 1.52),
          new Vector3(0, 0.012, 1.8),
          new Vector3(0.16, 0.012, 1.52),
        ],
      },
      s,
    );
    arrow.color = new Color3(0.35, 0.78, 1);
    arrow.parent = direction;
    const releaseFire=()=>{if(testTimer.current)clearInterval(testTimer.current);testTimer.current=undefined;};
    window.addEventListener("pointerup",releaseFire);
    window.addEventListener("blur",releaseFire);
    const resize = () => engine.resize();
    window.addEventListener("resize", resize);
    s.onBeforeAnimationsObservable.add(()=>holdingRig.current?.restore());
    s.onAfterAnimationsObservable.add(()=>{
      if(holdingPreviewRef.current){
        const target=roots.current["tp-support"];
        const config={...holdingRef.current,supportHand:{...holdingRef.current.supportHand,target:target?readTransform(target):holdingRef.current.supportHand.target}};
        holdingRig.current?.apply(config,roots.current["tp-gun"]);
      }
    });
    engine.runRenderLoop(() => s.render());
    return () => {
      stopPreview();
      cancelAnimationFrame(adsAnimation.current);
      if (testTimer.current) clearInterval(testTimer.current);
      for (const url of previewUrls.current) URL.revokeObjectURL(url);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointerup",releaseFire);
      window.removeEventListener("blur",releaseFire);
      engine.dispose();
    };
  }, []);
  useEffect(() => {
    const fp = roots.current["fp-muzzle"],
      tp = roots.current["tp-muzzle"];
    for(const [prefix,key,node] of [["fp","firstPerson",fp],["tp","thirdPerson",tp]] as const){
      if(!node)continue;
      const root=roots.current[prefix+"-gun"],name=effects.muzzleNode?.[key];
      node.parent=name?root?.getChildTransformNodes(false).find(n=>n.name===name)??root:root;
      applyTransform(node,effects.muzzle[key]);
    }
  }, [effects.muzzle,effects.muzzleNode]);
  useEffect(() => {
    if (playerCamera.current)
      playerCamera.current.fov = (previewFov * Math.PI) / 180;
  }, [previewFov]);
  useEffect(() => attach(), [transformTool]);
  useEffect(()=>{
    const gm=gizmo.current;if(!gm)return;
    if(gm.gizmos.positionGizmo)gm.gizmos.positionGizmo.snapDistance=snapEnabled?positionStep:0;
    if(gm.gizmos.rotationGizmo)gm.gizmos.rotationGizmo.snapDistance=snapEnabled?rotationStep*Math.PI/180:0;
    if(gm.gizmos.scaleGizmo)gm.gizmos.scaleGizmo.snapDistance=snapEnabled?scaleStep:0;
  },[positionStep,rotationStep,scaleStep,snapEnabled,transformTool]);
  useEffect(() => {
    const s=scene.current,cam=camera.current,pov=playerCamera.current;
    if(!s||!cam||!pov)return;
    const layout=()=>{
      if(mode==="first-person" && livePreview && !testing){
        cam.viewport=new Viewport(0,0,.55,1);
        const width=s.getEngine().getRenderWidth(),height=s.getEngine().getRenderHeight(),w=Math.min(.44,height*.75*(16/9)/width),h=width*w/(height*(16/9));
        pov.viewport=new Viewport(1-w,(1-h)/2,w,h);
        s.activeCameras=[cam,pov];
      }else{
        cam.viewport=new Viewport(0,0,1,1);pov.viewport=new Viewport(0,0,1,1);
        s.activeCameras=null;s.activeCamera=testing&&mode==="first-person"?pov:cam;
      }
    };
    layout();const observer=s.getEngine().onResizeObservable.add(layout);
    return ()=>{s.getEngine().onResizeObservable.remove(observer);};
  },[mode,livePreview,testing]);
  useEffect(() => {
    if (testTimer.current) {
      clearInterval(testTimer.current);
      testTimer.current = undefined;
      setTesting(false);
    }
    setTesting(false);
    if (scene.current && camera.current)
      scene.current.activeCamera = camera.current;
    for (const [key, node] of Object.entries(roots.current))
      node.setEnabled(
        mode === "first-person"
          ? key.startsWith("fp-")
          : key === "direction-guide" ||
              key === "studio-ground" ||
              key.startsWith("tp-"),
      );
    if (camera.current) {
      camera.current.target =
        mode === "first-person"
          ? new Vector3(0, 0, 0.55)
          : new Vector3(0, 1, 0);
      camera.current.radius = mode === "first-person" ? 2.2 : 4;
    }
    const fallback = mode === "first-person" ? "fp-gun" : "tp-gun";
    setFingers(
      [...fingerNodes.current.keys()]
        .filter((key) =>
          key.startsWith(mode === "first-person" ? "fp:" : "tp:"),
        )
        .map((key) => key.slice(3))
        .sort(),
    );
    setSelected(fallback);
    queueMicrotask(() => attach(fallback));
  }, [mode]);
  useEffect(() => {
    if (panel !== "poses" && panel !== "effects") return;
    const prefix = mode === "first-person" ? "fp" : "tp";
    const key = `${prefix}-${panel === "effects" ? "muzzle" : "gun"}`;
    setSelected(key);
    attach(key);
  }, [panel, mode]);
  async function load(kind: "view" | "character" | "world", file: File) {
    const s = scene.current;
    if (!s) return;
    stopPreview();
    holdingRig.current?.restore();
    if(kind==="character"){
      sharedReference.current=false;
      if(roots.current["tp-gun"])roots.current["tp-gun"].setParent(null);
      holdingRig.current=undefined;weaponSocket.current=undefined;
    }
    if(kind==="world"&&roots.current["tp-support"])roots.current["tp-support"].parent=null;
    if(kind==="world"&&!roots.current["tp-character"])await loadDefaultCharacter();
    const key =
      kind === "view"
        ? "fp-gun"
        : kind === "character"
          ? "tp-character"
          : "tp-gun";
    const muzzle =
      roots.current[
        kind === "view" ? "fp-muzzle" : kind === "world" ? "tp-muzzle" : "none"
      ];
    if (muzzle) muzzle.parent = null;
    roots.current[key]?.dispose();
    files.current[kind] = file;
    if (kind === "character" || kind === "world") thirdPose.current = undefined;
    const root = (roots.current[key] = new TransformNode(key, s));
    const result = await SceneLoader.ImportMeshAsync("", "", file, s);
    for (const node of [...result.transformNodes, ...result.meshes])
      if (!node.parent) node.parent = root;
    if(kind==="character"){
      const fitted=new TransformNode("reference-fit",s);
      for(const child of root.getChildren()) if(child instanceof TransformNode)child.parent=fitted;
      for(const group of result.animationGroups)group.stop();
      const idle=findClip(result.animationGroups,"idle");
      referenceIdle.current=idle;
      if(idle){idle.start(true,1,idle.from,idle.to);idle.setWeightForAllAnimatables(1);idle.goToFrame(idle.from);idle.pause();}
      fitCharacter(fitted,1.8);fitted.parent=root;
      holdingRig.current=new HoldingRig(fitted);
      weaponSocket.current=createWeaponSocket(fitted);
      if(roots.current["tp-gun"]&&weaponSocket.current)roots.current["tp-gun"].setParent(weaponSocket.current);
    }
    if (kind === "view" && roots.current["fp-muzzle"])
      roots.current["fp-muzzle"].parent = root;
    if (kind === "world" && roots.current["tp-muzzle"])
      roots.current["tp-muzzle"].parent = root;
    if (kind === "view" || kind === "character") {
      if (kind === "view") root.position.set(0, 0, 0);
      else root.position.set(0, 0, 0);
      const prefix = kind === "view" ? "fp:" : "tp:";
      for (const key of [...fingerNodes.current.keys()])
        if (key.startsWith(prefix)) fingerNodes.current.delete(key);
      const found = new Set<string>();
      for (const skeleton of result.skeletons)
        for (const bone of skeleton.bones) {
          const node = bone.getTransformNode();
          if (node && (isFinger(bone.name)||(kind==="character"&&isArmJoint(bone.name)))) {
            const label = bone.name;
            fingerNodes.current.set(prefix + label, node);
            found.add(label);
          }
        }
      if (
        (kind === "view" && mode === "first-person") ||
        (kind === "character" && mode === "third-person")
      )
        setFingers([...found].sort());
      setStatus(
        found.size
          ? `Loaded ${kind} with ${found.size} adjustable finger joints.`
          : `${kind} loaded, but this rig exposes no finger bones.`,
      );
      if (kind === "view") {
        for (const mesh of root.getChildMeshes()) mesh.computeWorldMatrix(true);
        const bounds = root.getHierarchyBoundingVectors(true),
          center = bounds.min.add(bounds.max).scale(0.5),
          span = bounds.max.subtract(bounds.min),
          fit = Math.min(1, 1.15 / Math.max(span.x, span.y, span.z, 0.001));
        root.scaling.setAll(fit);
        root.position.set(
          0.1 - center.x * fit,
          -0.12 - center.y * fit,
          0.55 - bounds.min.z * fit,
        );
        hip.current = readTransform(root);
        setAds(readTransform(root));
        hipCaptured.current = false;
      }
    } else {
      root.position.set(0, 1.25, 0.25);
      if(weaponSocket.current)root.setParent(weaponSocket.current);
      const marker=ensureSupportMarker();marker.setParent(root);
      placeSupportAtHand();
    }
    if(kind !== "character") {
    const clipMode = kind === "view" ? "first-person" : "third-person";
    const names = result.animationGroups.map((group) => group.name);
    importedGroups.current[clipMode] = result.animationGroups;
    setClips((value) => ({ ...value, [clipMode]: names }));
    if (names.length) {
      setAnimationMap((value) => {
        const next = { ...value, [clipMode]: { ...value[clipMode] } };
        for (const action of ["idle", "draw", "fire", "reload"] as const) {
          const match = names.find((candidate) =>
            candidate.toLowerCase().includes(action),
          );
          if (!next[clipMode][action])
            next[clipMode][action] = match ?? BUILTIN_ANIMATION;
        }
        return next;
      });
    }
    for(const group of result.animationGroups)group.stop();
    }
    for (const mesh of root.getChildMeshes())
      if (mesh instanceof Mesh) mesh.isPickable = false;
    root.setEnabled(
      mode === "first-person" ? key.startsWith("fp-") : key.startsWith("tp-"),
    );
    setSelected(key);
    attach(key);
  }
  async function loadDefaultCharacter(){
    try{
      const response=await fetch(defaultCharacterUrl);
      if(!response.ok)throw Error("Could not load the game reference");
      await load("character",new File([await response.blob()],"character.glb",{type:"model/gltf-binary"}));
      sharedReference.current=true;
    }catch(error){setStatus((error as Error).message);}
  }
  function selectFinger(name: string) {
    if(mode==="third-person")pauseHoldingForEdit();
    const key = (mode === "first-person" ? "fp:" : "tp:") + name;
    setSelected(`finger:${key}`);
    const node = fingerNodes.current.get(key);
    if (node) {
      node.rotationQuaternion ??= Quaternion.FromEulerAngles(
        node.rotation.x,
        node.rotation.y,
        node.rotation.z,
      );
      pose.current[key] = {
        x: node.rotationQuaternion.x,
        y: node.rotationQuaternion.y,
        z: node.rotationQuaternion.z,
        w: node.rotationQuaternion.w,
      };
      attach(`finger:${key}`);
    }
  }
  function ensureSupportMarker(){
    if(roots.current["tp-support"])return roots.current["tp-support"];
    const marker=new TransformNode("tp-support",scene.current!);
    const sphere=MeshBuilder.CreateSphere("support-hand-target",{diameter:.035},scene.current!);
    const material=new StandardMaterial("support-hand-green",scene.current!);material.emissiveColor=new Color3(.2,1,.55);
    sphere.material=material;sphere.parent=marker;sphere.layerMask=0x10000000;
    roots.current["tp-support"]=marker;return marker;
  }
  function pauseHoldingForEdit(){
    const rig=holdingRig.current;
    const visible=rig?.joints.map(n=>[n,n.rotationQuaternion?.clone()??Quaternion.FromEulerVector(n.rotation)] as const);
    rig?.restore();
    for(const [n,q]of visible??[])n.rotationQuaternion=q;
    holdingPreviewRef.current=false;setHoldingPreview(false);
  }
  function placeSupportAtHand(forward=0){
    const marker=ensureSupportMarker(),gun=roots.current["tp-gun"],hand=holdingRig.current?.left.hand;
    if(!gun||!hand)return;
    hand.computeWorldMatrix(true);
    const world=hand.getWorldMatrix().clone();
    const character=roots.current["tp-character"];
    const direction=Vector3.TransformNormal(new Vector3(0,0,forward),character.computeWorldMatrix(true));
    world.setTranslation(world.getTranslation().add(direction));
    marker.parent=gun;
    applyMatrix(marker,world.multiply(Matrix.Invert(gun.computeWorldMatrix(true))));
    marker.scaling.setAll(1);
    setHolding(h=>({...h,supportHand:{...h.supportHand,target:readTransform(marker)}}));
  }
  function resetReferenceBase(){
    holdingRig.current?.restore();
    const idle=referenceIdle.current;
    if(idle)idle.goToFrame(idle.from);
    for(const [key,q]of Object.entries(pose.current)){
      if(!key.startsWith("tp:")||isArmJoint(key))continue;
      const node=fingerNodes.current.get(key);
      if(node)node.rotationQuaternion=new Quaternion(q.x,q.y,q.z,q.w);
    }
  }
  function chooseHoldingPreset(preset:HoldingPose["preset"]){
    resetReferenceBase();
    setHolding(h=>({...h,preset,arms:{},supportHand:{...h.supportHand,enabled:preset==="rifle"}}));
    if(preset==="rifle")placeSupportAtHand(.18);
    setHoldingPreview(true);
    setStatus(preset==="rifle"?"Rifle starter pose. Move the green support target to the foregrip, then fine-tune its wrist rotation.":"Using the character's pistol stance. Arm and finger adjustments are saved per weapon.");
  }
  function captureArms(){
    const arms=Object.fromEntries((holdingRig.current?.joints??[]).map(n=>{
      const q=n.rotationQuaternion??Quaternion.FromEulerVector(n.rotation);
      return [n.name.slice(n.name.indexOf("mixamorig:")),{x:q.x,y:q.y,z:q.z,w:q.w}];
    }));
    resetReferenceBase();
    setHolding(h=>({...h,arms}));
    setHoldingPreview(true);
    setStatus("Saved this weapon's arm pose. Movement uses it before applying the support-hand target.");
  }
  function mirrorPose() {
    const prefix = mode === "first-person" ? "fp:" : "tp:",
      entries = Object.entries(pose.current).filter(([name]) =>
        name.startsWith(prefix),
      );
    for (const [name, q] of entries) {
      const boneName = name.slice(3),
        oppositeBone = /left/i.test(boneName)
          ? boneName.replace(/left/gi, "Right")
          : /right/i.test(boneName)
            ? boneName.replace(/right/gi, "Left")
            : "";
      const opposite = prefix + oppositeBone;
      const node = fingerNodes.current.get(opposite);
      if (!node) continue;
      node.rotationQuaternion = new Quaternion(-q.x, q.y, q.z, -q.w);
      pose.current[opposite] = {
        x: node.rotationQuaternion.x,
        y: node.rotationQuaternion.y,
        z: node.rotationQuaternion.z,
        w: node.rotationQuaternion.w,
      };
    }
    setStatus("Mirrored available finger joints to the opposite hand.");
  }
  function resetSelected() {
    const key = selectedRef.current;
    if (key.startsWith("finger:")) {
      const n = fingerNodes.current.get(key.slice(7));
      if (n) {
        n.rotationQuaternion = Quaternion.Identity();
        pose.current[key.slice(7)] = { x: 0, y: 0, z: 0, w: 1 };
      }
    } else {
      const n = roots.current[key];
      if (n) applyTransform(n, identity());
    }
    attach();
  }
  function nudgeSelected(field:"x"|"y"|"z"|"pitch"|"yaw"|"roll"|"scale",amount:number){
    const key=selectedRef.current,n=key.startsWith("finger:")?fingerNodes.current.get(key.slice(7)):roots.current[key];
    if(!n)return setStatus("Select a model, muzzle, support target or joint first.");
    const value=readTransform(n);
    value[field]=field==="scale"?Math.max(.001,value[field]+amount):value[field]+amount;
    applyTransform(n,value);attach();
    setStatus(`Nudged ${key} ${field} to ${value[field].toFixed(field==="scale"?4:field==="x"||field==="y"||field==="z"?4:2)}.`);
  }
  function frameFirstPersonModel() {
    const root = roots.current["fp-gun"];
    if (!root) return setStatus("Load the combined first-person model first.");
    applyTransform(root, identity());
    for (const mesh of root.getChildMeshes()) mesh.computeWorldMatrix(true);
    const bounds = root.getHierarchyBoundingVectors(true),
      center = bounds.min.add(bounds.max).scale(0.5),
      span = bounds.max.subtract(bounds.min),
      fit = Math.min(1, 1.15 / Math.max(span.x, span.y, span.z, 0.001));
    root.scaling.setAll(fit);
    root.position.set(
      0.1 - center.x * fit,
      -0.12 - center.y * fit,
      0.55 - bounds.min.z * fit,
    );
    hip.current = readTransform(root);
    setAds(hip.current);
    hipCaptured.current = false;
    setAiming(false);
    setStatus(
      "Model centered in the player viewport. Adjust it, then capture HIP.",
    );
    attach("fp-gun");
  }
  function autoPlaceMuzzle() {
    const root = roots.current[mode === "first-person" ? "fp-gun" : "tp-gun"],
      muzzle =
        roots.current[mode === "first-person" ? "fp-muzzle" : "tp-muzzle"];
    if (!root || !muzzle)
      return setStatus("Load the weapon before placing its muzzle.");
    for (const mesh of root.getChildMeshes()) mesh.computeWorldMatrix(true);
    const bounds = root.getHierarchyBoundingVectors(true),
      point = new Vector3(
        (bounds.min.x + bounds.max.x) / 2,
        (bounds.min.y + bounds.max.y) / 2,
        bounds.max.z,
      );
    root.computeWorldMatrix(true);
    muzzle.position.copyFrom(
      Vector3.TransformCoordinates(point, Matrix.Invert(root.getWorldMatrix())),
    );
    muzzle.rotation.set(0, 0, 0);
    setStatus(
      "Muzzle placed at the +Z edge as a starting point. Fine-tune it to the barrel opening.",
    );
    setSelected(mode === "first-person" ? "fp-muzzle" : "tp-muzzle");
    attach(mode === "first-person" ? "fp-muzzle" : "tp-muzzle");
  }
  function setAdsPreview(next: boolean) {
    const gun = roots.current["fp-gun"];
    if (!gun) return;
    if (next && !hipCaptured.current)
      return setStatus(
        "Capture the HIP pose first, then position and capture ADS.",
      );
    cancelAnimationFrame(adsAnimation.current);
    stopPreview();
    const from = readTransform(gun),
      to = next ? ads : hip.current,
      started = performance.now(),
      fromFov=playerCamera.current?.fov??previewFov*Math.PI/180,
      toFov=previewFov*Math.PI/180*(next?adsFov:1);
    const animate = (now: number) => {
      const raw = Math.min(1, (now - started) / 180),
        t = raw * raw * (3 - 2 * raw);
      blendFrame(gun,from,to,t);
      if(playerCamera.current)playerCamera.current.fov=fromFov+(toFov-fromFov)*t;
      if (raw < 1) adsAnimation.current = requestAnimationFrame(animate);
    };
    adsAnimation.current = requestAnimationFrame(animate);
    setAiming(next);
  }
  function captureAds(ask = true) {
    stopPreview();
    cancelAnimationFrame(adsAnimation.current);
    const gun = roots.current["fp-gun"];
    if (!gun) return;
    if (!hipCaptured.current)
      return setStatus(
        "Capture the HIP pose first. ADS must be derived from that baseline.",
      );
    if (
      ask && !window.confirm(
        "Replace the saved ADS pose with the weapon's current transform?",
      )
    )
      return;
    setAds(readTransform(gun));
    setStatus("Captured the current gun transform as the ADS pose.");
  }
  function captureHip(ask = true) {
    stopPreview();
    const gun = roots.current["fp-gun"];
    if (!gun) return;
    if (
      ask && !window.confirm(
        "Replace the saved HIP pose with the weapon's current transform? ADS will continue to use its separately saved pose.",
      )
    )
      return;
    hip.current = readTransform(gun);
    hipCaptured.current = true;
    setStatus("Captured the current gun transform as the hip pose.");
  }
  function captureFingerPose(targetMode:PoseMode){
    const prefix=targetMode==="first-person"?"fp:":"tp:";
    for(const [key,node]of fingerNodes.current){
      if(!key.startsWith(prefix)||isArmJoint(key))continue;
      const q=node.rotationQuaternion??Quaternion.FromEulerVector(node.rotation);
      pose.current[key]={x:+q.x.toFixed(6),y:+q.y.toFixed(6),z:+q.z.toFixed(6),w:+q.w.toFixed(6)};
    }
  }
  function captureThirdPerson(ask=true){
    stopPreview();
    const gun=roots.current["tp-gun"],character=roots.current["tp-character"];
    if(!gun)return setStatus("Load the third-person weapon first.");
    if(ask&&!window.confirm("Capture the current third-person attachment, arm pose, fingers and support-hand target?"))return;
    thirdPose.current={weapon:readTransform(gun),character:character?readTransform(character):identity()};
    captureArms();captureFingerPose("third-person");
    if(roots.current["tp-support"])setHolding(h=>({...h,supportHand:{...h.supportHand,target:readTransform(roots.current["tp-support"])}}));
    setStatus("Captured third-person attachment, holding pose, fingers and support target.");
  }
  function captureAll(){
    if(mode==="first-person"){
      if(aiming)captureAds(false);else captureHip(false);
      captureFingerPose("first-person");
      const marker=roots.current["fp-muzzle"];
      if(marker)setEffects(v=>({...v,muzzle:{...v.muzzle,firstPerson:readTransform(marker)}}));
      setStatus(`Captured the current ${aiming?"ADS":"HIP"} pose, first-person fingers and muzzle. Switch HIP/ADS and capture the other pose when you adjust it.`);
    }else captureThirdPerson(false);
  }
  async function importPackage(file: File) {
    try {
      setStatus("Opening weapon package…");
      const zip = await JSZip.loadAsync(file),
        entries = Object.values(zip.files),
        manifestEntry = entries.find(
          (entry) => !entry.dir && /(^|\/)weapon\.json$/i.test(entry.name),
        );
      if (!manifestEntry)
        throw new Error("This ZIP does not contain weapon.json.");
      const manifest = JSON.parse(
        await manifestEntry.async("text"),
      ) as WeaponManifest;
      if (
        manifest.version !== 1 ||
        !manifest.id ||
        !manifest.firstPerson ||
        !manifest.effects
      )
        throw new Error("This is not a supported Collateral weapon package.");
      const base = manifestEntry.name.slice(0, -"weapon.json".length);
      const packagedFile = async (
        asset: string | undefined,
        fallbackName: string,
        type: string,
      ) => {
        if (!asset) return undefined;
        const entry =
          zip.file(base + asset) ??
          entries.find(
            (candidate) =>
              !candidate.dir && candidate.name.endsWith("/" + asset),
          );
        if (!entry) throw new Error(`Package is missing ${asset}.`);
        return new File(
          [await entry.async("blob")],
          asset.split("/").pop() ?? fallbackName,
          { type },
        );
      };
      stopPreview();
      holdingRig.current?.restore();
      if(roots.current["tp-gun"])roots.current["tp-gun"].setParent(null);
      if(roots.current["tp-support"])roots.current["tp-support"].parent=null;
      for(const key of ["fp-muzzle","tp-muzzle"])if(roots.current[key])roots.current[key].parent=null;
      for (const key of ["fp-gun", "tp-character", "tp-gun"])
        roots.current[key]?.dispose();
      files.current = {};
      setName(manifest.name);
      setId(manifest.id);
      setSlot(manifest.slot);
      setGameplay(structuredClone(manifest.gameplay));
      setEffects(structuredClone(manifest.effects));
      setAds(structuredClone(manifest.firstPerson.ads));
      setAdsFov(manifest.firstPerson.adsFov);
      setPreviewFov(manifest.firstPerson.previewFov ?? 95);
      setAnimationMap({
        "first-person": Object.fromEntries(
          (["idle", "draw", "fire", "reload"] as AnimationAction[]).map(
            (action) => [
              action,
              manifest.firstPerson.animations?.[action] ?? BUILTIN_ANIMATION,
            ],
          ),
        ),
        "third-person": Object.fromEntries(
          (["idle", "draw", "fire", "reload"] as AnimationAction[]).map(
            (action) => [
              action,
              manifest.thirdPerson.animations?.[action] ?? BUILTIN_ANIMATION,
            ],
          ),
        ),
      });
      const view = await packagedFile(
        manifest.assets.view,
        "view.glb",
        "model/gltf-binary",
      );
      const character = await packagedFile(
        manifest.assets.character,
        "character.glb",
        "model/gltf-binary",
      );
      const world = await packagedFile(
        manifest.assets.world,
        "world.glb",
        "model/gltf-binary",
      );
      const shot = await packagedFile(
        manifest.assets.shotSound,
        "shot.ogg",
        "audio/ogg",
      );
      const reload = await packagedFile(
        manifest.assets.reloadSound,
        "reload.ogg",
        "audio/ogg",
      );
      if (view) await load("view", view);
      if (character) await load("character", character);
      else await loadDefaultCharacter();
      if (world) await load("world", world);
      if (shot) files.current.shotSound = shot;
      if (reload) files.current.reloadSound = reload;
      setAudioNames({shotSound:shot?.name??"",reloadSound:reload?.name??""});
      setAds(structuredClone(manifest.firstPerson.ads));
      setAnimationMap({"first-person":manifest.firstPerson.animations??{},"third-person":manifest.thirdPerson.animations??{}});
      hip.current = structuredClone(manifest.firstPerson.weapon);
      thirdPose.current = {
        weapon: structuredClone(manifest.thirdPerson.weapon),
        character: structuredClone(manifest.thirdPerson.character),
      };
      hipCaptured.current = true;
      if (roots.current["fp-gun"])
        applyTransform(roots.current["fp-gun"], hip.current);
      if (roots.current["tp-character"])
        applyTransform(
          roots.current["tp-character"],
          manifest.thirdPerson.character,
        );
      if (roots.current["tp-gun"]) {
        const gun=roots.current["tp-gun"],character=roots.current["tp-character"],socket=weaponSocket.current;
        gun.parent=socket??null;
        if(manifest.thirdPerson.space==="socket"||(!manifest.thirdPerson.space&&!manifest.firstPerson.editorFramed)){
          applyTransform(gun,manifest.thirdPerson.weapon);
        }else{
          let world=frameMatrix(manifest.thirdPerson.weapon);
          if(!manifest.thirdPerson.space&&manifest.firstPerson.editorFramed){
            const fit=character.getChildTransformNodes(true).find(n=>n.name==="reference-fit");
            if(fit){
              const placement=character.computeWorldMatrix(true);
              const normalization=fit.computeWorldMatrix(true).multiply(Matrix.Invert(placement));
              world=world.multiply(Matrix.Invert(placement)).multiply(normalization).multiply(placement);
            }
          }
          applyMatrix(gun,socket?world.multiply(Matrix.Invert(socket.computeWorldMatrix(true))):world);
        }
        thirdPose.current={weapon:readTransform(gun),character:readTransform(character)};
        const marker=ensureSupportMarker();marker.parent=gun;
        applyTransform(marker,manifest.thirdPerson.holding?.supportHand.target??identity());
      }
      setHolding(manifest.thirdPerson.holding??{preset:"pistol",arms:{},supportHand:{enabled:false,target:identity(),orient:false}});
      setHoldingPreview(true);setIncludeReference(false);
      for(const [prefix,key] of [["fp","firstPerson"],["tp","thirdPerson"]] as const){
        const root=roots.current[prefix+"-gun"],marker=roots.current[prefix+"-muzzle"],name=manifest.effects.muzzleNode?.[key];
        if(marker)marker.parent=name?root?.getChildTransformNodes(false).find(n=>n.name===name)??root:root;
      }
      if (roots.current["fp-muzzle"])
        applyTransform(
          roots.current["fp-muzzle"],
          manifest.effects.muzzle.firstPerson,
        );
      if (roots.current["tp-muzzle"])
        applyTransform(
          roots.current["tp-muzzle"],
          manifest.effects.muzzle.thirdPerson,
        );
      for (const [prefix, values] of [
        ["fp:", manifest.firstPerson.fingers],
        ["tp:", manifest.thirdPerson.fingers ?? {}],
      ] as const)
        for (const [bone, value] of Object.entries(values)) {
          const node = fingerNodes.current.get(prefix + bone);
          if (node)
            node.rotationQuaternion = new Quaternion(
              value.x,
              value.y,
              value.z,
              value.w,
            );
        }
      setMode("first-person");
      setAiming(false);
      setSelected("fp-gun");
      queueMicrotask(() => attach("fp-gun"));
      setStatus(
        `Imported ${manifest.name}. Continue editing from its saved HIP pose.`,
      );
    } catch (error) {
      setStatus((error as Error).message);
    }
  }
  function previewAnimation(action: AnimationAction, targetMode: PoseMode) {
    stopPreview();
    const choice = animationMap[targetMode][action] ?? BUILTIN_ANIMATION;
    const player=new ClipPlayer(importedGroups.current[targetMode],{[action]:choice});
    previewPlayer.current=player;
    if(player.play(action,action==="idle",action==="reload"?gameplay.reloadSeconds:action==="draw"?.55:undefined)){
      player.tick(1);
      return setStatus("Playing the selected model clip / range only.");
    }
    if(choice!==BUILTIN_ANIMATION)return setStatus(choice===NO_ANIMATION?"Animation disabled.":"Selected clip or range is unavailable. No procedural substitute is played.");
    const root =
      roots.current[targetMode === "first-person" ? "fp-gun" : "tp-gun"];
    if (!root) return setStatus("Load this view's weapon model first.");
    const base = readTransform(root),
      duration =
        action === "draw"
          ? 0.55
          : action === "fire"
            ? 0.16
            : action === "reload"
              ? gameplay.reloadSeconds
              : 0.35,
      started = performance.now();
    restorePreview.current=()=>applyTransform(root,base);
    const frame = (now: number) => {
      const t = Math.min(1, (now - started) / (duration * 1000)),
        wave = Math.sin(Math.PI * t),
        next = { ...base };
      if (action === "draw") {
        const p=drawPose(t*.55);
        next.x+=p.x;next.y+=p.y;next.z+=p.z;next.pitch+=p.pitch*180/Math.PI;next.roll+=p.roll*180/Math.PI;
      }
      if (action === "fire") {
        next.z -= 0.055 * wave;
        next.pitch -= 4 * wave;
      }
      if (action === "reload") {
        next.y -= 0.11 * wave;
        next.pitch += 42 * wave;
        next.roll += 16 * wave;
      }
      applyTransform(root, next);
      if (t < 1) proceduralFrame.current=requestAnimationFrame(frame);
      else applyTransform(root, base);
    };
    proceduralFrame.current=requestAnimationFrame(frame);
    setStatus(
      `Playing Collateral built-in ${action}: ${animationLabels[action]}.`,
    );
  }
  function soundInput(kind: "shotSound" | "reloadSound", label: string) {
    return (
      <label>
        {label}
        <input
          type="file"
          accept="audio/*,.ogg,.mp3,.wav"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) { files.current[kind] = file;setAudioNames(v=>({...v,[kind]:file.name})); }
          }}
        />
        <small>{audioNames[kind]||"No sound loaded"}</small>
      </label>
    );
  }
  function testShot() {
    const s = scene.current,
      key = mode === "first-person" ? "fp-muzzle" : "tp-muzzle",
      muzzle = roots.current[key];
    if (!s || !muzzle)
      return setStatus("Load and position a weapon muzzle first.");
    muzzle.computeWorldMatrix(true);
    const start = muzzle.getAbsolutePosition(),
      forward = Vector3.TransformNormal(
        Vector3.Forward(),
        muzzle.getWorldMatrix(),
      ).normalize(),
      end = start.add(forward.scale(Math.min(12, gameplay.range)));
    const flash = MeshBuilder.CreateSphere(
        "preview-flash",
        { diameter: effects.flash.size * 2 },
        s,
      ),
      mat = new StandardMaterial("preview-flash-material", s);
    mat.emissiveColor = Color3.FromHexString(effects.flash.color).scale(
      effects.flash.intensity,
    );
    flash.material = mat;
    flash.position.copyFrom(start);
    const tracer = MeshBuilder.CreateLines(
      "preview-tracer",
      { points: [start, end] },
      s,
    );
    tracer.color = Color3.FromHexString(effects.tracer.color);
    if (effects.tracer.smoke) {
      const smoke = MeshBuilder.CreateSphere(
          "preview-smoke",
          { diameter: effects.flash.size * 0.8 },
          s,
        ),
        smokeMat = new StandardMaterial("preview-smoke-material", s);
      smokeMat.diffuseColor = new Color3(0.35, 0.37, 0.39);
      smokeMat.alpha = 0.28;
      smoke.material = smokeMat;
      smoke.position.copyFrom(start.add(forward.scale(0.05)));
      setTimeout(() => {
        smoke.dispose();
        smokeMat.dispose();
      }, 420);
    }
    setTimeout(
      () => {
        flash.dispose();
        mat.dispose();
      },
      Math.max(20, effects.flash.duration * 1000),
    );
    setTimeout(
      () => tracer.dispose(),
      Math.max(
        60,
        (end.subtract(start).length() / effects.tracer.speed) * 1000,
      ),
    );
    previewAnimation("fire",mode);
    const sound = files.current.shotSound;
    if (sound) {
      const url = URL.createObjectURL(sound);
      previewUrls.current.push(url);
      const audio = new Audio(url);
      void audio.play();
      audio.onended = () => {
        URL.revokeObjectURL(url);
        previewUrls.current = previewUrls.current.filter(
          (item) => item !== url,
        );
      };
    }
    setStatus(
      `${mode === "first-person" ? "First" : "Third"}-person shot preview · ${gameplay.rpm} RPM · ${gameplay.damage} damage.`,
    );
  }
  const latestTestShot=useRef(testShot);
  latestTestShot.current=testShot;
  function toggleTest() {
    if(testTimer.current)clearInterval(testTimer.current);
    testTimer.current=undefined;
    stopPreview();
    setTesting(v=>!v);
  }
  async function exportWeapon() {
    try {
      stopPreview();
      if (!files.current.view && !files.current.world)
        throw new Error("Load at least one weapon GLB.");
      if(files.current.world&&!weaponSocket.current)throw new Error("Load a supported reference with a right-hand joint before exporting a third-person weapon.");
      if (!clean(id)) throw new Error("Enter a valid weapon ID.");
      for(const view of ["first-person","third-person"] as const)for(const [action,binding] of Object.entries(animationMap[view])){
        if(typeof binding!=="object")continue;
        const source=importedGroups.current[view].find(g=>g.name===binding.clip);
        if(!source||!Number.isFinite(binding.from)||!Number.isFinite(binding.to)||binding.from<source.from||binding.to>source.to||binding.to<binding.from)
          throw Error(`${view} ${action}: range must fit inside its source timeline.`);
      }
      setExporting(true);
      for (const [finger, node] of fingerNodes.current) {
        if(isArmJoint(finger))continue;
        const q =
          node.rotationQuaternion ??
          Quaternion.FromEulerAngles(
            node.rotation.x,
            node.rotation.y,
            node.rotation.z,
          );
        pose.current[finger] = {
          x: +q.x.toFixed(6),
          y: +q.y.toFixed(6),
          z: +q.z.toFixed(6),
          w: +q.w.toFixed(6),
        };
      }
      const weaponId = clean(id);
      const manifest: WeaponManifest = {
        version: 1,
        id: weaponId,
        name: name.trim(),
        slot,
        assets: {
          view: files.current.view ? "view.glb" : undefined,
          character: includeReference && !sharedReference.current && files.current.character ? "character.glb" : undefined,
          world: files.current.world ? "world.glb" : undefined,
          shotSound: files.current.shotSound
            ? `shot.${files.current.shotSound.name.split(".").pop() ?? "ogg"}`
            : undefined,
          reloadSound: files.current.reloadSound
            ? `reload.${files.current.reloadSound.name.split(".").pop() ?? "ogg"}`
            : undefined,
        },
        gameplay,
        effects: {
          ...effects,
          muzzle: {
            firstPerson: roots.current["fp-muzzle"]
              ? readTransform(roots.current["fp-muzzle"])
              : effects.muzzle.firstPerson,
            thirdPerson: roots.current["tp-muzzle"]
              ? readTransform(roots.current["tp-muzzle"])
              : effects.muzzle.thirdPerson,
          },
        },
        firstPerson: {
          arms: identity(),
          weapon: hip.current,
          ads,
          adsFov,
          fingers: Object.fromEntries(
            Object.entries(pose.current)
              .filter(([key]) => key.startsWith("fp:"))
              .map(([key, value]) => [key.slice(3), value]),
          ),
          animations: animationMap["first-person"],
          editorFramed: true,
          previewFov,
        },
        thirdPerson: {
          space: "socket",
          characterId: "swat",
          holding:{...holding,supportHand:{...holding.supportHand,target:roots.current["tp-support"]?readTransform(roots.current["tp-support"]):holding.supportHand.target}},
          character: thirdPose.current?.character ?? (roots.current["tp-character"]
            ? readTransform(roots.current["tp-character"])
            : identity()),
          weapon: thirdPose.current?.weapon ?? (roots.current["tp-gun"]
            ? readTransform(roots.current["tp-gun"])
            : identity()),
          fingers: Object.fromEntries(
            Object.entries(pose.current)
              .filter(([key]) => key.startsWith("tp:") && !isArmJoint(key))
              .map(([key, value]) => [key.slice(3), value]),
          ),
          animations: animationMap["third-person"],
        },
      };
      const zip = new JSZip(),
        folder = zip.folder(slot)!.folder(weaponId)!;
      folder.file("weapon.json", JSON.stringify(manifest, null, 2));
      for (const [key, file] of Object.entries(files.current)) {
        if(key==="character"&&(!includeReference||sharedReference.current))continue;
        folder.file(
          key === "shotSound"
            ? `shot.${file.name.split(".").pop() ?? "ogg"}`
            : key === "reloadSound"
              ? `reload.${file.name.split(".").pop() ?? "ogg"}`
              : `${key === "view" ? "view" : key === "world" ? "world" : key}.glb`,
          await file.arrayBuffer(),
        );
      }
      folder.file(
        "INSTALL.txt",
        `Copy the ${slot}/${weaponId} folder into client/public/weapons/${slot}/${weaponId}, then restart the server.`,
      );
      download(
        await zip.generateAsync({
          type: "blob",
          compression: "DEFLATE",
          compressionOptions: { level: 6 },
        }),
        `${weaponId}-${slot}.zip`,
      );
      setStatus(`Exported ${name} as a ${slot} weapon package.`);
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  const fileInput = (kind: "view" | "character" | "world", label: string) => (
    <label>
      {label}
      <input
        type="file"
        accept=".glb"
        onChange={(e) =>
          e.target.files?.[0] && void load(kind, e.target.files[0])
        }
      />
    </label>
  );
  const number = (
    label: string,
    value: number,
    onChange: (value: number) => void,
    step = 0.01,
    min = 0,
  ) => (
    <label>
      {label}
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
  const animationConnector = (targetMode: PoseMode) => (
    <section hidden={panel !== "animations"}>
      <h2>Animation connector</h2>
      <p>
        Map animation clips embedded in this GLB to the actions used by the
        game. Select one source per action, or split a combined timeline using Start / End frames (Babylon imported frame numbers).
      </p>
      {!clips[targetMode].length && (
        <p className="warning">Load the model to inspect its animations.</p>
      )}
      {(["idle", "draw", "fire", "reload"] as AnimationAction[]).map(
        (action) => (
          <div key={action} className="animation-map-row">
            <span>{action.toUpperCase()}</span>
            <select
              value={typeof animationMap[targetMode][action]==="object" ? (animationMap[targetMode][action] as Exclude<AnimationBinding,string>).clip : animationMap[targetMode][action] as string ?? BUILTIN_ANIMATION}
              onChange={(event) =>
                setAnimationMap((value) => ({
                  ...value,
                  [targetMode]: {
                    ...value[targetMode],
                    [action]: event.target.value,
                  },
                }))
              }
            >
              <option value={BUILTIN_ANIMATION}>
                COLLATERAL BUILT-IN · {animationLabels[action]}
              </option>
              <option value={NO_ANIMATION}>NONE · no animation</option>
              {clips[targetMode].map((clip) => (
                <option key={clip} value={clip}>
                  MODEL CLIP · {clip}
                </option>
              ))}
            </select>
            {typeof animationMap[targetMode][action]==="object" && (["from","to","speed"] as const).map(field=> {
              const binding=animationMap[targetMode][action] as Exclude<AnimationBinding,string>;
              return number(field==="speed"?"Speed":field==="from"?"Start frame":"End frame",binding[field]??1,v=>setAnimationMap(m=>({...m,[targetMode]:{...m[targetMode],[action]:{...binding,[field]:v}}})),field==="speed"?.05:1);
            })}
            <button type="button" onClick={()=>{
              const binding=animationMap[targetMode][action];
              if(typeof binding==="object")return setAnimationMap(m=>({...m,[targetMode]:{...m[targetMode],[action]:binding.clip}}));
              const group=importedGroups.current[targetMode].find(g=>g.name===binding);
              if(!group)return setStatus("Choose a model clip first, then define its frame range.");
              setAnimationMap(m=>({...m,[targetMode]:{...m[targetMode],[action]:{clip:group.name,from:group.from,to:group.to,speed:1}}}));
            }}>{typeof animationMap[targetMode][action]==="object"?"USE FULL CLIP":"SET FRAME RANGE"}</button>
            <button
              type="button"
              onClick={() => previewAnimation(action, targetMode)}
            >
              ▶ PLAY
            </button>
          </div>
        ),
      )}
    </section>
  );
  return (
    <div className="app framer">
      <header>
        <b>C/</b>
        <div>
          <h1>CHARACTER / WEAPON FRAMER</h1>
          <small>WEAPON PACKAGE V1</small>
        </div>
        <button className="home" onClick={onHome}>
          ENGINE HOME
        </button>
        <button
          className="export"
          disabled={exporting}
          onClick={() => void exportWeapon()}
        >
          {exporting ? "EXPORTING…" : "EXPORT WEAPON PACKAGE"}
        </button>
      </header>
      <aside>
        <nav className="framer-tabs" aria-label="Framer panels">
          {["models", "poses", "holding", "save", "animations", "rules", "audio", "effects"].map((tab) => (
            <button key={tab} className={panel === tab ? "selected" : ""} onClick={() => setPanel(tab)}>{tab.toUpperCase()}</button>
          ))}
        </nav>
        <section hidden={panel !== "models"}>
          <h2>1 · Weapon</h2>
          <label>
            Continue from exported package
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={(event) =>
                event.target.files?.[0] &&
                void importPackage(event.target.files[0])
              }
            />
          </label>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Folder ID
            <input value={id} onChange={(e) => setId(clean(e.target.value))} />
          </label>
          <label>
            Inventory slot
            <select
              value={slot}
              onChange={(e) => setSlot(e.target.value as Slot)}
            >
              <option value="primary">Primary</option>
              <option value="secondary">Secondary</option>
            </select>
          </label>
        </section>
        {mode === "first-person" && (
          <section hidden={panel !== "poses" && panel !== "models"}>
            <h2>2 · First person</h2>
            {panel==="models" && fileInput("view", "Combined arms + weapon GLB")}
            <div hidden={panel!=="poses"}>
            <p>
              The camera is the player's fixed eye position. Move the combined
              model into the viewport.
            </p>
            <button onClick={frameFirstPersonModel}>
              AUTO-FRAME IN VIEWPORT
            </button>
            <div className="row">
              <button
                className={!aiming ? "selected" : ""}
                onClick={() => setAdsPreview(false)}
              >
                HIP VIEW
              </button>
              <button
                className={aiming ? "selected" : ""}
                onClick={() => setAdsPreview(true)}
              >
                ADS VIEW
              </button>
            </div>
            {number("ADS FOV multiplier", adsFov, setAdsFov, 0.01, 0.5)}
            {number(
              "Preview FOV (matches game setting)",
              previewFov,
              setPreviewFov,
              1,
              60,
            )}
            </div>
          </section>
        )}
        <section hidden={panel!=="save"}>
          <h2>Save · {mode==="first-person"?"First person":"Third person"}</h2>
          <p>Capture adjusted values before export. Export also reads live transforms, but these buttons create explicit restore points.</p>
          {mode==="first-person"?<>
            <button onClick={()=>captureHip()}>CAPTURE HIP POSE</button>
            <button onClick={()=>captureAds()}>CAPTURE ADS POSE</button>
            <button onClick={()=>{captureFingerPose("first-person");setStatus("Captured first-person finger pose.");}}>CAPTURE FINGER POSE</button>
            <button onClick={()=>{const marker=roots.current["fp-muzzle"];if(!marker)return setStatus("Load a first-person muzzle first.");setEffects(v=>({...v,muzzle:{...v.muzzle,firstPerson:readTransform(marker)}}));setStatus("Captured first-person muzzle placement.");}}>CAPTURE MUZZLE PLACEMENT</button>
            <button className="capture-all" onClick={captureAll}>CAPTURE ALL CURRENT FIRST-PERSON VALUES</button>
            <p className="warning">Capture All stores whichever baseline is visible now: HIP or ADS. Toggle the other view and capture it separately after changing it.</p>
          </>:<>
            <button onClick={()=>captureThirdPerson()}>CAPTURE ATTACHMENT + HOLDING POSE</button>
            <button onClick={()=>{captureArms();captureFingerPose("third-person");}}>CAPTURE ARM + FINGER POSE</button>
            <button onClick={()=>{const marker=roots.current["tp-muzzle"];if(!marker)return setStatus("Load a third-person muzzle first.");setEffects(v=>({...v,muzzle:{...v.muzzle,thirdPerson:readTransform(marker)}}));setStatus("Captured third-person muzzle placement.");}}>CAPTURE MUZZLE PLACEMENT</button>
            <button onClick={()=>{const saved=thirdPose.current;if(!saved)return setStatus("Capture a third-person pose first.");if(roots.current["tp-gun"])applyTransform(roots.current["tp-gun"],saved.weapon);if(roots.current["tp-character"])applyTransform(roots.current["tp-character"],saved.character);setStatus("Restored captured third-person attachment.");}}>RESTORE CAPTURED ATTACHMENT</button>
            <button className="capture-all" onClick={captureAll}>CAPTURE ALL THIRD-PERSON VALUES</button>
          </>}
        </section>
        {mode === "first-person" && animationConnector("first-person")}
        {mode === "third-person" && (
          <section hidden={panel !== "poses" && panel !== "models"}>
            <h2>3 · Third person</h2>
            <div hidden={panel!=="models"}>
            <p>Reference only: use the same rig and idle pose as the match character. Importing a different reference does not replace the in-game player.</p>
            <button onClick={()=>void loadDefaultCharacter()}>LOAD GAME SWAT REFERENCE</button>
            {fileInput("character", "Custom reference character GLB (preview only)")}
            <label className="check"><input type="checkbox" checked={includeReference} onChange={e=>setIncludeReference(e.target.checked)}/>Include custom reference in ZIP for editing (shared SWAT is never duplicated)</label>
            {fileInput("world", "World weapon GLB")}
            </div>
            <div hidden={panel!=="poses"}>
<p>Adjust the attachment here. Capture and restore controls are grouped in Save.</p>
            </div>
          </section>
        )}
        {mode === "third-person" && animationConnector("third-person")}
        <section hidden={panel !== "poses" && panel !== "effects"}>
          <h2>{panel === "effects" ? "Muzzle placement" : "Weapon alignment"}</h2>
          <p>
            <strong>FRONT = +Z</strong> · Blue arrow points toward the muzzle
            and firing direction.
          </p>
          <div className="row" hidden={panel !== "poses"}>
            <button
              onClick={() => {
                const k = mode === "first-person" ? "fp-gun" : "tp-character";
                setSelected(k);
                attach(k);
              }}
            >
              {mode === "first-person" ? "COMBINED VIEW MODEL" : "CHARACTER"}
            </button>
            {mode === "third-person" && (
              <button
                onClick={() => {
                  const k = "tp-gun";
                  setSelected(k);
                  attach(k);
                }}
              >
                WEAPON
              </button>
            )}
          </div>
          <div className="tool-switch" aria-label="Transform tool">
            {(["move", "rotate", "scale"] as TransformTool[]).map((tool) => (
              <button
                key={tool}
                className={transformTool === tool ? "selected" : ""}
                onClick={() => setTransformTool(tool)}
              >
                {tool.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="precision-controls">
            <h3>PRECISION ALIGNMENT</h3>
            <p>Selected: <strong>{selected}</strong>. Snap affects the gizmo; nudge buttons move by exactly the values below.</p>
            <label className="check"><input type="checkbox" checked={snapEnabled} onChange={e=>setSnapEnabled(e.target.checked)}/>Snap transform gizmos</label>
            <div className="precision-steps">
              <label>Position step (m)<input type="number" min="0.0001" max="0.1" step="0.0001" value={positionStep} onChange={e=>setPositionStep(Math.max(.0001,e.target.valueAsNumber||.001))}/></label>
              <label>Rotation step (°)<input type="number" min="0.01" max="15" step="0.01" value={rotationStep} onChange={e=>setRotationStep(Math.max(.01,e.target.valueAsNumber||.1))}/></label>
              <label>Scale step<input type="number" min="0.0001" max="0.1" step="0.0001" value={scaleStep} onChange={e=>setScaleStep(Math.max(.0001,e.target.valueAsNumber||.001))}/></label>
            </div>
            <div className="nudge-grid">
              {(["x","y","z"] as const).flatMap(axis=>[<button key={axis+"-"} onClick={()=>nudgeSelected(axis,-positionStep)}>{axis.toUpperCase()} −</button>,<button key={axis+"+"} onClick={()=>nudgeSelected(axis,positionStep)}>{axis.toUpperCase()} +</button>])}
              {(["pitch","yaw","roll"] as const).flatMap(axis=>[<button key={axis+"-"} onClick={()=>nudgeSelected(axis,-rotationStep)}>{axis.toUpperCase()} −</button>,<button key={axis+"+"} onClick={()=>nudgeSelected(axis,rotationStep)}>{axis.toUpperCase()} +</button>])}
              <button onClick={()=>nudgeSelected("scale",-scaleStep)}>SCALE −</button><button onClick={()=>nudgeSelected("scale",scaleStep)}>SCALE +</button>
            </div>
          </div>
          <button onClick={resetSelected}>RESET SELECTED AXES</button>
          <div hidden={panel !== "effects"}>
          <button
            onClick={() => {
              const key = mode === "first-person" ? "fp-muzzle" : "tp-muzzle";
              setSelected(key);
              attach(key);
            }}
          >
            SELECT MUZZLE SOCKET
          </button>
          <label>Muzzle follows
            <select value={effects.muzzleNode?.[mode==="first-person"?"firstPerson":"thirdPerson"]??""} onChange={e=>{
              const prefix=mode==="first-person"?"fp":"tp",key=mode==="first-person"?"firstPerson":"thirdPerson",
                root=roots.current[prefix+"-gun"],marker=roots.current[prefix+"-muzzle"];
              if(!root||!marker)return;
              const name=e.target.value;
              marker.setParent(name?root.getChildTransformNodes(false).find(n=>n.name===name)??root:root);
              setEffects(v=>({...v,muzzleNode:{...v.muzzleNode,[key]:name||undefined},muzzle:{...v.muzzle,[key]:readTransform(marker)}}));
            }}>
              <option value="">Weapon root</option>
              {(roots.current[mode==="first-person"?"fp-gun":"tp-gun"]?.getChildTransformNodes(false)??[]).filter(n=>!n.name.includes("muzzle")).map(n=><option key={n.uniqueId} value={n.name}>{n.name}</option>)}
            </select>
          </label>
          <button onClick={autoPlaceMuzzle}>
            AUTO-PLACE MUZZLE AT +Z FRONT
          </button>
          </div>
        </section>
        {mode==="third-person"&&<section hidden={panel!=="holding"}>
          <h2>Weapon holding pose · SWAT</h2>
          <p>The gun is attached to the right hand. Pose the arms and move the green target to where the left hand should grip this weapon. This only changes third person.</p>
          <label>Starting stance<select value={holding.preset} onChange={e=>chooseHoldingPreset(e.target.value as HoldingPose["preset"])}>
            <option value="pistol">Pistol · authored stance</option><option value="rifle">Rifle · compact starter</option><option value="custom">Custom</option>
          </select></label>
          <button onClick={()=>{if(holdingPreview)pauseHoldingForEdit();else {resetReferenceBase();setHoldingPreview(true);}}}>{holdingPreview?"PAUSE GRIP PREVIEW TO POSE JOINTS":"PREVIEW SAVED GRIP"}</button>

          <label className="check"><input type="checkbox" checked={holding.supportHand.enabled} onChange={e=>setHolding(h=>({...h,supportHand:{...h.supportHand,enabled:e.target.checked}}))}/>Left hand follows support target (IK)</label>
          <label className="check"><input type="checkbox" checked={holding.supportHand.orient} onChange={e=>setHolding(h=>({...h,supportHand:{...h.supportHand,orient:e.target.checked}}))}/>Use target rotation for wrist</label>
          <button onClick={()=>{const marker=ensureSupportMarker();if(roots.current["tp-gun"]&&!marker.parent)marker.parent=roots.current["tp-gun"];setSelected("tp-support");attach("tp-support");}}>MOVE / ROTATE SUPPORT HAND TARGET</button>
          <button onClick={()=>placeSupportAtHand()}>SNAP TARGET TO CURRENT LEFT HAND</button>
          <div className="tool-switch">{(["move","rotate"] as TransformTool[]).map(t=><button key={t} className={transformTool===t?"selected":""} onClick={()=>setTransformTool(t)}>{t.toUpperCase()}</button>)}</div>
          <button onClick={()=>{resetReferenceBase();setHolding(h=>({...h,preset:"pistol",arms:{},supportHand:{...h.supportHand,enabled:false}}));setHoldingPreview(true);}}>RESET HOLD TO AUTHORED PISTOL</button>
          <p>Arm overrides and support IK release during reload and death. Targets outside arm reach are clamped; the skeleton is never stretched.</p>
        </section>}
        {fingers.length > 0 && (
          <section hidden={panel !== "poses" && panel !== "holding"}>
            <h2>Arm and finger joints</h2>
            <p>
              Select an arm or finger joint, then use the rotation rings. Save arm changes in the Holding tab. Finger poses
              export by bone name.
            </p>
            {!fingers.length && (
              <p className="warning">
                No adjustable finger bones detected yet.
              </p>
            )}
            <div className="finger-list">
              {fingers.map((f) => (
                <button
                  className={
                    selected ===
                    `finger:${mode === "first-person" ? "fp:" : "tp:"}${f}`
                      ? "selected"
                      : ""
                  }
                  key={f}
                  onClick={() => selectFinger(f)}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="row">
              <button onClick={mirrorPose}>MIRROR POSE</button>
              <button
                onClick={() => {
                  pose.current = {};
                  setStatus(
                    "Cleared exported finger overrides. Reload arms to restore the authored pose visually.",
                  );
                }}
              >
                CLEAR POSE
              </button>
            </div>
          </section>
        )}
        <section hidden={panel !== "rules"}>
          <h2>6 · Ballistics</h2>
          <label>
            Fire mode
            <select
              aria-label="Fire mode"
              value={gameplay.fireMode ?? "semi"}
              onChange={(event) => setGameplay((current) => ({
                ...current,
                fireMode: event.target.value === "auto" ? "auto" : "semi",
              }))}
            >
              <option value="semi">Semi automatic · one shot per press</option>
              <option value="auto">Automatic · hold to fire</option>
            </select>
          </label>
          <p>Automatic fire repeats while the trigger is held, at the Fire rate (RPM) below.</p>
          <p>
            Magazine and reserve belong to this weapon package and remain
            independent when players switch guns.
          </p>
          <div className="row">
            {number(
              "Damage",
              gameplay.damage,
              (v) => setGameplay((g) => ({ ...g, damage: v })),
              1,
            )}
            {number(
              "Head multiplier",
              gameplay.headshotMultiplier,
              (v) => setGameplay((g) => ({ ...g, headshotMultiplier: v })),
              0.1,
            )}
          </div>
          <div className="row">
            {number(
              "Range (m)",
              gameplay.range,
              (v) => setGameplay((g) => ({ ...g, range: v })),
              1,
            )}
            {number(
              "Fire rate (RPM)",
              gameplay.rpm,
              (v) => setGameplay((g) => ({ ...g, rpm: v })),
              10,
              30,
            )}
          </div>
          <div className="row">
            {number(
              "Magazine",
              gameplay.magazine,
              (v) => setGameplay((g) => ({ ...g, magazine: v })),
              1,
              1,
            )}
            {number(
              "Reserve",
              gameplay.reserve,
              (v) => setGameplay((g) => ({ ...g, reserve: v })),
              1,
            )}
          </div>
          {number(
            "Reload seconds",
            gameplay.reloadSeconds,
            (v) => setGameplay((g) => ({ ...g, reloadSeconds: v })),
            0.05,
            0.1,
          )}
          <h3>Spread (radians)</h3>
          <div className="row">
            {number(
              "Standing",
              gameplay.spread.standing,
              (v) =>
                setGameplay((g) => ({
                  ...g,
                  spread: { ...g.spread, standing: v },
                })),
              0.0001,
            )}
            {number(
              "Moving",
              gameplay.spread.moving,
              (v) =>
                setGameplay((g) => ({
                  ...g,
                  spread: { ...g.spread, moving: v },
                })),
              0.0001,
            )}
          </div>
          <div className="row">
            {number(
              "Crouched",
              gameplay.spread.crouched,
              (v) =>
                setGameplay((g) => ({
                  ...g,
                  spread: { ...g.spread, crouched: v },
                })),
              0.0001,
            )}
            {number(
              "ADS",
              gameplay.spread.ads,
              (v) =>
                setGameplay((g) => ({ ...g, spread: { ...g.spread, ads: v } })),
              0.0001,
            )}
          </div>
          <h3>Recoil</h3>
          <div className="row">
            {number(
              "Pitch",
              gameplay.recoil.pitch,
              (v) =>
                setGameplay((g) => ({
                  ...g,
                  recoil: { ...g.recoil, pitch: v },
                })),
              0.05,
            )}
            {number(
              "Yaw",
              gameplay.recoil.yaw,
              (v) =>
                setGameplay((g) => ({ ...g, recoil: { ...g.recoil, yaw: v } })),
              0.05,
            )}
          </div>
          {number(
            "Recovery",
            gameplay.recoil.recovery,
            (v) =>
              setGameplay((g) => ({
                ...g,
                recoil: { ...g.recoil, recovery: v },
              })),
            0.5,
          )}
        </section>
        <section hidden={panel !== "audio"}>
          <h2>7 · Audio</h2>
          {soundInput("shotSound", "Fire sound")}
          {soundInput("reloadSound", "Reload sound")}
        </section>
        <section hidden={panel !== "effects"}>
          <h2>8 · Effects</h2>
          <label>
            Flash color
            <div className="color-field">
              <input
                type="color"
                value={effects.flash.color}
                onChange={(e) =>
                  setEffects((v) => ({
                    ...v,
                    flash: { ...v.flash, color: e.target.value },
                  }))
                }
              />
              <input
                aria-label="Flash color hex"
                value={effects.flash.color}
                onChange={(e) => {
                  const color = e.target.value;
                  if (/^#[0-9a-f]{6}$/i.test(color))
                    setEffects((v) => ({ ...v, flash: { ...v.flash, color } }));
                }}
              />
            </div>
          </label>
          <div className="row">
            {number(
              "Flash size",
              effects.flash.size,
              (v) =>
                setEffects((e) => ({ ...e, flash: { ...e.flash, size: v } })),
              0.01,
            )}
            {number(
              "Brightness",
              effects.flash.intensity,
              (v) =>
                setEffects((e) => ({
                  ...e,
                  flash: { ...e.flash, intensity: v },
                })),
              0.1,
            )}
          </div>
          {number(
            "Flash duration",
            effects.flash.duration,
            (v) =>
              setEffects((e) => ({ ...e, flash: { ...e.flash, duration: v } })),
            0.005,
          )}
          <label>
            Tracer color
            <input
              type="color"
              value={effects.tracer.color}
              onChange={(e) =>
                setEffects((v) => ({
                  ...v,
                  tracer: { ...v.tracer, color: e.target.value },
                }))
              }
            />
          </label>
          <div className="row">
            {number(
              "Tracer width",
              effects.tracer.width,
              (v) =>
                setEffects((e) => ({
                  ...e,
                  tracer: { ...e.tracer, width: v },
                })),
              0.001,
            )}
            {number(
              "Tracer length",
              effects.tracer.length,
              (v) =>
                setEffects((e) => ({
                  ...e,
                  tracer: { ...e.tracer, length: v },
                })),
              0.1,
            )}
          </div>
          {number(
            "Tracer speed",
            effects.tracer.speed,
            (v) =>
              setEffects((e) => ({ ...e, tracer: { ...e.tracer, speed: v } })),
            10,
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={effects.tracer.smoke}
              onChange={(e) =>
                setEffects((v) => ({
                  ...v,
                  tracer: { ...v.tracer, smoke: e.target.checked },
                }))
              }
            />{" "}
            Barrel smoke
          </label>
        </section>
        <footer>{status}</footer>
      </aside>
      <main>
        <canvas ref={canvas} onPointerDown={e=>{
          if(!testing||e.button!==0)return;
          testShot();
          if(gameplay.fireMode==="auto"){
            if(testTimer.current)clearInterval(testTimer.current);
            testTimer.current=window.setInterval(()=>latestTestShot.current(),Math.max(60,60000/gameplay.rpm));
          }
        }} />
        {mode === "first-person" && (
          <div className={`viewport-guide ${livePreview&&!testing?"live-camera-guide":""}`}>
            <span>PLAYER VIEWPORT · {previewFov}° HORIZONTAL FOV</span>
            <i>FRONT +Z →</i>
          </div>
        )}
        {mode === "third-person" && (
          <div className="front-badge">FRONT / FIRE DIRECTION · +Z ↑</div>
        )}
        <div className="mode-switch">
          <button
            className={mode === "first-person" ? "selected" : ""}
            onClick={() => setMode("first-person")}
          >
            FIRST PERSON
          </button>
          <button
            className={mode === "third-person" ? "selected" : ""}
            onClick={() => setMode("third-person")}
          >
            THIRD PERSON
          </button>
        </div>
        <div className="preview-controls">
          {mode==="first-person" && <button onClick={()=>setLivePreview(v=>!v)}>{livePreview?"HIDE LIVE CAMERA":"SHOW LIVE CAMERA"}</button>}
          <button onClick={testShot}>FIRE ONCE</button>
          <button onClick={toggleTest}>
            {testing ? "■ STOP TEST" : "▶ PLAY TEST"}
          </button>
          <button
            onClick={() => setAdsPreview(!aiming)}
            disabled={mode !== "first-person"}
          >
            {aiming ? "EXIT ADS" : "TEST ADS"}
          </button>
        </div>
        <div className="help">
          {testing && mode === "first-person"
            ? "PLAYER CAMERA PREVIEW · CLICK TO FIRE · HOLD FOR AUTOMATIC"
            : "EDIT VIEW · SELECT AN OBJECT, THEN DRAG ITS AXIS GIZMO"}
        </div>
      </main>
    </div>
  );
}
