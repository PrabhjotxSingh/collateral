import type {GameMap} from './maps.js';
import {RULES} from './rules.js';
// Engine-independent triangle query used by authoritative movement and hitscan.
export type V={x:number;y:number;z:number};
const add=(a:V,b:V):V=>({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
const sub=(a:V,b:V):V=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const mul=(a:V,k:number):V=>({x:a.x*k,y:a.y*k,z:a.z*k});
const dot=(a:V,b:V)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a:V,b:V):V=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
interface Triangle {a:V;b:V;c:V;minY:number;maxY:number}
class Geometry {
  triangles:Triangle[]=[];grid=new Map<string,number[]>();
  constructor(data:number[][]){for(const p of data){const v=(i:number)=>({x:p[i],y:p[i+1],z:p[i+2]}),a=v(0),b=v(3),c=v(6),id=this.triangles.length;
    this.triangles.push({a,b,c,minY:Math.min(a.y,b.y,c.y),maxY:Math.max(a.y,b.y,c.y)});
    for(let x=Math.floor(Math.min(a.x,b.x,c.x)/2);x<=Math.floor(Math.max(a.x,b.x,c.x)/2);x++)for(let z=Math.floor(Math.min(a.z,b.z,c.z)/2);z<=Math.floor(Math.max(a.z,b.z,c.z)/2);z++){const key=`${x},${z}`;let bucket=this.grid.get(key);if(!bucket)this.grid.set(key,bucket=[]);bucket.push(id);}
  }}
  query(minX:number,maxX:number,minZ:number,maxZ:number){const ids=new Set<number>();for(let x=Math.floor(minX/2);x<=Math.floor(maxX/2);x++)for(let z=Math.floor(minZ/2);z<=Math.floor(maxZ/2);z++)for(const id of this.grid.get(`${x},${z}`)??[])ids.add(id);return [...ids].map(id=>this.triangles[id]);}
}
const cache=new WeakMap<GameMap,Geometry>();
const geometry=(map:GameMap)=>{let g=cache.get(map);if(!g){g=new Geometry(map.triangles??[]);cache.set(map,g);}return g;};
export function rayTriangle(o:V,d:V,t:Triangle,max:number=RULES.maxRange){
  const ab=sub(t.b,t.a),ac=sub(t.c,t.a),h=cross(d,ac),det=dot(ab,h);if(Math.abs(det)<1e-9)return Infinity;
  const f=1/det,s=sub(o,t.a),u=f*dot(s,h);if(u<0||u>1)return Infinity;const q=cross(s,ab),v=f*dot(d,q);if(v<0||u+v>1)return Infinity;
  const distance=f*dot(ac,q);return distance>=-1e-7&&distance<=max?Math.max(0,distance):Infinity;
}
export function rayMap(o:V,d:V,map:GameMap,max:number=RULES.maxRange){const end=add(o,mul(d,max));let hit=Infinity;
  for(const t of geometry(map).query(Math.min(o.x,end.x),Math.max(o.x,end.x),Math.min(o.z,end.z),Math.max(o.z,end.z)))hit=Math.min(hit,rayTriangle(o,d,t,max));return hit;
}
// Closest point on a triangle (vertex, edge and face Voronoi regions).
function pointTriangle(p:V,t:Triangle):V{const {a,b,c}=t,ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);if(d1<=0&&d2<=0)return a;
  const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);if(d3>=0&&d4<=d3)return b;const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0)return add(a,mul(ab,d1/(d1-d3)));
  const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);if(d6>=0&&d5<=d6)return c;const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0)return add(a,mul(ac,d2/(d2-d6)));
  const va=d3*d6-d5*d4;if(va<=0&&d4-d3>=0&&d5-d6>=0)return add(b,mul(sub(c,b),(d4-d3)/((d4-d3)+(d5-d6))));const inv=1/(va+vb+vc);return add(a,add(mul(ab,vb*inv),mul(ac,vc*inv)));
}
function segments(p:V,q:V,a:V,b:V):[V,V]{const d1=sub(q,p),d2=sub(b,a),r=sub(p,a),aa=dot(d1,d1),ee=dot(d2,d2),f=dot(d2,r);let s=0,t=0;
  if(aa<=1e-12)t=ee>1e-12?clamp(f/ee):0;else{const c=dot(d1,r);if(ee<=1e-12)s=clamp(-c/aa);else{const bb=dot(d1,d2),den=aa*ee-bb*bb;s=den>1e-12?clamp((bb*f-c*ee)/den):0;t=(bb*s+f)/ee;if(t<0){t=0;s=clamp(-c/aa);}else if(t>1){t=1;s=clamp((bb-c)/aa);}}}return [add(p,mul(d1,s)),add(a,mul(d2,t))];
}
function capsuleContact(x:number,y:number,z:number,height:number,t:Triangle){
  const p={x,y:y+RULES.radius,z},q={x,y:y+height-RULES.radius,z};
  let best:[V,V]=[p,pointTriangle(p,t)],distance=dot(sub(best[0],best[1]),sub(best[0],best[1]));
  for(const pair of [[q,pointTriangle(q,t)],segments(p,q,t.a,t.b),segments(p,q,t.b,t.c),segments(p,q,t.c,t.a)] as [V,V][]){const d=sub(pair[0],pair[1]),ds=dot(d,d);if(ds<distance){distance=ds;best=pair;}}
  const line=sub(q,p),len=Math.sqrt(dot(line,line));if(len>0&&rayTriangle(p,mul(line,1/len),t,len)!==Infinity)distance=0;
  if(distance>=RULES.radius**2)return undefined;const dist=Math.sqrt(distance);let normal:V;
  if(dist>1e-7)normal=mul(sub(best[0],best[1]),1/dist);else{normal=cross(sub(t.b,t.a),sub(t.c,t.a));normal=mul(normal,1/Math.max(1e-9,Math.sqrt(dot(normal,normal))));if(dot(normal,sub(p,t.a))<0)normal=mul(normal,-1);}
  return {normal,depth:RULES.radius-dist};
}
export function capsuleOverlapsMap(b:V,height:number,map:GameMap,tolerance=0.005){return geometry(map).query(b.x-RULES.radius,b.x+RULES.radius,b.z-RULES.radius,b.z+RULES.radius).some(t=>t.maxY>b.y&&t.minY<b.y+height&&(capsuleContact(b.x,b.y,b.z,height,t)?.depth??0)>tolerance);}
export function resolveMap(b:V&{vx:number;vy:number;vz:number;grounded:boolean},height:number,map:GameMap){
  const candidates=geometry(map).query(b.x-RULES.radius-.15,b.x+RULES.radius+.15,b.z-RULES.radius-.15,b.z+RULES.radius+.15);
  for(let pass=0;pass<5;pass++){let changed=false;for(const t of candidates){if(t.minY>b.y+height||t.maxY<b.y)continue;const c=capsuleContact(b.x,b.y,b.z,height,t);if(!c||c.depth<1e-6)continue;
    b.x+=c.normal.x*(c.depth+1e-5);b.y+=c.normal.y*(c.depth+1e-5);b.z+=c.normal.z*(c.depth+1e-5);const into=b.vx*c.normal.x+b.vy*c.normal.y+b.vz*c.normal.z;if(into<0){b.vx-=c.normal.x*into;b.vy-=c.normal.y*into;b.vz-=c.normal.z*into;}if(c.normal.y>0.65)b.grounded=true;changed=true;
  }if(!changed)break;}
}
