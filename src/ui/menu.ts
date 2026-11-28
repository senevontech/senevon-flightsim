/* Pause menu / settings panel: works with mouse and touch. Opening it pauses the flight.
   Sections: Fly, World, Hangar, Mayday, Weather, Assists, Controls, Graphics, Keys. */
import type { Airport } from "../world/WorldProvider";
import type { AssistPreset } from "../sim/assists";
import { WEATHER_PRESETS, type Weather, type WeatherPreset } from "../gameplay/weather";
import type { MaydayDef, MaydayId } from "../gameplay/mayday";

export type Sensitivity = "low" | "medium" | "high";

/** A search result in the World tab. */
export interface WorldHit {
  ident: string;
  name: string;
  place: string;
  country: string;
  size: number;
}

export interface HangarEntry {
  id: string;
  name: string;
  description: string;
  stats: string;
  current: boolean;
}

export interface MenuState {
  hangar: HangarEntry[];
  /** Current aircraft can start on the water (floats). */
  canWaterStart: boolean;
  assists: AssistPreset;
  invertPitch: boolean;
  mouseFlying: boolean;
  tilt: boolean;
  touch: boolean;
  sensitivity: Sensitivity;
  timeIndex: number;
  times: number[];
  quality: "low" | "high";
  airportIndex: number;
  weather: Weather;
  weatherPreset: WeatherPreset | "custom";
  maydays: (MaydayDef & { owned: boolean })[];
  storeAvailable: boolean;
  devBuild: boolean;
  devUnlockAll: boolean;
  worldMode: "custom" | "real";
  /** Real world: the airport the map is centred on, e.g. "EGLL · London Heathrow Airport". */
  realHome: string | null;
}

export interface MenuActions {
  aircraft(id: string): void;
  water(): void;
  resume(): void;
  runway(): void;
  approach(): void;
  airport(i: number): void;
  mayday(id: MaydayId): void;
  assists(p: AssistPreset): void;
  invertPitch(on: boolean): void;
  mouseFlying(on: boolean): void;
  tilt(on: boolean): void;
  calibrate(): void;
  sensitivity(s: Sensitivity): void;
  time(i: number): void;
  quality(q: "low" | "high"): void;
  weatherPreset(p: WeatherPreset): void;
  weatherField(key: keyof Weather, value: number | boolean): void;
  devUnlockAll(on: boolean): void;
  /** Switch maps (reloads the game). */
  worldMode(m: "custom" | "real"): void;
  /** Real world: fly from this airport (reloads the game). */
  realAirport(ident: string): void;
  searchAirports(query: string): Promise<WorldHit[]>;
}

/** Text from data files goes into HTML: escape it. */
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const fmtTime = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

const SLIDERS: [keyof Weather, string, number, number, number, (v: number) => string][] = [
  ["windFrom", "Wind from", 0, 350, 10, (v) => `${String(v || 360).padStart(3, "0")}°`],
  ["windKt", "Wind speed", 0, 35, 1, (v) => `${v} kt`],
  ["gustKt", "Gusts", 0, 25, 1, (v) => `+${v} kt`],
  ["turbulence", "Turbulence", 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`],
  ["cumulus", "Cumulus clouds", 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`],
  ["overcast", "Overcast layer", 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`],
  ["visibility", "Visibility", 0.8, 70, 0.2, (v) => (v >= 10 ? `${Math.round(v)} km` : `${v.toFixed(1)} km`)],
  ["rain", "Rain", 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`],
];

export class Menu {
  readonly el = document.createElement("div");
  private tab = "fly";
  private notice = "";
  private query = "";
  private searchTimer = 0;
  private hits: WorldHit[] = [];
  private searching = "";

