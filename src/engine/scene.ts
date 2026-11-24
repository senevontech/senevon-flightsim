/* Renderer, sky, lighting and haze with time of day and weather; composes the world layers:
   streamed terrain, ocean, cumulus, overcast deck, rain, scenery scatter and airports.
   Time of day sets the base light; weather then dims / greys it, sets visibility, cloud cover,
   rain and lightning. */
import {
  ACESFilmicToneMapping, Color, DirectionalLight, FogExp2, HemisphereLight, PCFSoftShadowMap, PerspectiveCamera,
  PMREMGenerator, Scene, SRGBColorSpace, Vector3, WebGLRenderer, type Texture,
} from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { detailTexture, fieldsTexture } from "./textures";
import { Terrain } from "./terrain";
import { Ocean } from "./ocean";
import { Clouds } from "./clouds";
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
  private nextFlash = 0;
  /** Called when lightning strikes (for thunder), with the delay in seconds. */
  onLightning: ((delay: number) => void) | null = null;
  hours = 16.6;

  constructor(canvas: HTMLCanvasElement, world: ProceduralWorld, quality: "low" | "high") {
    const r = (this.renderer = new WebGLRenderer({ canvas, antialias: quality === "high", powerPreference: "high-performance", logarithmicDepthBuffer: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, quality === "high" ? 2 : 1.25));
    r.outputColorSpace = SRGBColorSpace;
    r.toneMapping = ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = PCFSoftShadowMap;
    this.pmrem = new PMREMGenerator(r);

    this.sky.scale.setScalar(70000);
    this.scene.add(this.sky);
    // exponential-squared haze: crisp nearby, soft blue toward the horizon
    this.fog = new FogExp2(new Color("#b8c8d8"), 0.000034);
    this.scene.fog = this.fog;

    const sun = (this.sun = new DirectionalLight("#fff1dc", 3.2));
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(quality === "high" ? 2048 : 1024);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -20;
    sc.right = sc.top = 20;
    sc.near = 1;
    sc.far = 400;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.hemi = new HemisphereLight("#cfe3ff", "#5d6a3a", 0.9);
    this.scene.add(sun, sun.target, this.hemi);

    const region = world.region;
    this.terrain = new Terrain(region.extent, detailTexture(), fieldsTexture());
    this.clouds = new Clouds(region.extent * 1.1);
    this.scatter = new Scatter(region, quality);
    this.airports = new AirportVisuals(region.airports, region.airportSizes);
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
      hemiI: lerp(1.0, 0.55, low),
      hemiColor: new Color("#cfe3ff").lerp(new Color("#f3c9a5"), low * 0.6),
      fog: new Color("#bccde0").lerp(new Color("#e8b98f"), low * 0.85),
      exposure: lerp(0.5, 0.42, low),
      env: lerp(0.7, 0.45, low),
      low,
    };
    const u = this.sky.material.uniforms;
    u.turbidity.value = lerp(4.5, 8, low);
    u.rayleigh.value = lerp(1.2, 2.6, low);
    u.mieCoefficient.value = lerp(0.004, 0.008, low);
    u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(this.sunDir);
    this.applyAtmosphere(true);
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
    // visibility: haze reaches ~98 % at the visibility distance
    this.fog.density = 1.98 / ((w ? w.visibility : 60) * 1000);
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
      for (const k of Object.keys(u)) envSky.material.uniforms[k].value = u[k].value;
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
    this.deck.update(cam, sim.windVel, t);
    this.scatter.update(cam, now);
    this.airports.setGuide(guide);
    this.airports.update(camera, sim.windVel, !!guide && sim.agl > 5);
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 200);

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

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
  }
}
