/* Adaptive HUD contrast: a few times a second, copy the rendered frame into a tiny canvas,
   measure the brightness behind each registered HUD element, and switch that element to dark
   marks over bright sky / runway or light marks over dark ground / sea. Hysteresis stops it
   flickering at the threshold. Must be called right after renderer.render() in the same frame
   (the WebGL drawing buffer is still intact then). */
import type { Tone } from "./instruments";

interface Target {
  el: HTMLElement;
  apply: (t: Tone) => void;
  tone: Tone;
}

const W = 160, H = 90;
const TO_DARK = 0.6; // average luminance above which marks turn dark
const TO_LIGHT = 0.48; // …and below which they turn light again

export class AdaptiveContrast {
  private targets: Target[] = [];
  private small = document.createElement("canvas");
  private g: CanvasRenderingContext2D;
  private last = 0;

  constructor(private source: HTMLCanvasElement) {
    this.small.width = W;
    this.small.height = H;
    this.g = this.small.getContext("2d", { willReadFrequently: true })!;
  }

  /** `apply` defaults to setting data-tone on the element (CSS does the rest). */
  register(el: HTMLElement, apply?: (t: Tone) => void): void {
    const t: Target = { el, tone: "light", apply: apply ?? ((tone) => (el.dataset.tone = tone)) };
    t.apply("light");
    this.targets.push(t);
  }

  update(now: number): void {
    if (now - this.last < 250) return;
    this.last = now;
    const vw = window.innerWidth, vh = window.innerHeight;
    try {
      this.g.drawImage(this.source, 0, 0, W, H);
    } catch {
      return;
    }
    const data = this.g.getImageData(0, 0, W, H).data;
    for (const t of this.targets) {
      const r = t.el.getBoundingClientRect();
      if (!r.width || !r.height) continue; // hidden elements have an empty box
      const x0 = Math.max(0, Math.floor((r.left / vw) * W)), x1 = Math.min(W - 1, Math.ceil((r.right / vw) * W));
      const y0 = Math.max(0, Math.floor((r.top / vh) * H)), y1 = Math.min(H - 1, Math.ceil((r.bottom / vh) * H));
      let sum = 0, n = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const k = (y * W + x) * 4;
          // perceived luminance of the (already sRGB) pixel
          sum += (0.2126 * data[k] + 0.7152 * data[k + 1] + 0.0722 * data[k + 2]) / 255;
          n++;
        }
      }
      if (!n) continue;
      const lum = sum / n;
      const next: Tone = t.tone === "light" ? (lum > TO_DARK ? "dark" : "light") : (lum < TO_LIGHT ? "light" : "dark");
      if (next !== t.tone) {
        t.tone = next;
        t.apply(next);
      }
    }
  }
}
