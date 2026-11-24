/* Procedural canvas textures (no image downloads for the P0 world). */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from "three";
import type { Runway } from "../world/WorldProvider";

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function finish(c: HTMLCanvasElement, repeat = true): Texture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Farmland patchwork, one tile = 2 km. Fields are drawn so the tile repeats seamlessly. */
export function fieldsTexture(): Texture {
  const S = 1024;
  const [c, g] = canvas(S, S);
  const r = rng(7);
  const palette = ["#5f7d3a", "#6b8a3f", "#7a8f45", "#8c9a52", "#a39a5c", "#58733a", "#4f6a35", "#93a35e", "#7d6b46", "#6e8c4a"];
  g.fillStyle = "#62803c";
  g.fillRect(0, 0, S, S);
  // grid of irregular fields; draw each 9 times offset by the tile size so edges wrap
  const cells = 9;
  const cs = S / cells;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const splits = 1 + Math.floor(r() * 3);
      for (let k = 0; k < splits; k++) {
        const x = i * cs + (k * cs) / splits + 2, y = j * cs + 2;
        const w = cs / splits - 4, h = cs - 4;
        g.fillStyle = palette[Math.floor(r() * palette.length)];
        g.fillRect(x, y, w, h);
        // crop rows
        g.globalAlpha = 0.12;
        g.strokeStyle = "#2c3a1c";
        const vertical = r() > 0.5;
        for (let s = 3; s < (vertical ? w : h); s += 5) {
          g.beginPath();
          if (vertical) { g.moveTo(x + s, y); g.lineTo(x + s, y + h); }
          else { g.moveTo(x, y + s); g.lineTo(x + w, y + s); }
          g.stroke();
        }
        g.globalAlpha = 1;
      }
    }
  }
  // hedgerows / tracks
  g.strokeStyle = "rgba(55,70,35,0.8)";
  g.lineWidth = 2;
  for (let i = 0; i <= cells; i++) {
    g.beginPath(); g.moveTo(i * cs, 0); g.lineTo(i * cs, S); g.stroke();
    g.beginPath(); g.moveTo(0, i * cs); g.lineTo(S, i * cs); g.stroke();
  }
  // speckle
  const img = g.getImageData(0, 0, S, S);
  for (let p = 0; p < img.data.length; p += 4) {
    const n = (r() - 0.5) * 18;
    img.data[p] += n; img.data[p + 1] += n; img.data[p + 2] += n;
  }
  g.putImageData(img, 0, 0);
  return finish(c);
}

/** Tileable multi-octave value noise (grey, mean ≈ 0.55). The terrain shader uses it for colour
   variation and, through its gradient, as a fake bump map. */
