/* Adaptive HUD contrast: a few times a second, estimate the brightness behind each registered HUD
   element and switch it to dark marks over bright sky or light marks over dark ground and sea.
   Hysteresis stops it flickering at the threshold.

   The brightness comes from a probe (WorldScene.luminanceAt): it looks along the camera ray
   through the element and returns how bright the sky or ground there is for the current time
   and weather. Reading the rendered frame back from the GPU did the same job, but it made the
   main thread wait for the GPU: a 20–370 ms freeze every time it ran. */
import type { Tone } from "./instruments";

interface Target {
  el: HTMLElement;
  apply: (t: Tone) => void;
  tone: Tone;
}

/** Brightness (0 dark … 1 white, display space) behind a point given in normalised device
    coordinates (x right, y up, −1…1). */
export type LuminanceProbe = (ndcX: number, ndcY: number) => number;

const TO_DARK = 0.6; // average luminance above which marks turn dark
const TO_LIGHT = 0.48; // …and below which they turn light again
// sample points across each element (fractions of its box)
const SAMPLES: [number, number][] = [[0.5, 0.5], [0.2, 0.25], [0.8, 0.25], [0.2, 0.75], [0.8, 0.75]];

export class AdaptiveContrast {
  private targets: Target[] = [];
  private last = 0;

  constructor(private probe: LuminanceProbe) {}

  /** `apply` defaults to setting data-tone on the element (CSS does the rest). */
  register(el: HTMLElement, apply?: (t: Tone) => void): void {
    const t: Target = { el, tone: "light", apply: apply ?? ((tone) => (el.dataset.tone = tone)) };
    t.apply("light");
    this.targets.push(t);
  }

  update(now: number): void {
    if (now - this.last < 200) return;
    this.last = now;
    const vw = window.innerWidth, vh = window.innerHeight;
    for (const t of this.targets) {
      const r = t.el.getBoundingClientRect();
      if (!r.width || !r.height) continue; // hidden elements have an empty box
      let sum = 0;
      for (const [fx, fy] of SAMPLES) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        sum += this.probe((x / vw) * 2 - 1, 1 - (y / vh) * 2);
      }
      const lum = sum / SAMPLES.length;
      const next: Tone = t.tone === "light" ? (lum > TO_DARK ? "dark" : "light") : (lum < TO_LIGHT ? "light" : "dark");
      if (next !== t.tone) {
        t.tone = next;
        t.apply(next);
      }
    }
  }
}
