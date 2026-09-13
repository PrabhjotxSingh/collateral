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
const readTransform = (n: TransformNode): Transform => ({
  x: +n.position.x.toFixed(4),
  y: +n.position.y.toFixed(4),
  z: +n.position.z.toFixed(4),
  pitch: +((n.rotation.x * 180) / Math.PI).toFixed(3),
  yaw: +((n.rotation.y * 180) / Math.PI).toFixed(3),
  roll: +((n.rotation.z * 180) / Math.PI).toFixed(3),
  scale: +n.scaling.x.toFixed(4),
});
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
    [panel, setPanel] = useState("models"),
    [transformTool, setTransformTool] = useState<TransformTool>("move"),
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
      Record<PoseMode, Partial<Record<AnimationAction, string>>>
    >({ "first-person": {}, "third-person": {} }),
    [fingers, setFingers] = useState<string[]>([]),
    [exporting, setExporting] = useState(false);
  const hip = useRef<Transform>(identity()),
    thirdPose = useRef<{ weapon: Transform; character: Transform } | undefined>(undefined),
    hipCaptured = useRef(false),
    transformToolRef = useRef<TransformTool>("move"),
    adsAnimation = useRef(0),
    previewUrls = useRef<string[]>([]),
    testTimer = useRef<number | undefined>(undefined);
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
    }
    const gm = (gizmo.current = new GizmoManager(s));
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
    const resize = () => engine.resize();
    window.addEventListener("resize", resize);
    engine.runRenderLoop(() => s.render());
    return () => {
      if (testTimer.current) clearInterval(testTimer.current);
      for (const url of previewUrls.current) URL.revokeObjectURL(url);
      window.removeEventListener("resize", resize);
      engine.dispose();
    };
  }, []);
  useEffect(() => {
    const fp = roots.current["fp-muzzle"],
      tp = roots.current["tp-muzzle"];
    if (fp) applyTransform(fp, effects.muzzle.firstPerson);
    if (tp) applyTransform(tp, effects.muzzle.thirdPerson);
  }, [effects.muzzle]);
  useEffect(() => {
    if (playerCamera.current)
      playerCamera.current.fov = (previewFov * Math.PI) / 180;
  }, [previewFov]);
  useEffect(() => attach(), [transformTool]);
  useEffect(() => {
    if (testTimer.current) {
      clearInterval(testTimer.current);
      testTimer.current = undefined;
      setTesting(false);
    }
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
  async function load(kind: "view" | "character" | "world", file: File) {
    const s = scene.current;
    if (!s) return;
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
          if (node && isFinger(bone.name)) {
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
    } else root.position.set(0, 1.25, 0.25);
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
    for (const mesh of root.getChildMeshes())
      if (mesh instanceof Mesh) mesh.isPickable = false;
    root.setEnabled(
      mode === "first-person" ? key.startsWith("fp-") : key.startsWith("tp-"),
    );
    setSelected(key);
    attach(key);
  }
  function selectFinger(name: string) {
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
    if (next) applyTransform(gun, hip.current);
    const from = readTransform(gun),
      to = next ? ads : hip.current,
      started = performance.now();
    const animate = (now: number) => {
      const raw = Math.min(1, (now - started) / 220),
        t = raw * raw * (3 - 2 * raw);
      const mix = (a: number, b: number) => a + (b - a) * t;
      applyTransform(gun, {
        x: mix(from.x, to.x),
        y: mix(from.y, to.y),
        z: mix(from.z, to.z),
        pitch: mix(from.pitch, to.pitch),
        yaw: mix(from.yaw, to.yaw),
        roll: mix(from.roll, to.roll),
        scale: mix(from.scale, to.scale),
      });
      if (raw < 1) adsAnimation.current = requestAnimationFrame(animate);
    };
    adsAnimation.current = requestAnimationFrame(animate);
    setAiming(next);
  }
  function captureAds() {
    const gun = roots.current["fp-gun"];
    if (!gun) return;
    if (!hipCaptured.current)
      return setStatus(
        "Capture the HIP pose first. ADS must be derived from that baseline.",
      );
    if (
      !window.confirm(
        "Replace the saved ADS pose with the weapon's current transform?",
      )
    )
      return;
    setAds(readTransform(gun));
    setStatus("Captured the current gun transform as the ADS pose.");
  }
  function captureHip() {
    const gun = roots.current["fp-gun"];
    if (!gun) return;
    if (
      !window.confirm(
        "Replace the saved HIP pose with the weapon's current transform? ADS will continue to use its separately saved pose.",
      )
    )
      return;
    hip.current = readTransform(gun);
    hipCaptured.current = true;
    setStatus("Captured the current gun transform as the hip pose.");
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
      if (world) await load("world", world);
      if (shot) files.current.shotSound = shot;
      if (reload) files.current.reloadSound = reload;
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
      if (roots.current["tp-gun"])
        applyTransform(roots.current["tp-gun"], manifest.thirdPerson.weapon);
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
    const choice = animationMap[targetMode][action];
    const group = importedGroups.current[targetMode].find(
      (item) => item.name === choice,
    );
    for (const item of importedGroups.current[targetMode]) item.stop();
    if (group) {
      group.start(action === "idle", 1, group.from, group.to);
      return setStatus(`Playing embedded clip: ${group.name}`);
    }
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
    const frame = (now: number) => {
      const t = Math.min(1, (now - started) / (duration * 1000)),
        wave = Math.sin(Math.PI * t),
        next = { ...base };
      if (action === "draw") {
        const ease = t * t * (3 - 2 * t);
        next.y -= 0.3 * (1 - ease);
        next.z -= 0.08 * (1 - ease);
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
      if (t < 1) requestAnimationFrame(frame);
      else applyTransform(root, base);
    };
    requestAnimationFrame(frame);
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
            if (file) files.current[kind] = file;
          }}
        />
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
    const fireName = animationMap[mode].fire;
    const fireGroup = importedGroups.current[mode].find(
      (group) => group.name === fireName,
    );
    if (fireGroup) fireGroup.start(false, 1, fireGroup.from, fireGroup.to);
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
  function toggleTest() {
    if (testTimer.current) {
      clearInterval(testTimer.current);
      testTimer.current = undefined;
      setTesting(false);
      if (scene.current && camera.current)
        scene.current.activeCamera = camera.current;
      return;
    }
    if (scene.current && mode === "first-person" && playerCamera.current)
      scene.current.activeCamera = playerCamera.current;
    testShot();
    testTimer.current = window.setInterval(
      testShot,
      Math.max(60, 60000 / gameplay.rpm),
    );
    setTesting(true);
  }
  async function exportWeapon() {
    try {
      if (!files.current.view && !files.current.world)
        throw new Error("Load at least one weapon GLB.");
      if (!clean(id)) throw new Error("Enter a valid weapon ID.");
      setExporting(true);
      for (const [finger, node] of fingerNodes.current) {
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
          character: files.current.character ? "character.glb" : undefined,
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
          character: thirdPose.current?.character ?? (roots.current["tp-character"]
            ? readTransform(roots.current["tp-character"])
            : identity()),
          weapon: thirdPose.current?.weapon ?? (roots.current["tp-gun"]
            ? readTransform(roots.current["tp-gun"])
            : identity()),
          fingers: Object.fromEntries(
            Object.entries(pose.current)
              .filter(([key]) => key.startsWith("tp:"))
              .map(([key, value]) => [key.slice(3), value]),
          ),
          animations: animationMap["third-person"],
        },
      };
      const zip = new JSZip(),
        folder = zip.folder(slot)!.folder(weaponId)!;
      folder.file("weapon.json", JSON.stringify(manifest, null, 2));
      for (const [key, file] of Object.entries(files.current))
        folder.file(
          key === "shotSound"
            ? `shot.${file.name.split(".").pop() ?? "ogg"}`
            : key === "reloadSound"
              ? `reload.${file.name.split(".").pop() ?? "ogg"}`
              : `${key === "view" ? "view" : key === "world" ? "world" : key}.glb`,
          await file.arrayBuffer(),
        );
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
        game.
      </p>
      {!clips[targetMode].length && (
        <p className="warning">Load the model to inspect its animations.</p>
      )}
      {(["idle", "draw", "fire", "reload"] as AnimationAction[]).map(
        (action) => (
          <label key={action} className="animation-map-row">
            <span>{action.toUpperCase()}</span>
            <select
              value={animationMap[targetMode][action] ?? BUILTIN_ANIMATION}
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
              {clips[targetMode].map((clip) => (
                <option key={clip} value={clip}>
                  MODEL CLIP · {clip}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => previewAnimation(action, targetMode)}
            >
              ▶ PLAY
            </button>
          </label>
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
          {["models", "poses", "animations", "rules", "audio", "effects"].map((tab) => (
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
            {fileInput("view", "Combined arms + weapon GLB")}
            <p>
              The camera is the player's fixed eye position. Move the combined
              model into the viewport.
            </p>
            <button onClick={frameFirstPersonModel}>
              AUTO-FRAME IN VIEWPORT
            </button>
            <div className="row">
              <button onClick={captureHip}>CAPTURE HIP</button>
              <button onClick={captureAds}>CAPTURE ADS</button>
            </div>
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
          </section>
        )}
        {mode === "first-person" && animationConnector("first-person")}
        {mode === "third-person" && (
          <section hidden={panel !== "poses" && panel !== "models"}>
            <h2>3 · Third person</h2>
            {fileInput("character", "Optional reference character GLB")}
            {fileInput("world", "World weapon GLB")}
            <div className="row">
              <button onClick={() => {
                const gun = roots.current["tp-gun"], character = roots.current["tp-character"];
                if (!gun) return setStatus("Load the third-person weapon first.");
                if (!window.confirm("Capture this third-person character and weapon pose for export?")) return;
                thirdPose.current = { weapon: readTransform(gun), character: character ? readTransform(character) : identity() };
                setStatus("Third-person pose captured for export.");
              }}>CAPTURE THIRD-PERSON POSE</button>
              <button onClick={() => {
                const saved = thirdPose.current;
                if (!saved) return setStatus("Capture a third-person pose first.");
                if (roots.current["tp-gun"]) applyTransform(roots.current["tp-gun"], saved.weapon);
                if (roots.current["tp-character"]) applyTransform(roots.current["tp-character"], saved.character);
                setStatus("Restored captured third-person pose.");
              }}>RESTORE POSE</button>
            </div>
          </section>
        )}
        {mode === "third-person" && animationConnector("third-person")}
        <section hidden={panel !== "poses"}>
          <h2>4 · Selection</h2>
          <p>
            <strong>FRONT = +Z</strong> · Blue arrow points toward the muzzle
            and firing direction.
          </p>
          <div className="row">
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
          <button onClick={resetSelected}>RESET SELECTED AXES</button>
          <button
            onClick={() => {
              const key = mode === "first-person" ? "fp-muzzle" : "tp-muzzle";
              setSelected(key);
              attach(key);
            }}
          >
            SELECT MUZZLE SOCKET
          </button>
          <button onClick={autoPlaceMuzzle}>
            AUTO-PLACE MUZZLE AT +Z FRONT
          </button>
        </section>
        {fingers.length > 0 && (
          <section hidden={panel !== "poses"}>
            <h2>5 · Finger pose</h2>
            <p>
              Select a skinned finger joint, then use the rotation rings. Poses
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
        <canvas ref={canvas} />
        {mode === "first-person" && (
          <div className="viewport-guide">
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
            ? "PLAYER CAMERA PREVIEW · SHOTS ORIGINATE AT THE MUZZLE SOCKET"
            : "EDIT VIEW · SELECT AN OBJECT, THEN DRAG ITS AXIS GIZMO"}
        </div>
      </main>
    </div>
  );
}
