/* Rain streaks around the camera (moved in the vertex shader, wrapped in a box so there are
   always drops nearby), and an overcast cloud layer: a large noise-shaded deck that drifts with
   the wind, grey from below, bright from above. */
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, LineSegments, Mesh, PlaneGeometry,
  ShaderMaterial, UniformsLib, UniformsUtils, Vector3,
} from "three";

const BOX = 90; // metres around the camera

export class Rain {
  readonly mesh: LineSegments;
  private uniforms: Record<string, { value: unknown }>;

  constructor(count = 5000) {
    const pos = new Float32Array(count * 2 * 3);
    const end = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = Math.random() * BOX, y = Math.random() * BOX, z = Math.random() * BOX;
      pos.set([x, y, z, x, y, z], i * 6);
      end[i * 2 + 1] = 1; // second vertex of each streak is its tail
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(pos, 3));
    geo.setAttribute("tail", new BufferAttribute(end, 1));
    this.uniforms = {
      uTime: { value: 0 },
      uCam: { value: new Vector3() },
      uVel: { value: new Vector3(0, -9, 0) },
      uOpacity: { value: 0 },
    };
    const mat = new ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute float tail;
        uniform float uTime;
        uniform vec3 uCam, uVel;
        varying float vTail;
        void main() {
          vec3 p = position + uVel * uTime - uCam;
          p = mod(p, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)};
          p += uCam;
          p -= uVel * 0.045 * tail; // streak length follows the relative velocity
          vTail = tail;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform float uOpacity;
        varying float vTail;
        void main() {
          #include <logdepthbuf_fragment>
          gl_FragColor = vec4(vec3(0.75, 0.8, 0.88), uOpacity * (1.0 - vTail * 0.7));
        }`,
    });
    this.mesh = new LineSegments(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** `relVel` = rain velocity relative to the aircraft (fall + wind − aircraft velocity). */
  update(cam: Vector3, relVel: Vector3, intensity: number, time: number): void {
    this.mesh.visible = intensity > 0.01;
    if (!this.mesh.visible) return;
    (this.uniforms.uCam.value as Vector3).copy(cam);
    (this.uniforms.uVel.value as Vector3).copy(relVel);
    this.uniforms.uTime.value = time;
    this.uniforms.uOpacity.value = 0.12 + intensity * 0.3;
  }
}

export class CloudLayer {
  readonly mesh: Mesh;
  readonly uniforms: Record<string, { value: unknown }>;
  readonly base = 1700;

  constructor() {
    this.uniforms = UniformsUtils.merge([
      UniformsLib.fog,
      {
        uCover: { value: 0 },
        uOffset: { value: new Vector3() },
        uTop: { value: new Color("#ffffff") },
        uBottom: { value: new Color("#8e98a4") },
        uDark: { value: 0 },
      },
    ]);
    const mat = new ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      fog: true,
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
        uniform float uCover, uDark;
        uniform vec3 uOffset, uTop, uBottom;
        varying vec3 vWorld;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float s = 0.0, a = 0.5;
          for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
          return s;
        }
        void main() {
          #include <logdepthbuf_fragment>
          vec2 p = (vWorld.xz + uOffset.xz) / 2600.0;
          float n = fbm(p);
          float d = smoothstep(1.0 - uCover, 1.0 - uCover + 0.28, n + uCover * 0.35);
          if (d < 0.01) discard;
          bool below = cameraPosition.y < vWorld.y;
          vec3 col = below ? mix(uBottom, uBottom * 0.7, n) : mix(uTop * 0.85, uTop, n);
          col *= 1.0 - uDark * 0.55;
          gl_FragColor = vec4(col, d * 0.97);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.mesh = new Mesh(new PlaneGeometry(160000, 160000, 1, 1), mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = this.base;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  update(cam: Vector3, wind: Vector3, time: number): void {
    const cover = this.uniforms.uCover.value as number;
    this.mesh.visible = cover > 0.02;
    this.mesh.position.x = Math.round(cam.x / 2000) * 2000;
    this.mesh.position.z = Math.round(cam.z / 2000) * 2000;
    (this.uniforms.uOffset.value as Vector3).set(-wind.x * time, 0, -wind.z * time);
  }
}
