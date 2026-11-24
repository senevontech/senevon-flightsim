/* Cumulus: clusters of camera-facing puffs (one instanced draw call). Flat bases, towering
   tops, lit from the sun side and bright on top, soft grey underneath. Faded near the camera (no
   hard walls when flying through) and into the haze. Coverage (weather) hides whole clusters;
   instances are re-sorted back-to-front a few times a second for clean blending. */
import {
  CanvasTexture, Color, InstancedMesh, Matrix4, PlaneGeometry, Quaternion, ShaderMaterial, UniformsLib, UniformsUtils,
  Vector3,
} from "three";
import { rng } from "./textures";

function puffTexture(): CanvasTexture {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const r = rng(99);
  // many overlapping soft blobs, denser toward the middle and the bottom: a cauliflower puff
  for (let k = 0; k < 60; k++) {
    const a = r() * Math.PI * 2, d = Math.pow(r(), 0.8) * S * 0.28;
    const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d * 0.75 + S * 0.04;
    const rad = S * (0.07 + r() * 0.13);
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, "rgba(255,255,255,0.35)");
    grad.addColorStop(0.6, "rgba(255,255,255,0.18)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
  }
  return new CanvasTexture(c);
}

export class Clouds {
  readonly mesh: InstancedMesh;
  private centers: Vector3[] = [];
  private scales: number[] = [];
  /** Per-puff cluster key 0..1: a puff shows when key < coverage. */
  private keys: number[] = [];
  private order: number[] = [];
  private lastSort = 0;
  private coverage = 0.6;
  readonly uniforms: Record<string, { value: unknown }>;

  constructor(extent: number, seed = 5) {
    const r = rng(seed);
    const clusters = 280;
    for (let c = 0; c < clusters; c++) {
      const key = r();
      const cx = (r() - 0.5) * extent, cz = (r() - 0.5) * extent;
      const base = 1150 + r() * 350;
      const w = 300 + r() * 700;
      const tower = 0.35 + r() * 0.9; // how tall this cumulus grows
      const puffs = 8 + Math.floor(r() * 14);
      for (let p = 0; p < puffs; p++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * w;
        const centre = 1 - d / w;
        const up = Math.pow(r(), 1.3) * w * tower * centre;
        const sc = 200 + r() * 280 + centre * 160;
        // puff bottoms sit on the cloud base: flat-bottomed cumulus
        this.centers.push(new Vector3(cx + Math.cos(a) * d, base + sc * 0.32 + up, cz + Math.sin(a) * d));
        this.scales.push(sc);
        this.keys.push(key);
      }
    }
    this.uniforms = UniformsUtils.merge([
      UniformsLib.fog,
      {
        map: { value: puffTexture() },
        uSunDir: { value: new Vector3(0, 1, 0) },
        uLit: { value: new Color("#ffffff") },
        uShade: { value: new Color("#b9c3cf") },
        uDark: { value: 0 },
      },
    ]);
    const mat = new ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      fog: true,
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        #include <logdepthbuf_pars_vertex>
        uniform vec3 uSunDir;
        varying vec2 vUv;
        varying float vLight;
        varying float vNear;
        void main() {
          vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float scale = length(instanceMatrix[0].xyz);
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 wp = center + (right * position.x + up * position.y) * scale;
          vUv = uv;
          vec3 toCam = normalize(cameraPosition - center);
          // bright on top, darker toward the base; a little brighter seen against the sun
          vLight = clamp(0.25 + 0.85 * uv.y + 0.2 * max(dot(-toCam, uSunDir), 0.0), 0.0, 1.0);
          vNear = clamp((distance(cameraPosition, center) - scale * 0.5) / (scale * 1.2), 0.0, 1.0);
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <logdepthbuf_vertex>
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        #include <logdepthbuf_pars_fragment>
        uniform sampler2D map;
        uniform vec3 uLit, uShade;
        uniform float uDark;
        varying vec2 vUv;
        varying float vLight;
        varying float vNear;
        void main() {
          #include <logdepthbuf_fragment>
          float a = min(texture2D(map, vUv).a * 1.25, 1.0) * vNear;
          if (a < 0.01) discard;
          vec3 col = mix(uShade, uLit, vLight) * (1.0 - uDark * 0.6);
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
          #ifdef FOG_EXP2
            gl_FragColor.a *= 1.0 - (1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth)) * 0.85;
          #endif
        }`,
    });
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), mat, this.centers.length);
    this.mesh.frustumCulled = false;
    this.order = this.centers.map((_, i) => i);
    this.writeMatrices();
  }

  /** 0 = no cumulus, 1 = every cluster. `dark` 0..1 greys them for storms. */
  setWeather(coverage: number, dark: number): void {
    this.coverage = coverage;
    this.uniforms.uDark.value = dark;
    this.writeMatrices();
  }

  private writeMatrices(): void {
    const m = new Matrix4(), q = new Quaternion(), s = new Vector3();
    this.order.forEach((src, i) => {
      const visible = this.keys[src] < this.coverage;
      m.compose(this.centers[src], q, s.setScalar(visible ? this.scales[src] : 0));
      this.mesh.setMatrixAt(i, m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(cam: Vector3, now: number): void {
    if (now - this.lastSort < 400) return;
    this.lastSort = now;
    const d = this.centers.map((c) => c.distanceToSquared(cam));
    this.order.sort((a, b) => d[b] - d[a]);
    this.writeMatrices();
  }
}
