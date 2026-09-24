import { Color, MeshStandardMaterial } from 'three'

export type Surface = 'terrain' | 'rock' | 'paving' | 'gravel' | 'masonry' | 'distant'
export function environmentMaterial(surface: Surface) {
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.91, metalness: surface === 'paving' ? 0.025 : 0 })
  material.name = `T02R_${surface}`
  const index = ['terrain', 'rock', 'paving', 'gravel', 'masonry', 'distant'].indexOf(surface)
  material.customProgramCacheKey = () => `t02r-${index}-5`
  material.onBeforeCompile = (shader) => {
    shader.uniforms.envGround = { value: new Color('#73766a') }
    shader.uniforms.envRock = { value: new Color('#646970') }
    shader.uniforms.envDebris = { value: new Color('#979183') }
    shader.vertexShader = `varying vec3 vEnvPosition; varying vec3 vEnvNormal;\n${shader.vertexShader}`
    shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vec4 envP = vec4(transformed, 1.0);
      vec3 envN = objectNormal;
      #ifdef USE_INSTANCING
        envP = instanceMatrix * envP;
        envN = mat3(instanceMatrix) * envN;
      #endif
      vEnvPosition = (modelMatrix * envP).xyz;
      vEnvNormal = normalize(mat3(modelMatrix) * envN);
    `)
    shader.fragmentShader = `
      varying vec3 vEnvPosition; varying vec3 vEnvNormal;
      uniform vec3 envGround; uniform vec3 envRock; uniform vec3 envDebris;
      float envHash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float envNoise(vec2 p) {
        vec2 a=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(envHash(a),envHash(a+vec2(1,0)),f.x),mix(envHash(a+vec2(0,1)),envHash(a+vec2(1,1)),f.x),f.y);
      }
      float envRelief(vec3 p) {
        float bedding=envNoise(vec2(p.x+p.z*.63,p.y*3.1+p.z*.14)*.9)*.24;
        float grit=sin(p.x*12.7+p.z*4.3)*sin(p.z*16.1-p.y*5.2)*.025;
        return bedding+grit;
      }
      ${shader.fragmentShader}`
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 ep=vEnvPosition;
      float slope=1.0-clamp(normalize(vEnvNormal).y,0.0,1.0);
      float macro=envNoise(ep.xz*.011);
      vec2 faceUV=vec2(ep.x+ep.z*.61,ep.y*.9+ep.z*.32);
      float weather=envNoise(faceUV*.14);
      float rockMix=smoothstep(.12,.44,slope);
      float debrisMix=(1.0-smoothstep(.26,.60,slope))*(1.0-smoothstep(-130.0,-25.0,ep.y))*.78;
      vec3 base=mix(envGround,envRock,rockMix);
      base=mix(base,envDebris,debrisMix);
      float strata=envNoise(vec2(faceUV.x*.11,ep.y*.48+ep.x*.023+weather*3.0));
      float grain=envNoise(faceUV*.91+weather);
      base*=.48+macro*.48+weather*.30+strata*.10*rockMix+grain*.16;
      ${surface === 'rock' ? 'base=envRock*(.49+macro*.40+weather*.30+strata*.14+grain*.16);' : ''}
      ${surface === 'gravel' ? 'base=envDebris*(.72+weather*.32+macro*.13);' : ''}
      ${surface === 'distant' ? 'base=mix(envRock,envGround,.3)*(.82+macro*.33);' : ''}
      ${surface === 'paving' || surface === 'masonry' ? `
        vec2 tileP=${surface === 'paving' ? 'ep.xz/vec2(2.6,3.6)' : 'vec2(ep.x+ep.z,ep.y)/vec2(3.8,1.15)'};
        tileP.x+=mod(floor(tileP.y),2.0)*.5;
        vec2 tile=fract(tileP), edge=min(tile,1.0-tile);
        float aa=max(fwidth(tileP.x),fwidth(tileP.y));
        float seam=(1.0-smoothstep(.008,.008+aa,min(edge.x,edge.y)))*(1.0-smoothstep(.09,.32,aa));
        float variation=envHash(floor(tileP));
        base=mix(vec3(.28,.30,.295),vec3(.39,.395,.37),variation)*(.87+weather*.18);
        base=mix(base,base*.39,seam);
      ` : ''}
      diffuseColor.rgb*=base;
    `)
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor=clamp(.76+weather*.16+rockMix*.065, .65, .99);
    `)
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      // Screen derivatives of world-space relief give continuous, meter-scaled
      // normal detail on tops and cliffs without stretched planar UVs.
      float relief=envRelief(vEnvPosition)*${surface === 'distant' ? '.025' : surface === 'paving' ? '.065' : '.18'};
      vec3 dpX=dFdx(-vViewPosition), dpY=dFdy(-vViewPosition);
      vec3 r1=cross(dpY,normal), r2=cross(normal,dpX);
      float det=dot(dpX,r1);
      vec3 grad=sign(det)*(dFdx(relief)*r1+dFdy(relief)*r2);
      normal=normalize(abs(det)*normal-grad);
    `)
  }
  return material
}
