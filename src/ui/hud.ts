/* Heads-up display. Clean, minimal layout:
     top-left  : menu button + radio messages
     top       : heading tape, nearest-airport pointer
     top-right : moving map
     bottom    : left cluster (airspeed, attitude) · centre strip (engine, flaps, status) ·
                 right cluster (altimeter, vertical speed)
   On touch devices the clusters move to the top corners (the thumbs own the bottom).
   Also: stall warning, callouts, toasts, landing / crash cards, first-run help, loading. */
import type { AircraftSim, CrashReason } from "../sim/aircraft";
import { FPM, FT, KT, type AircraftConfig, type Controls } from "../sim/types";
import type { AssistPreset } from "../sim/assists";
import type { Grade, LandingResult } from "../gameplay/landing";
import { AirspeedGauge, AltimeterGauge, AttitudeGauge, HeadingTape, VsiGauge } from "./instruments";
import type { AdaptiveContrast } from "./contrast";

const GRADE_COLORS: Record<Grade, string> = {
  BUTTER: "#ffd34d", SMOOTH: "#4cd964", FIRM: "#5ac8fa", HARD: "#ff9f0a", ROUGH: "#ff6b3d", CRASH: "#ff3b30",
};

const CRASH_TEXT: Record<CrashReason, string> = {
  terrain: "You flew into the ground.",
  wingtip: "A wingtip hit the ground.",
  propeller: "Prop strike: the nose hit the ground.",
  tail: "Tail strike.",
  gear: "The landing gear collapsed: too hard.",
  overstress: "The airframe was overstressed.",
  overspeed: "Too fast: the airframe broke up.",
  water: "Ditched in the sea. This plane has wheels, not floats.",
  belly: "Belly landing: the gear was up.",
};

export interface HudInfo {
  mode: AssistPreset;
  stall: number;
  best: number | null;
  autopilot: string | null;
  rewinds: number | null;
  /** Red warning banner text (GEAR, OVERSPEED), or null. */
  warning?: string | null;
}

const html = String.raw;

