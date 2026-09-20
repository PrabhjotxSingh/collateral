import { blendFrame } from "../../shared/weapon-transforms";
import { usesProcedural, usesProceduralMotion } from "../../shared/weapons";
import { DevTools } from "./dev-tools";
import { daylight, applyMapSun } from "./lighting";
import {
  Engine,
  Scene,
  Camera,
  UniversalCamera,
  Vector3,
  Matrix,
  ShadowGenerator,
  MeshBuilder,
  StandardMaterial,
  ShaderMaterial,
  Color3,
  Color4,
  Mesh,
  TransformNode,
  VertexData,
  PointLight,
  CubeTexture,
  HDRCubeTexture,
  BaseTexture,
} from "@babylonjs/core";
import { mapById, ASSETS } from "../../shared/maps.js";
import { rayMap } from "../../shared/geometry.js";
import { rayBox } from "../../shared/simulation.js";
import { RULES } from "../../shared/rules.js";
import type { GameView, PlayerView, ShotEvent } from "../../shared/protocol.js";
import type { Network } from "./network";
import type { Settings, Action } from "./settings";
import { Assets, type AssetInstance } from "./assets";
import { drawPose, DRAW_SECONDS, type ClipAction } from "./animation";
import { TacticalAudio } from "./audio";
import { ViewmodelMotion } from "./viewmodel";
import { CosmeticPhysics } from "./physics";
import { ShotEffects } from "./shot-effects";
import { ShotPrediction } from "./shot-prediction";
import { setLoading, paint } from "./loading-screen";
import type { WeaponManifest } from "../../shared/weapons.js";
export class Game {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: UniversalCamera;
  private shadows: ShadowGenerator;
  private players = new Map<string, Mesh>();
  private spawnShields = new Map<string, Mesh>();
  private keys = new Set<string>();
  private mapId = "";
  private completedMapId = "";
  get mapReady() { return this.completedMapId === this.mapId && !!this.mapId; }
  private environment: Mesh[] = [];
  private mapLights: PointLight[] = [];
  private sky: Mesh;
  private skyMaterial: ShaderMaterial;
  private customSky?: Mesh;
  private customEnvironment?: BaseTexture;
  private defaultEnvironment?: BaseTexture;
  private yaw = 0;
  private pitch = 0;
  private seq = 0;
  private elapsed = 0;
  private lastRound = 0;
  private state?: GameView;
  private gun: Mesh;
  settings: Settings;
  active = false;
  private spectatorId = "";
  private assets: Assets;
  private audio: TacticalAudio;
  private physics: CosmeticPhysics;
  private mapModel?: TransformNode;
  private kingZone?: Mesh;
  private kick = 0;
  private motion = new ViewmodelMotion();
  private cancelSprint = false;
  private lastPoseAds = 0;
  private actorPhases = new Map<string, number>();
  private actorDead = new Set<string>();
  private weapon?: AssetInstance;
  private actorAssets = new Map<string, AssetInstance>();
  private drawElapsed = DRAW_SECONDS;
  private bakedDraw = false;
  private reloadWasActive = false;
  private shotAnimRemaining = 0;
  private dev: DevTools;
  private effects: ShotEffects;
  private prediction = new ShotPrediction();
  private fireRequested = false;
  private lastSprintPose = 0;
  private actorReloading = new Set<string>();
  private actorWeapons = new Map<string, string>();
  private weaponManifests = new Map<string, WeaponManifest>();
  private currentManifest?: WeaponManifest;
  private nameTags = new Map<string, HTMLDivElement>();
  private tags = document.createElement("div");
  private damageShake = 0;
  private crouchedActors = new Set<string>();
  private currentWeapon = "";
  private queuedWeapon = "";
  private switchElapsed = 0;
  private switchLoaded = false;
  private weaponLoadGeneration = 0;
  private emptyClickAt = -Infinity;
  private loadoutPreload?: Promise<void>;
  private devCamera={enabled:false,distance:3.2,height:.65};
  private previousHealth = new Map<string, number>();
  private respawnHiddenUntil = new Map<string, number>();
  constructor(
    private canvas: HTMLCanvasElement,
    private network: Network,
    settings: Settings,
  ) {
    this.settings = settings;
    this.engine = new Engine(canvas, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.065, 0.077, 0.084, 1);
    this.scene.fogMode = Scene.FOGMODE_LINEAR;
    this.scene.fogStart = 45;
    this.scene.fogEnd = 115;
    this.scene.fogColor = new Color3(0.67, 0.81, 0.94);
    this.camera = new UniversalCamera(
      "eyes",
      new Vector3(0, 2, -14),
      this.scene,
    );
    this.camera.minZ = 0.05;
    this.camera.maxZ = 120;
    this.camera.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
    this.camera.fov = (settings.fov * Math.PI) / 180;
    const sky = (this.sky = MeshBuilder.CreateSphere(
      "map-sky",
      { diameter: 180, segments: 24 },
      this.scene,
    ));
    sky.infiniteDistance = true;
    sky.isPickable = false;
    sky.applyFog = false;
    const skyMaterial = (this.skyMaterial = new ShaderMaterial(
      "sky-gradient",
      this.scene,
      {
        vertexSource:
          "precision highp float;attribute vec3 position;uniform mat4 worldViewProjection;varying float elevation;void main(){elevation=max(0.0,position.y/90.0);gl_Position=worldViewProjection*vec4(position,1.0);}",
        fragmentSource:
          "precision highp float;varying float elevation;uniform vec3 horizonColor;uniform vec3 topColor;void main(){gl_FragColor=vec4(mix(horizonColor,topColor,pow(elevation,.65)),1.0);}",
      },
      {
        attributes: ["position"],
        uniforms: ["worldViewProjection", "horizonColor", "topColor"],
      },
    ));
    skyMaterial.backFaceCulling = false;
    skyMaterial.setColor3("horizonColor", new Color3(0.72, 0.85, 0.98));
    skyMaterial.setColor3("topColor", new Color3(0.12, 0.43, 0.86));
    sky.material = skyMaterial;
    this.shadows = daylight(this.scene, this.camera);
    this.defaultEnvironment = this.scene.environmentTexture ?? undefined;
    this.gun = MeshBuilder.CreateBox(
      "glock-placeholder",
      { width: 0.08, height: 0.12, depth: 0.3 },
      this.scene,
    );
    this.gun.parent = this.camera;
    this.gun.position.set(0.18, -0.17, 0.4);
    this.gun.material = this.material("gun", new Color3(0.12, 0.13, 0.14));
    this.assets = new Assets(this.scene);
    void this.assets.preload(ASSETS.player,ASSETS.playerB);
    this.audio = new TacticalAudio(() => this.settings);
    this.physics = new CosmeticPhysics(this.scene);
    this.effects = new ShotEffects(this.scene);
    this.dev = new DevTools(this.scene, () => this.actorAssets.values(), network);
    this.tags.id = "name-tags";
    document.body.append(this.tags);
    this.scene.setRenderingAutoClearDepthStencil(1, true, true, true);
    void this.changeWeapon("secondary/glock");
    network.addEventListener("identity", () => void this.preloadLoadout());
    network.addEventListener("match", () => void this.preloadLoadout());
    network.addEventListener("shot", (e) =>
      this.shot((e as CustomEvent<ShotEvent>).detail),
    );
    network.addEventListener("fire-rejected", (e) =>
      this.prediction.acknowledge((e as CustomEvent).detail.shotId),
    );
    network.addEventListener("step", (e) => {
      const step = (e as CustomEvent).detail;
      this.audio.play("step", step, step.volume ?? 1);
    });
    network.addEventListener("reload", (e) => {
      const detail = (e as CustomEvent).detail,
        weapon = this.state?.players[detail.id]?.weapon;
      const local=detail.id===this.network.match?.sessionId;
      // The local weapon lives with the listener. Remote reloads remain HRTF
      // emitters and are moved with their player every frame.
      this.audio.play("reload", local?undefined:detail, 1, weapon, detail.id);
    });
    network.addEventListener("reload-stop", (e) => {
      this.audio.stop("reload", (e as CustomEvent).detail.id);
    });
    window.addEventListener("resize", () => this.engine.resize());
    window.addEventListener("dev-third-person",e=>{this.devCamera={...(e as CustomEvent<typeof this.devCamera>).detail};});
    window.addEventListener("keydown", (e) => {
      if (e.code === "F2" && this.dev.available) return;
      if (!this.locked) return;
      e.preventDefault();
      if (!this.keys.has(e.code)) this.press(e.code);
      this.keys.add(e.code);
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (!this.locked) return;
        e.preventDefault();
        const current=this.currentManifest?.slot??"secondary";
        this.chooseSlot(e.deltaY>0?(current==="primary"?2:1):(current==="secondary"?1:2));
      },
      { passive: false },
    );
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    document.addEventListener("pointerlockchange", () => {
      this.keys.clear();
      window.dispatchEvent(new Event("game-lock"));
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("mousedown", (e) => {
      void this.audio.unlock();
      const me=this.state?.players[this.network.match?.sessionId??""];
      if(me&&me.health<=0&&(this.state?.gameMode==="deathmatch"||this.state?.gameMode==="king-of-the-hill")){
        this.network.send("respawn");
        return;
      }
      if (!this.locked) {
        if (this.active) void canvas.requestPointerLock();
        return;
      }
      const key = `Mouse${e.button}`;
      this.press(key);
      this.keys.add(key);
    });
    window.addEventListener("mouseup", (e) =>
      this.keys.delete(`Mouse${e.button}`),
    );
    window.addEventListener("mousemove", (e) => {
      if (!this.locked || !this.active) return;
      const me = this.state?.players[this.network.match?.sessionId ?? ""];
      if (!me || me.health <= 0) return;
      const factor =
        0.002 * this.settings.sensitivity * (this.held("ads") ? 0.72 : 1);
      this.yaw = (this.yaw + e.movementX * factor) % (Math.PI * 2);
      this.pitch = Math.max(
        -1.5,
        Math.min(1.5, this.pitch + e.movementY * factor),
      );
    });
    this.scene.onAfterAnimationsObservable.add(()=>{
      for(const [id,actor]of this.actorAssets){
        const p=this.state?.players[id];
        actor.holdingRig?.apply(actor.holding,actor.worldWeapon?.root,!!p&&p.health>0&&!p.reloading);
        if(p&&p.health>0&&!p.reloading)for(const [node,q]of actor.handPose??[])node.rotationQuaternion=q;
      }
    });
    this.engine.runRenderLoop(() => {
      this.frame(Math.min(this.engine.getDeltaTime() / 1000, 0.05));
      this.scene.render();
    });
  }
  get locked() {
    return document.pointerLockElement === this.canvas;
  }
  get loadedMapId() {
    return this.mapId;
  }
  enter() {
    void this.audio.unlock().then(() => this.preloadLoadout());
    void this.canvas.requestPointerLock();
  }
  private held(action: Action) {
    return this.keys.has(this.settings.keys[action]);
  }
  private press(key: string) {
    if (key === "Digit1") return this.chooseSlot(1);
    if (key === "Digit2") return this.chooseSlot(2);
    if (this.drawElapsed < DRAW_SECONDS || this.switchElapsed > 0) return;
    if (key === this.settings.keys.fire) {
      this.cancelSprint = true;
      this.fireRequested = true;
      this.tryFire();
    }
    if (key === this.settings.keys.reload) {
      this.fireRequested = false;
      this.network.send("reload");
    }
  }
  private chooseSlot(slot: 1 | 2) {
    const id = slot === 1 ? this.settings.primary : this.settings.secondary;
    if (!id) return;
    const path = `${slot === 1 ? "primary" : "secondary"}/${id}`;
    if (!this.network.weapons.some((weapon) => weapon.path === path)) return;
    if (path === this.currentWeapon || path === this.queuedWeapon) return;
    this.queuedWeapon = path;
    this.switchElapsed = 0.5;
    this.switchLoaded = false;
    this.fireRequested = false;
    const meId=this.network.match?.sessionId;
    if(meId)this.audio.stop("reload",meId);
    this.network.send("weapon", path);
  }
  private preloadLoadout() {
    if (this.loadoutPreload) return this.loadoutPreload;
    const paths = [
      this.settings.primary ? `primary/${this.settings.primary}` : "",
      this.settings.secondary ? `secondary/${this.settings.secondary}` : "",
    ].filter((path) => path && this.network.weapons.some((w) => w.path === path));
    this.loadoutPreload = Promise.all(paths.map(async (path) => {
      const manifest = await this.network.weapon(path);
      this.weaponManifests.set(path, manifest);
      await this.assets.preload(manifest.assets.view, manifest.assets.world);
      await this.audio.weapon(path, manifest);
    })).then(() => undefined).finally(() => { this.loadoutPreload = undefined; });
    return this.loadoutPreload;
  }
  private async changeWeapon(path: string) {
    const generation=++this.weaponLoadGeneration;
    this.gun.setEnabled(false);
    this.reloadWasActive=false;this.shotAnimRemaining=0;this.bakedDraw=false;
    const meId=this.network.match?.sessionId;if(meId)this.audio.stop("reload",meId);
    this.weapon?.clips.resetToIdle();
    this.weapon?.dispose();this.weapon=undefined;
    this.gun.position.setAll(0);this.gun.rotation.setAll(0);this.gun.scaling.setAll(1);
    try {
      const manifest = await this.network.weapon(path);
      if(generation!==this.weaponLoadGeneration)return;
      this.weaponManifests.set(path, manifest);
      this.currentManifest = manifest;
      void this.audio.weapon(path, manifest);
      this.gun.isVisible = true;
      const loaded = await this.assets.viewWeapon(manifest, this.gun, this.gun);
      if(generation!==this.weaponLoadGeneration){loaded?.dispose();return;}
      this.weapon = loaded ?? undefined;
      this.weapon?.clips.settleIdle();
      this.currentWeapon = path;
      window.dispatchEvent(
        new CustomEvent("weapon-changed", {
          detail: { name: manifest.name, path },
        }),
      );
      this.beginDraw();
    } catch (error) {
      console.warn("Weapon package unavailable", error);
    }
  }
  private actorWeaponRequests = new Map<string,{actor:AssetInstance,path:string}>();
  private async changeActorWeapon(id: string, path: string) {
    const actor = this.actorAssets.get(id);
    if (!actor || this.actorWeapons.get(id) === path) return;
    const pending=this.actorWeaponRequests.get(id);
    if(pending?.actor===actor&&pending.path===path)return;
    const request={actor,path};this.actorWeaponRequests.set(id,request);
    try {
      const manifest = await this.network.weapon(path);
      this.weaponManifests.set(path, manifest);
      void this.audio.weapon(path, manifest);
      if (this.actorAssets.get(id) !== actor || this.actorWeaponRequests.get(id)!==request) return;
      const world=await this.assets.worldWeapon(manifest, actor);
      // Other players should already be holding their selected weapon. A
      // camera-facing draw motion made small pistols appear to float in.
      if(world){world.root.position.setAll(0);world.root.rotation.setAll(0);world.clips.settleIdle();world.weaponAction=undefined;}
      if(this.actorWeaponRequests.get(id)===request)this.actorWeapons.set(id, path);
    } catch (error) {
      console.warn("World weapon package unavailable", error);
    } finally {if(this.actorWeaponRequests.get(id)===request)this.actorWeaponRequests.delete(id);}
  }
  private tryFire() {
    const me = this.state?.players[this.network.match?.sessionId ?? ""];
    const auto=this.currentManifest?.gameplay.fireMode === "auto" && this.held("fire");
    if ((!this.fireRequested && !auto) || !me) return;
    if (me.sprint || this.lastSprintPose > 0.02) return;
    this.fireRequested = false;
    if (
      !this.active ||
      !this.locked ||
      this.state?.phase !== "live" ||
      me.health <= 0 ||
      me.reloading ||
      this.drawElapsed < DRAW_SECONDS || this.switchElapsed > 0
    )
      return;
    if(me.ammo<=0){
      const cadence=60/(this.currentManifest?.gameplay.rpm??480),now=performance.now()/1000;
      if(now-this.emptyClickAt>=cadence){this.emptyClickAt=now;this.audio.play("empty");window.dispatchEvent(new Event("game-empty"));}
      return;
    }
    const shotId = this.prediction.request(
      performance.now(),
      me.ammo,
      60 / (this.currentManifest?.gameplay.rpm ?? 480),
    );
    if (shotId === undefined) return;
    this.localShot();
    this.network.send("fire", { shotId, yaw: this.yaw, pitch: this.pitch });
  }
  private localShot() {
    this.dev.shotStarted();
    this.audio.play("shot", undefined, 1, this.currentWeapon);
    if (usesProcedural(this.currentManifest?.firstPerson.animations?.fire, !!this.weapon?.clips.has("fire"))) this.motion.fire();
    const shotSeconds = 60 / (this.currentManifest?.gameplay.rpm ?? 480);
    this.weapon?.clips.play("fire", false, shotSeconds);
    this.shotAnimRemaining = shotSeconds;
    this.kick = Math.min(0.06, this.kick + 0.025);
    this.effects.muzzle(
      this.weapon?.muzzle,
      this.camera.position.add(
        this.camera.getDirection(Vector3.Forward()).scale(0.6),
      ),
      true,
      this.currentManifest?.effects,
    );
    void this.physics.casing(
      this.camera.position.add(new Vector3(0.15, -0.15, 0.15)),
      this.yaw,
    );
  }
  private beginDraw() {
    this.prediction.reset();
    this.fireRequested = false;
    this.motion.reset();
    this.cancelSprint = false;
    this.drawElapsed = 0;
    this.reloadWasActive=false;this.shotAnimRemaining=0;
    this.weapon?.clips.settleIdle();
    this.bakedDraw =
      this.weapon?.clips.play("draw", false) ?? false;
  }
  private material(name: string, color: Color3) {
    const m = new StandardMaterial(name, this.scene);
    m.diffuseColor = color;
    m.specularColor = new Color3(0.08, 0.08, 0.08);
    return m;
  }
  private async loadMap(id: string) {
    this.completedMapId = "";
    // mapId is committed synchronously, before any await, so a re-entrant
    // update() during this async load can never start a second loadMap for it.
    this.mapId = id;
    this.mapModel?.dispose();
    this.kingZone?.dispose();this.kingZone=undefined;
    for (const mesh of this.environment) mesh.dispose();
    this.environment = [];
    for (const light of this.mapLights) light.dispose();
    this.mapLights = [];
    setLoading(true, "PREPARING MAP", 4);
    await paint();
    const map = mapById(id);
    this.applySkybox(map.skybox?.preset ?? "blue-day", map.skybox?.asset);
    applyMapSun(this.scene,map.sun);
    const zone=map.kingZone??(map.bounds?{x:(map.bounds.minX+map.bounds.maxX)/2,y:0,z:(map.bounds.minZ+map.bounds.maxZ)/2,radius:4,height:.08}:undefined);
    if(zone){const ring=this.kingZone=MeshBuilder.CreateCylinder("king-of-the-hill-zone",{height:.06,diameter:zone.radius*2,tessellation:64},this.scene),mat=this.material("king-of-the-hill-zone-material",new Color3(.25,.65,1));ring.position.set(zone.x,zone.y+.035,zone.z);mat.alpha=.28;mat.emissiveColor=new Color3(.12,.38,.72);mat.backFaceCulling=false;ring.material=mat;ring.isPickable=false;for(let i=0;i<14;i++){const mote=MeshBuilder.CreateSphere(`hill-mote-${i}`,{diameter:.045+(i%3)*.015},this.scene);mote.parent=ring;mote.position.set(Math.sin(i/14*Math.PI*2)*zone.radius*.92,.12+(i%5)*.13,Math.cos(i/14*Math.PI*2)*zone.radius*.92);mote.material=mat;mote.isPickable=false;}ring.setEnabled(false);}
    if (map.triangles) {
      // The same baked surface used by the server also supplies a safe fallback
      // and Havok casing collision; no obsolete greybox walls remain.
      setLoading(
        true,
        "BAKING COLLISION MESH",
        15,
        `${map.triangles.length.toLocaleString()} triangles`,
      );
      await paint();
      const mesh = new Mesh("map-collision-surface", this.scene),
        data = new VertexData();
      data.positions = map.triangles.flat();
      data.indices = Array.from(
        { length: data.positions.length / 3 },
        (_, i) => i,
      );
      const normals: number[] = [];
      VertexData.ComputeNormals(data.positions, data.indices, normals);
      data.normals = normals;
      data.applyToMesh(mesh);
      const mat = this.material("map-fallback", new Color3(0.3, 0.32, 0.34));
      mat.backFaceCulling = false;
      mesh.material = mat;
      this.environment.push(mesh);
      setLoading(true, "PREPARING PHYSICS", 55);
      await paint();
      await this.physics.setMap([mesh], true);
    } else {
      for (const [i, w] of map.walls.entries()) {
        const mesh = MeshBuilder.CreateBox(
          `cover-${i}`,
          { width: w.w, height: w.h, depth: w.d },
          this.scene,
        );
        mesh.position.set(w.x, w.y, w.z);
        this.environment.push(mesh);
      }
      void this.physics.setMap(this.environment);
    }
    const root = (this.mapModel = new TransformNode("map-model", this.scene));
    root.position.set(map.offsetX ?? 0, map.offsetY ?? 0, map.offsetZ ?? 0);
    root.rotation.y = map.rotationY ?? 0;
    root.scaling.setAll(map.scale ?? 1);
    const placeholders = [...this.environment];
    for (const source of map.lights ?? []) {
      const light = new PointLight(
        `map-light-${source.id}`,
        new Vector3(source.x, source.y, source.z),
        this.scene,
      );
      light.diffuse = Color3.FromHexString(source.color);
      light.intensity = source.intensity;
      light.range = source.range;
      this.mapLights.push(light);
    }
    setLoading(true, "LOADING ENVIRONMENT", 75);
    await paint();
    try {
      const loaded = await this.assets.instance(map.asset, root);
      await this.effects.ready.catch(() => {});
      if (loaded) {
        for (const mesh of placeholders)
          if (!mesh.isDisposed()) mesh.isVisible = false;
        for (const mesh of root.getChildMeshes()) {
          mesh.receiveShadows = true;
          this.shadows.addShadowCaster(mesh, false);
          mesh.onDisposeObservable.addOnce(() =>
            this.shadows.removeShadowCaster(mesh, false),
          );
        }
      }
    } finally {
      this.completedMapId = id;
      setLoading(false);
      // Tells the server this client is done — the host's signal releases the
      // prep-round countdown, which is held until then so nobody starts blind.
      this.network.send("ready");
    }
  }
  private applySkybox(
    preset: "blue-day" | "overcast" | "night" | "custom",
    asset?: string,
  ) {
    this.customSky?.dispose();
    this.customSky = undefined;
    this.customEnvironment?.dispose();
    this.customEnvironment = undefined;
    this.scene.environmentTexture = this.defaultEnvironment ?? null;
    this.sky.setEnabled(true);
    const colors =
      preset === "night"
        ? {
            h: new Color3(0.035, 0.06, 0.13),
            t: new Color3(0.005, 0.012, 0.04),
            fog: new Color3(0.07, 0.1, 0.16),
          }
        : preset === "overcast"
          ? {
              h: new Color3(0.63, 0.67, 0.7),
              t: new Color3(0.28, 0.33, 0.38),
              fog: new Color3(0.52, 0.57, 0.61),
            }
          : {
              h: new Color3(0.72, 0.85, 0.98),
              t: new Color3(0.12, 0.43, 0.86),
              fog: new Color3(0.67, 0.81, 0.94),
            };
    this.skyMaterial.setColor3("horizonColor", colors.h);
    this.skyMaterial.setColor3("topColor", colors.t);
    this.scene.fogColor = colors.fog;
    if (preset === "custom" && asset) {
      const texture = (this.customEnvironment =
        asset.toLowerCase().endsWith(".hdr")
          ? new HDRCubeTexture(asset,this.scene,256,false,true,false,true)
          : asset.toLowerCase().endsWith(".env")
            ? CubeTexture.CreateFromPrefilteredData(asset, this.scene)
            : new CubeTexture(asset,this.scene));
      this.scene.environmentTexture = texture;
      this.customSky =
        this.scene.createDefaultSkybox(texture, true, 180) ?? undefined;
      this.sky.setEnabled(false);
    }
  }
  update(state: GameView) {
    this.state = state;
    this.active = !["waiting", "finished", "abandoned"].includes(state.phase);
    if (state.phase === "waiting") {
      this.lastRound = 0;
      for (const mesh of this.players.values()) mesh.setEnabled(false);
      for (const tag of this.nameTags.values()) tag.hidden = true;
      return;
    }
    const mapChanged = this.mapId !== state.mapId;
    if (mapChanged) void this.loadMap(state.mapId);
    const me = state.players[this.network.match?.sessionId ?? ""];
    if (
      me?.weapon &&
      me.weapon !== this.currentWeapon &&
      me.weapon !== this.queuedWeapon
    ) {
      this.queuedWeapon = me.weapon;
      this.switchElapsed = 0.5;
      this.switchLoaded = false;
    }
    if (me && state.round !== this.lastRound) {
      this.lastRound = state.round;
      this.yaw = me.yaw;
      this.pitch = 0;
      this.seq = Math.max(this.seq, me.ack);
      this.kick = 0;
      this.reloadWasActive = false;
      this.shotAnimRemaining = 0;
      this.beginDraw();
      this.actorPhases.clear();
      this.actorReloading.clear();
      this.actorDead.clear();
      for (const actor of this.actorAssets.values()) {
        actor.clips.play("idle");
        actor.combat?.stop();
      }
      this.camera.position.set(me.x, me.y + RULES.eyeHeight, me.z);
    }
    for (const p of Object.values(state.players)) {
      if (!this.players.has(p.id)) {
        const mesh = MeshBuilder.CreateCapsule(
          p.id,
          { height: RULES.height, radius: RULES.radius },
          this.scene,
        );
        mesh.material = this.material(
          p.id,
          p.team === "A"
            ? new Color3(0.35, 0.62, 0.67)
            : new Color3(0.85, 0.44, 0.2),
        );
        mesh.position.set(p.x, p.y + RULES.height / 2, p.z);
        this.players.set(p.id, mesh);
        const shield=MeshBuilder.CreateCapsule(`${p.id}-spawn-protection`,{height:RULES.height+0.18,radius:RULES.radius+0.1},this.scene);
        const shieldMat=this.material(`${p.id}-spawn-protection-material`,new Color3(.12,.62,1));
        shieldMat.alpha=.2;shieldMat.emissiveColor=new Color3(.08,.34,.72);shieldMat.backFaceCulling=false;
        shield.material=shieldMat;shield.isPickable=false;shield.setEnabled(false);this.spawnShields.set(p.id,shield);
        const root = new TransformNode(`${p.id}-model`, this.scene);
        root.parent = mesh;
        root.position.y = -RULES.height / 2;
        void this.assets
          .instance(p.team==="B"?ASSETS.playerB:ASSETS.player, root, undefined, {
            characterHeight: RULES.height,
          })
          .then((loaded) => {
            if (!loaded) return;
            if (mesh.isDisposed() || this.players.get(p.id) !== mesh) {
              loaded.dispose();
              return;
            }
            mesh.isVisible = false;
            this.actorAssets.set(p.id, loaded);
            void this.changeActorWeapon(p.id, p.weapon);
            for (const part of root.getChildMeshes()) {
              part.receiveShadows = true;
              this.shadows.addShadowCaster(part, false);
              part.onDisposeObservable.addOnce(() =>
                this.shadows.removeShadowCaster(part, false),
              );
            }
          });
      }
      if (
        this.actorAssets.has(p.id) &&
        this.actorWeapons.get(p.id) !== p.weapon
      )
        void this.changeActorWeapon(p.id, p.weapon);
      if (mapChanged) {
        const mesh = this.players.get(p.id)!;
        mesh.position.set(p.x, p.y + RULES.height / 2, p.z);
        mesh.rotation.y = p.yaw;
        mesh.setEnabled(false);
      }
    }
  }
  private frame(dt: number) {
    for(const actor of this.actorAssets.values())actor.holdingRig?.restore();
    this.dev.tick(this.active ? this.state : undefined);
    if (!this.state || !this.active) {
      this.gun.setEnabled(false);
      document.body.classList.remove("is-ads");
      for (const tag of this.nameTags.values()) tag.hidden = true;
      return;
    }
    const me = this.state.players[this.network.match?.sessionId ?? ""];
    if (!me) return;
    if(this.kingZone){this.kingZone.setEnabled(this.state.gameMode==="king-of-the-hill");this.kingZone.rotation.y+=dt*.22;const mat=this.kingZone.material as StandardMaterial;if(this.state.zoneTeam==="A"){mat.diffuseColor=new Color3(.18,.58,1);mat.emissiveColor=new Color3(.08,.35,.85);}else if(this.state.zoneTeam==="B"){mat.diffuseColor=new Color3(1,.42,.12);mat.emissiveColor=new Color3(.8,.18,.04);}else{mat.diffuseColor=new Color3(.5,.55,.58);mat.emissiveColor=new Color3(.18,.22,.25);}}
    const map=mapById(this.state.mapId),zone=map.kingZone??(map.bounds?{x:(map.bounds.minX+map.bounds.maxX)/2,y:0,z:(map.bounds.minZ+map.bounds.maxZ)/2,radius:4,height:3}:undefined),inHill=!!zone&&this.state.gameMode==="king-of-the-hill"&&Math.hypot(me.x-zone.x,me.z-zone.z)<=zone.radius;
    document.body.classList.toggle("in-king-zone",inHill);
    if (this.switchElapsed > 0) {
      this.switchElapsed = Math.max(0, this.switchElapsed - dt);
      if (!this.switchLoaded && this.switchElapsed <= 0.25) {
        this.switchLoaded = true;
        void this.changeWeapon(this.queuedWeapon);
      }
      if (this.switchElapsed === 0) {
        this.queuedWeapon = "";
      }
    }
    const wasDrawing = this.drawElapsed < DRAW_SECONDS;
    this.drawElapsed = Math.min(DRAW_SECONDS, this.drawElapsed + dt);
    if (wasDrawing && this.drawElapsed === DRAW_SECONDS)
      this.weapon?.clips.play("idle");
    if (me.reloading && !this.reloadWasActive)
      this.weapon?.clips.play(
        "reload",
        false,
        this.currentManifest?.gameplay.reloadSeconds ?? RULES.reloadSeconds,
      );
    if (!me.reloading && this.reloadWasActive) this.weapon?.clips.play("idle");
    this.reloadWasActive = me.reloading;
    if (this.shotAnimRemaining > 0) {
      this.shotAnimRemaining -= dt;
      if (this.shotAnimRemaining <= 0 && !me.reloading)
        this.weapon?.clips.play("idle");
    }
    this.weapon?.clips.tick(dt);
    if (!this.held("sprint")) this.cancelSprint = false;
    const sprint =
      this.state.phase === "live" &&
      this.locked &&
      this.held("sprint") &&
      !this.cancelSprint &&
      !this.held("ads") &&
      !this.held("crouch") &&
      !me.reloading &&
      this.held("forward");
    this.elapsed += dt;
    if (this.elapsed >= 1 / 30) {
      this.elapsed = 0;
      this.network.send("input", {
        seq: ++this.seq,
        forward: this.locked
          ? Number(this.held("forward")) - Number(this.held("back"))
          : 0,
        strafe: this.locked
          ? Number(this.held("right")) - Number(this.held("left"))
          : 0,
        yaw: this.yaw,
        pitch: this.pitch,
        jump: this.locked && this.held("jump"),
        crouch: this.locked && this.held("crouch"),
        ads: this.locked && this.held("ads"),
        sprint,
      });
    }
    const target =
      me.health > 0
        ? me
        : Object.values(this.state.players).find(
            (p) => p.team === me.team && p.health > 0 && p.connected,
          );
    if(me.health<=0&&target?.weapon&&target.weapon!==this.currentWeapon&&target.weapon!==this.queuedWeapon){
      this.queuedWeapon=target.weapon;this.switchElapsed=.3;this.switchLoaded=false;
    }
    this.kick *= Math.exp(-12 * dt);
    this.damageShake *= Math.exp(-10 * dt);
    if (target) {
      const eye=new Vector3(target.x,target.y+(target.crouch?RULES.crouchEyeHeight:RULES.eyeHeight),target.z),third=this.dev.available&&this.devCamera.enabled;
      const desired=third?eye.add(new Vector3(-Math.sin(this.yaw)*this.devCamera.distance,this.devCamera.height,-Math.cos(this.yaw)*this.devCamera.distance)):eye;
      // Horizontal tracking stays responsive while grounded vertical changes
      // use a softer visual follow, hiding discrete network stair risers without
      // changing the authoritative capsule or allowing clients through walls.
      const horizontal=1-Math.exp(-22*dt),vertical=1-Math.exp(-(target.grounded?10:18)*dt);
      this.camera.position.set(
        this.camera.position.x+(desired.x-this.camera.position.x)*horizontal,
        this.camera.position.y+(desired.y-this.camera.position.y)*vertical,
        this.camera.position.z+(desired.z-this.camera.position.z)*horizontal,
      );
      const local = target.id === me.id;
      this.camera.rotation.set(
        local
          ? this.pitch -
              this.kick +
              Math.sin(performance.now() * 0.06) * this.damageShake * 0.01
          : target.pitch,
        local
          ? this.yaw +
              Math.cos(performance.now() * 0.047) * this.damageShake * 0.008
          : target.yaw,
        0,
      );
      if(third)this.camera.setTarget(eye);
    }
    this.audio.listener(
      this.camera.position,
      this.camera.rotation.y,
      this.camera.rotation.x,
    );
    for (const [id, mesh] of this.players) {
      const p = this.state.players[id];
      if (!p) continue;
      this.audio.move("reload",id,{x:p.x,y:p.y+(p.crouch?RULES.crouchEyeHeight:RULES.eyeHeight),z:p.z});
      const actor = this.actorAssets.get(id);
      const dead = p.health <= 0;
      const priorHealth=this.previousHealth.get(id);
      if(priorHealth!==undefined&&priorHealth<=0&&p.health>0){
        // Hide the corpse while it is atomically returned to a spawn. This
        // prevents interpolation from visibly dragging a body across the map.
        mesh.position.set(p.x,p.y+RULES.height/2,p.z);
        this.respawnHiddenUntil.set(id,performance.now()+140);
        actor?.clips.resetToIdle();actor?.combat?.stop();
        if(id===me.id)this.camera.position.set(p.x,p.y+(p.crouch?RULES.crouchEyeHeight:RULES.eyeHeight),p.z);
      }
      this.previousHealth.set(id,p.health);
      const shield=this.spawnShields.get(id);
      if(shield){shield.position.set(p.x,p.y+RULES.height/2,p.z);shield.setEnabled(id!==me.id&&p.health>0&&p.spawnProtected);}
      if (dead && actor && !this.actorDead.has(id)) {
        this.actorDead.add(id);
        actor.combat?.stop();
        actor.clips.play("death", false);
      }
      if (!dead && this.actorDead.delete(id)) actor?.clips.play("idle");
      mesh.setEnabled(
        p.connected &&
          id !== me.id &&
          id !== target?.id &&
          (!dead || this.actorDead.has(id)) &&
          performance.now()>=(this.respawnHiddenUntil.get(id)??0)
      );
      const dx = p.x - mesh.position.x,
        dz = p.z - mesh.position.z;
      const moving = p.grounded && Math.hypot(p.vx, p.vz) > 0.12;
      const forward = p.vx * Math.sin(p.yaw) + p.vz * Math.cos(p.yaw),
        strafe = p.vx * Math.cos(p.yaw) - p.vz * Math.sin(p.yaw);
      let action: ClipAction = "idle";
      if (moving)
        action =
          Math.abs(strafe) > Math.abs(forward)
            ? strafe > 0
              ? "strafeRight"
              : "strafeLeft"
            : forward < 0
              ? "walkBackward"
              : "walk";
      if (p.sprint && moving) action = "run";
      if (p.crouch && actor?.clips.has("crouch"))
        action = moving ? "crouchWalk" : "crouch";
      if (!p.grounded) action = "jump";
      if (actor && !actor.clips.has(action)) action = p.crouch&&actor.clips.has("crouch")?"crouch":"idle";
      if (!dead) {
        if (p.crouch) this.crouchedActors.add(id);
        else this.crouchedActors.delete(id);
        actor?.clips.play(action, true);
        if (p.reloading) {
          if (!this.actorReloading.has(id)) {
            this.actorReloading.add(id);
            if(actor?.worldWeapon){const w=actor.worldWeapon,duration=this.weaponManifests.get(p.weapon)?.gameplay.reloadSeconds??RULES.reloadSeconds;w.clips.play("reload",false,duration);w.weaponAction={action:"reload",elapsed:0,duration};}
            actor?.combat?.play(
              "reload",
              false,
              this.weaponManifests.get(p.weapon)?.gameplay.reloadSeconds ??
                RULES.reloadSeconds,
            );
          }
        } else if (this.actorReloading.delete(id)) actor?.combat?.stop();
      }
      // Two authoritative footfalls per full walk cycle; identical phase drives
      // viewmodel bob and server-emitted footsteps, including ADS/crouch speeds.
      const phase =
        (this.actorPhases.get(id) ?? p.stepPhase) +
        (p.stepPhase - (this.actorPhases.get(id) ?? p.stepPhase)) *
          (1 - Math.exp(-24 * dt));
      this.actorPhases.set(id, phase);
      if (action === "jump" && !dead)
        actor?.clips.phase(
          Math.max(0.05, Math.min(0.95, 0.5 - (p.vy ?? 0) / 12)),
        );
      if (moving && !dead) actor?.clips.phase((phase / 2) % 1);
      actor?.clips.tick(dt);
      actor?.combat?.tick(dt);
      const world=actor?.worldWeapon;
      if(world){
        world.clips.tick(dt);
        const a=world.weaponAction;
        if(a){
          a.elapsed+=dt;
          const binding=this.weaponManifests.get(p.weapon)?.thirdPerson.animations?.[a.action];
          world.root.position.setAll(0);world.root.rotation.setAll(0);
          if(!dead && usesProcedural(binding,world.clips.has(a.action))){
            const t=Math.min(1,a.elapsed/a.duration),wave=Math.sin(Math.PI*t);
            if(a.action==="draw"){const d=drawPose(a.elapsed);world.root.position.set(d.x,d.y,d.z);world.root.rotation.set(d.pitch,0,d.roll);}
            if(a.action==="fire"){world.root.position.z=-.024*wave;world.root.rotation.x=-.037*wave;}
            if(a.action==="reload")world.root.rotation.x=-.65*wave;
          }
          if(dead||a.elapsed>=a.duration){world.weaponAction=undefined;world.root.position.setAll(0);world.root.rotation.setAll(0);world.clips.play("idle");}
        }
      }

      const h = p.crouch ? RULES.crouchHeight : RULES.height;
      // Crouch is skeletal; do not squash the soldier's entire body.
      const scale = actor ? 1 : h / RULES.height;
      mesh.scaling.y += (scale - mesh.scaling.y) * (1 - Math.exp(-18 * dt));
      mesh.position = Vector3.Lerp(
        mesh.position,
        new Vector3(p.x, p.y + (mesh.scaling.y * RULES.height) / 2, p.z),
        1 - Math.exp(-18 * dt),
      );
      mesh.rotation.y = p.yaw;
      if(actor&&!dead){
        // A restrained upper-body cue makes remote aim pitch readable while
        // keeping the authored locomotion and hand pose intact.
        const aim=Math.max(-.18,Math.min(.18,p.pitch*.22));
        actor.root.rotation.x+=(aim-actor.root.rotation.x)*(1-Math.exp(-12*dt));
      }
    }
    const motion = this.motion.update(
      {
        yaw: this.yaw,
        pitch: this.pitch,
        vx: target?.vx ?? 0,
        vy: target?.vy ?? 0,
        vz: target?.vz ?? 0,
        grounded: target?.grounded ?? true,
        crouch: target?.crouch ?? false,
        ads: me.health > 0 ? this.locked && this.held("ads") : !!target?.ads,
        sprint: me.health > 0 ? sprint : !!target?.sprint,
        reloading: target?.reloading ?? false,
        stepPhase: target?.stepPhase ?? 0,
        lookActive: this.locked,
        proceduralIdle: this.currentManifest
          ? usesProceduralMotion(this.currentManifest.firstPerson, !!this.weapon?.clips.has("idle"))
          : true,
      },
      dt,
    );
    this.lastPoseAds = motion.ads;
    document.body.classList.toggle(
      "is-ads",
      me.health > 0 && (this.held("ads") || motion.ads > 0.01),
    );
    const adsFov = this.currentManifest?.firstPerson.adsFov ?? 0.82;
    this.camera.fov =
      (this.settings.fov * (1 - (1 - adsFov) * motion.ads) * Math.PI) / 180;
    if (this.weapon && this.currentManifest) {
      const hip = this.currentManifest.firstPerson.weapon,
        ads = this.currentManifest.firstPerson.ads,
        t = motion.ads,
        ease = t;
      blendFrame(this.weapon.root, hip, ads, ease);
    }
    const proceduralDraw=usesProcedural(this.currentManifest?.firstPerson.animations?.draw, this.bakedDraw);
    const pose = drawPose(proceduralDraw ? this.drawElapsed : DRAW_SECONDS);
    const switchDrop =
      this.switchElapsed > 0.25
        ? (1 - (this.switchElapsed - 0.25) / 0.25) * 0.38
        : 0;
    this.gun.setEnabled(!!target && !!this.weapon && !(this.dev.available&&this.devCamera.enabled));
    this.gun.position.set(
      motion.x - 0.18 * (1 - motion.ads) + pose.x,
      motion.y - (-0.17 + 0.051 * motion.ads) + pose.y - switchDrop,
      motion.z - 0.4 + pose.z,
    );
    this.gun.rotation.set(
      motion.pitch +
        pose.pitch +
        (me.reloading && usesProcedural(this.currentManifest?.firstPerson.animations?.reload, !!this.weapon?.clips.has("reload")) ? -0.65 : 0),
      motion.yaw,
      motion.roll + pose.roll,
    );
    this.lastSprintPose = motion.sprint;
    this.tryFire();
    const speed = Math.hypot(me.vx ?? 0, me.vz ?? 0),
      gap =
        this.settings.crosshairGap +
        (this.settings.crosshairMode === "dynamic"
          ? Math.min(13, speed * 1.4 + (!me.grounded ? 6 : 0) + this.kick * 80)
          : 0);
    document.documentElement.style.setProperty(
      "--crosshair-gap",
      `${gap.toFixed(1)}px`,
    );
    this.updateNameTags(me, target);
  }
  private shot(shot: ShotEvent) {
    this.dev.shot(shot);
    if (!this.active) return;
    const local = shot.id === this.network.match?.sessionId,
      origin = new Vector3(shot.x, shot.y, shot.z),
      direction = new Vector3(shot.dx, shot.dy, shot.dz),
      end = origin.add(direction.scale(shot.distance));
    const actor = this.actorAssets.get(shot.id),
      muzzle = local ? this.weapon?.muzzle : actor?.muzzle,
      manifest = this.weaponManifests.get(shot.weapon);
    if (local) {
      if (!this.prediction.acknowledge(shot.shotId)) this.localShot();
      if (shot.hit) {
        this.audio.play("hit");
        window.dispatchEvent(
          new CustomEvent("game-hit", {
            detail: { headshot: shot.headshot, killed: !!shot.killed },
          }),
        );
      }
    } else {
      this.audio.play("shot", shot, 1, shot.weapon);
      this.effects.muzzle(muzzle, origin, false, manifest?.effects);
      actor?.combat?.play("fire", false, 60 / (manifest?.gameplay.rpm ?? 480));
      if(actor?.worldWeapon){const w=actor.worldWeapon,duration=60/(manifest?.gameplay.rpm??480);w.clips.play("fire",false,duration);w.weaponAction={action:"fire",elapsed:0,duration};}
    }
    const me = this.state?.players[this.network.match?.sessionId ?? ""];
    if (!local && me && shot.targetId === me.id) {
      const bearing = Math.atan2(shot.x - me.x, shot.z - me.z) - this.yaw;
      this.damageShake = 1;
      window.dispatchEvent(
        new CustomEvent("game-damage", { detail: (bearing * 180) / Math.PI }),
      );
    }
    muzzle?.computeWorldMatrix(true);
    const start = muzzle?.getAbsolutePosition().clone() ?? origin;
    if (shot.distance > 0.65 && Vector3.Dot(end.subtract(start), direction) > 0)
      this.effects.tracer(start, end, manifest?.effects.tracer);
    if (shot.distance < (manifest?.gameplay.range ?? RULES.maxRange) - 0.01) {
      if(shot.hit)this.effects.blood(end,direction);else this.effects.impact(end,direction,false);
    }
  }
  private updateNameTags(me: PlayerView, target?: PlayerView) {
    const viewport = this.camera.viewport.toGlobal(
        this.engine.getRenderWidth(),
        this.engine.getRenderHeight(),
      ),
      visible = new Set<string>(),
      map = mapById(this.state!.mapId);
    for (const p of Object.values(this.state?.players ?? {})) {
      if (
        p.id === me.id ||
        p.id === target?.id ||
        !p.connected ||
        p.health <= 0
      )
        continue;
      const height = p.crouch ? RULES.crouchHeight : RULES.height,
        point = new Vector3(p.x, p.y + height + 0.18, p.z),
        to = point.subtract(this.camera.position);
      if (Vector3.Dot(to, this.camera.getForwardRay().direction) <= 0) continue;
      // A tag is revealed only when at least one meaningful body point has
      // unobstructed line of sight through the authoritative map geometry.
      const seen = [0.22, 0.56, 0.88].some((f) => {
        const sample = new Vector3(p.x, p.y + height * f, p.z),
          ray = sample.subtract(this.camera.position),
          distance = ray.length(),
          direction = ray.scale(1 / distance);
        let obstruction = rayMap(
          this.camera.position,
          direction,
          map,
          distance,
        );
        for (const wall of map.walls)
          obstruction = Math.min(
            obstruction,
            rayBox(this.camera.position, direction, wall),
          );
        return obstruction >= distance - 0.06;
      });
      if (!seen) continue;
      const screen = Vector3.Project(
        point,
        Matrix.IdentityReadOnly,
        this.scene.getTransformMatrix(),
        viewport,
      );
      if (screen.z < 0 || screen.z > 1) continue;
      let tag = this.nameTags.get(p.id);
      if (!tag) {
        tag = document.createElement("div");
        this.tags.append(tag);
        this.nameTags.set(p.id, tag);
      }
      tag.className = `name-tag ${p.team === me.team ? "friendly" : "enemy"}`;
      tag.textContent = p.username;
      tag.style.transform = `translate(${screen.x}px,${screen.y}px) translate(-50%,-100%)`;
      visible.add(p.id);
    }
    for (const [id, tag] of this.nameTags) tag.hidden = !visible.has(id);
  }
  reset() {
    this.dev.reset();
    document.body.classList.remove("is-ads");
    this.active = false;
    this.state = undefined;
    this.lastRound = 0;
    this.keys.clear();
    for (const mesh of this.players.values()) mesh.dispose();
    for (const mesh of this.spawnShields.values()){mesh.material?.dispose();mesh.dispose();}
    this.players.clear();
    this.spawnShields.clear();
    this.actorAssets.clear();
    this.actorPhases.clear();
    this.actorDead.clear();
    this.actorReloading.clear();
    this.actorWeapons.clear();
    this.actorWeaponRequests.clear();
    this.crouchedActors.clear();
    this.previousHealth.clear();
    this.respawnHiddenUntil.clear();
    for (const tag of this.nameTags.values()) tag.remove();
    this.nameTags.clear();
    this.prediction.reset();
    this.fireRequested = false;
    this.effects.clear();
    this.motion.reset();
    if (this.locked) document.exitPointerLock();
  }
}
