/* Volumetric (ray-marched) cumulus for High quality. Low quality keeps the billboard puffs
   (clouds.ts), which cost a fraction of this on phones.

   How it works
   - Each frame a reduced-resolution pass (≈ 0.5 MP whatever the screen) marches a ray per pixel
     through the cloud slab (base 1150 m, tops up to ~3.4 km). Density = a 2D weather map (where
     clouds are and how tall they grow, thresholded by the weather's cumulus coverage) × a height
     profile (flat base, rounded towers) × tileable 3D Perlin-Worley noise eroded by finer Worley
     detail. The noise is built once on the CPU (64³) at start-up.
   - Light: a short march toward the sun (Beer's law + "powder" darkening of thin edges), a
     two-lobe Henyey-Greenstein phase (silver lining toward the sun) and a sky / ground ambient
     term. Each sample is hazed with the same height-haze formula as every other material
     (haze.ts), so distant clouds sink into the horizon like the terrain does.
   - The ray stops at the scene depth (terrain, the aircraft, buildings), read from the main
     render's depth texture. three.js's logarithmic depth buffer is decoded back to view depth.
   - A full-resolution composite then lays the clouds over the frame, before glare and tone
     mapping, so bright cloud tops behave like the rest of the HDR image.
   You can fly through them: the ray starts at the camera when it is inside the slab. */
import {
  Color, Data3DTexture, DataTexture, HalfFloatType, LinearFilter, Matrix4, RGFormat,
  RepeatWrapping, ShaderMaterial, UnsignedByteType, Vector2, Vector3, WebGLRenderTarget, type PerspectiveCamera,
  type WebGLRenderer,
} from "three";
import { Pass, FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { HAZE_SCALE_HEIGHT } from "./haze";

export const CLOUD_BASE = 1150;
export const CLOUD_TOP = 3400;
/** Rays give up after this distance (m); haze hides everything beyond it anyway. */
export const CLOUD_MAX_DIST = 45000;
/** Target pixel count of the march pass. */
const MARCH_PIXELS = 520000;

// ---------------------------------------------------------------------------------------------
// noise (pure functions; tested)

/** Deterministic integer hash → [0, 1). */
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144665) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const wrap = (i: number, p: number) => ((i % p) + p) % p;

/** Tileable 3D value noise with period `p` lattice cells, at a point in lattice units. → [0, 1]. */
function valueNoise(x: number, y: number, z: number, p: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
  let r = 0;
  for (let c = 0; c < 8; c++) {
    const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
    const h = hash3(wrap(xi + dx, p), wrap(yi + dy, p), wrap(zi + dz, p), seed);
    r += h * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  }
  return r;
}

/** Tileable 3D Worley (cellular) noise: 1 − distance to the nearest feature point. → [0, 1]. */
function worley(x: number, y: number, z: number, cells: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let best = 9;
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx, cy = yi + dy, cz = zi + dz;
        const wx = wrap(cx, cells), wy = wrap(cy, cells), wz = wrap(cz, cells);
        const fx = cx + hash3(wx, wy, wz, seed) - x;
        const fy = cy + hash3(wx, wy, wz, seed + 1) - y;
        const fz = cz + hash3(wx, wy, wz, seed + 2) - z;
        const d = fx * fx + fy * fy + fz * fz;
        if (d < best) best = d;
      }
  return 1 - Math.min(Math.sqrt(best), 1);
}

const remap = (v: number, lo: number, hi: number) => Math.min(Math.max((v - lo) / (hi - lo), 0), 1);

/** Replace each channel's values by their rank (0..255): a uniform spread, so thresholds mean "this share". */
function equalise(data: Uint8Array, channels: number): Uint8Array {
  const n = data.length / channels;
  for (let c = 0; c < channels; c++) {
    // counting sort by value, ties broken by position (deterministic)
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) hist[data[i * channels + c]]++;
    const start = new Float64Array(256);
    for (let v = 1; v < 256; v++) start[v] = start[v - 1] + hist[v - 1];
    for (let v = 0; v < 256; v++) start[v] = (start[v] + hist[v] / 2) / n; // mid-rank of each value
    for (let i = 0; i < n; i++) data[i * channels + c] = Math.round(start[data[i * channels + c]] * 255);
  }
  return data;
}

