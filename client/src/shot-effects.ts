import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  Color3,
  Vector3,
  Quaternion,
  PointLight,
  Material,
  TransformNode,
  Ray,
  PBRMaterial,
} from "@babylonjs/core";
import type { WeaponManifest } from "../../shared/weapons.js";
export function tracerSegment(distance: number, age: number) {
  const head = Math.min(distance, 0.45 + age * 350),
    tail = Math.max(0, head - 1.25);
  return {
    head,
    tail,
    alpha: Math.max(0, 1 - Math.max(0, age - distance / 350) / 0.035),
  };
}
interface Effect {
  age: number;
  life: number;
  tick: (age: number) => void;
  dispose: () => void;
}
export class ShotEffects {
  readonly ready: Promise<void>;
  private light: PointLight;
  private lightAge = 1;
  private effects: Effect[] = [];
  private flash: DynamicTexture;
  private soft: DynamicTexture;
  constructor(private scene: Scene) {
    this.soft = this.texture(false);
    this.flash = this.texture(true);
    this.light = new PointLight("persistent-shot-light", Vector3.Zero(), scene);
    this.light.diffuse = new Color3(1, 0.72, 0.35);
    this.light.range = 2.5;
    this.light.intensity = 0;
    this.ready = this.warmup();
    void this.ready.catch((error) =>
      console.warn("Effect warmup failed", error),
    );
    scene.onBeforeRenderObservable.add(() =>
      this.update(Math.min(scene.getEngine().getDeltaTime() / 1000, 0.05)),
    );
    scene.onDisposeObservable.addOnce(() => {
      this.clear();
      this.flash.dispose();
      this.soft.dispose();
      this.light.dispose();
    });
  }
  private async warmup() {
    const mesh = MeshBuilder.CreatePlane(
      "effect-warmup",
      { size: 0.01 },
      this.scene,
    );
    mesh.isVisible = false;
    mesh.applyFog = false;
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    const materials = [
      this.material("warm-flash", Color3.White(), this.flash),
      this.material("warm-smoke", Color3.White(), this.soft),
      this.material("warm-tracer", Color3.White()),
    ];
    try {
      for (const m of materials) {
        mesh.billboardMode =
          m === materials[2] ? Mesh.BILLBOARDMODE_NONE : Mesh.BILLBOARDMODE_ALL;
        mesh.material = m;
        await m.forceCompilationAsync(mesh);
      }
    } finally {
      mesh.dispose();
      materials.forEach((m) => m.dispose());
    }
  }
  private texture(flame: boolean) {
    const t = new DynamicTexture(
      flame ? "muzzle-flame" : "soft-particle",
      128,
      this.scene,
      false,
    );
    t.hasAlpha = true;
    const ctx = t.getContext(),
      gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 62);
    gradient.addColorStop(0, "rgba(255,255,235,1)");
    gradient.addColorStop(
      0.18,
      flame ? "rgba(255,230,150,.95)" : "rgba(255,255,255,.7)",
    );
    gradient.addColorStop(
      0.48,
      flame ? "rgba(255,140,35,.35)" : "rgba(255,255,255,.3)",
    );
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = gradient;
    if (flame) {
      ctx.save();
      ctx.translate(64, 64);
      ctx.scale(1, 0.42);
      ctx.translate(-64, -64);
      ctx.beginPath();
      ctx.arc(64, 64, 61, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else ctx.fillRect(0, 0, 128, 128);
    t.update();
    return t;
  }
  private material(name: string, color: Color3, texture?: DynamicTexture) {
    const m = new StandardMaterial(name, this.scene);
    m.disableLighting = true;
    m.emissiveColor = color;
    m.diffuseColor = color;
    m.backFaceCulling = false;
    m.disableDepthWrite = true;
    m.transparencyMode = Material.MATERIAL_ALPHABLEND;
    if (texture) {
      m.diffuseTexture = texture;
      m.opacityTexture = texture;
    }
    return m;
  }
  private add(e: Effect) {
    this.effects.push(e);
    while (this.effects.length > 100) this.effects.shift()!.dispose();
    e.tick(0);
  }
  muzzle(
    anchor: TransformNode | undefined,
    fallback: Vector3,
    local = false,
    config?: WeaponManifest["effects"],
  ) {
    anchor?.computeWorldMatrix(true);
    const position = anchor?.getAbsolutePosition().clone() ?? fallback,
      flash = MeshBuilder.CreatePlane(
        "muzzle-flash",
        { size: config?.flash.size ?? (local ? 0.115 : 0.16) },
        this.scene,
      );
    flash.position.copyFrom(position);
    flash.billboardMode = Mesh.BILLBOARDMODE_ALL;
    flash.isPickable = false;
    flash.applyFog = false;
    flash.renderingGroupId = local ? 1 : 0;
    const mat = this.material(
      "muzzle-emission",
      config
        ? Color3.FromHexString(config.flash.color).scale(config.flash.intensity)
        : new Color3(1, 0.82, 0.48),
      this.flash,
    );
    flash.material = mat;
    flash.rotation.z = (Math.random() - 0.5) * 0.2;
    const light = this.light;
    this.lightAge = 0;
    light.position.copyFrom(position);
    light.intensity = 0.75;
    const flashLife = config?.flash.duration ?? 0.032;
    this.add({
      age: 0,
      life: flashLife,
      tick: (t) => {
        mat.alpha = 1 - t / flashLife;
        if (anchor && !anchor.isDisposed()) {
          anchor.computeWorldMatrix(true);
          flash.position.copyFrom(anchor.getAbsolutePosition());
        }
      },
      dispose: () => {
        flash.dispose();
        mat.dispose();
      },
    });
    const forward = anchor
      ? Vector3.TransformNormal(
          Vector3.Forward(),
          anchor.getWorldMatrix(),
        ).normalize()
      : new Vector3(0, 0, 1);
    if (config?.tracer.smoke !== false)
      for (let i = 0; i < 3; i++)
        this.puff(
          position.add(forward.scale(i * 0.025)),
          forward
            .scale(0.2 + i * 0.06)
            .add(
              new Vector3(
                (Math.random() - 0.5) * 0.05,
                0.04 + Math.random() * 0.04,
                (Math.random() - 0.5) * 0.05,
              ),
            ),
          0.035 + i * 0.012,
          0.38 + i * 0.08,
          new Color3(0.5, 0.52, 0.53),
          0.075 - i * 0.012,
        );
  }
  tracer(
    start: Vector3,
    end: Vector3,
    config?: WeaponManifest["effects"]["tracer"],
  ) {
    const delta = end.subtract(start),
      distance = delta.length();
    if (distance < 0.5) return;
    const direction = delta.scale(1 / distance),
      width = config?.width ?? 0.012,
      speed = config?.speed ?? 350,
      length = config?.length ?? 1.25,
      mesh = MeshBuilder.CreateCylinder(
        "bullet-streak",
        {
          height: 1,
          diameterTop: width * 0.25,
          diameterBottom: width,
          tessellation: 5,
        },
        this.scene,
      );
    mesh.isPickable = false;
    mesh.applyFog = false;
    mesh.rotationQuaternion = Quaternion.Identity();
    Quaternion.FromUnitVectorsToRef(
      Vector3.Up(),
      direction,
      mesh.rotationQuaternion,
    );
    const mat = this.material(
      "streak-emission",
      config ? Color3.FromHexString(config.color) : new Color3(1, 0.88, 0.63),
    );
    mesh.material = mat;
    this.add({
      age: 0,
      life: distance / speed + 0.035,
      tick: (t) => {
        const head = Math.min(distance, 0.45 + t * speed),
          tail = Math.max(0, head - length),
          s = {
            head,
            tail,
            alpha: Math.max(0, 1 - Math.max(0, t - distance / speed) / 0.035),
          };
        mesh.position.copyFrom(
          start.add(direction.scale((s.head + s.tail) / 2)),
        );
        mesh.scaling.y = Math.max(0.001, s.head - s.tail);
        mat.alpha = s.alpha * 0.65;
      },
      dispose: () => {
        mesh.dispose();
        mat.dispose();
      },
    });
  }
  impact(position: Vector3, direction: Vector3, hit: boolean) {
    if(!hit)this.impactMark(position,direction);
    for (let i = 0; i < (hit ? 3 : 6); i++) {
      const velocity = direction
        .scale(-0.12)
        .add(
          new Vector3(
            (Math.random() - 0.5) * 0.6,
            Math.random() * 0.45,
            (Math.random() - 0.5) * 0.6,
          ),
        );
      this.puff(
        position,
        velocity,
        hit ? 0.025 : 0.035,
        0.18 + Math.random() * 0.12,
        hit ? new Color3(0.38, 0.22, 0.18) : new Color3(0.63, 0.59, 0.48),
        hit ? 0.3 : 0.55,
      );
    }
  }
  blood(position: Vector3, direction: Vector3) {
    for(let i=0;i<18;i++)this.puff(
      position,
      direction.scale(-.16-Math.random()*.16).add(new Vector3((Math.random()-.5)*1.15,Math.random()*.75-.08,(Math.random()-.5)*1.15)),
      .025+Math.random()*.04,
      .32+Math.random()*.28,
      i%4===0?new Color3(.48,.018,.012):new Color3(.23,.006,.004),
      .82,
    );
  }
  private impactMark(position:Vector3,direction:Vector3){
    // Sample the rendered surface just around the authoritative hit point. The
    // resulting mark inherits a darkened version of that material's color,
    // instead of looking like the same decal on concrete, metal and wood.
    const ray=new Ray(position.subtract(direction.scale(.08)),direction,.18),pick=this.scene.pickWithRay(ray,m=>m.isPickable&&m.isVisible);
    const source=pick?.pickedMesh?.material;
    const base=source instanceof PBRMaterial?source.albedoColor:source instanceof StandardMaterial?source.diffuseColor:new Color3(.32,.3,.27);
    const normal=pick?.getNormal(true)??direction.scale(-1),mark=MeshBuilder.CreateDisc("bullet-impact",{radius:.026,tessellation:14},this.scene);
    mark.position.copyFrom((pick?.pickedPoint??position).add(normal.scale(.0025)));
    mark.rotationQuaternion=Quaternion.FromLookDirectionLH(normal,Math.abs(Vector3.Dot(normal,Vector3.Up()))>.95?Vector3.Right():Vector3.Up());
    mark.isPickable=false;mark.applyFog=true;
    const mat=this.material("impact-mark",Color3.Lerp(base,new Color3(.045,.04,.035),.84));
    mat.disableLighting=false;mat.emissiveColor=Color3.Black();mat.diffuseColor=Color3.Lerp(base,new Color3(.025,.022,.02),.88);mat.disableDepthWrite=false;mark.material=mat;
    this.add({age:0,life:12,tick:t=>{mat.alpha=t>10?1-(t-10)/2:1;},dispose:()=>{mark.dispose();mat.dispose();}});
  }
  private puff(
    start: Vector3,
    velocity: Vector3,
    size: number,
    life: number,
    color: Color3,
    alpha: number,
  ) {
    const mesh = MeshBuilder.CreatePlane("impact-smoke", { size }, this.scene);
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mesh.isPickable = false;
    mesh.applyFog = false;
    const mat = this.material("particle", color, this.soft);
    mesh.material = mat;
    this.add({
      age: 0,
      life,
      tick: (t) => {
        mesh.position.copyFrom(start.add(velocity.scale(t)));
        mesh.scaling.setAll(1 + t * 3);
        mat.alpha = alpha * (1 - t / life);
      },
      dispose: () => {
        mesh.dispose();
        mat.dispose();
      },
    });
  }
  private update(dt: number) {
    this.lightAge += dt;
    this.light.intensity = 0.75 * Math.max(0, 1 - this.lightAge / 0.032);
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      if (e.age >= e.life) {
        e.dispose();
        this.effects.splice(i, 1);
      } else {
        e.tick(e.age);
        e.age += dt;
      }
    }
  }
  clear() {
    this.lightAge = 1;
    this.light.intensity = 0;
    for (const e of this.effects) e.dispose();
    this.effects = [];
  }
}
