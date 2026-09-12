import {Engine,Scene,UniversalCamera,Camera,Vector3,Color3,Color4,HemisphericLight,DirectionalLight,TransformNode} from '@babylonjs/core';
import {Assets,type AssetInstance} from './assets';

// Dedicated menu scene and asset. Never shares the in-match actor or camera.
export class MenuScene {
  private engine:Engine;private scene:Scene;private actor?:AssetInstance;readonly ready:Promise<void>;
  constructor(canvas:HTMLCanvasElement){
    this.engine=new Engine(canvas,true);this.scene=new Scene(this.engine);
    this.scene.clearColor=new Color4(0.015,0.017,0.019,1);
    const camera=new UniversalCamera('menu-camera',new Vector3(0,1.42,2.15),this.scene);
    camera.setTarget(new Vector3(0.34,1.39,0));camera.fovMode=Camera.FOVMODE_HORIZONTAL_FIXED;camera.fov=0.78;camera.minZ=0.1;
    const ambient=new HemisphericLight('menu-fill',Vector3.Up(),this.scene);ambient.intensity=0.12;ambient.groundColor=new Color3(0.008,0.009,0.01);
    const key=new DirectionalLight('menu-key',new Vector3(-0.45,-1,-0.75),this.scene);key.position.set(2,4,3);key.intensity=0.6;key.diffuse=new Color3(0.82,0.84,0.86);
    const rim=new DirectionalLight('menu-rim',new Vector3(-0.3,-0.5,1),this.scene);rim.intensity=2.5;rim.diffuse=new Color3(1,1,1);
    const root=new TransformNode('menu-operator',this.scene);root.rotation.y=-0.18;
    let orbitTime=0;const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
    const resize=()=>{this.engine.resize();};resize();window.addEventListener('resize',resize);
    this.ready=new Assets(this.scene).instance('/assets/menu/operator.glb',root,undefined,{characterHeight:1.9,menu:true}).then(actor=>{
      this.actor=actor??undefined;
    });
    this.engine.runRenderLoop(()=>{
      if(document.hidden||!document.body.classList.contains('is-menu'))return;
      const dt=Math.min(this.engine.getDeltaTime()/1000,0.05);if(!reduceMotion.matches)orbitTime+=dt;
      // Slow front three-quarter arc keeps the face visible; never swings behind him.
      const angle=reduceMotion.matches?0:Math.sin(orbitTime*0.055)*0.19;const radius=innerWidth<760?2.8:2.05;
      camera.position.set(Math.sin(angle)*radius,1.45+(reduceMotion.matches?0:Math.sin(orbitTime*0.035)*0.035),Math.cos(angle)*radius);
      const framing=innerWidth<760?0.22:0.39;camera.setTarget(new Vector3(Math.cos(angle)*framing,1.4,-Math.sin(angle)*framing));
      this.actor?.clips.tick(dt);this.scene.render();
    });
  }
}