/**
 * 3D cloud noise, `size`³ voxels, tileable on every axis. Two bytes per voxel:
 * R = base shape (Perlin-Worley: billowy value noise carved by cells), G = fine Worley detail.
 */
export function cloudNoise3D(size = 64, seed = 11): Uint8Array {
  const out = new Uint8Array(size * size * size * 2);
  let i = 0;
  for (let z = 0; z < size; z++)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size, w = z / size;
        // billowy fBm value noise (periods 4, 8, 16 cells)
        const vn = valueNoise(u * 4, v * 4, w * 4, 4, seed) * 0.55 + valueNoise(u * 8, v * 8, w * 8, 8, seed + 7) * 0.3
          + valueNoise(u * 16, v * 16, w * 16, 16, seed + 13) * 0.15;
        const wl = worley(u * 4, v * 4, w * 4, 4, seed + 20) * 0.625 + worley(u * 8, v * 8, w * 8, 8, seed + 30) * 0.25
          + worley(u * 16, v * 16, w * 16, 16, seed + 40) * 0.125;
        const base = remap(vn, (1 - wl) * 0.75, 1);
        const detail = worley(u * 8, v * 8, w * 8, 8, seed + 50) * 0.625 + worley(u * 16, v * 16, w * 16, 16, seed + 60) * 0.25
          + worley(u * 32, v * 32, w * 32, 32, seed + 70) * 0.125;
        out[i++] = Math.round(base * 255);
        out[i++] = Math.round(detail * 255);
      }
  return equalise(out, 2);
}

/**
 * 2D weather map, `size`², tileable. R = cloud presence (a cluster shows where R > 1 − coverage),
 * G = how tall the cumulus in that column grows.
 */
export function weatherMap2D(size = 512, seed = 3): Uint8Array {
  const N = size * size;
  const raw = new Float32Array(N);
  const out = new Uint8Array(N * 2);
  for (let y = 0, i = 0; y < size; y++)
    for (let x = 0; x < size; x++, i++) {
      const u = x / size, v = y / size;
      // clusters: cells of soft blobs, broken up by value noise (z = 0.5 slice of the 3D noises)
      const cell = worley(u * 24, v * 24, 0.5, 24, seed) * 0.7 + worley(u * 48, v * 48, 0.5, 48, seed + 1) * 0.3;
      const n = valueNoise(u * 16, v * 16, 0.5, 16, seed + 2) * 0.6 + valueNoise(u * 64, v * 64, 0.5, 64, seed + 3) * 0.4;
      raw[i] = cell * 0.75 + n * 0.45;
      out[i * 2 + 1] = Math.round(valueNoise(u * 12, v * 12, 0.5, 12, seed + 4) * 255);
    }
  // equalise by rank: the share of sky with cloud over it then equals the coverage
  const order = Array.from(raw.keys()).sort((a, b) => raw[a] - raw[b]);
  order.forEach((src, rank) => { out[src * 2] = Math.round((rank / (N - 1)) * 255); });
  return out;
}

// ---------------------------------------------------------------------------------------------
// geometry helpers (mirrored in the shaders; tested)

/** View-space depth (m) from a logarithmic depth-buffer value (three.js: d = log2(1 + w) / log2(far + 1)). */
export const logDepthToViewZ = (d: number, far: number) => Math.pow(far + 1, d) - 1;

