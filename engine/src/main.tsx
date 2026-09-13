import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArcRotateCamera,
  Color3,
  Color4,
  Engine,
  GizmoManager,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  PointLight,
  Scene,
  SceneLoader,
  StandardMaterial,
  TransformNode,
  UniversalCamera,
  Vector3,
  VertexBuffer,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import JSZip from "jszip";
import type { GameMap, MapLight, MapSkybox, Spawn } from "../../shared/maps";
import { makeBody, moveBody, type Body } from "../../shared/simulation";
import { RULES } from "../../shared/rules";
import type { Input } from "../../shared/protocol";
import "./style.css";
type Team = "A" | "B";
type SpawnMarker = Spawn & { id: string; team: Team };
type Selected = { kind: "reference" | "spawn" | "light"; id: string };
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
const cleanId = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
const save = (blob: Blob, name: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const skyColors: Record<
  Exclude<MapSkybox["preset"], "custom">,
  { clear: Color4; ambient: Color3 }
> = {
  "blue-day": {
    clear: new Color4(0.28, 0.57, 0.86, 1),
    ambient: new Color3(0.85, 0.92, 1),
  },
  overcast: {
    clear: new Color4(0.38, 0.43, 0.47, 1),
    ambient: new Color3(0.72, 0.76, 0.78),
  },
  night: {
    clear: new Color4(0.012, 0.022, 0.055, 1),
    ambient: new Color3(0.18, 0.25, 0.42),
  },
};
function App() {
  const canvas = useRef<HTMLCanvasElement>(null),
    scene = useRef<Scene | undefined>(undefined),
    root = useRef<TransformNode | undefined>(undefined),
    meshes = useRef<Mesh[]>([]),
    source = useRef<ArrayBuffer | undefined>(undefined);
  const reference = useRef<Mesh | undefined>(undefined),
    gizmos = useRef<GizmoManager | undefined>(undefined),
    spawnNodes = useRef(new Map<string, TransformNode>()),
    lightNodes = useRef(new Map<string, TransformNode>()),
    ambient = useRef<HemisphericLight | undefined>(undefined);
  const arcCamera = useRef<ArcRotateCamera | undefined>(undefined),
    testCamera = useRef<UniversalCamera | undefined>(undefined);
  const [testPicker, setTestPicker] = useState(false),
    [testActive, setTestActive] = useState(false);
  const testActiveRef = useRef(testActive);
  testActiveRef.current = testActive;
  const playerBody = useRef<Body | undefined>(undefined),
    testMap = useRef<GameMap | undefined>(undefined),
    testKeys = useRef(new Set<string>()),
    testYaw = useRef(0),
    testPitch = useRef(0),
    testSeq = useRef(0);
  const testTickRef = useRef(() => {});
  const [name, setName] = useState("New map"),
    [id, setId] = useState("new-map"),
    [scale, setScale] = useState(1),
    [offsetY, setOffsetY] = useState(0),
    [cursor, setCursor] = useState({ x: 0, y: 0, z: 0, yaw: 0 });
  const [spawns, setSpawns] = useState<SpawnMarker[]>([]),
    [lights, setLights] = useState<MapLight[]>([]),
    [selected, setSelected] = useState<Selected>({
      kind: "reference",
      id: "reference",
    });
  const [sky, setSky] = useState<MapSkybox>({ preset: "blue-day" }),
    skyFile = useRef<ArrayBuffer | undefined>(undefined),
    [status, setStatus] = useState("Import a GLB to begin."),
    [exporting, setExporting] = useState<{ stage: string; progress: number }>();
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const selectedNode = () => {
    const choice = selectedRef.current;
    return choice.kind === "reference"
      ? reference.current
      : choice.kind === "spawn"
        ? spawnNodes.current.get(choice.id)
        : lightNodes.current.get(choice.id);
  };
  const attach = () => gizmos.current?.attachToNode(selectedNode() ?? null);
  const commitSelected = () => {
    const node = selectedNode(),
      choice = selectedRef.current;
    if (!node) return;
    if (choice.kind === "reference")
      setCursor({
        x: +node.position.x.toFixed(3),
        y: +(node.position.y - 0.9).toFixed(3),
        z: +node.position.z.toFixed(3),
        yaw: +node.rotation.y.toFixed(3),
      });
    if (choice.kind === "spawn")
      setSpawns((v) =>
        v.map((s) =>
          s.id === choice.id
            ? {
                ...s,
                x: +node.position.x.toFixed(3),
                y: +node.position.y.toFixed(3),
                z: +node.position.z.toFixed(3),
                yaw: +node.rotation.y.toFixed(3),
              }
            : s,
        ),
      );
    if (choice.kind === "light")
      setLights((v) =>
        v.map((l) =>
          l.id === choice.id
            ? {
                ...l,
                x: +node.position.x.toFixed(3),
                y: +node.position.y.toFixed(3),
                z: +node.position.z.toFixed(3),
              }
            : l,
        ),
      );
  };
  useEffect(() => {
    const engine = new Engine(canvas.current!, true),
      s = (scene.current = new Scene(engine));
    s.clearColor = skyColors["blue-day"].clear;
    const camera = (arcCamera.current = new ArcRotateCamera(
      "camera",
      -Math.PI / 2,
      1.05,
      18,
      new Vector3(0, 1, 0),
      s,
    ));
    camera.attachControl(canvas.current!, true);
    camera.wheelPrecision = 35;
    camera.minZ = 0.03;
    ambient.current = new HemisphericLight("ambient", Vector3.Up(), s);
    ambient.current.intensity = 0.9;
    const ground = MeshBuilder.CreateGround(
        "editor-grid",
        { width: 100, height: 100 },
        s,
      ),
      gm = new StandardMaterial("grid", s);
    gm.diffuseColor = new Color3(0.08, 0.1, 0.11);
    gm.wireframe = true;
    ground.material = gm;
    const capsule = (reference.current = MeshBuilder.CreateCapsule(
        "player-reference",
        { height: 1.8, radius: 0.32 },
        s,
      )),
      cm = new StandardMaterial("reference-material", s);
    cm.emissiveColor = new Color3(0.1, 0.65, 1);
    cm.alpha = 0.48;
    cm.wireframe = true;
    capsule.material = cm;
    capsule.position.y = 0.9;
    capsule.metadata = { editor: { kind: "reference", id: "reference" } };
    const manager = (gizmos.current = new GizmoManager(s));
    manager.positionGizmoEnabled = true;
    manager.rotationGizmoEnabled = true;
    manager.scaleGizmoEnabled = false;
    manager.boundingBoxGizmoEnabled = false;
    manager.usePointerToAttachGizmos = false;
    manager.attachToNode(capsule);
    s.onPointerDown = (_event, pick) => {
      if (testActiveRef.current) return;
      const entity = pick.pickedMesh?.metadata?.editor as Selected | undefined;
      if (entity) setSelected(entity);
    };
    const commit = () => {
      if (!testActiveRef.current) commitSelected();
    };
    window.addEventListener("pointerup", commit);
    const resize = () => engine.resize();
    window.addEventListener("resize", resize);
    s.onBeforeRenderObservable.add(() => testTickRef.current());
    engine.runRenderLoop(() => s.render());
    return () => {
      window.removeEventListener("pointerup", commit);
      window.removeEventListener("resize", resize);
      engine.dispose();
    };
  }, []);
  useEffect(() => {
    const onLockChange = () => {
      if (!document.pointerLockElement && testActiveRef.current) exitTest();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!testActiveRef.current || document.pointerLockElement !== canvas.current)
        return;
      e.preventDefault();
      testKeys.current.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => testKeys.current.delete(e.code);
    const onBlur = () => testKeys.current.clear();
    const onMouseMove = (e: MouseEvent) => {
      if (!testActiveRef.current || document.pointerLockElement !== canvas.current)
        return;
      const factor = 0.002;
      testYaw.current = (testYaw.current + e.movementX * factor) % (Math.PI * 2);
      testPitch.current = Math.max(
        -1.5,
        Math.min(1.5, testPitch.current + e.movementY * factor),
      );
    };
    document.addEventListener("pointerlockchange", onLockChange);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("mousemove", onMouseMove);
    return () => {
      document.removeEventListener("pointerlockchange", onLockChange);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("mousemove", onMouseMove);
    };
  }, []);
  useEffect(() => {
    root.current?.scaling.setAll(scale);
    if (root.current) root.current.position.y = offsetY;
  }, [scale, offsetY]);
  useEffect(() => {
    const n = reference.current;
    if (!n) return;
    n.position.set(cursor.x, cursor.y + 0.9, cursor.z);
    n.rotation.y = cursor.yaw;
    if (selected.kind === "reference") attach();
  }, [cursor, selected]);
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    for (const n of spawnNodes.current.values()) n.dispose();
    spawnNodes.current.clear();
    for (const spawn of spawns) {
      const n = new TransformNode(spawn.id, s),
        body = MeshBuilder.CreateCapsule(
          `${spawn.id}-body`,
          { height: 1.8, radius: 0.32 },
          s,
        ),
        mat = new StandardMaterial(`${spawn.id}-material`, s);
      mat.emissiveColor =
        spawn.team === "A" ? new Color3(0.1, 0.5, 1) : new Color3(1, 0.2, 0.15);
      mat.alpha = 0.58;
      body.material = mat;
      body.parent = n;
      body.position.y = 0.9;
      body.metadata = { editor: { kind: "spawn", id: spawn.id } };
      n.position.set(spawn.x, spawn.y ?? 0, spawn.z);
      n.rotation.y = spawn.yaw;
      spawnNodes.current.set(spawn.id, n);
    }
    attach();
  }, [spawns, selected]);
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    for (const n of lightNodes.current.values()) n.dispose();
    lightNodes.current.clear();
    for (const light of lights) {
      const n = new TransformNode(light.id, s),
        bulb = MeshBuilder.CreateSphere(
          `${light.id}-bulb`,
          { diameter: 0.22 },
          s,
        ),
        mat = new StandardMaterial(`${light.id}-material`, s);
      mat.emissiveColor = Color3.FromHexString(light.color);
      bulb.material = mat;
      bulb.parent = n;
      bulb.metadata = { editor: { kind: "light", id: light.id } };
      const lamp = new PointLight(`${light.id}-source`, Vector3.Zero(), s);
      lamp.parent = n;
      lamp.diffuse = Color3.FromHexString(light.color);
      lamp.intensity = light.intensity;
      lamp.range = light.range;
      n.position.set(light.x, light.y, light.z);
      lightNodes.current.set(light.id, n);
    }
    attach();
  }, [lights, selected]);
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    const colors =
      sky.preset === "custom" ? skyColors["blue-day"] : skyColors[sky.preset];
    s.clearColor = colors.clear;
    if (ambient.current) {
      ambient.current.diffuse = colors.ambient;
      ambient.current.intensity = sky.preset === "night" ? 0.35 : 0.9;
    }
  }, [sky]);
  async function load(file: File) {
    if (!scene.current) return;
    root.current?.dispose();
    meshes.current = [];
    setSpawns([]);
    setLights([]);
    setSelected({ kind: "reference", id: "reference" });
    source.current = await file.arrayBuffer();
    const mapRoot = (root.current = new TransformNode(
      "authored-map",
      scene.current,
    ));
    mapRoot.scaling.setAll(scale);
    mapRoot.position.y = offsetY;
    const result = await SceneLoader.ImportMeshAsync(
      "",
      "",
      file,
      scene.current,
    );
    for (const node of [...result.transformNodes, ...result.meshes])
      if (!node.parent) node.parent = mapRoot;
    meshes.current = result.meshes.filter(
      (m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0,
    );
    setName(file.name.replace(/\.glb$/i, "").replace(/[-_]+/g, " "));
    setId(cleanId(file.name.replace(/\.glb$/i, "")));
    setStatus(
      `Loaded ${meshes.current.length} meshes. Add an object, select it, then drag its axis gizmo.`,
    );
  }
  async function importProject(file: File) {
    try {
      setStatus("Reading map package...");
      const zip = await JSZip.loadAsync(file);
      const [projectEntry] = zip.file(/project\.json$/i);
      const [glbEntry] = zip.file(/map\.glb$/i);
      if (!projectEntry || !glbEntry)
        throw new Error(
          "This zip has no project.json + map.glb — export it from this engine first.",
        );
      const project = JSON.parse(await projectEntry.async("string"));
      const glbBuffer = await glbEntry.async("arraybuffer");
      await load(
        new File([glbBuffer], "map.glb", { type: "model/gltf-binary" }),
      );
      setName(typeof project.name === "string" ? project.name : name);
      setId(cleanId(typeof project.id === "string" ? project.id : id));
      setScale(typeof project.scale === "number" ? project.scale : 1);
      setOffsetY(typeof project.offsetY === "number" ? project.offsetY : 0);
      setSpawns(Array.isArray(project.spawns) ? project.spawns : []);
      setLights(Array.isArray(project.lights) ? project.lights : []);
      setSky(
        project.sky && typeof project.sky.preset === "string"
          ? project.sky
          : { preset: "blue-day" },
      );
      const [skyEntry] = zip.file(/skybox\.env$/i);
      skyFile.current = skyEntry ? await skyEntry.async("arraybuffer") : undefined;
      setStatus(`Reopened "${project.name ?? "map"}" for editing.`);
    } catch (error) {
      setStatus((error as Error).message);
    }
  }
  function addSpawn(team: Team) {
    if (spawns.filter((s) => s.team === team).length >= 2)
      return setStatus(`Team ${team} already has two spawns.`);
    const marker: SpawnMarker = { id: uid(`spawn-${team}`), team, ...cursor };
    setSpawns((v) => [...v, marker]);
    setSelected({ kind: "spawn", id: marker.id });
  }
  function addLight() {
    const light: MapLight = {
      id: uid("light"),
      type: "point",
      x: cursor.x,
      y: cursor.y + 2,
      z: cursor.z,
      color: "#fff1d6",
      intensity: 2,
      range: 8,
    };
    setLights((v) => [...v, light]);
    setSelected({ kind: "light", id: light.id });
  }
  function startTest(spawn: SpawnMarker) {
    const s = scene.current;
    if (!s || !canvas.current) return;
    const baked = bake();
    if (!baked.triangles.length) {
      setStatus("No collision geometry to test against. Import a GLB first.");
      return;
    }
    setTestPicker(false);
    gizmos.current?.attachToNode(null);
    arcCamera.current?.detachControl();
    testMap.current = {
      id: "editor-test",
      name: "editor-test",
      asset: "",
      walls: [],
      triangles: baked.triangles,
      spawns: { A: [], B: [] },
    };
    const body = (playerBody.current = makeBody(spawn.x, spawn.z));
    body.y = spawn.y ?? 0;
    testYaw.current = spawn.yaw;
    testPitch.current = 0;
    testSeq.current = 0;
    testKeys.current.clear();
    const cam = (testCamera.current = new UniversalCamera(
      "test-camera",
      new Vector3(spawn.x, body.y + RULES.eyeHeight, spawn.z),
      s,
    ));
    cam.minZ = 0.05;
    cam.rotation.set(0, spawn.yaw, 0);
    s.activeCamera = cam;
    canvas.current.requestPointerLock?.();
    setTestActive(true);
    setStatus(
      `Testing TEAM ${spawn.team} spawn. WASD to walk, SPACE to jump, C to crouch. Press ESC or EXIT TEST to return.`,
    );
  }
  function testTick() {
    const s = scene.current,
      body = playerBody.current,
      map = testMap.current,
      cam = testCamera.current;
    if (!testActiveRef.current || !s || !body || !map || !cam) return;
    const dt = Math.min(s.getEngine().getDeltaTime() / 1000, 0.05);
    const keys = testKeys.current;
    const input: Input = {
      seq: ++testSeq.current,
      forward: Number(keys.has("KeyW")) - Number(keys.has("KeyS")),
      strafe: Number(keys.has("KeyD")) - Number(keys.has("KeyA")),
      yaw: testYaw.current,
      pitch: testPitch.current,
      jump: keys.has("Space"),
      crouch: keys.has("KeyC"),
      ads: false,
      sprint: false,
    };
    moveBody(body, input, dt, map);
    cam.position.set(
      body.x,
      body.y + (body.crouch ? RULES.crouchEyeHeight : RULES.eyeHeight),
      body.z,
    );
    cam.rotation.set(testPitch.current, testYaw.current, 0);
  }
  testTickRef.current = testTick;
  function exitTest() {
    const s = scene.current;
    if (document.pointerLockElement) document.exitPointerLock();
    testCamera.current?.dispose();
    testCamera.current = undefined;
    playerBody.current = undefined;
    testMap.current = undefined;
    testKeys.current.clear();
    if (s && arcCamera.current) {
      s.activeCamera = arcCamera.current;
      arcCamera.current.attachControl(canvas.current!, true);
    }
    setTestActive(false);
    attach();
    setStatus("Back in edit mode.");
  }
  function bake() {
    const triangles: number[][] = [];
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const mesh of meshes.current) {
      mesh.computeWorldMatrix(true);
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind),
        indices = mesh.getIndices();
      if (!positions || !indices) continue;
      const world = mesh.getWorldMatrix();
      for (let i = 0; i < indices.length; i += 3) {
        const row: number[] = [];
        for (let j = 0; j < 3; j++) {
          const at = indices[i + j] * 3,
            p = Vector3.TransformCoordinates(
              new Vector3(positions[at], positions[at + 1], positions[at + 2]),
              world,
            );
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minZ = Math.min(minZ, p.z);
          maxZ = Math.max(maxZ, p.z);
          row.push(+p.x.toFixed(5), +p.y.toFixed(5), +p.z.toFixed(5));
        }
        triangles.push(row);
      }
    }
    return { triangles, bounds: { minX, maxX, minZ, maxZ } };
  }
  async function exportMap() {
    try {
      if (!source.current) throw new Error("Import a GLB first.");
      if (
        spawns.filter((s) => s.team === "A").length < 2 ||
        spawns.filter((s) => s.team === "B").length < 2
      )
        throw new Error("Add two spawn points for each team.");
      if (sky.preset === "custom" && !skyFile.current)
        throw new Error("Upload a .env skybox or choose a preset.");
      const mapId = cleanId(id);
      if (!mapId) throw new Error("Enter a valid folder ID.");
      setExporting({ stage: "Baking collision geometry", progress: 8 });
      await new Promise((r) => setTimeout(r, 30));
      const baked = bake();
      if (!baked.triangles.length)
        throw new Error("No collision triangles were found in this GLB.");
      setExporting({
        stage: `Writing ${baked.triangles.length.toLocaleString()} collision triangles`,
        progress: 35,
      });
      await new Promise((r) => setTimeout(r, 30));
      const manifest = {
        version: 1,
        id: mapId,
        name: name.trim(),
        asset: `/maps/${mapId}/map.glb`,
        walls: [],
        triangles: baked.triangles,
        offsetY,
        scale,
        bounds: baked.bounds,
        spawns: {
          A: spawns
            .filter((s) => s.team === "A")
            .map(({ id: _, team: __, ...s }) => s),
          B: spawns
            .filter((s) => s.team === "B")
            .map(({ id: _, team: __, ...s }) => s),
        },
        lights,
        skybox: {
          preset: sky.preset,
          asset:
            sky.preset === "custom" ? `/maps/${mapId}/skybox.env` : undefined,
        },
      };
      const project = {
        version: 1,
        name: name.trim(),
        id: mapId,
        scale,
        offsetY,
        spawns,
        lights,
        sky,
      };
      const zip = new JSZip(),
        folder = zip.folder(mapId)!;
      folder.file("map.glb", source.current);
      folder.file("map.json", JSON.stringify(manifest));
      folder.file("project.json", JSON.stringify(project));
      if (sky.preset === "custom") folder.file("skybox.env", skyFile.current!);
      folder.file(
        "INSTALL.txt",
        "Copy this entire folder into client/public/maps, then restart the Collateral server.\nproject.json is the editable source — reopen it from the map engine's IMPORT MAP button to keep editing this map.",
      );
      const blob = await zip.generateAsync(
        {
          type: "blob",
          compression: "DEFLATE",
          compressionOptions: { level: 6 },
        },
        (meta) =>
          setExporting({
            stage: "Compressing map package",
            progress: 35 + meta.percent * 0.65,
          }),
      );
      save(blob, `${mapId}.zip`);
      setStatus(
        `Exported ${baked.triangles.length.toLocaleString()} collision triangles.`,
      );
      setExporting({ stage: "Export complete", progress: 100 });
      setTimeout(() => setExporting(undefined), 700);
    } catch (error) {
      setStatus((error as Error).message);
      setExporting(undefined);
    }
  }
  const selectObject = (kind: Selected["kind"], objectId: string) =>
    setSelected({ kind, id: objectId });
  const resetReference = () => {
    setCursor({ x: 0, y: 0, z: 0, yaw: 0 });
    setSelected({ kind: "reference", id: "reference" });
    const node = reference.current;
    if (node) {
      node.position.set(0, 0.9, 0);
      node.rotation.set(0, 0, 0);
    }
    setStatus("Player reference returned to the world origin.");
  };
  return (
    <div className="app">
      <header>
        <b>C/</b>
        <div>
          <h1>MAP ENGINE</h1>
          <small>PACKAGE FORMAT V1</small>
        </div>
        <button
          className="test"
          onClick={() => setTestPicker(true)}
          disabled={!spawns.length}
        >
          TEST SPAWN
        </button>
        <button className="export" onClick={exportMap}>
          EXPORT MAP PACKAGE
        </button>
      </header>
      <aside>
        <section>
          <h2>1 · Source</h2>
          <label>
            Map GLB
            <input
              type="file"
              accept=".glb,model/gltf-binary"
              onChange={(e) =>
                e.target.files?.[0] && void load(e.target.files[0])
              }
            />
          </label>
          <label>
            Reopen exported map package (.zip)
            <input
              type="file"
              accept=".zip"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importProject(file);
                e.target.value = "";
              }}
            />
          </label>
          <label>
            Display name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Folder ID
            <input
              value={id}
              onChange={(e) => setId(cleanId(e.target.value))}
            />
          </label>
          <div className="row">
            <label>
              Scale
              <input
                type="number"
                min=".01"
                step=".05"
                value={scale}
                onChange={(e) => setScale(+e.target.value)}
              />
            </label>
            <label>
              Y offset
              <input
                type="number"
                step=".05"
                value={offsetY}
                onChange={(e) => setOffsetY(+e.target.value)}
              />
            </label>
          </div>
        </section>
        <section>
          <h2>2 · Objects</h2>
          <p>
            Select an object, then drag its red, green, or blue axis. Rotation
            handles set spawn facing.
          </p>
          <button
            className={selected.kind === "reference" ? "selected" : ""}
            onClick={() => selectObject("reference", "reference")}
          >
            PLAYER REFERENCE
          </button>
          <button onClick={resetReference}>RESET REFERENCE TO CENTER</button>
          <div className="row">
            <button onClick={() => addSpawn("A")}>ADD TEAM A SPAWN</button>
            <button onClick={() => addSpawn("B")}>ADD TEAM B SPAWN</button>
          </div>
          {spawns.map((s) => (
            <div
              className={`object ${selected.id === s.id ? "active" : ""}`}
              key={s.id}
            >
              <button onClick={() => selectObject("spawn", s.id)}>
                TEAM {s.team} ·{" "}
                {spawns.filter((x) => x.team === s.team).indexOf(s) + 1}
                <small>
                  {s.x.toFixed(2)}, {Number(s.y ?? 0).toFixed(2)},{" "}
                  {s.z.toFixed(2)}
                </small>
              </button>
              <button
                onClick={() => setSpawns((v) => v.filter((x) => x.id !== s.id))}
              >
                ×
              </button>
            </div>
          ))}
          <button onClick={addLight}>ADD POINT LIGHT</button>
          {lights.map((l, i) => (
            <div
              className={`light ${selected.id === l.id ? "active" : ""}`}
              key={l.id}
            >
              <button onClick={() => selectObject("light", l.id)}>
                {l.id}
              </button>
              <input
                type="color"
                value={l.color}
                onChange={(e) =>
                  setLights((v) =>
                    v.map((x, n) =>
                      n === i ? { ...x, color: e.target.value } : x,
                    ),
                  )
                }
              />
              <label>
                Power
                <input
                  type="number"
                  step=".1"
                  value={l.intensity}
                  onChange={(e) =>
                    setLights((v) =>
                      v.map((x, n) =>
                        n === i ? { ...x, intensity: +e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Range
                <input
                  type="number"
                  step=".5"
                  value={l.range}
                  onChange={(e) =>
                    setLights((v) =>
                      v.map((x, n) =>
                        n === i ? { ...x, range: +e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <button
                onClick={() => setLights((v) => v.filter((_, n) => n !== i))}
              >
                ×
              </button>
            </div>
          ))}
        </section>
        <section>
          <h2>3 · Skybox</h2>
          <label>
            Environment
            <select
              value={sky.preset}
              onChange={(e) =>
                setSky({ preset: e.target.value as MapSkybox["preset"] })
              }
            >
              <option value="blue-day">Blue Day</option>
              <option value="overcast">Overcast</option>
              <option value="night">Night</option>
              <option value="custom">Custom Babylon .env</option>
            </select>
          </label>
          {sky.preset === "custom" && (
            <label>
              Skybox .env
              <input
                type="file"
                accept=".env"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  skyFile.current = file ? await file.arrayBuffer() : undefined;
                }}
              />
            </label>
          )}
        </section>
        <footer>{status}</footer>
      </aside>
      <main>
        <canvas ref={canvas} />
        {testActive ? (
          <>
            <div className="crosshair" />
            <button className="exit-test" onClick={exitTest}>
              EXIT TEST (ESC)
            </button>
          </>
        ) : (
          <div className="help">
            LEFT DRAG · ORBIT &nbsp; RIGHT DRAG · PAN &nbsp; WHEEL · ZOOM &nbsp;
            CLICK MARKER · SELECT
          </div>
        )}
      </main>
      {exporting && (
        <div className="modal">
          <div>
            <h2>EXPORTING MAP</h2>
            <p>{exporting.stage}</p>
            <progress max="100" value={exporting.progress} />
            <strong>{Math.round(exporting.progress)}%</strong>
          </div>
        </div>
      )}
      {testPicker && (
        <div className="modal" onClick={() => setTestPicker(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <h2>TEST SPAWN</h2>
            <p>Pick a placed spawn point to drop into a first-person camera.</p>
            <div className="spawn-list">
              {(["A", "B"] as const).map((team) => (
                <div key={team} className="spawn-list-team">
                  <h3>TEAM {team}</h3>
                  {spawns.filter((s) => s.team === team).length === 0 && (
                    <p>No spawns placed.</p>
                  )}
                  {spawns
                    .filter((s) => s.team === team)
                    .map((s, i) => (
                      <button key={s.id} onClick={() => startTest(s)}>
                        SPAWN {i + 1}
                        <small>
                          {s.x.toFixed(2)}, {Number(s.y ?? 0).toFixed(2)},{" "}
                          {s.z.toFixed(2)}
                        </small>
                      </button>
                    ))}
                </div>
              ))}
            </div>
            <button onClick={() => setTestPicker(false)}>CANCEL</button>
          </div>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