export function detailTexture(): Texture {
  const S = 256;
  const [c, g] = canvas(S, S);
  const img = g.createImageData(S, S);
  const r = rng(3);
  const acc = new Float32Array(S * S);
  let amp = 1, norm = 0;
  for (const cells of [4, 8, 16, 32, 64, 128]) {
    const grid = new Float32Array(cells * cells).map(() => r());
    const cs = S / cells;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const gx = x / cs, gy = y / cs;
        const x0 = Math.floor(gx), y0 = Math.floor(gy);
        let tx = gx - x0, ty = gy - y0;
        tx = tx * tx * (3 - 2 * tx);
        ty = ty * ty * (3 - 2 * ty);
        const v = (ix: number, iy: number) => grid[((iy % cells) * cells) + (ix % cells)];
        const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * tx;
        const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * tx;
        acc[y * S + x] += (a + (b - a) * ty) * amp;
      }
    }
    norm += amp;
    amp *= 0.62;
  }
  for (let i = 0; i < S * S; i++) {
    const v = Math.max(0, Math.min(255, (acc[i] / norm - 0.5) * 1.8 * 255 + 140));
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new CanvasTexture(c); // linear data (used as a multiplier / height), not sRGB colour
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Runway markings for a runway of the given size. Canvas bottom = landing threshold. */
export function runwayTexture(rwy: Runway, recipName: string): Texture {
  const W = 256, H = 4096;
  const [c, g] = canvas(W, H);
  const sx = W / rwy.width, sy = H / rwy.length;
  const r = rng(11);
  g.fillStyle = "#3b3e43";
  g.fillRect(0, 0, W, H);
  const img = g.getImageData(0, 0, W, H);
  for (let p = 0; p < img.data.length; p += 4) {
    const n = (r() - 0.5) * 22;
    img.data[p] += n; img.data[p + 1] += n; img.data[p + 2] += n;
  }
  g.putImageData(img, 0, 0);
  // tyre marks near both touchdown zones
  g.fillStyle = "rgba(20,20,22,0.35)";
  for (const base of [rwy.aimPoint, rwy.length - rwy.aimPoint]) {
    for (let k = 0; k < 40; k++) {
      const along = base + (r() - 0.5) * 300;
      const cross = (r() - 0.5) * 8;
      g.fillRect((rwy.width / 2 + cross) * sx - 3, H - along * sy, 6, 30 + r() * 60);
    }
  }
  const rect = (cross: number, along: number, w: number, l: number) =>
    g.fillRect((rwy.width / 2 + cross - w / 2) * sx, H - (along + l) * sy, w * sx, l * sy);
  g.fillStyle = "#f2f2ee";
  // edge lines
  rect(-rwy.width / 2 + 0.6, 0, 0.9, rwy.length);
  rect(rwy.width / 2 - 0.6, 0, 0.9, rwy.length);
  // centreline dashes 30 m + 20 m gap, between the numbers
  for (let a = 60; a < rwy.length - 60; a += 50) rect(0, a, 0.9, 30);
  for (const end of [0, 1]) {
    const at = (a: number, l: number) => (end === 0 ? a : rwy.length - a - l);
    // threshold piano keys
    for (let k = -3.5; k <= 3.5; k++) if (Math.abs(k) > 0.4) rect(k * 3.2, at(6, 30), 1.8, 30);
    // aim point blocks and touchdown zone marks
    rect(-6, at(rwy.aimPoint, 45), 4, 45);
    rect(6, at(rwy.aimPoint, 45), 4, 45);
    for (const d of [150, 450, 600]) {
      rect(-6, at(d, 22), 1.8, 22); rect(-8.5, at(d, 22), 1.8, 22);
      rect(6, at(d, 22), 1.8, 22); rect(8.5, at(d, 22), 1.8, 22);
    }
  }
  // designators
  const num = (text: string, along: number, flip: boolean) => {
    g.save();
    g.translate(W / 2, H - along * sy);
    if (flip) g.rotate(Math.PI);
    // canvas pixels are not square in metres (sx ≠ sy): pre-squash so glyphs come out tall and
    // narrow on the ground like real runway numbers (~18 m × 6 m)
    g.scale(1, (sy / sx) * 1.7);
    g.font = "bold 92px Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "bottom";
    g.fillText(text, 0, 0);
    g.restore();
  };
  num(rwy.name, 45, false);
  num(recipName, rwy.length - 45, true);
  const t = finish(c, false);
  t.anisotropy = 16;
  return t;
}

/** Mown grass strip with white edge markers and threshold bars. */
export function grassRunwayTexture(rwy: Runway): Texture {
  const W = 128, H = 2048;
  const [c, g] = canvas(W, H);
  const sx = W / rwy.width, sy = H / rwy.length;
  const r = rng(13);
  g.fillStyle = "#6f9645";
  g.fillRect(0, 0, W, H);
  // mower stripes along the strip
  for (let k = 0; k < 6; k++) {
    g.fillStyle = k % 2 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
    g.fillRect((k * W) / 6, 0, W / 6, H);
  }
  // worn wheel tracks
  g.fillStyle = "rgba(120,100,60,0.35)";
  g.fillRect(W / 2 - 2.2 * sx, 0, 1.2 * sx, H);
  g.fillRect(W / 2 + 1.0 * sx, 0, 1.2 * sx, H);
  const img = g.getImageData(0, 0, W, H);
  for (let p = 0; p < img.data.length; p += 4) {
    const n = (r() - 0.5) * 26;
    img.data[p] += n; img.data[p + 1] += n; img.data[p + 2] += n * 0.5;
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = "#f4f4ef";
  for (let a = 0; a < rwy.length; a += 60) {
    g.fillRect(1, H - (a + 3) * sy, 1.2 * sx, 3 * sy);
    g.fillRect(W - 1 - 1.2 * sx, H - (a + 3) * sy, 1.2 * sx, 3 * sy);
  }
  for (const at of [4, rwy.length - 8]) {
    for (let k = -2; k <= 2; k++) g.fillRect(W / 2 + k * 3.5 * sx - 0.8 * sx, H - (at + 4) * sy, 1.6 * sx, 4 * sy);
  }
  return finish(c, false);
}

/** Soft round glow for light sprites. */
export function glowTexture(): Texture {
  const S = 64;
  const [c, g] = canvas(S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.8)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return finish(c, false);
}
