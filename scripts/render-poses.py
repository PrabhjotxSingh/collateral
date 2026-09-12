"""Offline geometry QA: pip install moderngl numpy pillow; run after inspect-runtime-character.ts."""
import json, numpy as np, moderngl, os
from PIL import Image,ImageDraw
c=moderngl.create_standalone_context(backend='egl');c.enable(moderngl.DEPTH_TEST)
p=c.program(vertex_shader='''#version 330
in vec3 in_pos;uniform mat4 vp;out vec3 pos;void main(){pos=in_pos;gl_Position=vp*vec4(in_pos,1);}''',fragment_shader='''#version 330
in vec3 pos;out vec4 color;uniform vec3 tint;void main(){vec3 n=normalize(cross(dFdx(pos),dFdy(pos)));float d=abs(dot(n,normalize(vec3(-.5,1,-.6))));color=vec4(tint*(.3+.7*d),1);}''')
def norm(x): return x/np.linalg.norm(x)
close=os.environ.get('CLOSE')=='1';eye=np.array([2.8,2,4]);target=np.array([0,1.3,.4] if close else [0,.9,0]);z=norm(eye-target);x=norm(np.cross([0,1,0],z));y=np.cross(z,x)
v=np.eye(4);v[:3,:3]=[x,y,z];v[:3,3]=-v[:3,:3]@eye
radius=.4 if close else 1.25;proj=np.diag([1/radius,1/radius,-2/20,1]);p['vp'].write((proj@v).T.astype('f4').tobytes())
size=300;f=c.simple_framebuffer((size,size));f.use();data=json.load(open('/tmp/collateral-poses.json'));out=Image.new('RGB',(size*5,330*((len(data)+4)//5)),(20,24,29));draw=ImageDraw.Draw(out)
for i,pose in enumerate(data):
 f.clear(.075,.09,.11,1)
 for m in pose['meshes']:
  b=c.buffer(np.array(m['positions'],dtype='f4').tobytes());ib=c.buffer(np.array(m['indices'],dtype='i4').tobytes());vao=c.vertex_array(p,[(b,'3f','in_pos')],ib)
  p['tint'].value=(.12,.13,.14) if 'g17_' in m['name'] else (.3,.35,.28) if 'visor' not in m['name'].lower() else (.07,.12,.16)
  vao.render();vao.release();b.release();ib.release()
 im=Image.frombytes('RGB',(size,size),f.read(components=3)).transpose(Image.Transpose.FLIP_TOP_BOTTOM);xx=i%5*size;yy=i//5*330;out.paste(im,(xx,yy));draw.text((xx+8,yy+303),f"{pose['name']} {pose['t']:.2f}",fill='white')
out.save('/tmp/collateral-grip.png' if close else '/tmp/collateral-poses.png')
