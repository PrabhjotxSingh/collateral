import {ASSETS} from '../../shared/maps.js';
import type {Settings} from './settings';
import type {Vec} from '../../shared/simulation.js';
type Cue='shot'|'hit'|'step'|'reload';
export class TacticalAudio {
  private context?:AudioContext;private output?:GainNode;private loading?:Promise<void>;
  private buffers=new Map<Cue,AudioBuffer>();
  constructor(private settings:()=>Settings){}
  async unlock(){
    if(!this.context){
      this.context=new AudioContext();this.output=this.context.createGain();
      const limiter=this.context.createDynamicsCompressor();limiter.threshold.value=-4;limiter.knee.value=6;limiter.ratio.value=8;limiter.attack.value=0.002;limiter.release.value=0.09;
      this.output.connect(limiter);limiter.connect(this.context.destination);this.loading=this.load();
    }
    await this.context.resume();
    await this.loading;
  }
  private async load(){
    await Promise.all((['shot','hit','step','reload'] as Cue[]).map(async kind=>{try{
      const response=await fetch(ASSETS[kind]);if(!response.ok||response.headers.get('content-type')?.includes('text/html'))return;
      this.buffers.set(kind,await this.context!.decodeAudioData(await response.arrayBuffer()));
    }catch{console.warn(`Sound unavailable: ${kind}`);}}));
  }
  listener(position:Vec,yaw:number,pitch:number){
    const ctx=this.context;if(!ctx||!this.output)return;
    this.output.gain.value=this.settings().master*this.settings().sfx;
    const l=ctx.listener;l.positionX.value=position.x;l.positionY.value=position.y;l.positionZ.value=position.z;
    l.forwardX.value=Math.sin(yaw)*Math.cos(pitch);l.forwardY.value=-Math.sin(pitch);l.forwardZ.value=Math.cos(yaw)*Math.cos(pitch);l.upX.value=0;l.upY.value=1;l.upZ.value=0;
  }
  play(kind:Cue,position?:Vec,volume=1){
    const ctx=this.context;if(!ctx||ctx.state!=='running'||!this.output)return;
    const recorded=this.buffers.get(kind);if(!recorded&&kind!=='step')return;
    const gain=ctx.createGain();let destination:AudioNode=this.output;
    if(position){const p=ctx.createPanner();p.panningModel='HRTF';p.distanceModel='inverse';p.refDistance=2;p.maxDistance=35;p.rolloffFactor=1.5;p.positionX.value=position.x;p.positionY.value=position.y;p.positionZ.value=position.z;p.connect(this.output);destination=p;}
    const cueVolume=Math.max(0,Math.min(1,volume));gain.connect(destination);const now=ctx.currentTime;const duration=kind==='shot'?0.12:kind==='hit'?0.1:kind==='step'?0.075:0.18;
    let source:AudioBufferSourceNode|OscillatorNode;
    if(recorded){source=ctx.createBufferSource();source.buffer=recorded;gain.gain.value=(kind==='shot'?0.65:kind==='hit'?.5:.4)*cueVolume;source.connect(gain);source.start();}
    else{
      source=ctx.createOscillator();source.type=kind==='step'?'sine':'triangle';source.frequency.setValueAtTime(kind==='step'?120:700,now);source.frequency.exponentialRampToValueAtTime(kind==='step'?45:200,now+duration);gain.gain.setValueAtTime(0.2*cueVolume,now);gain.gain.exponentialRampToValueAtTime(0.001,now+duration);source.connect(gain);source.start();source.stop(now+duration);
    }
    source.onended=()=>{source.disconnect();gain.disconnect();if(destination!==this.output)destination.disconnect();};
  }
}
