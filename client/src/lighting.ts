import {Scene,Camera,Engine,HemisphericLight,DirectionalLight,ShadowGenerator,Vector3,Color3,RawCubeTexture,SSAO2RenderingPipeline,DefaultRenderingPipeline,ImageProcessingConfiguration,MotionBlurPostProcess} from '@babylonjs/core';
import type { MapSun } from '../../shared/maps.js';

const FALLBACK_SUN:MapSun={enabled:true,x:18,y:32,z:-18,color:'#fff0d6',intensity:2.1};
export function applyMapSun(scene:Scene, authored?:MapSun){
  const value=authored??FALLBACK_SUN,sun=scene.getLightByName('sun') as DirectionalLight|undefined;
  if(!sun)return;
  const position=new Vector3(value.x,value.y,value.z),length=position.length();
  sun.setEnabled(value.enabled);sun.position.copyFrom(position);
  sun.direction=length>.001?position.scale(-1/length):new Vector3(-.45,-.85,.32).normalize();
  sun.diffuse=Color3.FromHexString(value.color);sun.intensity=value.intensity;
}

/** Daylight lighting stays independent of map geometry and server collision. */
export function daylight(scene:Scene,camera:Camera){
  const fill=new HemisphericLight('sky-fill',Vector3.Up(),scene);
  fill.intensity=.32;fill.diffuse=new Color3(.79,.87,1);fill.groundColor=new Color3(.22,.20,.17);fill.specular=Color3.Black();
  const sun=new DirectionalLight('sun',new Vector3(-.45,-.85,.32).normalize(),scene);
  sun.diffuse=new Color3(1,.94,.84);sun.intensity=2.1;sun.position.set(18,32,-18);
  sun.shadowMinZ=.1;sun.shadowMaxZ=110;
  const shadows=new ShadowGenerator(2048,sun);
  shadows.usePercentageCloserFiltering=true;shadows.filteringQuality=ShadowGenerator.QUALITY_HIGH;
  shadows.bias=.0003;shadows.normalBias=.025;shadows.darkness=.12;

  // A seamless low-frequency sky/ground reflection probe, generated locally.
  // Gives metal and rough surfaces environmental light without an external HDR download.
  const size=32,faces=[];
  for(let face=0;face<6;face++){
    const data=new Uint8Array(size*size*4);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const u=2*(x+.5)/size-1,v=2*(y+.5)/size-1;
      const d=[new Vector3(1,-v,-u),new Vector3(-1,-v,u),new Vector3(u,1,v),new Vector3(u,-1,-v),new Vector3(u,-v,1),new Vector3(-u,-v,-1)][face].normalize();
      const color=d.y>=0?Color3.Lerp(new Color3(.64,.72,.81),new Color3(.24,.43,.69),Math.pow(d.y,.65)):Color3.Lerp(new Color3(.64,.72,.81),new Color3(.14,.13,.11),Math.sqrt(-d.y));
      const i=(y*size+x)*4;data[i]=color.r*255;data[i+1]=color.g*255;data[i+2]=color.b*255;data[i+3]=255;
    }faces.push(data);
  }
  const environment=new RawCubeTexture(scene,faces,size,Engine.TEXTUREFORMAT_RGBA,Engine.TEXTURETYPE_UNSIGNED_BYTE,true);
  environment.name='procedural-daylight-probe';environment.gammaSpace=false;scene.environmentTexture=environment;scene.environmentIntensity=.55;
  const image=scene.imageProcessingConfiguration;
  image.toneMappingEnabled=true;image.toneMappingType=ImageProcessingConfiguration.TONEMAPPING_ACES;image.exposure=1.05;image.contrast=1.05;
  // WebGL1 retains sunlight and shadows; AO requires WebGL2.
  if((scene.getEngine() as Engine).webGLVersion>1&&SSAO2RenderingPipeline.IsSupported){
    const ao=new SSAO2RenderingPipeline('contact-occlusion',scene,{ssaoRatio:.5,blurRatio:1},[camera]);
    ao.radius=.18;ao.totalStrength=.38;ao.samples=12;ao.maxZ=45;ao.expensiveBlur=true;
  }
  const finish=new DefaultRenderingPipeline('daylight-finish',true,scene,[camera]);
  finish.fxaaEnabled=true;finish.bloomEnabled=false;
  if((scene.getEngine() as Engine).webGLVersion>1){const motion=new MotionBlurPostProcess('restrained-camera-motion',scene,1,camera);motion.isObjectBased=false;motion.motionStrength=.18;motion.motionBlurSamples=16;}
  return shadows;
}
