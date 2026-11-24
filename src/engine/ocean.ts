/* Ocean surface: a large plane that follows the camera. Semi-transparent so the coloured sea
   floor (turquoise reef → deep blue) shows through; animated wave normals, fresnel sky
   reflection, sun glitter, and fog. A sea-depth grid (built in a worker) adds surf lines that
   roll in to the beaches and break over the reef, clearer water in the shallows, and sparse
   whitecaps offshore. */
import {
  ClampToEdgeWrapping, Color, DataTexture, LinearFilter, Mesh, PlaneGeometry, RedFormat, ShaderMaterial,
  UniformsLib, UniformsUtils, UnsignedByteType, Vector3,
} from "three";
import type { DepthRequest, DepthResult } from "../workers/terrain.worker";

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
        uDepth: { value: Ocean.flatDepth() },
        uExtent: { value: 65536 },
        uWind: { value: 0.4 },
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
        uniform sampler2D uDepth;
        uniform float uExtent, uWind;
        varying vec3 vWorld;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        vec2 wave(vec2 p, vec2 dir, float freq, float speed, float amp) {
          float ph = dot(p, dir) * freq + uTime * speed;
          return dir * cos(ph) * freq * amp;
        }
        void main() {
          #include <logdepthbuf_fragment>
          vec2 p = vWorld.xz;
          float dist = length(cameraPosition - vWorld);
          float detail = clamp(1.0 - dist / 6000.0, 0.0, 1.0);
          // swell + chop, broken up with noise so glitter doesn't form regular stripes
          vec2 nq = p * 0.018 + vec2(uTime * 0.02, -uTime * 0.013);
          float nh0 = vnoise(nq), nhx = vnoise(nq + vec2(0.07, 0.0)), nhz = vnoise(nq + vec2(0.0, 0.07));
          vec2 gn = vec2(nhx - nh0, nhz - nh0) * 2.2;
          vec2 g = gn
                 + wave(p, normalize(vec2(1.0, 0.3)), 0.06, 1.1, 0.13) * (0.6 + 0.8 * nh0)
                 + wave(p, normalize(vec2(-0.4, 1.0)), 0.11, 1.6, 0.08) * (1.4 - 0.8 * nh0)
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

          // ---- depth: clearer shallows, surf, reef breakers, whitecaps ----
          float depth = texture2D(uDepth, vWorld.xz / uExtent + 0.5).r * 25.5;
          float shallow = 1.0 - smoothstep(0.5, 8.0, depth);
          alpha = mix(alpha, alpha * 0.8, shallow * (1.0 - fres));
          float n1 = vnoise(p * 0.045 + vec2(uTime * 0.05, 0.0));
          float n2 = vnoise(p * 0.21 - vec2(0.0, uTime * 0.11));
          // lines of surf travelling up the depth gradient (toward the shore)
          float phase = depth * 1.6 - uTime * 0.55 + n1 * 2.2;
          float band = smoothstep(0.78, 0.97, 0.5 + 0.5 * sin(phase * 3.14159));
          // surf only where the bottom shoals quickly (beaches, reef edges), not across a flat lagoon
          vec2 duv = vWorld.xz / uExtent + 0.5;
          float tx = 1.0 / 1024.0;
          float ddx = texture2D(uDepth, duv + vec2(tx, 0.0)).r * 25.5 - depth;
          float ddz = texture2D(uDepth, duv + vec2(0.0, tx)).r * 25.5 - depth;
          float shoal = smoothstep(1.2, 4.0, length(vec2(ddx, ddz)));
          float surfZone = (1.0 - smoothstep(1.0, 6.0, depth)) * step(0.05, depth) * shoal;
          float foam = surfZone * band * (0.55 + 0.45 * n2);
          foam = max(foam, (1.0 - smoothstep(0.3, 1.6, depth)) * step(0.05, depth) * (0.45 + 0.55 * n2)); // wash at the beach
          // whitecaps on open water, stronger with wind; tiny ones fade with distance
          float caps = smoothstep(0.86 - uWind * 0.12, 0.98, vnoise(p * 0.09 + g * 6.0 + uTime * 0.2) * (0.6 + 0.4 * n1));
          foam = max(foam, caps * smoothstep(6.0, 15.0, depth) * detail * (0.25 + uWind));
          foam *= 1.0 - smoothstep(4000.0, 14000.0, dist);
          vec3 foamCol = uSunColor * (0.35 + 0.55 * max(uSunDir.y, 0.0)) + uSkyHorizon * 0.45;
          col = mix(col, foamCol, clamp(foam, 0.0, 1.0) * 0.85);
          alpha = max(alpha, foam * 0.92);
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

  /** 1×1 "deep everywhere" until the real depth grid arrives. */
  private static flatDepth(): DataTexture {
    const t = new DataTexture(new Uint8Array([255]), 1, 1, RedFormat, UnsignedByteType);
    t.needsUpdate = true;
    return t;
  }

  /** Build the sea-depth grid for a region in a worker (≈ 64 m texels over 65 km). */
  loadDepth(extent: number, size = 1024): void {
    const w = new Worker(new URL("../workers/terrain.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<DepthResult>) => {
      if (e.data.kind !== "depth") return;
      const t = new DataTexture(e.data.depth, e.data.size, e.data.size, RedFormat, UnsignedByteType);
      t.magFilter = t.minFilter = LinearFilter;
      t.wrapS = t.wrapT = ClampToEdgeWrapping;
      t.needsUpdate = true;
      (this.uniforms.uDepth as { value: DataTexture }).value.dispose();
      (this.uniforms.uDepth as { value: DataTexture }).value = t;
      (this.uniforms.uExtent as { value: number }).value = extent;
      w.terminate();
    };
    const req: DepthRequest = { kind: "depth", id: 1, size, extent };
    w.postMessage(req);
  }

  update(cam: Vector3, time: number): void {
    this.mesh.position.set(Math.round(cam.x / SNAP) * SNAP, 0, Math.round(cam.z / SNAP) * SNAP);
    (this.uniforms.uTime as { value: number }).value = time;
  }
}
