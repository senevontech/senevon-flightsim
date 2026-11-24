/* Handling qualities: keyboard-style step inputs through the assist layer.
   These lock in "how the controls feel" so tuning changes can't silently make them worse. */
import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { AircraftSim, SIM_DT } from "../aircraft";
import { Assists, type AssistPreset } from "../assists";
import { emptyControls, KT, type Controls } from "../types";
import { AIRCRAFT } from "../../aircraft";
import { FlatWorld } from "../../world/flat/FlatWorld";

declare const process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } };
const LOG = !!process.env.FLIGHT_LOG;
const log = (...a: unknown[]) => LOG && process.stderr.write(a.join(" ") + "\n");

interface Trace { t: number; bank: number; pitch: number; alt: number; g: number; stall: number; ias: number }

/** Fly for `seconds` with `input(t)` giving the raw pilot input (keyboard-like ramps applied). */
function fly(preset: AssistPreset, seconds: number, input: (t: number, raw: Controls) => void, speedKt = 100, throttle = 0.65) {
  const sim = new AircraftSim(AIRCRAFT["sparrow-s1"], new FlatWorld());
  sim.reset({ pos: new Vector3(0, 800, 0), headingDeg: 0, speed: speedKt * KT, pitchDeg: 1 });
  const assists = new Assists();
  assists.preset = preset;
  const raw = emptyControls();
  const target = emptyControls();
  const out = emptyControls();
  raw.throttle = target.throttle = throttle;
  const trace: Trace[] = [];
  // let the aircraft settle on its trimmed state first
  const settle = 6;
  for (let i = 0; i < Math.round((seconds + settle) / SIM_DT); i++) {
    const t = i * SIM_DT - settle;
    target.pitch = target.roll = target.yaw = 0;
    if (t >= 0) input(t, target);
    // keyboard ramp, as in InputManager (full deflection in ~0.4 s)
    for (const k of ["pitch", "roll", "yaw"] as const) {
      const d = target[k] - raw[k];
      raw[k] += Math.max(-2.6 * SIM_DT, Math.min(2.6 * SIM_DT, d));
    }
    raw.throttle = target.throttle;
    assists.apply(raw, sim, SIM_DT, out);
    sim.step(SIM_DT, out);
    if (sim.crashed) throw new Error("crashed: " + sim.crashed);
    if (t >= 0 && i % 6 === 0) trace.push({ t, bank: sim.bankDeg, pitch: sim.pitchDeg, alt: sim.pos.y, g: sim.gLoad, stall: sim.wingStall, ias: sim.ias / KT });
  }
  return trace;
}

const window_ = (tr: Trace[], a: number, b: number) => tr.filter((p) => p.t >= a && p.t <= b);
const max = (xs: number[]) => Math.max(...xs);
const min = (xs: number[]) => Math.min(...xs);

describe("EASY handling", () => {
  it("flies straight and level hands-off", () => {
    const tr = fly("easy", 30, () => {});
    const banks = tr.map((p) => Math.abs(p.bank));
    const alt = tr.map((p) => p.alt);
    log("easy hands-off: max bank", max(banks).toFixed(1), "alt drift", (max(alt) - min(alt)).toFixed(1));
    expect(max(banks)).toBeLessThan(3);
    expect(max(alt) - min(alt)).toBeLessThan(60);
  });

  it("banks to ~50° on full roll and levels itself on release without wobble", () => {
    const tr = fly("easy", 12, (t, r) => { r.roll = t < 4 ? 1 : 0; });
    const held = window_(tr, 2.5, 4).map((p) => p.bank);
    const after = window_(tr, 4, 12).map((p) => p.bank);
    const levelAt = window_(tr, 4, 12).find((p) => Math.abs(p.bank) < 3)?.t ?? 99;
    log("easy roll: held", min(held).toFixed(1), "-", max(held).toFixed(1), "overshoot past level", min(after).toFixed(1), "level after", (levelAt - 4).toFixed(2), "s");
    expect(min(held)).toBeGreaterThan(42);
    expect(max(held)).toBeLessThan(56);
    expect(levelAt - 4).toBeLessThan(3.5);
    expect(min(after)).toBeGreaterThan(-4); // no swing to the other side
  });

  it("pitch input moves the nose at a steady rate and it stays put after release", () => {
    const tr = fly("easy", 10, (t, r) => { r.pitch = t < 1.5 ? 1 : 0; });
    const start = tr[0].pitch;
    const atRelease = window_(tr, 1.4, 1.6)[0].pitch;
    const hold = window_(tr, 2.5, 8).map((p) => p.pitch);
    log("easy pitch: +", (atRelease - start).toFixed(1), "deg in 1.5 s; hold range", min(hold).toFixed(1), "-", max(hold).toFixed(1));
    expect(atRelease - start).toBeGreaterThan(5);
    expect(atRelease - start).toBeLessThan(15);
    expect(max(hold) - min(hold)).toBeLessThan(3);
  });

  it("a sustained turn keeps its altitude without pulling", () => {
    const tr = fly("easy", 25, (_t, r) => { r.roll = 0.75; });
    const alt = window_(tr, 5, 25).map((p) => p.alt);
    log("easy turn: alt range", (max(alt) - min(alt)).toFixed(1), "bank", tr[tr.length - 1].bank.toFixed(1));
    expect(max(alt) - min(alt)).toBeLessThan(60);
  });

  it("holding full back stick does not stall or over-g", () => {
    const tr = fly("easy", 15, (_t, r) => { r.pitch = 1; });
    log("easy full pull: max stall", max(tr.map((p) => p.stall)).toFixed(2), "max g", max(tr.map((p) => p.g)).toFixed(2), "min ias", min(tr.map((p) => p.ias)).toFixed(0));
    expect(max(tr.map((p) => p.stall))).toBeLessThan(0.25);
    expect(max(tr.map((p) => p.g))).toBeLessThan(2.6);
  });
});