/** Ray distances [t0, t1] inside the slab base..top for a ray from height y with vertical direction dy, or null. */
export function slabInterval(y: number, dy: number, base: number, top: number, maxT: number): [number, number] | null {
  let t0: number, t1: number;
  if (Math.abs(dy) < 1e-6) {
    if (y < base || y > top) return null;
    t0 = 0; t1 = maxT;
  } else {
    const ta = (base - y) / dy, tb = (top - y) / dy;
    t0 = Math.max(Math.min(ta, tb), 0);
    t1 = Math.min(Math.max(ta, tb), maxT);
  }
  return t1 > t0 ? [t0, t1] : null;
}

// ---------------------------------------------------------------------------------------------
// shaders

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COMMON = /* glsl */ `
  uniform sampler2D tDepth;
  uniform mat4 uProjInv, uCamWorld;
  uniform vec3 uCamPos;
  uniform float uFar;
  varying vec2 vUv;
  const float BASE = ${CLOUD_BASE.toFixed(1)};
  const float TOP = ${CLOUD_TOP.toFixed(1)};
  const float MAXD = ${CLOUD_MAX_DIST.toFixed(1)};

  // world-space ray direction for this pixel and the ray distance to the scene behind it
  void viewRay(vec2 uv, out vec3 dir, out float sceneT) {
    vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
    vec3 vd = normalize(v.xyz / v.w);
    dir = normalize((uCamWorld * vec4(vd, 0.0)).xyz);
    float d = texture2D(tDepth, uv).x;
    float viewZ = pow(uFar + 1.0, d) - 1.0;
    sceneT = d > 0.99999 ? 1e9 : viewZ / max(-vd.z, 1e-4);
  }

  bool slab(vec3 o, vec3 d, float maxT, out float t0, out float t1) {
    if (abs(d.y) < 1e-6) {
      if (o.y < BASE || o.y > TOP) return false;
      t0 = 0.0; t1 = maxT;
    } else {
      float ta = (BASE - o.y) / d.y, tb = (TOP - o.y) / d.y;
      t0 = max(min(ta, tb), 0.0);
      t1 = min(max(ta, tb), maxT);
    }
    return t1 > t0;
  }`;

