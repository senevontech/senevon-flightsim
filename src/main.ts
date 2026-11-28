/* Skyward — boot, game loop (fixed 120 Hz physics + interpolated render), spawns, and wiring
   between sim, input (keyboard / mouse / gamepad / touch), assists, autopilot, rewind, scoring,
   world, cameras, audio, HUD, map, radio and menu. */
import "./styles.css";
import { Quaternion, Vector3 } from "three";
import { AircraftSim, SIM_DT } from "./sim/aircraft";
import { Assists, type AssistPreset } from "./sim/assists";
import { Autopilot } from "./sim/autopilot";
import { ApPanel, type ApAction } from "./ui/apPanel";
import { DEG, emptyControls, FT, KT } from "./sim/types";
import { AIRCRAFT, AIRCRAFT_ORDER } from "./aircraft";
import { ProceduralWorld } from "./world/procedural/ProceduralWorld";
import { RealWorld } from "./world/real/RealWorld";
import { loadAirportDb, type AirportDb } from "./world/real/airportDb";
import { runwayCoords, type Airport, type Runway } from "./world/WorldProvider";
import { InputManager, MOUSE_RANGE } from "./input/controls";
import { TouchControls } from "./input/touch";
import { LandingMonitor, type Grade } from "./gameplay/landing";
import { TIMES, WorldScene } from "./engine/scene";
import { AircraftVisual } from "./engine/glbModel";
import { CameraRig } from "./engine/cameras";
import { FlightAudio } from "./engine/audio";
import { Hud } from "./ui/hud";
import { Minimap } from "./ui/minimap";
import { Menu, type Sensitivity } from "./ui/menu";
import { AdaptiveContrast } from "./ui/contrast";
import { WEATHER_PRESETS, weatherFromPreset, weatherText, type Weather, type WeatherPreset } from "./gameplay/weather";
import { MAYDAYS, MaydayDirector, maydayItemId, type MaydayDef } from "./gameplay/mayday";
import { Entitlements } from "./services/entitlements";

const store = {
  get(k: string): string | null {
    try { return localStorage.getItem("skyward." + k); } catch { return null; }
  },
  set(k: string, v: string): void {
    try { localStorage.setItem("skyward." + k, v); } catch { /* private mode: ignore */ }
  },
};

const CALLSIGN = "Skyward 01K";
const canvas = document.getElementById("view") as HTMLCanvasElement;
const coarse = matchMedia("(pointer: coarse)").matches;
if (coarse) document.body.classList.add("touch");
window.addEventListener("touchstart", () => document.body.classList.add("touch"), { once: true, passive: true });
// developer URL options for screenshots and testing: ?quality=low|high&spawn=approach&time=0..4&airport=SKY10
const devParams = new URLSearchParams(location.search);
const storedQuality = devParams.get("quality") ?? store.get("quality");
const quality: "low" | "high" = storedQuality === "low" || storedQuality === "high"
  ? storedQuality : coarse || Math.min(screen.width, screen.height) < 600 ? "low" : "high";

// ---- world: the custom Coral Coast map, or the real world around a chosen airport ----
// (?mode=real&real=EGLL in dev; the menu's World tab sets these and reloads)
export type WorldMode = "custom" | "real";
const worldMode: WorldMode = (devParams.get("mode") ?? store.get("mode")) === "real" ? "real" : "custom";
const AIRPORT_KEY = worldMode === "real" ? "realAirport" : "airport";
let airportDb: AirportDb | null = null;
let worldNote = "";
async function makeWorld(): Promise<ProceduralWorld | RealWorld> {
  if (worldMode !== "real") return new ProceduralWorld();
  try {
    airportDb = await loadAirportDb();
    const home = airportDb.get(devParams.get("real") ?? store.get("realAirport") ?? "EGLL") ?? airportDb.get("EGLL")!;
    return new RealWorld(home, airportDb);
  } catch (e) {
    console.warn("Real-world mode unavailable", e);
    worldNote = "Real-world data couldn't load (offline?). Flying the Coral Coast instead.";
    return new ProceduralWorld();
  }
}
const world = await makeWorld();
const realWorld = world instanceof RealWorld ? world : null;
const airports = world.airports();
const airportOf = new Map<Runway, Airport>();
for (const a of airports) for (const r of a.runways) airportOf.set(r, a);
const savedPlane = store.get("aircraft");
let cfg = AIRCRAFT[savedPlane && AIRCRAFT[savedPlane] ? savedPlane : "sparrow-s1"];
let sim = new AircraftSim(cfg, world);
// default: fair weather with the trade wind from the east-south-east (SKY1's runway 10 into it)

const hud = new Hud(document.getElementById("hud")!, cfg);
hud.setAircraft(cfg);
const assists = new Assists();
const savedPreset = store.get("assists") as AssistPreset | null;
if (savedPreset === "easy" || savedPreset === "normal" || savedPreset === "real") assists.preset = savedPreset;

