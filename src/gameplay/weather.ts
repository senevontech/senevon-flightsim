/* Weather settings and presets. Pure data: the scene (clouds, haze, light, rain, lightning) and
   the sim (wind, gusts, turbulence) both read from one Weather object. */

export interface Weather {
  /** Fraction of cumulus puffs shown, 0..1. */
  cumulus: number;
  /** Overcast layer coverage, 0..1. */
  overcast: number;
  /** Visibility (km). */
  visibility: number;
  /** Rain intensity, 0..1. */
  rain: number;
  lightning: boolean;
  /** Wind direction (from, degrees) and speed / gust (knots). */
  windFrom: number;
  windKt: number;
  gustKt: number;
  /** Turbulence 0..1. */
  turbulence: number;
}

export type WeatherPreset = "clear" | "fair" | "scattered" | "overcast" | "rain" | "storm" | "fog";

export const WEATHER_PRESETS: Record<WeatherPreset, { name: string; w: Omit<Weather, "windFrom"> }> = {
  clear: { name: "Clear", w: { cumulus: 0.08, overcast: 0, visibility: 70, rain: 0, lightning: false, windKt: 5, gustKt: 2, turbulence: 0.08 } },
  fair: { name: "Fair", w: { cumulus: 0.35, overcast: 0, visibility: 55, rain: 0, lightning: false, windKt: 9, gustKt: 4, turbulence: 0.2 } },
  scattered: { name: "Scattered", w: { cumulus: 0.7, overcast: 0.15, visibility: 40, rain: 0, lightning: false, windKt: 12, gustKt: 6, turbulence: 0.3 } },
  overcast: { name: "Overcast", w: { cumulus: 0.55, overcast: 0.9, visibility: 22, rain: 0, lightning: false, windKt: 14, gustKt: 7, turbulence: 0.35 } },
  rain: { name: "Rain", w: { cumulus: 0.8, overcast: 1, visibility: 8, rain: 0.65, lightning: false, windKt: 17, gustKt: 9, turbulence: 0.5 } },
  storm: { name: "Storm", w: { cumulus: 1, overcast: 1, visibility: 4, rain: 1, lightning: true, windKt: 26, gustKt: 16, turbulence: 0.85 } },
  fog: { name: "Fog", w: { cumulus: 0.1, overcast: 0.5, visibility: 1.2, rain: 0, lightning: false, windKt: 3, gustKt: 1, turbulence: 0.05 } },
};

export const weatherFromPreset = (p: WeatherPreset, windFrom: number): Weather => ({ ...WEATHER_PRESETS[p].w, windFrom });

/** Short METAR-style line for the radio / HUD, e.g. "wind 110 at 9 gusting 14, visibility 40 km". */
export function weatherText(w: Weather): string {
  const dir = String(Math.round(w.windFrom / 10) * 10 || 360).padStart(3, "0");
  const gust = w.gustKt >= w.windKt * 0.4 + 3 ? ` gusting ${Math.round(w.windKt + w.gustKt)}` : "";
  const vis = w.visibility >= 10 ? `${Math.round(w.visibility)} km` : `${w.visibility.toFixed(1)} km`;
  return `wind ${dir} at ${Math.round(w.windKt)}${gust}, visibility ${vis}`;
}