const MARCH_FRAG = /* glsl */ `
  precision highp float;
  precision highp sampler3D;
  ${COMMON}
  uniform sampler3D tNoise;
  uniform sampler2D tWeather;
  uniform float uCoverage, uDark, uDeckY, uDeckCover;
  uniform vec2 uDrift;
  uniform vec3 uSunDir, uSunLight, uAmbTop, uAmbBottom, uFogColor, uFogSun;
  uniform float uFogDensity;

  const float SIGMA = 0.032;        // extinction per metre at density 1
  const float WEATHER_SCALE = 1.0 / 26000.0;

  float remap(float v, float lo, float hi) { return clamp((v - lo) / max(hi - lo, 1e-4), 0.0, 1.0); }

  // cheap: is there cloud in this column at this height at all? (weather × height profile)
  float shape(vec3 p, out float h) {
    h = (p.y - BASE) / (TOP - BASE);
    // explicit LOD everywhere in the march: implicit derivatives are undefined in divergent loops
    // (that showed as alternating dark rows)
    vec2 w = textureLod(tWeather, (p.xz + uDrift) * WEATHER_SCALE, 0.0).rg;
    // rank-equalised presence → 0 at a cluster's edge, 1 at its core
    float x = clamp((w.r - (1.0 - uCoverage)) / max(uCoverage, 0.01), 0.0, 1.0);
    // the core grows tallest; some columns tower, most stay fair-weather sized
    float top = mix(0.13, 0.9, w.g * w.g * w.g) * (0.35 + 0.65 * x);
    float hn = h / max(top, 0.01);
    // the footprint narrows with height: wide flat base, rounded dome / tower on top
    float cov = remap(x, hn * 0.6, 0.22 + hn * 0.6);
    float prof = smoothstep(0.0, 0.03, h) * (1.0 - smoothstep(0.8, 1.0, hn));
    return cov * prof;
  }

  // detail: 0 = shape only (light march), up to 1 = full erosion (fades out with distance)
  float density(vec3 p, float detail) {
    float h;
    float s = shape(p, h);
    if (s <= 0.003) return 0.0;
    vec3 q = (p + vec3(uDrift.x, 0.0, uDrift.y)) / 2600.0;
    float base = textureLod(tNoise, q, 0.0).r;
    // noise carves the shape: even a cluster core keeps billows and gaps
    float d = remap(base, 1.0 - s * 0.8, 1.0);
    if (detail > 0.0 && d > 0.0) {
      // ~18 m voxels: coarse enough not to alias at the march step
      float det = textureLod(tNoise, q * 2.3 + vec3(0.0, 0.07, 0.0), 0.0).g;
      // detail eats wispy edges more near the bottom, cauliflower tops higher up
      d = remap(d, mix(det, 1.0 - det, clamp(h * 3.0, 0.0, 1.0)) * 0.34 * detail, 1.0);
    }
    return d * 1.6 * smoothstep(0.0, 0.08, h);   // softer under the flat base
  }

  float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5); }

  // white-noise ray start offset per pixel (hides step banding without a regular pattern);
  // integer hash: float hashes correlated whole rows on some GPUs
  float ign(vec2 px) {
    uvec2 q = uvec2(px);
    uint h = (q.x * 0x8da6b343u) ^ (q.y * 0xd8163841u);
    h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15; h *= 0x846ca68bu; h ^= h >> 16;
    return float(h) * (1.0 / 4294967296.0);
  }

  void main() {
    vec3 dir; float sceneT;
    viewRay(vUv, dir, sceneT);
    float maxT = min(sceneT, MAXD);
    // stop at a solid overcast deck crossing (the deck is drawn by its own mesh)
    if (uDeckCover > 0.5 && abs(dir.y) > 1e-4) {
      float td = (uDeckY - uCamPos.y) / dir.y;
      if (td > 0.0) maxT = min(maxT, td);
    }
    float t0, t1;
    if (!slab(uCamPos, dir, maxT, t0, t1)) { gl_FragColor = vec4(0.0); return; }

    float mu = dot(dir, uSunDir);
    float phase = mix(hg(mu, 0.55), hg(mu, -0.2), 0.35);   // 1 = isotropic
    // steps grow with distance (detail far away is lost in the haze anyway)
    float dt = 10.0 + t0 * 0.009;
    float t = t0 + dt * ign(gl_FragCoord.xy);
    float T = 1.0;
    vec3 L = vec3(0.0);
    float camAtt = exp(-max(uCamPos.y, 0.0) / ${HAZE_SCALE_HEIGHT.toFixed(1)});
    for (int i = 0; i < 280; i++) {
      if (t > t1 || T < 0.02) break;
      dt = 10.0 + t * 0.009;
      vec3 p = uCamPos + dir * t;
      float d = density(p, 1.0 - smoothstep(2500.0, 12000.0, t));
      // near the camera clouds fade in over a few metres (no hard wall when entering one)
      d *= smoothstep(4.0, 60.0, t);
      if (d > 0.0) {
        // light march toward the sun (shape + base noise only)
        float od = 0.0;
        float ls = 45.0;
        vec3 lp = p;
        for (int j = 0; j < 5; j++) {
          lp += uSunDir * ls;
          od += density(lp, 0.0) * ls;
          ls *= 1.7;
        }
        float h = (p.y - BASE) / (TOP - BASE);
        float beer = exp(-SIGMA * od);
        float powder = 1.0 - exp(-SIGMA * od * 2.0 - 0.15);
        // multiple scattering keeps cloud cores from going black
        float ms = 0.55 * exp(-SIGMA * od * 0.12);
        vec3 sun = uSunLight * (beer * mix(1.0, powder, 0.3) * (0.8 + 0.45 * phase) + ms);
        vec3 amb = mix(uAmbBottom, uAmbTop, clamp(h * 1.6, 0.0, 1.0));
        vec3 S = (sun + amb) * (1.0 - uDark * 0.65);
        // height haze between the camera and this sample (same formula as haze.ts)
        float k = (p.y - uCamPos.y) / ${HAZE_SCALE_HEIGHT.toFixed(1)};
        float integ = abs(k) > 0.001 ? (1.0 - exp(-k)) / k : 1.0 - 0.5 * k;
        float fog = 1.0 - exp(-uFogDensity * t * camAtt * integ);
        vec3 fogCol = uFogColor + uFogSun * (0.045 * pow(max(mu, 0.0), 6.0) + 0.07 * pow(max(mu, 0.0), 40.0));
        S = mix(S, fogCol, fog);
        float st = d * SIGMA;
        float ds = dt * 0.5;   // half steps inside cloud: smoother edges and shading
        float Ts = exp(-st * ds);
        L += T * S * (1.0 - Ts);   // energy-conserving step integral (S already per unit extinction)
        T *= Ts;
        t += ds;
      } else {
        t += dt * 1.6;   // empty air: stride faster
      }
    }
    gl_FragColor = vec4(L, 1.0 - T);
  }`;

