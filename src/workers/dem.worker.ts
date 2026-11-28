/* Elevation tile decoder for the real-world mode: fetches a Terrarium PNG (AWS Terrain Tiles),
   decodes it off the main thread and returns heights packed as Uint16 (see dem.ts). */
import { packHeight } from "../world/real/dem";

export interface DemRequest {
  id: number;
  url: string;
}
export interface DemResult {
  id: number;
  data?: Uint16Array;
  error?: string;
}

const SIZE = 256;
const canvas = new OffscreenCanvas(SIZE, SIZE);
const g = canvas.getContext("2d", { willReadFrequently: true })!;

self.onmessage = async (e: MessageEvent<DemRequest>) => {
  const { id, url } = e.data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    g.clearRect(0, 0, SIZE, SIZE);
    g.drawImage(bmp, 0, 0, SIZE, SIZE);
    bmp.close();
    const px = g.getImageData(0, 0, SIZE, SIZE).data;
    const out = new Uint16Array(SIZE * SIZE);
    for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = packHeight(px[p] * 256 + px[p + 1] + px[p + 2] / 256 - 32768);
    (self as unknown as Worker).postMessage({ id, data: out } satisfies DemResult, [out.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) } satisfies DemResult);
  }
};
