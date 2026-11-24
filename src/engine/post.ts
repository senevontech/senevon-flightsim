/* Post-processing for High quality: the scene renders into a half-float (HDR) buffer with 4×
   MSAA, volumetric clouds are marched and laid over it (volumetricClouds.ts), bright highlights (the sun, its glitter on the water, chrome) bleed into a soft glare,
   then ACES tone mapping and a gentle lens finish (vignette, slight contrast curve).
   Low quality renders straight to the screen and skips all of this. */
import {
  DepthTexture, HalfFloatType, UnsignedIntType, Vector2, WebGLRenderTarget, type PerspectiveCamera, type Scene,
  type WebGLRenderer,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { VolumetricCloudPass, type VolumetricClouds } from "./volumetricClouds";

const LensShader = {
  name: "LensShader",
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.08 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // soft S-curve for a little more punch (display space)
      c.rgb = mix(c.rgb, c.rgb * c.rgb * (3.0 - 2.0 * c.rgb), 0.18);
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - uVignette * dot(d, d) * 1.6;
      gl_FragColor = c;
    }`,
};

export class PostFX {
  private composer: EffectComposer;
  private render: RenderPass;
  private clouds: VolumetricCloudPass | null = null;
  readonly bloom: UnrealBloomPass;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, clouds: VolumetricClouds | null) {
    const size = renderer.getDrawingBufferSize(new Vector2());
    // the depth texture lets the cloud pass stop its rays at the terrain / aircraft
    const rt = new WebGLRenderTarget(size.x, size.y, {
      type: HalfFloatType, samples: 4, depthTexture: new DepthTexture(size.x, size.y, UnsignedIntType),
    });
    this.composer = new EffectComposer(renderer, rt);
    this.render = new RenderPass(scene, camera);
    // threshold is in scene (pre-exposure) units, above the brightest sky (capped at 6): only the
    // sun disc and hard specular glints glow
    this.bloom = new UnrealBloomPass(new Vector2(size.x / 2, size.y / 2), 0.2, 0.35, 8.0);
    this.composer.addPass(this.render);
    if (clouds) {
      this.clouds = new VolumetricCloudPass(clouds, camera);
      this.composer.addPass(this.clouds);
    }
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new ShaderPass(LensShader));
  }

  setCamera(camera: PerspectiveCamera): void {
    this.render.camera = camera;
    this.clouds?.setCamera(camera);
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  draw(): void {
    this.composer.render();
  }
}