describe("NORMAL handling", () => {
  it("roll input sets a bank that is held after release", () => {
    const tr = fly("normal", 12, (t, r) => { r.roll = t < 1 ? 1 : 0; });
    const peak = max(window_(tr, 0, 2).map((p) => p.bank));
    const held = window_(tr, 2.5, 12).map((p) => p.bank);
    log("normal roll: peak", peak.toFixed(1), "held", min(held).toFixed(1), "-", max(held).toFixed(1));
    expect(peak).toBeGreaterThan(25);
    expect(max(held) - min(held)).toBeLessThan(8);
  });

  it("full back stick at low speed is guarded from a hard stall", () => {
    const tr = fly("normal", 12, (_t, r) => { r.pitch = 1; }, 70, 0.3);
    log("normal slow pull: max stall", max(tr.map((p) => p.stall)).toFixed(2));
    expect(max(tr.map((p) => p.stall))).toBeLessThan(0.5);
  });
});

describe("REAL handling", () => {
  it("responds directly and survives a roll input", () => {
    const tr = fly("real", 6, (t, r) => { r.roll = t < 1 ? 1 : 0; });
    log("real roll: bank after 1 s", window_(tr, 0.9, 1.1)[0].bank.toFixed(1));
    expect(window_(tr, 0.9, 1.1)[0].bank).toBeGreaterThan(15);
  });
});

describe("TAXI handling", () => {
  function taxi(preset: AssistPreset, input: Partial<Controls>, seconds = 5) {
    const sim = new AircraftSim(AIRCRAFT["sparrow-s1"], new FlatWorld());
    sim.reset({ pos: new Vector3(0, sim.restHeight, 0), headingDeg: 0, speed: 0 });
    const a = new Assists();
    a.preset = preset;
    const raw = emptyControls();
    const out = emptyControls();
    raw.throttle = 0.35;
    for (let i = 0; i < 120 * 6; i++) { a.apply(raw, sim, SIM_DT, out); sim.step(SIM_DT, out); }
    const h0 = sim.headingDeg;
    Object.assign(raw, input);
    for (let i = 0; i < 120 * seconds; i++) { a.apply(raw, sim, SIM_DT, out); sim.step(SIM_DT, out); }
    return ((sim.headingDeg - h0 + 540) % 360) - 180;
  }

  for (const preset of ["easy", "normal", "real"] as const) {
    it(`${preset}: bank input (A/D, phone stick) steers the nose wheel`, () => {
      expect(taxi(preset, { roll: 1 })).toBeGreaterThan(60);
      expect(taxi(preset, { roll: -1 })).toBeLessThan(-60);
    });
  }

  it("rudder (Q/E) steers", () => {
    expect(taxi("easy", { yaw: 1 })).toBeGreaterThan(60);
  });

  it("taxis straight with no input", () => {
    expect(Math.abs(taxi("easy", {}, 8))).toBeLessThan(3);
  });
});
