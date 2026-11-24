/* Aerial perspective for every material, by replacing three.js's fog shader chunks once at start-up.

   - Height fog: haze is densest at sea level and thins with altitude (scale height ~1.1 km), so
     a mountain top above the haze layer stays crisp while the valley below is milky, and the
     ground seen from high up is veiled by the lower air only. The optical depth along the view
     ray is integrated analytically (exponential density), then fog = 1 − e^(−τ).
   - Sun glow: haze toward the sun is brighter and takes the sun's colour (golden at sunset).
     Lit materials read the sun from three's first directional light; unlit ones get plain haze.

   scene.fog stays a FogExp2: its colour is the haze colour and its density is the sea-level
   extinction per metre (≈ 3 / visibility). */
import { ShaderChunk } from "three";

/** Scale height of the haze layer, metres. */
export const HAZE_SCALE_HEIGHT = 1100;

let installed = false;

export function installHaze(): void {
  if (installed) return;
  installed = true;

  ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogView;
#endif
`;

  ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogView = mvPosition.xyz;
#endif
`;

  ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogView;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif
`;

  // lit materials: flag that the sun (directional light 0) is available to the fog
  ShaderChunk.lights_pars_begin += /* glsl */ `
#if NUM_DIR_LIGHTS > 0
  #define FOG_SUN_LIT
#endif
`;

  ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
  {
    // camera → fragment in world space (view-space vector rotated back by the view matrix)
    vec3 fogRel = (vec4(vFogView, 0.0) * viewMatrix).xyz;
    float fogDist = length(fogRel);
    vec3 fogDir = fogRel / max(fogDist, 0.001);
    float fogK = fogRel.y / ${HAZE_SCALE_HEIGHT.toFixed(1)};
    float fogInt = abs(fogK) > 0.001 ? (1.0 - exp(-fogK)) / fogK : 1.0 - 0.5 * fogK;
    float fogTau = fogDensity * fogDist * exp(-max(cameraPosition.y, 0.0) / ${HAZE_SCALE_HEIGHT.toFixed(1)}) * fogInt;
    float fogFactor = 1.0 - exp(-fogTau);
    vec3 fogCol = fogColor;
    #ifdef FOG_SUN_LIT
      vec3 fogSun = normalize((vec4(directionalLights[0].direction, 0.0) * viewMatrix).xyz);
      float fogMu = max(dot(fogDir, fogSun), 0.0);
      fogCol += directionalLights[0].color * (0.045 * pow(fogMu, 6.0) + 0.07 * pow(fogMu, 40.0));
    #endif
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, fogFactor);
  }
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
  #endif
#endif
`;
}

/** Sea-level extinction (per metre) for a visibility in km. */
export const hazeDensity = (visibilityKm: number) => 2.6 / (visibilityKm * 1000);

/** Fraction of haze between two points (for tests / CPU-side checks); mirrors the shader. */
export function hazeFactor(density: number, camY: number, dy: number, dist: number): number {
  const k = dy / HAZE_SCALE_HEIGHT;
  const int = Math.abs(k) > 0.001 ? (1 - Math.exp(-k)) / k : 1 - 0.5 * k;
  const tau = density * dist * Math.exp(-Math.max(camY, 0) / HAZE_SCALE_HEIGHT) * int;
  return 1 - Math.exp(-tau);
}
