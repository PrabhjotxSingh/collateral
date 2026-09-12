import {Animation,AnimationGroup,Quaternion,Vector3} from '@babylonjs/core';

// The supplied G17 demonstration is authored at 30fps, imported at 60fps.
// First shot: 1–12 source frames; first full reload: 13–84; idle: 234–265.
// Keep the original key curves; use explicit ranges, never loop the showcase.
export function createGlockClips(source:AnimationGroup){
  source.stop();
  return ([['fire',2,24],['reload',26,168],['idle',468,530]] as const).map(([name,from,to])=>{
    const clip=source.clone(name,undefined,true);clip.from=from;clip.to=Math.min(to,source.to);
    if(name==='idle'){
      clip.metadata={playbackSpeed:0.65};
      // Static held pose: all idle drift is layered from actual mouse input.
      for(const {animation} of clip.targetedAnimations){
        const rest=animation.evaluate(from);
        const keys=[];
        for(let frame=from;frame<=530;frame+=2){
          const value=animation.evaluate(Math.min(frame,clip.to));
          keys.push({frame,value:animation.dataType===Animation.ANIMATIONTYPE_QUATERNION?Quaternion.Slerp(rest,value,0):animation.dataType===Animation.ANIMATIONTYPE_VECTOR3?Vector3.Lerp(rest,value,0):rest});
        }
        animation.setKeys(keys);
      }
    }
    return clip;
  });
}
