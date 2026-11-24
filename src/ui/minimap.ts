/* Moving map (north up): island map rendered once in a worker, airports with runway lines and
   ids, the aircraft at the centre, and a range ring. Tap/click toggles a larger, zoomed-out view. */
import type { Airport } from "../world/WorldProvider";
import type { MapRequest, MapResult } from "../workers/terrain.worker";

const EXTENT = 60000; // metres covered by the map image

export class Minimap {
  readonly el = document.createElement("div");
  private canvas = document.createElement("canvas");
  private g = this.canvas.getContext("2d")!;
  private img: HTMLCanvasElement | null = null;
  private last = 0;
  expanded = false;

  constructor(private airports: Airport[]) {
    this.el.className = "minimap";
    this.el.innerHTML = `<div class="map-label">MAP</div>`;
    this.el.prepend(this.canvas);
    this.el.addEventListener("click", () => this.toggle());
    const w = new Worker(new URL("../workers/terrain.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<MapResult>) => {
      const { size, pixels } = e.data;
      const c = document.createElement("canvas");
      c.width = c.height = size;
      c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels), size, size), 0, 0);
      this.img = c;
      w.terminate();
    };
    const req: MapRequest = { kind: "map", id: 0, size: 512, extent: EXTENT };
    w.postMessage(req);
  }

  toggle(): void {
    this.expanded = !this.expanded;
    this.el.classList.toggle("expanded", this.expanded);
  }

  draw(x: number, z: number, headingDeg: number, now: number): void {
    if (now - this.last < 66) return;
    this.last = now;
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (!W || !H) return;
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    const g = this.g;
    const range = this.expanded ? 22000 : 9000; // metres from centre to edge
    const ppm = (Math.min(W, H) / 2) / range; // pixels per metre
    g.fillStyle = "#0b3a62";
    g.fillRect(0, 0, W, H);
    if (this.img) {
      const s = this.img.width / EXTENT; // image px per metre
      const sx = (x + EXTENT / 2) * s - (W / 2 / ppm) * s;
      const sz = (z + EXTENT / 2) * s - (H / 2 / ppm) * s;
      g.imageSmoothingEnabled = true;
      g.drawImage(this.img, sx, sz, (W / ppm) * s, (H / ppm) * s, 0, 0, W, H);
    }
    const toPx = (wx: number, wz: number): [number, number] => [W / 2 + (wx - x) * ppm, H / 2 + (wz - z) * ppm];
    // airports
    g.font = `600 ${Math.round(11 * dpr)}px system-ui, sans-serif`;
    g.textAlign = "left";
    g.textBaseline = "middle";
    for (const a of this.airports) {
      const rw = a.runways[0];
      const h = (rw.headingDeg * Math.PI) / 180;
      const [x0, y0] = toPx(rw.threshold.x, rw.threshold.z);
      const [x1, y1] = toPx(rw.threshold.x + Math.sin(h) * rw.length, rw.threshold.z - Math.cos(h) * rw.length);
      g.strokeStyle = "rgba(0,0,0,0.5)";
      g.lineWidth = 5 * dpr;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
      g.strokeStyle = rw.surface === "grass" ? "#b9e08a" : "#ffffff";
      g.lineWidth = 2.5 * dpr;
      g.stroke();
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      g.fillStyle = "#ff7a1a";
      g.beginPath();
      g.arc(mx, my, 3 * dpr, 0, Math.PI * 2);
      g.fill();
      const label = this.expanded ? `${a.id} ${a.name}` : a.id;
      g.fillStyle = "rgba(0,0,0,0.55)";
      const tw = g.measureText(label).width;
      g.fillRect(mx + 6 * dpr, my - 8 * dpr, tw + 8 * dpr, 16 * dpr);
      g.fillStyle = "#fff";
      g.fillText(label, mx + 10 * dpr, my);
    }
    // range ring
    g.strokeStyle = "rgba(255,255,255,0.25)";
    g.lineWidth = 1 * dpr;
    g.setLineDash([4 * dpr, 4 * dpr]);
    g.beginPath();
    g.arc(W / 2, H / 2, (range / 2) * ppm, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    // aircraft
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate((headingDeg * Math.PI) / 180);
    const s = 9 * dpr;
    g.fillStyle = "#ff7a1a";
    g.strokeStyle = "#fff";
    g.lineWidth = 1.5 * dpr;
    g.beginPath();
    g.moveTo(0, -s);
    g.lineTo(s * 0.7, s * 0.8);
    g.lineTo(0, s * 0.4);
    g.lineTo(-s * 0.7, s * 0.8);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    // north marker + scale
    g.fillStyle = "#fff";
    g.font = `700 ${Math.round(11 * dpr)}px system-ui, sans-serif`;
    g.textAlign = "center";
    g.fillText("N", W / 2, 10 * dpr);
    g.textAlign = "right";
    g.fillStyle = "rgba(255,255,255,0.75)";
    g.fillText(`${((range / 2) / 1852).toFixed(1)} nm`, W - 6 * dpr, H - 9 * dpr);
  }
}