const input = new InputManager(cfg.flaps.steps);
const touch = new TouchControls(input);
document.body.append(touch.el);
touch.setGearAvailable(!!cfg.retractable);
const controls = emptyControls();
const monitor = new LandingMonitor(() => airports.flatMap((a) => a.runways));
const scene = new WorldScene(canvas, world, quality);
let model = new AircraftVisual(sim);
scene.scene.add(model.root);
const rig = new CameraRig(cfg, canvas);
if (import.meta.env.DEV) (window as unknown as { __skyward: unknown }).__skyward = { scene, world, get sim() { return sim; }, get model() { return model; }, rig };
rig.ground = (x, z) => world.heightAt(x, z);
const audio = new FlightAudio();
const minimap = new Minimap(airports, realWorld?.frame ?? null);
hud.mapSlot.append(minimap.el);
// HUD text and marks flip dark / light depending on what is behind them
const contrast = new AdaptiveContrast((x, y) => scene.luminanceAt(rig.camera, x, y));
hud.registerContrast(contrast);
const autopilot = new Autopilot();
let apOn = false;
/** Pilot-selected autopilot values (the panel edits these). */
const apSel = { hdg: 0, altFt: 3000, vsFpm: 500, ias: 90, at: false, lateral: "hdg" as "hdg" | "nav" | "apr" };
const apPanel = new ApPanel();
document.getElementById("hud")!.append(apPanel.el);
/** Simulation rate (time acceleration): 1×, 2×, 4×, 6×. */
const SIM_RATES = [1, 2, 4, 6];
let simRate = 1;
const mayday = new MaydayDirector();
const entitlements = new Entitlements(MAYDAYS.filter((m) => m.free).map((m) => maydayItemId(m.id)));

// ---- weather ----
let wxPreset: WeatherPreset | "custom" = "fair";
let weather: Weather = weatherFromPreset("fair", 105);
try {
  const saved = JSON.parse(store.get("weather") ?? "null");
  if (saved && typeof saved.w === "object") {
    weather = { ...weather, ...saved.w };
    wxPreset = saved.preset in WEATHER_PRESETS || saved.preset === "custom" ? saved.preset : "custom";
  }
} catch { /* ignore bad saved weather */ }
/** Weather to restore after a storm-approach Mayday. */
let weatherBeforeStorm: { w: Weather; p: WeatherPreset | "custom" } | null = null;

function applyWeather(save = true): void {
  sim.wind = { fromDeg: weather.windFrom, speed: weather.windKt * KT, gust: weather.gustKt * KT, turbulence: weather.turbulence };
  scene.setWeather(weather);
  audio.rain = weather.rain;
  if (save) store.set("weather", JSON.stringify({ preset: wxPreset, w: weather }));
}
applyWeather(false);
scene.onLightning = (delay) => audio.thunder(delay);
scene.onShed = (what) => hud.toast(`Keeping it smooth: ${what}`);
// real world: data credits on screen (CC BY / open-data terms; docs/ASSETS.md)
if (realWorld) {
  const credits = document.createElement("div");
  credits.className = "credits";
  credits.textContent = "Imagery: Sentinel-2 cloudless 2016 by EOX (s2maps.eu), modified Copernicus Sentinel data · Elevation: AWS Terrain Tiles (SRTM, USGS, others) · Airports: OurAirports";
  document.getElementById("hud")!.append(credits);
}
if (worldNote) setTimeout(() => hud.toast(worldNote), 1500);
if (realWorld) {
  const h = document.querySelector("[data-k=loading] h2");
  if (h) h.textContent = `Loading ${realWorld.home[1]}…`;
}

// ---- stick sensitivity ----
const SENS: Record<Sensitivity, number> = { low: 0.6, medium: 0.8, high: 1 };
const savedSens = store.get("sensitivity") as Sensitivity | null;
let sensitivity: Sensitivity = savedSens && savedSens in SENS ? savedSens : "high";
input.sensitivity = SENS[sensitivity];
const stick = emptyControls();
const surfaceView = emptyControls();
let shake = 0;

input.invertPitch = store.get("invertPitch") === "1";
input.mouseFlying = store.get("mouseFlying") === "1";
rig.leftButtonOrbits = !input.mouseFlying;

const ASSIST_HINT: Record<AssistPreset, string> = {
  easy: "EASY: the plane levels itself when you let go",
  normal: "NORMAL: the plane holds the bank you leave it in",
  real: "REAL: no help, direct controls",
};
const REWINDS: Record<AssistPreset, number> = { easy: Infinity, normal: 3, real: 0 };

let best: number | null = Number(store.get("bestLanding")) || null;
let cardOpen = false;
let timeIndex = Math.max(0, TIMES.indexOf(Number(store.get("time")) || 16.6));
scene.setTime(TIMES[timeIndex]);
let airportIndex = Math.max(0, airports.findIndex((a) => a.id === (devParams.get("airport") ?? store.get(AIRPORT_KEY))));

// ---- flight state ----
const prevPos = new Vector3();
const prevQ = new Quaternion();
const renderPos = new Vector3();
const renderQ = new Quaternion();
/** Runway the approach guide points at (set by approach spawns, else picked by proximity). */
let guideRunway: Runway | null = null;
let lastGuide: Runway | null = null;
let departedFrom: Airport | null = null;
let rewindsLeft = REWINDS[assists.preset];
const history: ReturnType<AircraftSim["snapshot"]>[] = [];
let historyTimer = 0;

const windText = () => weatherText(weather);
const tower = (a: Airport) => `${a.name} Tower`;

/** The runway direction at an airport with the most headwind. */
/** The runway most into the wind; among near-equal ones (within ~15°), the paved and longer
    one (real airports list grass and glider strips beside the main runway). */