  constructor(private airports: Airport[], private state: () => MenuState, private act: MenuActions) {
    this.el.className = "menu-overlay hidden";
    this.el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t === this.el) return this.act.resume();
      const b = t.closest("[data-m]") as HTMLElement | null;
      if (!b) return;
      const [kind, arg] = (b.dataset.m ?? "").split(":");
      this.notice = "";
      const s = this.state();
      switch (kind) {
        case "tab": this.tab = arg; break;
        case "resume": return this.act.resume();
        case "runway": return this.act.runway();
        case "water": return this.act.water();
        case "plane": return this.act.aircraft(arg);
        case "approach": return this.act.approach();
        case "airport": return this.act.airport(Number(arg));
        case "mayday": {
          const m = s.maydays.find((x) => x.id === arg)!;
          if (m.owned) return this.act.mayday(m.id);
          this.notice = s.storeAvailable
            ? `Unlock "${m.name}" for ${m.price} tokens.`
            : `"${m.name}" unlocks with ${m.price} Senevon tokens (or Senevon Plus). Token purchases open when Skyward connects to your Senevon account.`;
          break;
        }
        case "assists": this.act.assists(arg as AssistPreset); break;
        case "invert": this.act.invertPitch(!s.invertPitch); break;
        case "mouse": this.act.mouseFlying(!s.mouseFlying); break;
        case "tilt": this.act.tilt(!s.tilt); break;
        case "calibrate": this.act.calibrate(); break;
        case "sens": this.act.sensitivity(arg as Sensitivity); break;
        case "time": this.act.time(Number(arg)); break;
        case "quality": return this.act.quality(arg as "low" | "high");
        case "wx": this.act.weatherPreset(arg as WeatherPreset); break;
        case "lightning": this.act.weatherField("lightning", !s.weather.lightning); break;
        case "dev": this.act.devUnlockAll(!s.devUnlockAll); break;
        case "world": return this.act.worldMode(arg as "custom" | "real");
        case "real": return this.act.realAirport(arg);
      }
      this.render();
    });
    // weather sliders apply live; the airport search updates its results as you type
    this.el.addEventListener("input", (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.search !== undefined) {
        this.query = t.value;
        clearTimeout(this.searchTimer);
        this.searchTimer = window.setTimeout(() => void this.runSearch(), 160);
        return;
      }
      const key = t.dataset.w as keyof Weather | undefined;
      if (!key) return;
      this.act.weatherField(key, Number(t.value));
      const fmt = SLIDERS.find((x) => x[0] === key)![5];
      const out = this.el.querySelector(`[data-wv="${key}"]`);
      if (out) out.textContent = fmt(Number(t.value));
      this.el.querySelectorAll(".seg.wx button").forEach((b) => b.classList.remove("on"));
    });
  }

  private async runSearch(): Promise<void> {
    const q = this.query;
    this.searching = "Loading airports…";
    this.renderHits();
    try {
      this.hits = await this.act.searchAirports(q);
      this.searching = q.trim().length >= 2 && !this.hits.length ? "No airport found." : "";
    } catch {
      this.hits = [];
      this.searching = "Couldn't load the airport list (offline?).";
    }
    if (q === this.query) this.renderHits();
  }

  private hitsHtml(): string {
    const SIZE = ["Small airport", "Airport", "Major airport"];
    if (this.searching) return `<p class="hint">${this.searching}</p>`;
    return this.hits.map((h) => `
      <button class="row-btn" data-m="real:${esc(h.ident)}">
        <span><b>${esc(h.ident)} · ${esc(h.name)}</b><small>${esc([h.place, h.country].filter(Boolean).join(", "))} · ${SIZE[h.size] ?? ""}</small></span><i class="chev">›</i>
      </button>`).join("");
  }

  /** Refresh only the result list, so the search box keeps focus while typing. */
  private renderHits(): void {
    const box = this.el.querySelector("[data-results]");
    if (box) box.innerHTML = this.hitsHtml();
  }

  get isOpen(): boolean {
    return !this.el.classList.contains("hidden");
  }

  open(tab?: string): void {
    if (tab) this.tab = tab;
    this.notice = "";
    this.render();
    this.el.classList.remove("hidden");
  }

  close(): void {
    this.el.classList.add("hidden");
  }

  refresh(): void {
    if (this.isOpen) this.render();
  }

  private render(): void {
    const s = this.state();
    const seg = (items: [string, string, boolean][], cls = "") =>
      `<div class="seg ${cls}">${items.map(([m, label, on]) => `<button data-m="${m}" class="${on ? "on" : ""}">${label}</button>`).join("")}</div>`;
    const toggle = (m: string, label: string, on: boolean, hint = "") =>
      `<button class="row-btn" data-m="${m}"><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ""}</span><i class="switch ${on ? "on" : ""}"></i></button>`;
    const tabs = [["fly", "Fly"], ["world", "World"], ["hangar", "Hangar"], ["mayday", "Mayday"], ["weather", "Weather"], ["assists", "Assists"], ["controls", "Controls"], ["graphics", "Graphics"], ...(s.touch ? [] : [["keys", "Keys"]])];
    let body = "";
    if (this.tab === "fly") {
      body = `
        <div class="grid2">
          <button class="big-btn" data-m="runway">Restart on runway</button>
          <button class="big-btn alt" data-m="approach">Final approach</button>
        </div>
        ${s.canWaterStart ? `<button class="big-btn alt water-btn" data-m="water">Start on the water</button>` : ""}
        <h4>Airports</h4>
        <div class="list">${this.airports.map((a, i) => {
          const r = a.runways[0];
          return `<button class="row-btn ${i === s.airportIndex ? "current" : ""}" data-m="airport:${i}">
            <span><b>${a.id} · ${a.name}</b><small>Runway ${a.runways.map((x) => x.name).join("/")} · ${Math.round(r.length)} m ${r.surface === "grass" ? "grass" : "paved"} · elev ${Math.round(a.elevation * 3.281)} ft</small></span><i class="chev">›</i></button>`;
        }).join("")}</div>`;
    } else if (this.tab === "world") {
      body = `
        <h4>Map</h4>
        ${seg([["world:custom", "Coral Coast", s.worldMode === "custom"], ["world:real", "Real world", s.worldMode === "real"]])}
        <p class="hint">${s.worldMode === "real"
          ? `Real terrain and satellite imagery around <b>${esc(s.realHome ?? "")}</b>. Search any airport below to fly from there.`
          : "Our own tropical islands: 14 airports. Or choose the real world and pick any airport on Earth."}</p>
        <h4>Fly from any real airport</h4>
        <input class="search" data-search type="search" placeholder="Code, name or city (e.g. EGLL, Mumbai, Innsbruck)" value="${esc(this.query)}" autocomplete="off" />
        <div class="list" data-results>${this.hitsHtml()}</div>
        <p class="hint">Changing the map reloads the game. Imagery: Sentinel-2 cloudless 2016 by EOX · Elevation: AWS Terrain Tiles · Airports: OurAirports.</p>`;
    } else if (this.tab === "hangar") {
      body = `<div class="list">${s.hangar.map((p) => `
          <button class="row-btn plane ${p.current ? "current" : ""}" data-m="plane:${p.id}">
            <span><b>${p.name}</b><small>${p.description}</small><small class="stats">${p.stats}</small></span>
            <i class="price">${p.current ? "FLYING" : "FLY"}</i>
          </button>`).join("")}</div>`;
    } else if (this.tab === "mayday") {
      body = `
        <p class="hint">You start in cruise toward the selected airport. Seconds later, something goes wrong. Get it down in one piece.</p>
        ${this.notice ? `<div class="notice">${this.notice}</div>` : ""}
        <div class="list">${s.maydays.map((m) => `
          <button class="row-btn ${m.owned ? "" : "locked"}" data-m="mayday:${m.id}">
            <span><b>${m.name}</b><small>${m.desc}</small></span>
            <i class="price">${m.free ? "FREE" : m.owned ? "PLAY" : `🔒 ${m.price}`}</i>
          </button>`).join("")}</div>
        ${s.devBuild ? toggle("dev", "Developer: unlock all", s.devUnlockAll, "Development builds only, for testing. Not in the released game.") : ""}`;
    } else if (this.tab === "weather") {
      body = `
        ${seg((Object.keys(WEATHER_PRESETS) as WeatherPreset[]).map((p) => [`wx:${p}`, WEATHER_PRESETS[p].name, s.weatherPreset === p] as [string, string, boolean]), "wx")}
        <div class="sliders">${SLIDERS.map(([k, label, min, max, step, fmt]) => `
          <label class="slider"><span>${label}<b data-wv="${k}">${fmt(s.weather[k] as number)}</b></span>
            <input type="range" data-w="${k}" min="${min}" max="${max}" step="${step}" value="${s.weather[k]}" /></label>`).join("")}
        </div>
        ${toggle("lightning", "Lightning", s.weather.lightning)}`;
    } else if (this.tab === "assists") {
      body = `
        ${seg([["assists:easy", "Easy", s.assists === "easy"], ["assists:normal", "Normal", s.assists === "normal"], ["assists:real", "Real", s.assists === "real"]])}
        <p class="hint">${s.assists === "easy" ? "The plane holds its nose where you leave it and levels its wings when you let go. Stall and g-protection, unlimited rewind." :
          s.assists === "normal" ? "Holds whatever bank you leave it in. Turns are coordinated; light stall protection; 3 rewinds per flight." :
          "No help at all: your input moves the control surfaces directly. No rewind."}</p>`;
    } else if (this.tab === "controls") {
      body = `
        <h4>Stick sensitivity</h4>
        ${seg([["sens:low", "Low", s.sensitivity === "low"], ["sens:medium", "Medium", s.sensitivity === "medium"], ["sens:high", "High", s.sensitivity === "high"]])}
        <h4>Options</h4>
        ${toggle("invert", "Invert pitch", s.invertPitch, "Push forward / drag up = nose up")}
        ${s.touch ? toggle("tilt", "Tilt to steer", s.tilt, "Steer by tilting the phone instead of the stick") : toggle("mouse", "Mouse flying", s.mouseFlying, "Cursor distance from the centre is the stick (Y)")}
        ${s.touch && s.tilt ? `<button class="big-btn" data-m="calibrate">Set current angle as level</button>` : ""}
        <p class="hint">On the ground, steering left/right (A/D, arrows, stick or tilt) turns the nose wheel.</p>`;
    } else if (this.tab === "graphics") {
      body = `
        <h4>Time of day</h4>
        ${seg(s.times.map((t, i) => [`time:${i}`, fmtTime(t), i === s.timeIndex] as [string, string, boolean]))}
        <h4>Quality</h4>
        ${seg([["quality:low", "Battery saver", s.quality === "low"], ["quality:high", "High", s.quality === "high"]])}
        <p class="hint">Changing quality reloads the game.</p>`;
    } else {
      body = `<div class="keys">
        ${[["S / ↓", "Nose up"], ["W / ↑", "Nose down"], ["A D / ← →", "Bank · steer on ground"], ["Q E", "Rudder"], ["Shift / Z", "Throttle up / down"],
          ["F / V", "Flaps down / up"], ["B / Space", "Brakes"], ["J", "Autopilot (panel: HDG · ALT · VS · SPD · NAV · APR)"], ["X", "Time acceleration 1× / 2× / 4× / 6×"], ["Backspace", "Rewind 10 s"], ["C", "Camera"],
          ["Tab", "Map size"], ["L", "Final approach"], ["R", "Restart"], ["N", "Next airport"], ["T", "Time of day"], ["M", "Assists"],
          ["Y", "Mouse flying"], ["I", "Invert pitch"], ["Esc / P", "Menu"]]
          .map(([k, v]) => `<div><kbd>${k}</kbd><span>${v}</span></div>`).join("")}
      </div>`;
    }
    this.el.innerHTML = `
      <div class="menu">
        <div class="menu-head"><h2>Skyward</h2><button class="resume" data-m="resume">Resume ▸</button></div>
        <div class="tabs">${tabs.map(([k, l]) => `<button data-m="tab:${k}" class="${this.tab === k ? "on" : ""}">${l}</button>`).join("")}</div>
        <div class="menu-body">${body}</div>
      </div>`;
  }
}