const COMPOSITE_FRAG = /* glsl */ `
  ${COMMON}
  uniform sampler2D tScene, tClouds;
  uniform vec2 uCloudTexel;
  void main() {
    vec4 c = texture2D(tScene, vUv);
    vec3 dir; float sceneT;
    viewRay(vUv, dir, sceneT);
    float t0, t1;
    // anything solid in front of the slab (the aircraft below the clouds) never gets cloud from
    // the low-resolution buffer bleeding over its edges
    if (slab(uCamPos, dir, min(sceneT, MAXD), t0, t1)) {
      // four bilinear taps half a texel out: a soft tent filter that hides the march dither
      vec2 o = uCloudTexel * 0.75;
      vec4 cl = 0.25 * (texture2D(tClouds, vUv + vec2(o.x, o.y)) + texture2D(tClouds, vUv - vec2(o.x, o.y))
        + texture2D(tClouds, vUv + vec2(o.x, -o.y)) + texture2D(tClouds, vUv + vec2(-o.x, o.y)));
      c.rgb = c.rgb * (1.0 - cl.a) + cl.rgb;
    }
    gl_FragColor = c;
  }`;

// ---------------------------------------------------------------------------------------------

export class VolumetricClouds {
  readonly uniforms: Record<string, { value: unknown }>;

  constructor() {
    const n = 64;
    const noise = new Data3DTexture(cloudNoise3D(n), n, n, n);
    noise.format = RGFormat;
    noise.type = UnsignedByteType;
    noise.wrapS = noise.wrapT = noise.wrapR = RepeatWrapping;
    noise.minFilter = noise.magFilter = LinearFilter;
    noise.unpackAlignment = 1;
    noise.needsUpdate = true;
    const ws = 512;
    const weather = new DataTexture(weatherMap2D(ws), ws, ws, RGFormat, UnsignedByteType);
    weather.wrapS = weather.wrapT = RepeatWrapping;
    weather.magFilter = LinearFilter;
    weather.minFilter = LinearFilter;
    weather.unpackAlignment = 1;
    weather.needsUpdate = true;
    this.uniforms = {
      tNoise: { value: noise },
      tWeather: { value: weather },
      uCoverage: { value: 0.6 },
      uDark: { value: 0 },
      uDrift: { value: new Vector2() },
      uDeckY: { value: 1700 },
      uDeckCover: { value: 0 },
      uSunDir: { value: new Vector3(0, 1, 0) },
      uSunLight: { value: new Color(3, 3, 3) },
      uAmbTop: { value: new Color(0.9, 1, 1.1) },
      uAmbBottom: { value: new Color(0.5, 0.55, 0.6) },
      uFogColor: { value: new Color() },
      uFogSun: { value: new Color() },
      uFogDensity: { value: 0 },
    };
  }