function intoWind(a: Airport): Runway {
  let best = a.runways[0], bestScore = -Infinity;
  for (const r of a.runways) {
    const head = Math.cos((r.headingDeg - sim.wind.fromDeg) * DEG);
    const score = head + (r.surface === "grass" || r.surface === "dirt" ? -0.05 : 0) + Math.min(r.length, 4000) / 4000 * 0.03;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}

function nearestAirport(): Airport {
  let best = airports[0], bd = Infinity;
  for (const a of airports) {
    const r = a.runways[0];
    const d = Math.hypot(r.threshold.x - sim.pos.x, r.threshold.z - sim.pos.z);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

/** Roughly where the airport's tower is (matches AirportVisuals placement). */
function towerPosition(a: Airport, out: Vector3): Vector3 {
  const r = a.runways[0];
  const h = r.headingDeg * DEG;
  const fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
  const cx = r.threshold.x + fx * r.length / 2, cz = r.threshold.z + fz * r.length / 2;
  return out.set(cx + rx * (r.width / 2 + 160) + fx * 100, a.elevation + 28, cz + rz * (r.width / 2 + 160) + fz * 100);
}

function beforeSpawn(): void {
  hud.hideCard();
  hud.resetCallouts();
  cardOpen = false;
  assists.reset();
  input.resetTrim();
  apOn = false;
  apPanel.show(false);
  setSimRate(1, true);
  history.length = 0;
  rewindsLeft = REWINDS[assists.preset];
  mayday.clear();
  hud.setFailures(false, false, false);
  minimap.el.classList.remove("dead");
  if (weatherBeforeStorm) {
    weather = weatherBeforeStorm.w;
    wxPreset = weatherBeforeStorm.p;
    weatherBeforeStorm = null;
    applyWeather();
  }
}

function afterSpawn(onGround: boolean): void {
  monitor.reset(onGround);
  prevPos.copy(sim.pos);
  prevQ.copy(sim.q);
  rig.snap();
}

function spawnRunway(a: Airport = airports[airportIndex]): void {
  beforeSpawn();
  const r = intoWind(a);
  const h = r.headingDeg * DEG;
  const fx = Math.sin(h), fz = -Math.cos(h);
  input.setFlapIndex(0);
  input.setThrottle(0);
  input.setGear(true);
  sim.reset({
    pos: new Vector3(r.threshold.x + fx * 25, r.threshold.y + sim.restHeight, r.threshold.z + fz * 25),
    headingDeg: r.headingDeg, speed: 0, gear: 1,
  });
  guideRunway = null;
  departedFrom = a;
  afterSpawn(true);
  hud.radio(tower(a), `${CALLSIGN}, ${windText()}, runway ${r.name}, cleared for takeoff.`);
}

function spawnApproach(): void {
  const a = nearestAirport();
  beforeSpawn();
  const r = intoWind(a);
  const h = r.headingDeg * DEG;
  const fx = Math.sin(h), fz = -Math.cos(h);
  const d = 3200; // from the aim point, on a 3° glide path
  const along = r.aimPoint - d;
  input.setFlapIndex(1);
  input.setThrottle(cfg.approachPower ?? 0.34);
  input.setGear(true);
  sim.reset({
    pos: new Vector3(r.threshold.x + fx * along, r.threshold.y + Math.tan(3 * DEG) * d + sim.restHeight, r.threshold.z + fz * along),
    headingDeg: r.headingDeg, speed: cfg.speeds.vapp * KT, pathDeg: -3, pitchDeg: 1, flaps: cfg.flaps.steps[1],
    throttle: cfg.approachPower ?? 0.34, gear: 1,
  });
  guideRunway = r;
  lastGuide = r;
  departedFrom = null;
  afterSpawn(false);
  hud.radio(tower(a), `${CALLSIGN}, ${windText()}, runway ${r.name}, cleared to land.`);
}

/** At least 2 m of water (sea depth from the region, or the real bathymetry). */
function deepWater(x: number, z: number): boolean {
  if (world instanceof ProceduralWorld) return world.region.height(x, z) < -2;
  const h = world.demHeight(x, z);
  return h !== null && h < -2;
}

/** Floatplanes: start on open water near the selected airport, pointing into the wind. */
function spawnWater(): void {
  if (!sim.hasFloats) return;
  const a = airports[airportIndex];
  const r = a.runways[0];
  const hdg = intoWind(a).headingDeg;
  const cx = r.threshold.x + Math.sin(r.headingDeg * DEG) * r.length / 2;
  const cz = r.threshold.z - Math.cos(r.headingDeg * DEG) * r.length / 2;
  const fx = Math.sin(hdg * DEG), fz = -Math.cos(hdg * DEG);
  // search outward for a spot with 900 m of open water ahead (into the wind)
  let spot: { x: number; z: number } | null = null;
  for (let dist = 800; dist <= 9000 && !spot; dist += 250) {
    for (let k = 0; k < 16 && !spot; k++) {
      const ang = (k / 16) * Math.PI * 2;
      const x = cx + Math.cos(ang) * dist, z = cz + Math.sin(ang) * dist;
      let clear = true;
      for (let t = 0; t <= 900 && clear; t += 75) clear = deepWater(x + fx * t, z + fz * t);
      if (clear) spot = { x, z };
    }
  }
  if (!spot) return hud.toast("No open water near this airport");
  beforeSpawn();
  input.setFlapIndex(1);
  input.setThrottle(0);
  input.setGear(true);
  sim.reset({ pos: new Vector3(spot.x, 1.55, spot.z), headingDeg: hdg, speed: 0, flaps: cfg.flaps.steps[1] });
  guideRunway = null;
  departedFrom = a;
  afterSpawn(true);
  hud.radio(tower(a), `${CALLSIGN}, ${windText()}, water takeoff at your discretion.`);
}

/** Switch aircraft: new physics, model, camera, flaps and HUD; restart on the runway. */
function selectAircraft(id: string): void {
  if (!AIRCRAFT[id]) return;
  cfg = AIRCRAFT[id];
  sim = new AircraftSim(cfg, world);
  applyWeather(false);
  scene.scene.remove(model.root);
  model.dispose();
  model = new AircraftVisual(sim);
  scene.scene.add(model.root);
  rig.cfg = cfg;
  input.setFlapSteps(cfg.flaps.steps);
  hud.setAircraft(cfg);
  touch.setGearAvailable(!!cfg.retractable);
  store.set("aircraft", id);
  spawnRunway();
  hud.toast(`${cfg.name}`);
}

/** Mayday scenario: cruise toward the selected airport; a failure follows a few seconds later. */
function spawnMayday(def: MaydayDef): void {
  const a = airports[airportIndex];
  beforeSpawn();
  if (def.id === "storm_approach") {
    weatherBeforeStorm = { w: weather, p: wxPreset };
    const r0 = intoWind(a);
    // storm with a strong quartering crosswind on the approach
    weather = { ...weatherFromPreset("storm", (r0.headingDeg + 45) % 360), windKt: 20, gustKt: 14 };
    wxPreset = "storm";
    applyWeather(false);
  }
  const r = intoWind(a);
  const h = r.headingDeg * DEG;
  const fx = Math.sin(h), fz = -Math.cos(h);
  const d = 6500; // from the aim point, on the extended centreline
  const along = r.aimPoint - d;
  input.setFlapIndex(0);
  input.setThrottle(0.65);
  input.setGear(!cfg.retractable);
  sim.reset({
    pos: new Vector3(r.threshold.x + fx * along, r.threshold.y + 760, r.threshold.z + fz * along),
    headingDeg: r.headingDeg, speed: Math.min(cfg.speeds.vcruise * 0.8, cfg.speeds.vy * 1.6) * KT, pitchDeg: 1,
    throttle: 0.65, gear: cfg.retractable ? 0 : 1,
  });
  guideRunway = r;
  lastGuide = r;
  departedFrom = null;
  afterSpawn(false);
  mayday.start(def, sim);
  hud.radio(tower(a), `${CALLSIGN}, radar contact, ${(d / 1852).toFixed(0)} miles out. Expect runway ${r.name}.`);
}

function onMaydayTriggered(): void {
  const def = mayday.active!;
  const a = guideRunway ? airportOf.get(guideRunway)! : nearestAirport();
  const r = guideRunway ?? intoWind(a);
  hud.alertMayday(def.alert);
  hud.setFailures(true, sim.failures.electrical, mayday.cracked);
  minimap.el.classList.toggle("dead", sim.failures.electrical);
  const miles = (Math.hypot(r.threshold.x - sim.pos.x, r.threshold.z - sim.pos.z) / 1852).toFixed(0);
  hud.radio(CALLSIGN, `MAYDAY MAYDAY MAYDAY, ${CALLSIGN}, ${def.call}, ${miles} miles from ${a.name}.`);
  setTimeout(() => hud.radio(tower(a), `${CALLSIGN}, roger Mayday. Runway ${r.name} is yours, ${windText()}. Emergency services standing by.`), 2600);
  navigator.vibrate?.([120, 60, 120]);
}

/** Pick the runway ahead of the aircraft that it is lined up with (for the guide rings). */
function pickGuide(): Runway | null {
  if (sim.onGround) return null;
  let best: Runway | null = null, bd = Infinity;
  for (const a of airports) {
    for (const r of a.runways) {
      const c = runwayCoords(r, sim.pos.x, sim.pos.z);
      if (c.along > r.aimPoint || c.along < -9000) continue;
      const hdg = Math.abs(((sim.headingDeg - r.headingDeg + 540) % 360) - 180);
      if (hdg > 35 || Math.abs(c.cross) > 2500) continue;
      const d = -c.along + Math.abs(c.cross) * 2;
      if (d < bd) { bd = d; best = r; }
    }
  }
  return best;
}

function rewind(): void {
  if (rewindsLeft <= 0) return hud.toast(assists.preset === "real" ? "No rewind in Real mode" : "No rewinds left this flight");
  if (history.length < 2) return hud.toast("Nothing to rewind yet");
  sim.restore(history[0]);
  history.length = 0;
  rewindsLeft--;
  assists.reset();
  apOn = false;
  apPanel.show(false);
  setSimRate(1, true);
  monitor.reset(sim.onGround);
  hud.hideCard();
  cardOpen = false;
  crashShown = false;
  prevPos.copy(sim.pos);
  prevQ.copy(sim.q);
  rig.snap();
  hud.toast(Number.isFinite(rewindsLeft) ? `Rewound 10 s · ${rewindsLeft} left` : "Rewound 10 s");
}

/** Approach fix 6 km out on the extended centreline of the into-wind runway of an airport. */
function approachFix(a: Airport): { x: number; z: number; runway: Runway } {
  const r = intoWind(a);
  const h = r.headingDeg * DEG;
  const along = r.aimPoint - 6000;
  return { x: r.threshold.x + Math.sin(h) * along, z: r.threshold.z - Math.cos(h) * along, runway: r };
}

function apOff(reason: string): void {
  if (!apOn) return;
  apOn = false;
  // hand the throttle back where the autothrottle left it (no jump)
  if (apSel.at) input.setThrottle(controls.throttle);
  apPanel.show(false);
  hud.toast(reason);
  audio.chime?.();
}

function applyApTargets(): void {
  const t = autopilot.targets;
  t.heading = apSel.hdg;
  t.altitude = apSel.altFt * FT;
  t.vs = Math.max(100, Math.abs(apSel.vsFpm)) * 0.00508;
  t.ias = apSel.ias;
  t.autothrottle = apSel.at;
  t.lateral = apSel.lateral;
  if (apSel.lateral === "apr") t.vertical = "gs";
  else t.vertical = "alt";
}

function toggleAutopilot(): void {
  if (apOn) return apOff("Autopilot off");
  if (sim.onGround || sim.agl < 60) return hud.toast("Autopilot: climb above 200 ft first");
  apSel.hdg = Math.round(sim.headingDeg / 5) * 5 % 360;
  apSel.altFt = Math.round(sim.pos.y / FT / 100) * 100;
  apSel.ias = Math.round(sim.ias / KT / 5) * 5;
  apSel.lateral = "hdg";
  apSel.at = false;
  autopilot.reset();
  autopilot.targets = {};
  applyApTargets();
  apOn = true;
  apPanel.show(true);
  hud.toast(`Autopilot on · HDG ${String(apSel.hdg).padStart(3, "0")} · ${apSel.altFt} ft`);
}

apPanel.onAction((a: ApAction) => {
  if (a === "ap") return toggleAutopilot();
  switch (a) {
    case "hdg": apSel.lateral = "hdg"; apSel.hdg = Math.round(sim.headingDeg); break;
    case "hdg-": apSel.hdg = (apSel.hdg + 359) % 360; break;
    case "hdg+": apSel.hdg = (apSel.hdg + 1) % 360; break;
    case "alt-": apSel.altFt = Math.max(500, apSel.altFt - 100); break;
    case "alt+": apSel.altFt = Math.min(12000, apSel.altFt + 100); break;
    case "vs-": apSel.vsFpm = Math.max(100, apSel.vsFpm - 100); break;
    case "vs+": apSel.vsFpm = Math.min(1500, apSel.vsFpm + 100); break;
    case "spd-": apSel.ias = Math.max(cfg.speeds.vs1 + 5, apSel.ias - 1); break;
    case "spd+": apSel.ias = Math.min(cfg.limits.vne - 10, apSel.ias + 1); break;
    case "at": apSel.at = !apSel.at; if (!apSel.at) input.setThrottle(controls.throttle); break;
    case "nav": {
      const a2 = nearestAirport();
      const fix = approachFix(a2);
      apSel.lateral = "nav";
      autopilot.targets.nav = { x: fix.x, z: fix.z };
      autopilot.targets.runway = fix.runway;
      hud.toast(`NAV → ${a2.name} approach, runway ${fix.runway.name}`);
      break;
    }
    case "apr": {
      const r = guideRunway ?? pickGuide() ?? intoWind(nearestAirport());
      apSel.lateral = "apr";
      autopilot.targets.runway = r;
      autopilot.reset();
      hud.toast(`APR armed · ${airportOf.get(r)?.name} runway ${r.name}`);
      break;
    }
  }
  applyApTargets();
});

/** Per-step autopilot housekeeping: NAV → APR hand-over, minimums. */
function autopilotLogic(): void {
  const t = autopilot.targets;
  if (apSel.lateral === "nav" && t.nav && Math.hypot(t.nav.x - sim.pos.x, t.nav.z - sim.pos.z) < 900) {
    apSel.lateral = "apr";
    autopilot.reset();
    applyApTargets();
    hud.toast(`APR · runway ${t.runway?.name}`);
  }
  if (apSel.lateral === "apr" && autopilot.atMinimums(sim)) apOff("MINIMUMS · your airplane: land it!");
}

function setSimRate(r: number, quiet = false): void {
  if (r > 1 && (sim.onGround || sim.agl < 150)) {
    if (!quiet) hud.toast("Time acceleration works above 500 ft");
    r = 1;
  }
  if (r === simRate) return;
  simRate = r;
  hud.setSimRate(simRate);
  if (!quiet) hud.toast(simRate === 1 ? "Normal speed" : `Simulation ${simRate}×`);
}

monitor.onResult = (r) => {
  if (r.grade === "CRASH") return; // the crash card is shown from the loop
  const newBest = best === null || r.score > best;
  if (newBest) {
    best = r.score;
    store.set("bestLanding", String(best));
  }
  const survived = !!mayday.active && mayday.triggered;
  hud.showLanding(r, best, newBest, survived ? "MAYDAY SURVIVED" : undefined);
  cardOpen = true;
  const a = nearestAirport();
  if (survived) {
    hud.radio(tower(a), `${CALLSIGN}, outstanding airmanship. Welcome to ${a.name}.`);
    mayday.clear();
    return;
  }
  const msg: Record<Grade, string> = {
    BUTTER: `What a greaser! Welcome to ${a.name}.`,
    SMOOTH: `Nice landing. Welcome to ${a.name}.`,
    FIRM: `Welcome to ${a.name}.`,
    HARD: `Firm arrival — check your gear. Welcome to ${a.name}.`,
    ROUGH: `That was rough. Welcome to ${a.name}.`,
    CRASH: "",
  };
  hud.radio(tower(a), `${CALLSIGN}, ${r.sample.onRunway ? msg[r.grade] : "you landed off the runway. Say intentions."}`);
};

// ---- menu ----
const menu = new Menu(airports, () => ({
  assists: assists.preset,
  invertPitch: input.invertPitch,
  mouseFlying: input.mouseFlying,
  tilt: touch.tilt,
  touch: document.body.classList.contains("touch"),
  timeIndex,
  times: TIMES,
  quality,
  airportIndex,
  sensitivity,
  weather,
  weatherPreset: wxPreset,
  maydays: MAYDAYS.map((m) => ({ ...m, owned: entitlements.has(maydayItemId(m.id)) })),
  storeAvailable: entitlements.storeAvailable,
  devBuild: entitlements.devBuild,
  devUnlockAll: entitlements.devUnlockAll,
  worldMode: realWorld ? "real" : "custom",
  realHome: realWorld ? `${realWorld.home[0]} · ${realWorld.home[1]}` : null,
  canWaterStart: sim.hasFloats,
  hangar: AIRCRAFT_ORDER.map((id) => {
    const c = AIRCRAFT[id];
    const engines = c.engines ?? [c.engine!];
    const kind = engines[0].type === "jet" ? "jet" : engines[0].type === "turboprop" ? "turboprop" : "piston";
    return {
      id,
      name: c.name,
      description: c.description ?? "",
      stats: `${c.speeds.vcruise} kt cruise · ${engines.length > 1 ? "twin " : ""}${kind} · ${c.retractable ? "retractable gear" : c.gear.some((g) => g.kind === "float") ? "amphibian floats" : "fixed gear"}`,
      current: id === cfg.id,
    };
  }),
}), {
  aircraft: (id) => { menu.close(); selectAircraft(id); },
  water: () => { menu.close(); spawnWater(); },
  resume: () => menu.close(),
  runway: () => { menu.close(); spawnRunway(); },
  approach: () => { menu.close(); spawnApproach(); },
  airport: (i) => { airportIndex = i; store.set(AIRPORT_KEY, airports[i].id); menu.close(); spawnRunway(); },
  assists: (p) => setAssists(p),
  invertPitch: (on) => { input.invertPitch = on; store.set("invertPitch", on ? "1" : "0"); },
  mouseFlying: (on) => setMouseFlying(on),
  tilt: (on) => {
    touch.setTilt(on).then((ok) => {
      if (!ok) hud.toast("Tilt isn't available on this device");
      store.set("tilt", touch.tilt ? "1" : "0");
      menu.refresh();
    });
  },
  calibrate: () => { touch.calibrate(); hud.toast("Level set"); },
  mayday: (id) => {
    const def = MAYDAYS.find((m) => m.id === id)!;
    if (!entitlements.has(maydayItemId(id))) return;
    menu.close();
    spawnMayday(def);
  },
  sensitivity: (v) => {
    sensitivity = v;
    input.sensitivity = SENS[v];
    store.set("sensitivity", v);
  },
  weatherPreset: (p) => {
    weather = weatherFromPreset(p, weather.windFrom);
    wxPreset = p;
    weatherBeforeStorm = null;
    applyWeather();
  },
  weatherField: (k, v) => {
    weather = { ...weather, [k]: v };
    wxPreset = "custom";
    weatherBeforeStorm = null;
    applyWeather();
  },
  worldMode: (m) => {
    if (m === (realWorld ? "real" : "custom")) return; // the map actually loaded (real can fall back)
    store.set("mode", m);
    location.reload();
  },
  realAirport: (ident) => {
    store.set("mode", "real");
    store.set("realAirport", ident);
    location.reload();
  },
  searchAirports: async (q) => {
    airportDb ??= await loadAirportDb();
    return airportDb.search(q, 30);
  },
  devUnlockAll: (on) => { entitlements.devUnlockAll = on; },
  time: (i) => setTime(i),
  quality: (q) => { store.set("quality", q); location.reload(); },
});
document.body.append(menu.el);
const toggleMenu = () => (menu.isOpen ? menu.close() : menu.open());
hud.onMenu = toggleMenu;
hud.onSimRate = () => setSimRate(SIM_RATES[(SIM_RATES.indexOf(simRate) + 1) % SIM_RATES.length]);
if (store.get("tilt") === "1" && coarse) touch.setTilt(true);

function setAssists(p: AssistPreset): void {
  assists.preset = p;
  store.set("assists", p);
  assists.reset();
  rewindsLeft = Math.min(rewindsLeft, REWINDS[p]);
  hud.toast(ASSIST_HINT[p]);
}

function setMouseFlying(on: boolean): void {
  input.mouseFlying = on;
  store.set("mouseFlying", on ? "1" : "0");
  rig.leftButtonOrbits = !on;
  hud.toast(on ? "Mouse flying ON: move the cursor from the centre to steer (right-drag to look)" : "Mouse flying OFF");
}

function setTime(i: number): void {
  timeIndex = i;
  scene.setTime(TIMES[i]);
  store.set("time", String(TIMES[i]));
}

hud.onCard((a) => {
  if (a === "approach") spawnApproach();
  else if (a === "runway") spawnRunway();
  else if (a === "rewind") rewind();
  else { hud.hideCard(); cardOpen = false; }
});

// ---- input actions ----
input.onAction((a) => {
  switch (a) {
    case "reset": spawnRunway(); break;
    case "approach": spawnApproach(); break;
    case "nextAirport":
      airportIndex = (airportIndex + 1) % airports.length;
      store.set(AIRPORT_KEY, airports[airportIndex].id);
      spawnRunway();
      break;
    case "time": {
      setTime((timeIndex + 1) % TIMES.length);
      const t = TIMES[timeIndex];
      hud.toast(`Time ${Math.floor(t)}:${String(Math.round((t % 1) * 60)).padStart(2, "0")}`);
      break;
    }
    case "camera": hud.toast(rig.toggle()); break;
    case "help": hud.toggleHelp(); break;
    case "menu":
    case "pause":
      if (hud.helpVisible) hud.toggleHelp(false);
      else toggleMenu();
      break;
    case "map": minimap.toggle(); break;
    case "autopilot": toggleAutopilot(); break;
    case "gear":
      if (!cfg.retractable) hud.toast("Fixed landing gear");
      else hud.toast(input.raw.gear > 0.5 ? "Gear down" : "Gear up");
      break;
    case "simRate": setSimRate(SIM_RATES[(SIM_RATES.indexOf(simRate) + 1) % SIM_RATES.length]); break;
    case "rewind": rewind(); break;
    case "assists": {
      const order: AssistPreset[] = ["easy", "normal", "real"];
      setAssists(order[(order.indexOf(assists.preset) + 1) % order.length]);
      break;
    }
    case "invert":
      store.set("invertPitch", input.invertPitch ? "1" : "0");
      hud.toast(input.invertPitch ? "Pitch inverted" : "Pitch normal");
      break;
    case "mouse": setMouseFlying(input.mouseFlying); break;
    case "flapsDown":
    case "flapsUp": {
      const deg = Math.round(input.raw.flaps * 30);
      hud.toast(deg ? `Flaps ${deg}°` : "Flaps up");
      break;
    }
  }
});
window.addEventListener("keydown", (e) => {
  if (e.code === "Enter" && cardOpen) {
    hud.hideCard();
    cardOpen = false;
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && !menu.isOpen) menu.open();
});
// phones: the first tap on "Start flying" goes full screen (no browser bars) and locks landscape
// where the browser allows it (Android Chrome; iPhones keep the rotate hint instead)
document.querySelector("[data-k=start]")?.addEventListener("click", () => {
  if (!document.body.classList.contains("touch") || document.fullscreenElement) return;
  const orient = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  document.documentElement.requestFullscreen?.({ navigationUI: "hide" })
    .then(() => orient.lock?.("landscape"))
    .catch(() => { /* not allowed here: the rotate hint covers portrait */ });
});

// ---- resize ----
function resize(): void {
  const w = window.innerWidth, h = window.innerHeight;
  scene.resize(w, h);
  rig.resize(w, h);
}
window.addEventListener("resize", resize);
resize();

// ---- loop ----
let last = performance.now();
let acc = 0;
let crashShown = false;
let loading = true;
let loadPeak = 1;
/** Shaders compiled (started once the terrain is in, so every material on screen is included). */
let warm: "no" | "compiling" | "done" = "no";
const towerTmp = new Vector3();

function updateNav(): void {
  if (sim.failures.electrical) return hud.setNav(null);
  const a = nearestAirport();
  const r = a.runways[0];
  const cx = r.threshold.x + Math.sin(r.headingDeg * DEG) * r.length / 2;
  const cz = r.threshold.z - Math.cos(r.headingDeg * DEG) * r.length / 2;
  const dist = Math.hypot(cx - sim.pos.x, cz - sim.pos.z);
  if (dist < 1500 && sim.onGround) return hud.setNav(`${a.id} ${a.name}`, 0);
  const bearing = (Math.atan2(cx - sim.pos.x, -(cz - sim.pos.z)) / DEG + 360) % 360;
  const rel = ((bearing - sim.headingDeg + 540) % 360) - 180;
  hud.setNav(`${a.id} ${a.name} · ${(dist / 1852).toFixed(1)} nm`, rel);
}

function radioEvents(guide: Runway | null): void {
  // departure: hand-off once clear of the airport
  if (departedFrom && !sim.onGround && sim.agl > 150) {
    hud.radio(tower(departedFrom), `${CALLSIGN}, frequency change approved. Have a good flight.`);
    departedFrom = null;
  }
  // inbound: landing clearance once lined up with a runway within ~6 nm
  if (guide && guide !== lastGuide) {
    const c = runwayCoords(guide, sim.pos.x, sim.pos.z);
    if (-c.along < 11000) {
      lastGuide = guide;
      const a = airportOf.get(guide)!;
      hud.radio(tower(a), `${CALLSIGN}, ${windText()}, runway ${guide.name}, cleared to land.`);
    }
  }
}

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const raw = input.update(dt);
  touch.update();
  const running = !menu.isOpen && !hud.helpVisible && !loading;

  if (running) {
    // time acceleration: run more fixed steps per frame (physics stays exactly the same)
    if (simRate > 1 && (sim.onGround || sim.agl < 150 || cardOpen)) {
      setSimRate(1, true);
      hud.toast("Back to normal speed below 500 ft");
    }
    acc += dt * simRate;
    let steps = 0;
    const maxSteps = 8 * simRate;
    while (acc >= SIM_DT && steps < maxSteps) {
      prevPos.copy(sim.pos);
      prevQ.copy(sim.q);
      if (apOn) {
        // the pilot taking the stick disconnects the autopilot
        if (Math.abs(raw.pitch) > 0.35 || Math.abs(raw.roll) > 0.35 || sim.onGround) apOff("Autopilot disconnected");
      }
      if (apOn) {
        Object.assign(controls, raw);
        autopilot.update(sim, SIM_DT, controls);
        autopilotLogic();
      } else {
        // stick sensitivity scales the pilot's pitch / roll (and ground steering)
        Object.assign(stick, raw);
        stick.pitch *= input.sensitivity;
        stick.roll *= input.sensitivity;
        assists.apply(stick, sim, SIM_DT, controls);
      }
      sim.step(SIM_DT, controls);
      if (mayday.update(sim)) onMaydayTriggered();
      monitor.update(sim, SIM_DT);
      acc -= SIM_DT;
      steps++;
    }
    if (steps === maxSteps) acc = 0; // too slow: drop time rather than spiral
    // rewind history: one snapshot every 0.25 s of simulated time, 10 s deep
    historyTimer += dt * simRate;
    if (historyTimer > 0.25 && !sim.crashed) {
      historyTimer = 0;
      history.push(sim.snapshot());
      if (history.length > 40) history.shift();
    }
  }

  if (sim.crashed && !crashShown) {
    crashShown = true;
    apOff("Autopilot off");
    hud.showCrash(sim.crashed);
    hud.radio(tower(nearestAirport()), "Emergency services are on their way.");
    cardOpen = true;
  } else if (!sim.crashed) crashShown = false;

  const alpha = running ? acc / SIM_DT : 1;
  renderPos.copy(prevPos).lerp(sim.pos, alpha);
  renderQ.copy(prevQ).slerp(sim.q, alpha);

  // the model shows where the control surfaces actually are (they lag the stick like real linkages)
  surfaceView.pitch = sim.surfacePos.pitch;
  surfaceView.roll = sim.surfacePos.roll;
  surfaceView.yaw = sim.surfacePos.yaw;
  surfaceView.trim = controls.trim;
  model.update(renderPos, renderQ, surfaceView, sim, running ? dt * simRate : 0);
  // camera shake: turbulence / g changes, runway roll, engine at high power (cockpit)
  shake += ((Math.min(1, Math.abs(sim.gLoad - 1) * 1.5) + (sim.onGround ? Math.min(1, sim.groundSpeed / 30) * 0.6 : 0)
    + (rig.mode === "cockpit" ? (sim.rpm / sim.engines[0].maxRpm) * 0.25 : 0)) - shake) * Math.min(1, dt * 6);
  rig.shake = running ? shake : 0;
  rig.velocity.copy(sim.vel);
  towerPosition(nearestAirport(), towerTmp);
  rig.towerPos.copy(towerTmp);
  rig.update(renderPos, renderQ, dt, world.heightAt(rig.camera.position.x, rig.camera.position.z));
  const autoGuide = guideRunway && !sim.onGround ? guideRunway : pickGuide();
  scene.update(rig.camera, sim, renderPos, assists.flags.approachGuide ? autoGuide : null, now);
  if (running) radioEvents(autoGuide);

  // real world: keep the physics' elevation tiles loaded under the aircraft
  realWorld?.update(sim.pos.x, sim.pos.z);
  // first load: wait for the terrain around the aircraft (real world: also the elevation under
  // it and the airports close by)
  if (loading) {
    const p = scene.terrain.pending + (realWorld
      ? (realWorld.readyAt(sim.pos.x, sim.pos.z) ? 0 : 1) + scene.airports.pendingNear(sim.pos, 6000) : 0);
    loadPeak = Math.max(loadPeak, p);
    hud.setLoading(1 - p / loadPeak);
    if (warm === "no" && p === 0 && now > 600) {
      warm = "compiling";
      void scene.warmUp(rig.camera).then(() => { warm = "done"; });
    }
    if (p === 0 && warm === "done" && now > 600) {
      loading = false;
      hud.setLoading(null);
    }
  }

  const stall = assists.stallWarning(sim);
  const gearWarn = !!cfg.retractable && sim.gearDown < 0.9 && !sim.onGround && sim.agl < 150 && controls.throttle < 0.3;
  const overspeed = sim.ias > cfg.limits.vne * KT;
  const warning = overspeed ? "OVERSPEED" : gearWarn ? "GEAR" : null;
  hud.update(sim, controls, {
    mode: assists.preset,
    stall,
    best,
    autopilot: apOn ? `AP ${autopilot.status.lateral} ${autopilot.status.vertical}` : null,
    rewinds: Number.isFinite(rewindsLeft) ? rewindsLeft : null,
    warning,
  }, now);
  if (apOn) {
    apPanel.render({
      lateralAnn: autopilot.status.lateral,
      verticalAnn: autopilot.status.vertical,
      lateral: apSel.lateral,
      hdg: apSel.hdg,
      altFt: apSel.altFt,
      vsFpm: apSel.vsFpm,
      ias: apSel.ias,
      at: apSel.at,
    });
  }
  hud.setYoke(input.mouseFlying && input.device === "mouse" ? input.mouseStick : null, Math.min(window.innerWidth, window.innerHeight) * MOUSE_RANGE);
  minimap.draw(renderPos.x, renderPos.z, sim.headingDeg, now);
  updateNav();
  audio.update(sim, Math.max(stall, warning ? 1 : 0), rig.mode === "cockpit", !running);
  // while shaders compile in the background, drawing would force them to finish one by one
  if (warm !== "compiling") scene.render(rig.camera);
  contrast.update(now);
  requestAnimationFrame(frame);
}

{
  const t = Number(devParams.get("time"));
  if (devParams.has("time") && TIMES[t] !== undefined) setTime(t);
  const sp = devParams.get("spawn");
  if (sp === "approach") spawnApproach();
  else spawnRunway();
}
requestAnimationFrame(frame);
