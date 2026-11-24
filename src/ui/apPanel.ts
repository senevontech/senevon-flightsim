/* Autopilot panel (shown while the autopilot is on): mode buttons, selected values with
   hold-to-repeat − / + buttons, and annunciations (active modes green, armed modes white). */

export type ApAction =
  | "ap" | "hdg" | "nav" | "apr" | "at"
  | "hdg-" | "hdg+" | "alt-" | "alt+" | "vs-" | "vs+" | "spd-" | "spd+";

export interface ApPanelState {
  lateralAnn: string;
  verticalAnn: string;
  lateral: "hdg" | "nav" | "apr";
  hdg: number;
  altFt: number;
  vsFpm: number;
  ias: number;
  at: boolean;
}

export class ApPanel {
  readonly el = document.createElement("div");
  private cb: ((a: ApAction) => void) | null = null;
  private repeat = 0;
  private repeatDelay = 0;
  private last = "";

  constructor() {
    this.el.className = "ap-panel hidden";
    this.el.innerHTML = `
      <div class="ap-ann"><span class="ap-mode" data-p="lat"></span><span class="ap-mode" data-p="ver"></span></div>
      <div class="ap-row">
        <button class="ap-btn on" data-a="ap" title="Autopilot on/off (J)">AP</button>
        <div class="ap-group">
          <button class="ap-btn" data-a="hdg">HDG</button>
          <button class="ap-step" data-a="hdg-">−</button><b data-p="hdg">000°</b><button class="ap-step" data-a="hdg+">+</button>
        </div>
        <div class="ap-group">
          <span class="ap-lbl">ALT</span>
          <button class="ap-step" data-a="alt-">−</button><b data-p="alt">0</b><button class="ap-step" data-a="alt+">+</button>
        </div>
        <div class="ap-group">
          <span class="ap-lbl">VS</span>
          <button class="ap-step" data-a="vs-">−</button><b data-p="vs">0</b><button class="ap-step" data-a="vs+">+</button>
        </div>
        <div class="ap-group">
          <button class="ap-btn" data-a="at" title="Autothrottle">SPD</button>
          <button class="ap-step" data-a="spd-">−</button><b data-p="spd">0</b><button class="ap-step" data-a="spd+">+</button>
        </div>
        <button class="ap-btn" data-a="nav" title="Fly to the nearest airport's approach, then arm APR">NAV</button>
        <button class="ap-btn" data-a="apr" title="Runway centreline + 3° glide path to minimums">APR</button>
      </div>`;
    for (const b of this.el.querySelectorAll<HTMLButtonElement>("button[data-a]")) {
      const a = b.dataset.a as ApAction;
      const stepper = a.endsWith("-") || a.endsWith("+");
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.cb?.(a);
        if (!stepper) return;
        // hold to repeat: first after 400 ms, then every 90 ms
        this.stopRepeat();
        this.repeatDelay = window.setTimeout(() => {
          this.repeat = window.setInterval(() => this.cb?.(a), 90);
        }, 400);
      });
    }
    for (const ev of ["pointerup", "pointercancel", "pointerleave"]) this.el.addEventListener(ev, () => this.stopRepeat());
  }

  private stopRepeat(): void {
    clearTimeout(this.repeatDelay);
    clearInterval(this.repeat);
  }

  onAction(cb: (a: ApAction) => void): void {
    this.cb = cb;
  }

  show(on: boolean): void {
    this.el.classList.toggle("hidden", !on);
    if (!on) this.stopRepeat();
  }

  render(s: ApPanelState): void {
    const key = JSON.stringify(s);
    if (key === this.last) return;
    this.last = key;
    const q = (k: string) => this.el.querySelector(`[data-p=${k}]`) as HTMLElement;
    const ann = (el: HTMLElement, text: string) => {
      el.textContent = text.replace("*", "");
      el.classList.toggle("armed", text.endsWith("*"));
    };
    ann(q("lat"), s.lateralAnn);
    ann(q("ver"), s.verticalAnn);
    q("hdg").textContent = `${String(Math.round(s.hdg) % 360 || 360).padStart(3, "0")}°`;
    q("alt").textContent = Math.round(s.altFt).toLocaleString("en-US");
    q("vs").textContent = `${s.vsFpm > 0 ? "+" : ""}${s.vsFpm}`;
    q("spd").textContent = `${Math.round(s.ias)}`;
    const btn = (a: string) => this.el.querySelector(`[data-a=${a}]`) as HTMLElement;
    btn("hdg").classList.toggle("on", s.lateral === "hdg");
    btn("nav").classList.toggle("on", s.lateral === "nav");
    btn("apr").classList.toggle("on", s.lateral === "apr");
    btn("at").classList.toggle("on", s.at);
  }
}