export class Hud {
  private el: HTMLElement;
  /** Element lookup, cached: update() runs every frame and must not query the DOM each time. */
  private found = new Map<string, HTMLElement>();
  private $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
    let e = this.found.get(sel);
    if (!e || !e.isConnected) {
      e = this.el.querySelector(sel) as HTMLElement;
      if (e) this.found.set(sel, e);
    }
    return e as T;
  };
  private last = new Map<HTMLElement, string>();
  private calloutsDone = new Set<number>();
  private toastTimer = 0;
  private asi: AirspeedGauge;
  private contrast: AdaptiveContrast | null = null;
  private jet = false;
  private adi = new AttitudeGauge();
  private alt = new AltimeterGauge();
  private vsi = new VsiGauge();
  private tape = new HeadingTape();
  private lastGauges = 0;
  private maydayTimer = 0;
  private electrical = false;
  /** Slot for the moving map (filled by main). */
  readonly mapSlot: HTMLElement;
  /** Fired by the on-screen menu button. */
  onMenu: (() => void) | null = null;
  /** Fired by the time-acceleration chip. */
  onSimRate: (() => void) | null = null;

  constructor(root: HTMLElement, cfg: AircraftConfig) {
    this.el = root;
    const sp = cfg.speeds;
    this.asi = new AirspeedGauge({ vs0: sp.vs0, vs1: sp.vs1, vfe: cfg.flaps.vfe, vno: Math.round(sp.vcruise * 1.17), vne: cfg.limits.vne });
    root.innerHTML = html`
      <div class="hud-tl">
        <button class="menu-btn" data-k="menuBtn" aria-label="Menu"><span></span><span></span><span></span></button>
        <div class="radio" data-k="radio"></div>
      </div>
      <div class="hud-top">
        <div class="pfd-row">
          <div class="pfd-box glass" data-k="pspd"><b data-k="dspd">0</b><label>KT</label></div>
          <div class="tape-slot" data-k="tapeSlot"></div>
          <div class="pfd-box glass" data-k="palt"><b data-k="dalt">0</b><label>FT</label><span class="pfd-vs" data-k="dvs"></span></div>
        </div>
        <div class="chip nav" data-k="navwrap"><span class="nav-arrow" data-k="navarrow">▲</span><span data-k="nav"></span></div>
      </div>
      <div class="hud-tr" data-k="mapSlot"></div>
      <div class="cluster left" data-k="cl"></div>
      <div class="cluster right" data-k="cr"></div>
      <div class="strip">
        <div class="cell thr"><div class="vbar"><i data-k="thr"></i></div><div><label>THR</label><b data-k="thrv">0%</b></div></div>
        <div class="cell"><label data-k="rpmlbl">RPM</label><b data-k="rpm">0</b></div>
        <div class="cell gear-cell hidden" data-k="gearcell"><label>GEAR</label><div class="gearlights" data-k="gear"><i></i><i></i><i></i></div></div>
        <div class="cell fuel"><label>FUEL</label><div class="hbar"><i data-k="fuel"></i></div></div>
        <div class="cell"><label>FLAPS</label><div class="flaps" data-k="flaps"><i></i><i></i><i></i></div></div>
        <div class="cell trim"><label>TRIM</label><div class="trimbar"><i data-k="trim"></i></div></div>
        <div class="cell status">
          <span class="tag" data-k="mode">EASY</span>
          <span class="tag ap hidden" data-k="ap">AP</span>
          <span class="tag warn hidden" data-k="brk">BRK</span>
          <span class="tag mayday-tag hidden" data-k="mdtag">MAYDAY</span>
        </div>
      </div>
      <div class="yoke hidden" data-k="yoke"><div class="yoke-dead"></div><div class="yoke-dot" data-k="ydot"></div></div>
      <canvas class="crack hidden" data-k="crack"></canvas>
      <div class="mayday-banner hidden" data-k="mayday"></div>
      <div class="stall" data-k="stall">STALL</div>
      <div class="stall warnbar" data-k="warn"></div>
      <div class="callout" data-k="callout"></div>
      <div class="toast" data-k="toast"></div>
      <div class="best-chip" data-k="bestwrap">BEST <b data-k="best">—</b></div>
      <button class="rate-chip" data-k="rate" title="Time acceleration (X)">1×</button>
      <div class="card hidden" data-k="card"></div>
      <div class="overlay loading hidden" data-k="loading"><div class="card-inner"><h2>Loading the islands…</h2><div class="bar-h"><i data-k="loadbar"></i></div></div></div>
      <div class="overlay" data-k="help">
        <div class="card-inner help">
          <h2>Skyward <span class="dim">· Coral Coast</span></h2>
          <div class="help-touch">
            <p><b>Left thumb:</b> drag anywhere on the left to steer. Pull down = nose up.</p>
            <p><b>Right thumb:</b> slide the throttle up for power; FLAP and BRAKE beside it. Small round buttons above: camera, autopilot, rewind.</p>
            <p><b>Takeoff:</b> full throttle, and at about 55 kt pull the stick gently down. Let go and the plane flies itself.</p>
          </div>
          <div class="keys help-keys">
            <div><kbd>S</kbd>/<kbd>↓</kbd><span>Nose up</span></div>
            <div><kbd>W</kbd>/<kbd>↑</kbd><span>Nose down</span></div>
            <div><kbd>A</kbd><kbd>D</kbd><span>Bank</span></div>
            <div><kbd>Shift</kbd>/<kbd>Z</kbd><span>Throttle</span></div>
            <div><kbd>F</kbd>/<kbd>V</kbd><span>Flaps</span></div>
            <div><kbd>B</kbd><span>Brakes</span></div>
            <div><kbd>J</kbd><span>Autopilot</span></div>
            <div><kbd>X</kbd><span>Time 1×/2×/4×/6×</span></div>
            <div><kbd>⌫</kbd><span>Rewind 10 s</span></div>
            <div><kbd>C</kbd><span>Camera</span></div>
            <div><kbd>L</kbd><span>Final approach</span></div>
            <div><kbd>Esc</kbd><span>Menu &amp; all keys</span></div>
            <div><kbd>Y</kbd><span>Mouse flying</span></div>
          </div>
          <p class="tip"><b>Goal:</b> touch down on the white aim-point blocks at 60–180 ft/min for a
            <span style="color:${GRADE_COLORS.BUTTER}">BUTTER</span> landing. On approach keep the lights beside the runway at <b>2 white · 2 red</b>.</p>
          <button class="big-btn start" data-k="start">Start flying</button>
        </div>
      </div>`;
    this.$("[data-k=cl]").append(this.asi.canvas, this.adi.canvas);
    this.$("[data-k=cr]").append(this.alt.canvas, this.vsi.canvas);
    this.$("[data-k=tapeSlot]").append(this.tape.canvas);
    this.mapSlot = this.$("[data-k=mapSlot]");
    this.$("[data-k=help]").addEventListener("click", () => this.toggleHelp(false));
    this.$("[data-k=menuBtn]").addEventListener("click", () => this.onMenu?.());
    this.$("[data-k=rate]").addEventListener("click", () => this.onSimRate?.());
  }

  private set(k: string, v: string): void {
    const e = this.$(`[data-k=${k}]`);
    if (this.last.get(e) !== v) {
      e.textContent = v;
      this.last.set(e, v);
    }
  }

  private show(k: string, on: boolean): void {
    this.$(`[data-k=${k}]`).classList.toggle("hidden", !on);
  }

  get helpVisible(): boolean {
    return !this.$("[data-k=help]").classList.contains("hidden");
  }

  toggleHelp(show = !this.helpVisible): void {
    this.show("help", show);
  }

  toast(text: string): void {
    const t = this.$("[data-k=toast]");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove("show"), 1800);
  }

  /** A line of radio traffic in the top-left log (fades after a while). */
  radio(from: string, text: string): void {
    const log = this.$("[data-k=radio]");
    const line = document.createElement("div");
    line.className = "radio-line";
    line.innerHTML = `<b></b><span></span>`;
    line.querySelector("b")!.textContent = from;
    line.querySelector("span")!.textContent = text;
    log.append(line);
    while (log.children.length > 3) log.firstElementChild!.remove();
    setTimeout(() => line.classList.add("old"), 14000);
    setTimeout(() => line.remove(), 16000);
  }

  resetCallouts(): void {
    this.calloutsDone.clear();
  }

  setNav(text: string | null, relBearing = 0): void {
    this.show("navwrap", !!text);
    if (!text) return;
    this.set("nav", text);
    this.$("[data-k=navarrow]").style.transform = `rotate(${Math.round(relBearing)}deg)`;
  }

  setLoading(progress: number | null): void {
    this.show("loading", progress !== null);
    if (progress !== null) this.$("[data-k=loadbar]").style.width = `${Math.round(progress * 100)}%`;
  }

  /** Mouse-flying cursor ring: x, y in −1..1 (null = hidden). Range = radius in px of full stick. */
  setYoke(stick: { x: number; y: number } | null, range: number): void {
    const y = this.$("[data-k=yoke]");
    y.classList.toggle("hidden", !stick);
    if (!stick) return;
    y.style.width = y.style.height = `${range * 2}px`;
    this.$("[data-k=ydot]").style.transform = `translate(${stick.x * range}px, ${-stick.y * range}px)`;
  }

  /** Phone readouts: speed (amber near the stall, red at the stall or overspeed), altitude and
      climb / sink rate. */
  private drawReadouts(sim: AircraftSim, info: HudInfo): void {
    this.set("dspd", String(Math.round(sim.ias / KT)));
    const spd = this.$("[data-k=pspd]");
    const state = info.stall > 0.5 || info.warning === "OVERSPEED" ? "bad" : info.stall > 0 ? "warn" : "";
    if ((spd.dataset.state ?? "") !== state) spd.dataset.state = state;
    this.set("dalt", String(Math.round(sim.pos.y / FT / 10) * 10));
    const vs = Math.round(sim.vs / FPM / 50) * 50;
    this.set("dvs", Math.abs(vs) < 50 ? "" : `${vs > 0 ? "\u25B2" : "\u25BC"}${Math.abs(vs)}`);
  }

  /** Hook every HUD element that floats over the scene into adaptive contrast. The attitude
      indicator is left out: it carries its own sky/ground background. */
  registerContrast(ac: AdaptiveContrast): void {
    this.contrast = ac;
    for (const g of [this.asi, this.alt, this.vsi, this.tape]) ac.register(g.canvas, (t) => g.setTone(t));
    for (const k of ["menuBtn", "radio", "navwrap", "bestwrap", "toast", "callout", "rate", "pspd", "palt"]) ac.register(this.$(`[data-k=${k}]`));
    ac.register(this.el.querySelector(".strip") as HTMLElement);
  }

  setSimRate(r: number): void {
    const chip = this.$("[data-k=rate]");
    chip.textContent = `${r}×`;
    chip.classList.toggle("fast", r > 1);
  }

  /** Switch the HUD to another aircraft: airspeed scale and arcs, engine readout, gear lights. */
  setAircraft(cfg: AircraftConfig): void {
    const sp = cfg.speeds;
    const max = Math.ceil((cfg.limits.vne * 1.15) / 40) * 40;
    const asi = new AirspeedGauge(
      { vs0: sp.vs0, vs1: sp.vs1, vfe: cfg.flaps.vfe, vno: Math.min(Math.round(sp.vcruise * 1.12), Math.round(cfg.limits.vne * 0.9)), vne: cfg.limits.vne },
      max,
    );
    this.asi.canvas.replaceWith(asi.canvas);
    this.asi = asi;
    this.contrast?.register(asi.canvas, (t) => asi.setTone(t));
    this.jet = (cfg.engines ?? [cfg.engine!])[0].type === "jet";
    this.set("rpmlbl", this.jet ? "N1 %" : "RPM");
    this.show("gearcell", !!cfg.retractable);
  }

  /** Big flashing alert when a Mayday failure happens. */
  alertMayday(text: string): void {
    const b = this.$("[data-k=mayday]");
    b.textContent = text;
    b.classList.remove("hidden");
    b.classList.remove("flash");
    void b.offsetWidth;
    b.classList.add("flash");
    clearTimeout(this.maydayTimer);
    this.maydayTimer = window.setTimeout(() => b.classList.add("hidden"), 5000);
  }

  /** Persistent failure effects: Mayday tag, dead instruments, cracked windscreen. */
  setFailures(mayday: boolean, electrical: boolean, cracked: boolean): void {
    this.show("mdtag", mayday);
    this.el.classList.toggle("electrical-dead", electrical);
    this.electrical = electrical;
    const crack = this.$<HTMLCanvasElement>("[data-k=crack]");
    if (cracked && crack.classList.contains("hidden")) this.drawCrack(crack);
    crack.classList.toggle("hidden", !cracked);
    if (!mayday) this.show("mayday", false);
  }

  private drawCrack(c: HTMLCanvasElement): void {
    const W = (c.width = window.innerWidth), H = (c.height = window.innerHeight);
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, W, H);
    const ox = W * 0.38, oy = H * 0.36;
    g.strokeStyle = "rgba(255,255,255,0.55)";
    g.shadowColor = "rgba(0,0,0,0.4)";
    g.shadowBlur = 2;
    // a starburst of jagged cracks from the impact point
    for (let k = 0; k < 14; k++) {
      let x = ox, y = oy;
      let a = (k / 14) * Math.PI * 2 + Math.random() * 0.3;
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(x, y);
      const len = 60 + Math.random() * Math.min(W, H) * 0.45;
      for (let d = 0; d < len; d += 14 + Math.random() * 22) {
        a += (Math.random() - 0.5) * 0.5;
        x += Math.cos(a) * 18;
        y += Math.sin(a) * 18;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // concentric fractures around the impact
    for (const r of [18, 36, 58]) {
      g.lineWidth = 1;
      g.beginPath();
      for (let a = 0; a < Math.PI * 2; a += 0.35) {
        const rr = r * (0.85 + Math.random() * 0.3);
        a === 0 ? g.moveTo(ox + rr, oy) : g.lineTo(ox + Math.cos(a) * rr, oy + Math.sin(a) * rr);
      }
      g.closePath();
      g.stroke();
    }
    g.fillStyle = "rgba(255,255,255,0.25)";
    g.beginPath();
    g.arc(ox, oy, 10, 0, Math.PI * 2);
    g.fill();
  }

  update(sim: AircraftSim, c: Controls, info: HudInfo, now: number): void {
    // instruments at ~30 Hz (frozen when the electrics are dead); phones show digital readouts
    // instead of the round gauges, so those are not drawn there
    if (!this.electrical && now - this.lastGauges > 33) {
      this.lastGauges = now;
      if (!document.body.classList.contains("touch")) {
        this.asi.draw(sim.ias / KT);
        this.adi.draw(sim.pitchDeg, sim.bankDeg);
        this.alt.draw(sim.pos.y / FT);
        this.vsi.draw(sim.vs / FPM);
      } else this.drawReadouts(sim, info);
      this.tape.draw(sim.headingDeg, sim.groundSpeed > 5 ? sim.trackDeg : null);
    }
    this.$("[data-k=thr]").style.height = `${Math.round(c.throttle * 100)}%`;
    this.set("thrv", `${Math.round(c.throttle * 100)}%`);
    this.set("rpm", this.jet ? sim.rpm.toFixed(0) : String(Math.round(sim.rpm / 10) * 10));
    // gear: three greens when down and locked, red in transit, dark when up
    const g = sim.gearDown;
    this.$("[data-k=gear]").dataset.state = g > 0.98 ? "down" : g < 0.02 ? "up" : "transit";
    const warn = info.warning ?? "";
    this.set("warn", warn);
    this.$("[data-k=warn]").classList.toggle("show", !!warn && !this.electrical);
    this.$("[data-k=fuel]").style.width = `${Math.round((sim.fuel / sim.cfg.fuelCapacity) * 100)}%`;
    const fl = Math.round(sim.flaps * 3);
    this.$("[data-k=flaps]").dataset.n = String(fl);
    this.$("[data-k=trim]").style.left = `${50 + c.trim * 45}%`;
    this.set("mode", info.mode.toUpperCase());
    this.show("ap", !!info.autopilot);
    if (info.autopilot) this.set("ap", info.autopilot);
    this.show("brk", c.brakes > 0 && sim.onGround);
    this.set("best", info.best === null ? "—" : String(info.best));
    this.$("[data-k=stall]").classList.toggle("show", info.stall > 0.5 && !this.electrical);

    // radio-altitude callouts on descent
    const aglFt = sim.agl / FT;
    if (!sim.onGround && sim.vs < -0.5) {
      for (const h of [100, 50, 30, 10]) {
        if (aglFt < h && aglFt > h - 15 && !this.calloutsDone.has(h)) {
          this.calloutsDone.add(h);
          this.callout(String(h));
        }
      }
    }
    if (aglFt > 200) this.calloutsDone.clear();
  }

  private callout(text: string): void {
    const e = this.$("[data-k=callout]");
    e.textContent = text;
    e.classList.remove("pop");
    void e.offsetWidth;
    e.classList.add("pop");
  }

  hideCard(): void {
    this.show("card", false);
  }

  showLanding(r: LandingResult, best: number | null, newBest: boolean, badge?: string): void {
    const s = r.sample;
    const pct = (v: number) => `<i style="width:${Math.round(v * 100)}%"></i>`;
    const row = (label: string, value: string, part: number) =>
      `<div class="row"><span>${label}</span><b>${value}</b><div class="meter">${pct(part)}</div></div>`;
    const card = this.$("[data-k=card]");
    const color = GRADE_COLORS[r.grade];
    card.innerHTML = html`
      <div class="card-inner landing">
        ${badge ? `<div class="badge">${badge}</div>` : ""}
        <div class="grade" style="color:${color}">${r.grade}</div>
        <div class="score"><span data-count="${r.score}">0</span><small>/ 1000</small></div>
        ${newBest ? `<div class="newbest">NEW PERSONAL BEST</div>` : best !== null ? `<div class="dim">Best ${best}</div>` : ""}
        <div class="rows">
          ${row("Touchdown rate", `${Math.round(Math.abs(s.vsFpm))} fpm`, r.parts.vs)}
          ${row("G-force", `${s.gPeak.toFixed(2)} g`, r.parts.g)}
          ${row("Centreline", `${Math.abs(s.centerline).toFixed(1)} m ${s.centerline > 0.5 ? "R" : s.centerline < -0.5 ? "L" : ""}`, r.parts.centerline)}
          ${row("Aim point", `${s.fromAim >= 0 ? "+" : ""}${Math.round(s.fromAim)} m`, r.parts.zone)}
          ${row("Bank / crab", `${Math.abs(s.bankDeg).toFixed(1)}° / ${Math.abs(s.crabDeg).toFixed(1)}°`, r.parts.attitude)}
          ${row("Bounce", s.bounced ? "Yes" : "None", r.parts.bounce)}
        </div>
        ${s.onRunway ? "" : `<div class="warn">Landed off the runway</div>`}
        <div class="actions">
          <button data-card="approach">Another approach</button>
          <button data-card="runway">Restart</button>
          <button data-card="close">Keep rolling</button>
        </div>
      </div>`;
    this.show("card", true);
    const span = card.querySelector("[data-count]") as HTMLElement;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 900);
      span.textContent = String(Math.round(r.score * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  showCrash(reason: CrashReason): void {
    const card = this.$("[data-k=card]");
    card.innerHTML = html`
      <div class="card-inner landing">
        <div class="grade" style="color:${GRADE_COLORS.CRASH}">CRASH</div>
        <p>${CRASH_TEXT[reason]}</p>
        <div class="actions">
          <button data-card="rewind">Rewind 10 s</button>
          <button data-card="approach">Try the approach</button>
          <button data-card="runway">Restart</button>
        </div>
      </div>`;
    this.show("card", true);
  }

  /** Card buttons (landing / crash) → handler. */
  onCard(cb: (action: string) => void): void {
    this.$("[data-k=card]").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("[data-card]") as HTMLElement | null;
      if (b) cb(b.dataset.card!);
    });
  }
}
