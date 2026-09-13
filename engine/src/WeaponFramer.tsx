import React, { useEffect, useRef, useState } from "react";
import {
  ArcRotateCamera,
  Color3,
  Color4,
  Engine,
  GizmoManager,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  SceneLoader,
  StandardMaterial,
  TransformNode,
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
    camera = useRef<ArcRotateCamera | undefined>(undefined);
  const roots = useRef<Record<string, TransformNode>>({}),
    files = useRef<Record<string, File>>({}),
    fingerNodes = useRef(new Map<string, TransformNode>()),
    pose = useRef<FingerPose>({});
  const [mode, setMode] = useState<PoseMode>("first-person"),
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
    [aiming, setAiming] = useState(false),
    [testing, setTesting] = useState(false),
    [status, setStatus] = useState(
      "Load separate arms and weapon GLBs to begin.",
    ),
    [fingers, setFingers] = useState<string[]>([]),
    [exporting, setExporting] = useState(false);
  const hip = useRef<Transform>(identity()),
    previewUrls = useRef<string[]>([]),
    testTimer = useRef<number | undefined>(undefined);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const attach = (key = selectedRef.current) => {
    const n = key.startsWith("finger:")
      ? fingerNodes.current.get(key.slice(7))
      : roots.current[key];
    if (!n) return;
    gizmo.current?.attachToNode(n);
    if (gizmo.current) {
      gizmo.current.positionGizmoEnabled = !key.startsWith("finger:");
      gizmo.current.rotationGizmoEnabled = true;
      gizmo.current.scaleGizmoEnabled = !key.startsWith("finger:");
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
    gm.rotationGizmoEnabled = true;
    gm.scaleGizmoEnabled = true;
    gm.boundingBoxGizmoEnabled = false;
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
    if (testTimer.current) {
      clearInterval(testTimer.current);
      testTimer.current = undefined;
      setTesting(false);
    }
    for (const [key, node] of Object.entries(roots.current))
      node.setEnabled(
        mode === "first-person" ? key.startsWith("fp-") : key.startsWith("tp-"),
      );
    if (camera.current) {
      camera.current.target =
        mode === "first-person"
          ? new Vector3(0, 1.45, 0.45)
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
  async function load(
    kind: "arms" | "view" | "character" | "world",
    file: File,
  ) {
    const s = scene.current;
    if (!s) return;
    const key =
      kind === "arms"
        ? "fp-arms"
        : kind === "view"
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
    const root = (roots.current[key] = new TransformNode(key, s));
    const result = await SceneLoader.ImportMeshAsync("", "", file, s);
    for (const node of [...result.transformNodes, ...result.meshes])
      if (!node.parent) node.parent = root;
    if (kind === "view" && roots.current["fp-muzzle"])
      roots.current["fp-muzzle"].parent = root;
    if (kind === "world" && roots.current["tp-muzzle"])
      roots.current["tp-muzzle"].parent = root;
    if (kind === "arms" || kind === "character") {
      if (kind === "arms") root.position.set(0, -0.55, 0.35);
      else root.position.set(0, 0, 0);
      const prefix = kind === "arms" ? "fp:" : "tp:";
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
        (kind === "arms" && mode === "first-person") ||
        (kind === "character" && mode === "third-person")
      )
        setFingers([...found].sort());
      setStatus(
        found.size
          ? `Loaded ${kind} with ${found.size} adjustable finger joints.`
          : `${kind} loaded, but this rig exposes no finger bones.`,
      );
    } else if (kind === "view") {
      root.position.set(0, -0.25, 0.65);
      hip.current = readTransform(root);
      setAds(readTransform(root));
    } else root.position.set(0, 1.25, 0.25);
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
  function setAdsPreview(next: boolean) {
    const gun = roots.current["fp-gun"];
    if (gun) {
      if (!aiming) hip.current = readTransform(gun);
      applyTransform(gun, next ? ads : hip.current);
    }
    setAiming(next);
  }
  function captureAds() {
    const gun = roots.current["fp-gun"];
    if (!gun) return;
    setAds(readTransform(gun));
    setStatus("Captured the current gun transform as the ADS pose.");
  }
  function captureHip() {
    const gun = roots.current["fp-gun"];
    if (!gun) return;
    hip.current = readTransform(gun);
    setStatus("Captured the current gun transform as the hip pose.");
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
      return;
    }
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
          arms: files.current.arms ? "arms.glb" : undefined,
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
          arms: roots.current["fp-arms"]
            ? readTransform(roots.current["fp-arms"])
            : identity(),
          weapon: hip.current,
          ads,
          adsFov,
          fingers: Object.fromEntries(
            Object.entries(pose.current)
              .filter(([key]) => key.startsWith("fp:"))
              .map(([key, value]) => [key.slice(3), value]),
          ),
        },
        thirdPerson: {
          character: roots.current["tp-character"]
            ? readTransform(roots.current["tp-character"])
            : identity(),
          weapon: roots.current["tp-gun"]
            ? readTransform(roots.current["tp-gun"])
            : identity(),
          fingers: Object.fromEntries(
            Object.entries(pose.current)
              .filter(([key]) => key.startsWith("tp:"))
              .map(([key, value]) => [key.slice(3), value]),
          ),
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
  const fileInput = (
    kind: "arms" | "view" | "character" | "world",
    label: string,
  ) => (
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
        <section>
          <h2>1 · Weapon</h2>
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
        <section>
          <h2>2 · First person</h2>
          {fileInput("arms", "Rigged arms GLB")}
          {fileInput("view", "View weapon GLB")}
          <button
            className={mode === "first-person" ? "selected" : ""}
            onClick={() => setMode("first-person")}
          >
            FRAME FIRST PERSON
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
        </section>
        <section>
          <h2>3 · Third person</h2>
          {fileInput("character", "Optional reference character GLB")}
          {fileInput("world", "World weapon GLB")}
          <button
            className={mode === "third-person" ? "selected" : ""}
            onClick={() => setMode("third-person")}
          >
            FRAME THIRD PERSON
          </button>
        </section>
        <section>
          <h2>4 · Selection</h2>
          <div className="row">
            <button
              onClick={() => {
                const k = mode === "first-person" ? "fp-arms" : "tp-character";
                setSelected(k);
                attach(k);
              }}
            >
              BODY / ARMS
            </button>
            <button
              onClick={() => {
                const k = mode === "first-person" ? "fp-gun" : "tp-gun";
                setSelected(k);
                attach(k);
              }}
            >
              WEAPON
            </button>
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
        </section>
        <section>
          <h2>5 · Finger pose</h2>
          <p>
            Select a skinned finger joint, then use the rotation rings. Poses
            export by bone name.
          </p>
          {!fingers.length && (
            <p className="warning">No adjustable finger bones detected yet.</p>
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
        <section>
          <h2>6 · Ballistics</h2>
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
        <section>
          <h2>7 · Audio</h2>
          {soundInput("shotSound", "Fire sound")}
          {soundInput("reloadSound", "Reload sound")}
        </section>
        <section>
          <h2>8 · Effects</h2>
          <label>
            Flash color
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
          DRAG GIZMOS · POSITION / ROTATE / SCALE &nbsp; SELECT FINGER · ROTATE
          JOINT
        </div>
      </main>
    </div>
  );
}