  /** Cumulus coverage 0..1 (as the billboard clouds) and storm darkening 0..1. */
  setWeather(coverage: number, dark: number, deckCover: number, deckY: number): void {
    // the share of sky under a cloud column; 1 (storm) is a nearly closed sky
    this.uniforms.uCoverage.value = Math.min(0.95, 0.05 + coverage * 0.6);
    this.uniforms.uDark.value = dark;
    this.uniforms.uDeckCover.value = deckCover;
    this.uniforms.uDeckY.value = deckY;
  }

  /** Light: sun direction, sun colour × intensity (scene units), sky ambient and the haze. */
  setLight(sunDir: Vector3, sunLight: Color, ambTop: Color, ambBottom: Color, fogColor: Color, fogDensity: number): void {
    (this.uniforms.uSunDir.value as Vector3).copy(sunDir);
    (this.uniforms.uSunLight.value as Color).copy(sunLight);
    (this.uniforms.uAmbTop.value as Color).copy(ambTop);
    (this.uniforms.uAmbBottom.value as Color).copy(ambBottom);
    (this.uniforms.uFogColor.value as Color).copy(fogColor);
    (this.uniforms.uFogSun.value as Color).copy(sunLight).multiplyScalar(1 / 3);
    this.uniforms.uFogDensity.value = fogDensity;
  }

  /** Clouds drift with the wind (wind velocity in m/s, east = +x, south = +z), dt in s. */
  drift(windX: number, windZ: number, dt: number): void {
    const d = this.uniforms.uDrift.value as Vector2;
    // the drift offsets the sample position, so it moves opposite to the wind; wrap to keep floats small
    d.x = (d.x - windX * dt) % 26000;
    d.y = (d.y - windZ * dt) % 26000;
  }
}

/** EffectComposer pass: march at reduced resolution, then composite over the HDR frame. */
export class VolumetricCloudPass extends Pass {
  private march: ShaderMaterial;
  private composite: ShaderMaterial;
  private quad: FullScreenQuad;
  private target: WebGLRenderTarget;
  private projInv = new Matrix4();

  constructor(clouds: VolumetricClouds, private camera: PerspectiveCamera) {
    super();
    this.needsSwap = true;
    const shared = {
      tDepth: { value: null },
      uProjInv: { value: this.projInv },
      uCamWorld: { value: new Matrix4() },
      uCamPos: { value: new Vector3() },
      uFar: { value: 80000 },
    };
    this.march = new ShaderMaterial({
      uniforms: { ...clouds.uniforms, ...shared },
      vertexShader: VERT,
      fragmentShader: MARCH_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.composite = new ShaderMaterial({
      uniforms: { ...shared, tScene: { value: null }, tClouds: { value: null }, uCloudTexel: { value: new Vector2() } },
      vertexShader: VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.march);
    this.target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  }

  setCamera(camera: PerspectiveCamera): void {
    this.camera = camera;
  }

  setSize(w: number, h: number): void {
    const s = Math.min(0.5, Math.sqrt(MARCH_PIXELS / Math.max(w * h, 1)));
    const tw = Math.max(1, Math.round(w * s)), th = Math.max(1, Math.round(h * s));
    this.target.setSize(tw, th);
    (this.composite.uniforms.uCloudTexel.value as Vector2).set(1 / tw, 1 / th);
  }

  render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget): void {
    const cam = this.camera;
    this.projInv.copy(cam.projectionMatrixInverse);
    (this.march.uniforms.uCamWorld.value as Matrix4).copy(cam.matrixWorld);
    (this.march.uniforms.uCamPos.value as Vector3).setFromMatrixPosition(cam.matrixWorld);
    this.march.uniforms.uFar.value = cam.far;
    this.march.uniforms.tDepth.value = readBuffer.depthTexture;
    this.composite.uniforms.tDepth.value = readBuffer.depthTexture;

    this.quad.material = this.march;
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);

    this.composite.uniforms.tScene.value = readBuffer.texture;
    this.composite.uniforms.tClouds.value = this.target.texture;
    this.quad.material = this.composite;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.march.dispose();
    this.composite.dispose();
    this.quad.dispose();
    this.target.dispose();
  }
}
