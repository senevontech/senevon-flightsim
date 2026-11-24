/* Ocean surface: a large plane that follows the camera. Semi-transparent so the coloured sea
   floor (turquoise reef → deep blue) shows through; animated wave normals, fresnel sky
   reflection, sun glitter, and fog. */
import { Color, Mesh, PlaneGeometry, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from "three";

const SIZE = 200000;
const SNAP = 1000;

export class Ocean {
  readonly mesh: Mesh;
  readonly uniforms: Record<string, { value: unknown }>;

  constructor() {
    this.uniforms = UniformsUtils.merge([
      UniformsLib.fog,
      {
        uTime: { value: 0 },
        uSunDir: { value: new Vector3(0, 1, 0) },
        uSunColor: { value: new Color("#fff1dc") },
        uSkyHorizon: { value: new Color("#b8c8d8") },
        uSkyZenith: { value: new Color("#4a7fc0") },
        uWater: { value: new Color("#0e4f74") },
      },
    ]);
    const mat = new ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      fog: true,
      depthWrite: true,
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <logdepthbuf_vertex>
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        #include <logdepthbuf_pars_fragment>
        uniform float uTime;
        uniform vec3 uSunDir, uSunColor, uSkyHorizon, uSkyZenith, uWater;
        varying vec3 vWorld;
        vec2 wave(vec2 p, vec2 dir, float freq, float speed, float amp) {
          float ph = dot(p, dir) * freq + uTime * speed;
          return dir * cos(ph) * freq * amp;
        }
        void main() {
          #include <logdepthbuf_fragment>
          vec2 p = vWorld.xz;
          float dist = length(cameraPosition - vWorld);
          float detail = clamp(1.0 - dist / 6000.0, 0.0, 1.0);
          vec2 g = wave(p, normalize(vec2(1.0, 0.3)), 0.06, 1.1, 0.25)
                 + wave(p, normalize(vec2(-0.4, 1.0)), 0.11, 1.6, 0.12)
                 + (wave(p, normalize(vec2(0.7, -0.7)), 0.35, 2.7, 0.04)
                 +  wave(p, normalize(vec2(-0.9, -0.2)), 0.8, 3.9, 0.015)) * detail;
          vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
          vec3 v = normalize(cameraPosition - vWorld);
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
          vec3 r = reflect(-v, n);
          vec3 sky = mix(uSkyHorizon, uSkyZenith, clamp(r.y * 2.5, 0.0, 1.0));
          vec3 col = mix(uWater, sky, fres);
          float spec = pow(max(dot(r, uSunDir), 0.0), mix(60.0, 400.0, detail));
          col += uSunColor * spec * (1.5 + 2.0 * detail);
          // see-through near the camera and at steep angles; opaque toward the horizon
          float alpha = mix(0.42, 1.0, clamp(fres * 1.6 + dist / 25000.0, 0.0, 1.0));
          alpha = max(alpha, clamp(spec, 0.0, 1.0));
          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.mesh = new Mesh(new PlaneGeometry(SIZE, SIZE, 1, 1), mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 1;
  }

  update(cam: Vector3, time: number): void {
    this.mesh.position.set(Math.round(cam.x / SNAP) * SNAP, 0, Math.round(cam.z / SNAP) * SNAP);
    (this.uniforms.uTime as { value: number }).value = time;
  }
}
