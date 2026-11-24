/* Renderer, sky, lighting and haze with time of day and weather; composes the world layers:
   streamed terrain, ocean, cumulus, overcast deck, rain, scenery scatter and airports.
   Time of day sets the base light; weather then dims / greys it, sets visibility, cloud cover,
   rain and lightning. */
import {
  ACESFilmicToneMapping, Color, DirectionalLight, FogExp2, HemisphereLight, Matrix4, PCFShadowMap, PerspectiveCamera,
  PMREMGenerator, Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer, type Texture,
} from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { installHaze, hazeDensity } from "./haze";
import { PostFX } from "./post";
import { detailTexture, fieldsTexture } from "./textures";
import { Terrain } from "./terrain";
import { Ocean } from "./ocean";
import { Clouds } from "./clouds";
import { VolumetricClouds } from "./volumetricClouds";
import { CloudLayer, Rain } from "./precip";
import { Scatter } from "./scatter";
import { AirportVisuals } from "./airports";
import type { ProceduralWorld } from "../world/procedural/ProceduralWorld";
import type { AircraftSim } from "../sim/aircraft";
import type { Runway } from "../world/WorldProvider";
import type { Weather } from "../gameplay/weather";
import { DEG } from "../sim/types";

/** Times of day the player can cycle through (hours). */
export const TIMES = [7.2, 10, 13, 16.6, 18.4];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

interface BaseLight {
  sunColor: Color;
  sunI: number;
  hemiI: number;
  hemiColor: Color;
  fog: Color;
  exposure: number;
  env: number;
  low: number;
}

export class WorldScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly terrain: Terrain;
  readonly ocean = new Ocean();
  readonly clouds: Clouds;
  /** Ray-marched cumulus (High quality only; Low keeps the billboard puffs). */
  readonly volClouds: VolumetricClouds | null;
  private lastUpdate = 0;
  readonly deck = new CloudLayer();
  readonly rain = new Rain();
  readonly scatter: Scatter;
  readonly airports: AirportVisuals;
  readonly sunDir = new Vector3();
  private sky = new Sky();
  private pmrem: PMREMGenerator;
  private envTex: Texture | null = null;
  private fog: FogExp2;
  private base!: BaseLight;
  private weather: Weather | null = null;
  private flash = 0;
  private post: PostFX | null = null;
  private shadowHalf: number;
  private shadowMapSize: number;
  private lightBasis = new Matrix4();
  private lightBasisInv = new Matrix4();
  private skyTime = 0;
  private nextFlash = 0;
  /** Called when lightning strikes (for thunder), with the delay in seconds. */
  onLightning: ((delay: number) => void) | null = null;
  hours = 16.6;

  constructor(canvas: HTMLCanvasElement, world: ProceduralWorld, private quality: "low" | "high") {
    installHaze();
    // High renders through PostFX (MSAA in its own buffer), so the canvas needs no antialiasing
    const r = (this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", logarithmicDepthBuffer: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, quality === "high" ? 2 : 1.25));
    r.outputColorSpace = SRGBColorSpace;
    r.toneMapping = ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = PCFShadowMap;
    this.pmrem = new PMREMGenerator(r);

    this.sky.scale.setScalar(70000);
    this.patchSky(this.sky);
    this.scene.add(this.sky);
    // exponential-squared haze: crisp nearby, soft blue toward the horizon
    this.fog = new FogExp2(new Color("#b8c8d8"), 0.000034);
    this.scene.fog = this.fog;

    const sun = (this.sun = new DirectionalLight("#fff1dc", 3.2));
    sun.castShadow = true;
    // shadows cover a box around the aircraft that grows with height above the ground
    // (about 0.12 m per texel near the ground: crisp aircraft shadow, hangars and trees around it)
    this.shadowMapSize = quality === "high" ? 4096 : 2048;
    this.shadowHalf = quality === "high" ? 250 : 120;
    sun.shadow.mapSize.setScalar(this.shadowMapSize);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -this.shadowHalf;
    sc.right = sc.top = this.shadowHalf;
    sc.near = 10;
    sc.far = 3000;
    // bias is a fraction of the 3 km depth range: 2e-5 ≈ 6 cm
    sun.shadow.bias = -0.00002;
    sun.shadow.normalBias = 0.03;
    sc.updateProjectionMatrix();
    this.hemi = new HemisphereLight("#cfe3ff", "#5d6a3a", 0.9);
    this.scene.add(sun, sun.target, this.hemi);

    const region = world.region;
    this.terrain = new Terrain(region.extent, detailTexture(), fieldsTexture());
    this.clouds = new Clouds(region.extent * 1.1);
    this.volClouds = quality === "high" ? new VolumetricClouds() : null;
    this.clouds.mesh.visible = !this.volClouds;
    this.scatter = new Scatter(region, quality);
    this.airports = new AirportVisuals(region.airports, region.airportSizes);
    if (quality === "high") for (const m of this.scatter.meshes) m.castShadow = true;
    this.ocean.loadDepth(region.extent);
    this.scene.add(this.terrain.group, this.ocean.mesh, this.clouds.mesh, this.deck.mesh, this.rain.mesh, this.airports.group, ...this.scatter.meshes);

    this.setTime(this.hours);
  }

  /** Sun position and base light for a time of day (hours, 6–19). */
  setTime(hours: number): void {
    this.hours = hours;
    const day = Math.min(Math.max((hours - 6) / 13, 0), 1); // 6:00 → 19:00
    const elevation = Math.sin(day * Math.PI) * 62 * DEG + 1.5 * DEG;
    const azimuth = lerp(80, 280, day) * DEG;
    this.sunDir.set(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), -Math.cos(elevation) * Math.cos(azimuth));
    const low = 1 - smooth(4 * DEG, 30 * DEG, elevation); // 1 at sunrise/sunset
    this.base = {
      sunColor: new Color("#fff4e6").lerp(new Color("#ffb36b"), low),
      sunI: lerp(3.4, 1.6, low),
      hemiI: lerp(0.4, 0.3, low),
      hemiColor: new Color("#dde6ef").lerp(new Color("#f3c9a5"), low * 0.6),
      fog: new Color("#bccde0").lerp(new Color("#e8b98f"), low * 0.85),
      exposure: lerp(0.56, 0.46, low),
      env: lerp(0.5, 0.38, low),
      low,
    };
    const u = this.sky.material.uniforms;
    u.turbidity.value = lerp(4.5, 8, low);
    u.rayleigh.value = lerp(1.2, 2.6, low);
    u.mieCoefficient.value = lerp(0.004, 0.008, low);
    u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(this.sunDir);
    // light-space basis for snapping the shadow box to whole texels (no shimmering edges)
    const up = Math.abs(this.sunDir.y) > 0.99 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
    this.lightBasis.lookAt(new Vector3(), this.sunDir.clone().negate(), up);
    this.lightBasisInv.copy(this.lightBasis).invert();
    this.applyAtmosphere(true);
  }

  /** Blend the sky into the haze colour at the horizon so distant terrain meets it without a seam. */
  private patchSky(sky: Sky): void {
    const m = sky.material;
    m.uniforms.uHaze = { value: new Color("#bccde0") };
    m.uniforms.uHazeAmt = { value: 0.85 };
    m.fragmentShader = m.fragmentShader
      .replace("uniform float time;", "uniform float time;\nuniform vec3 uHaze;\nuniform float uHazeAmt;")
      .replace(
        "gl_FragColor = vec4( texColor, 1.0 );",
        `float hz = 1.0 - smoothstep(-0.01, 0.09, direction.y);
         hz *= 1.0 - 0.65 * pow(max(dot(direction, vSunDirection), 0.0), 6.0); // keep the sunset glow
         texColor = mix(texColor, uHaze, hz * uHazeAmt);
         // keep the sky below the glare threshold (only the sun disc glows) and never let the disc
         // overflow a half-float buffer (Inf/NaN)
         texColor = min(texColor, vec3(mix(6.0, 40.0, sundisc)));
         gl_FragColor = vec4( texColor, 1.0 );`,
      );
  }

  setWeather(w: Weather): void {
    const regenEnv = !this.weather || Math.abs(this.weather.overcast - w.overcast) > 0.05;
    this.weather = w;
    this.applyAtmosphere(regenEnv);
  }

  /** Combine time-of-day light with the weather. */
  private applyAtmosphere(regenEnv: boolean): void {
    const b = this.base;
    const w = this.weather;
    const oc = w ? w.overcast : 0;
    const storm = w ? Math.max(w.rain * 0.6, w.lightning ? 1 : 0) : 0;
    const grey = new Color("#8f99a5").lerp(new Color("#5d6672"), storm);

    this.sun.color.copy(b.sunColor);
    this.sun.intensity = b.sunI * (1 - 0.8 * oc);
    this.hemi.color.copy(b.hemiColor).lerp(new Color("#c9d0d8"), oc);
    this.hemi.intensity = b.hemiI * (1 - 0.25 * oc - 0.25 * storm) + oc * 0.25;
    const fogColor = b.fog.clone().lerp(grey, Math.max(oc * 0.85, w && w.visibility < 3 ? 0.6 : 0));
    this.fog.color.copy(fogColor);
    this.scene.background = fogColor;
    // visibility: sea-level extinction; the haze shader thins it with altitude
    this.fog.density = hazeDensity(w ? w.visibility : 60);
    const su = this.sky.material.uniforms;
    (su.uHaze.value as Color).copy(fogColor);
    // high cloud layer painted in the sky dome: thin cirrus in fair weather, thick under overcast
    su.cloudCoverage.value = w ? Math.min(0.85, 0.18 + w.cumulus * 0.25 + oc * 0.5) : 0.3;
    su.cloudDensity.value = 0.3 + oc * 0.5;
    (this.ocean.uniforms.uWind as { value: number }).value = w ? Math.min(1, w.windKt / 25) : 0.3;
    this.renderer.toneMappingExposure = b.exposure * (1 - 0.12 * storm);

    // ocean
    const ou = this.ocean.uniforms;
    (ou.uSunDir.value as Vector3).copy(this.sunDir);
    (ou.uSunColor.value as Color).copy(b.sunColor).multiplyScalar(1 - 0.85 * oc);
    (ou.uSkyHorizon.value as Color).copy(fogColor);
    (ou.uSkyZenith.value as Color).set("#3f78c2").lerp(new Color("#7a86b5"), b.low * 0.5).lerp(grey, oc);
    (ou.uWater.value as Color).set("#0e4f74").lerp(new Color("#2b4a5c"), oc * 0.6);

    // cumulus + overcast deck
    const cu = this.clouds.uniforms;
    (cu.uSunDir.value as Vector3).copy(this.sunDir);
    (cu.uLit.value as Color).set("#ffffff").lerp(new Color("#ffd2a0"), b.low * 0.8).lerp(new Color("#c9ced6"), oc * 0.6);
    (cu.uShade.value as Color).set("#b9c3cf").lerp(new Color("#9a8a92"), b.low * 0.5).lerp(new Color("#7d8794"), oc * 0.7);
    this.clouds.setWeather(w ? w.cumulus : 0.6, storm);
    if (this.volClouds) {
      const sunLight = b.sunColor.clone().multiplyScalar(this.sun.intensity * 0.95);
      const ambTop = new Color("#cfe0f5").lerp(b.hemiColor, 0.4).multiplyScalar(0.8 * (1 - 0.3 * oc) + 0.2 * oc);
      const ambBottom = (cu.uShade.value as Color).clone().multiplyScalar(0.4);
      this.volClouds.setLight(this.sunDir, sunLight, ambTop, ambBottom, fogColor, this.fog.density);
      this.volClouds.setWeather(w ? w.cumulus : 0.6, storm, oc, this.deck.base);
    }
    const du = this.deck.uniforms;
    du.uCover.value = oc;
    du.uDark.value = storm;
    (du.uTop.value as Color).copy(b.sunColor).lerp(new Color("#ffffff"), 0.5);

    // image-based lighting from this sky (dimmed under cloud)
    if (regenEnv) {
      const envScene = new Scene();
      const envSky = new Sky();
      envSky.scale.setScalar(1000);
      const u = this.sky.material.uniforms;
      for (const k of Object.keys(u)) if (envSky.material.uniforms[k]) envSky.material.uniforms[k].value = u[k].value;
      // no sun disc in the ambient/reflection map: otherwise it acts as a second sun that casts no shadows
      envSky.material.uniforms.showSunDisc.value = 0;
      envScene.add(envSky);
      this.envTex?.dispose();
      this.envTex = this.pmrem.fromScene(envScene, 0.04).texture;
      this.scene.environment = this.envTex;
    }
    this.scene.environmentIntensity = b.env * (1 - 0.45 * oc);
  }

  update(camera: PerspectiveCamera, sim: AircraftSim, focus: Vector3, guide: Runway | null, now: number): void {
    const cam = camera.position;
    const t = now / 1000;
    this.sky.position.copy(cam);
    // the clear sky disappears under a full overcast deck (looking up from below it)
    this.sky.visible = !(this.weather && this.weather.overcast > 0.85 && cam.y < this.deck.base);
    this.terrain.update(cam, now);
    this.ocean.update(cam, t);
    this.clouds.update(cam, now);
    const dt = this.lastUpdate ? Math.min((now - this.lastUpdate) / 1000, 0.25) : 0;
    this.lastUpdate = now;
    this.volClouds?.drift(sim.windVel.x, sim.windVel.z, dt);
    this.deck.update(cam, sim.windVel, t);
    this.scatter.update(cam, now);
    this.airports.setGuide(guide);
    this.airports.update(camera, sim.windVel, !!guide && sim.agl > 5);
    this.sky.material.uniforms.time.value = (this.skyTime += 1 / 60);
    this.placeShadow(focus, sim.agl);

    // rain: falls at ~9 m/s, blown by the wind, streaks relative to the aircraft
    const rain = this.weather && cam.y < this.deck.base ? this.weather.rain : 0;
    const rel = new Vector3(sim.windVel.x - sim.vel.x, -9 - sim.vel.y, sim.windVel.z - sim.vel.z);
    this.rain.update(cam, rel, rain, t % 600);

    // lightning: random flashes in a storm
    if (this.weather?.lightning) {
      if (t > this.nextFlash) {
        this.flash = 1;
        this.nextFlash = t + 4 + Math.random() * 12;
        this.onLightning?.(0.6 + Math.random() * 3);
      }
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - 1 / 12);
      const flicker = this.flash > 0.5 || Math.random() > 0.5 ? this.flash : 0;
      this.hemi.intensity = this.base.hemiI * 0.6 + flicker * 4;
      if (this.flash === 0) this.applyAtmosphere(false);
    }
  }

  /** Fit the sun's shadow box around the aircraft (larger when high), snapped to whole texels. */
  private placeShadow(focus: Vector3, agl: number): void {
    const half = Math.min(this.shadowHalf * 4, this.shadowHalf + Math.max(0, agl) * 0.6);
    const sc = this.sun.shadow.camera;
    if (sc.right !== half) {
      sc.left = sc.bottom = -half;
      sc.right = sc.top = half;
      sc.updateProjectionMatrix();
    }
    // the box centre sits between the aircraft and the ground below it, so both get shadows
    const ls = focus.clone();
    ls.y -= Math.min(Math.max(agl, 0), half) * 0.5;
    const texel = (half * 2) / this.shadowMapSize;
    ls.applyMatrix4(this.lightBasisInv);
    ls.x = Math.round(ls.x / texel) * texel;
    ls.y = Math.round(ls.y / texel) * texel;
    ls.applyMatrix4(this.lightBasis);
    this.sun.target.position.copy(ls);
    this.sun.position.copy(ls).addScaledVector(this.sunDir, 1500);
    this.sun.target.updateMatrixWorld();
  }

  /** Draw a frame: through the glare / lens pipeline on High, straight to the screen on Low. */
  render(camera: PerspectiveCamera): void {
    if (this.quality === "high") {
      if (!this.post) {
        this.post = new PostFX(this.renderer, this.scene, camera, this.volClouds);
        const s = this.renderer.getSize(new Vector2());
        this.post.setSize(s.x, s.y);
      }
      this.post.setCamera(camera);
      this.post.draw();
    } else {
      this.renderer.render(this.scene, camera);
    }
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h);
  }
}
