/* Minimal synthesized sound (P0): engine drone following rpm, wind with airspeed, stall horn,
   tyre chirp on touchdown. Real recorded layers replace this in P2. Starts on first user input
   (browsers block audio until then). */
import type { AircraftSim } from "../sim/aircraft";

export class FlightAudio {
  private ctx: AudioContext | null = null;
  private engA!: OscillatorNode;
  private engB!: OscillatorNode;
  private engGain!: GainNode;
  private engFilter!: BiquadFilterNode;
  /** Turbine whine (turboprops and jets). */
  private whine!: OscillatorNode;
  private whineGain!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private horn!: GainNode;
  private rainGain!: GainNode;
  private noise!: AudioBuffer;
  rain = 0;
  private master!: GainNode;
  private wasGround = true;
  muted = false;

  constructor() {
    const start = () => {
      this.init();
      window.removeEventListener("keydown", start);
      window.removeEventListener("pointerdown", start);
    };
    window.addEventListener("keydown", start);
    window.addEventListener("pointerdown", start);
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = last * 0.97 + (Math.random() * 2 - 1) * 0.03; // brown-ish
      d[i] = last * 8;
    }
    return b;
  }

  private init(): void {
    if (this.ctx) return;
    try {
      const ctx = (this.ctx = new AudioContext());
      this.master = ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(ctx.destination);

      this.engFilter = ctx.createBiquadFilter();
      this.engFilter.type = "lowpass";
      this.engFilter.frequency.value = 500;
      this.engGain = ctx.createGain();
      this.engGain.gain.value = 0;
      this.engA = ctx.createOscillator();
      this.engA.type = "sawtooth";
      this.engB = ctx.createOscillator();
      this.engB.type = "square";
      this.engA.connect(this.engFilter);
      const bGain = ctx.createGain();
      bGain.gain.value = 0.35;
      this.engB.connect(bGain).connect(this.engFilter);
      this.engFilter.connect(this.engGain).connect(this.master);
      this.engA.start();
      this.engB.start();
      this.whine = ctx.createOscillator();
      this.whine.type = "sine";
      this.whineGain = ctx.createGain();
      this.whineGain.gain.value = 0;
      this.whine.connect(this.whineGain).connect(this.master);
      this.whine.start();

      this.noise = this.noiseBuffer(ctx);
      const noise = ctx.createBufferSource();
      noise.buffer = this.noise;
      noise.loop = true;
      this.windFilter = ctx.createBiquadFilter();
      this.windFilter.type = "bandpass";
      this.windFilter.Q.value = 0.6;
      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0;
      noise.connect(this.windFilter).connect(this.windGain).connect(this.master);
      noise.start();

      // rain: bright hiss
      const rainSrc = ctx.createBufferSource();
      rainSrc.buffer = this.noise;
      rainSrc.loop = true;
      rainSrc.playbackRate.value = 1.7;
      const rainF = ctx.createBiquadFilter();
      rainF.type = "highpass";
      rainF.frequency.value = 1800;
      this.rainGain = ctx.createGain();
      this.rainGain.gain.value = 0;
      rainSrc.connect(rainF).connect(this.rainGain).connect(this.master);
      rainSrc.start();

      const hornOsc = ctx.createOscillator();
      hornOsc.type = "square";
      hornOsc.frequency.value = 520;
      this.horn = ctx.createGain();
      this.horn.gain.value = 0;
      const hornF = ctx.createBiquadFilter();
      hornF.frequency.value = 1400;
      hornOsc.connect(hornF).connect(this.horn).connect(this.master);
      hornOsc.start();
    } catch {
      this.ctx = null;
    }
  }

  private chirp(strength: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(900, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12 * strength, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    const f = ctx.createBiquadFilter();
    f.frequency.value = 2000;
    o.connect(f).connect(g).connect(this.master);
    o.start();
    o.stop(ctx.currentTime + 0.25);
  }

  /** Autopilot-disconnect alert: three falling two-tone chirps. */
  chime(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    for (let k = 0; k < 3; k++) {
      const t0 = ctx.currentTime + k * 0.32;
      for (const [f, dt] of [[1250, 0], [940, 0.13]] as const) {
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0 + dt);
        g.gain.exponentialRampToValueAtTime(0.12, t0 + dt + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.12);
        o.connect(g).connect(this.master);
        o.start(t0 + dt);
        o.stop(t0 + dt + 0.14);
      }
    }
  }

  /** Rolling thunder after `delay` seconds. */
  thunder(delay: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.35;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 220;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.9, t0 + 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 3.5);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + 3.6);
  }

  update(sim: AircraftSim, stallWarning: number, interior: boolean, paused: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const on = !paused && !this.muted && !sim.crashed;
    this.master.gain.setTargetAtTime(on ? 0.5 : 0, t, 0.1);
    const e = sim.engines[0];
    const spool = sim.spool.reduce((a, b) => a + b, 0) / Math.max(1, sim.spool.length);
    const running = sim.rpm > (e.type === "jet" ? 5 : 100);
    if (e.type === "jet") {
      // turbofan: low rumble + a turbine whine that climbs with the spool
      this.engA.frequency.setTargetAtTime(38 + 50 * spool, t, 0.2);
      this.engB.frequency.setTargetAtTime(27 + 35 * spool, t, 0.2);
      this.engFilter.frequency.setTargetAtTime((interior ? 160 : 260) + 260 * spool, t, 0.2);
      this.engGain.gain.setTargetAtTime(running ? 0.1 + 0.2 * spool : 0, t, 0.3);
      this.whine.frequency.setTargetAtTime(1600 + 3600 * Math.pow(spool, 0.8), t, 0.3);
      this.whineGain.gain.setTargetAtTime(running ? (interior ? 0.012 : 0.03) * (0.5 + spool) : 0, t, 0.3);
    } else {
      // pistons: firing pulses (4-cyl: 2 per rev; big radials sound deeper);
      // turboprops: blade-pass buzz plus the turbine whine
      const pulses = e.type === "turboprop" ? 4 : e.power > 250000 ? 4.5 : 2;
      const fire = (sim.rpm / 60) * pulses;
      this.engA.frequency.setTargetAtTime(Math.max(fire, 8), t, 0.05);
      this.engB.frequency.setTargetAtTime(Math.max(fire * 0.5, 4), t, 0.05);
      this.engFilter.frequency.setTargetAtTime((interior ? 260 : 420) + (sim.rpm / e.maxRpm) * 680, t, 0.05);
      this.engGain.gain.setTargetAtTime(running ? 0.12 + 0.18 * (sim.rpm / e.maxRpm) : 0, t, 0.1);
      const turbine = e.type === "turboprop";
      this.whine.frequency.setTargetAtTime(2200 + 2600 * spool, t, 0.3);
      this.whineGain.gain.setTargetAtTime(turbine && running ? (interior ? 0.01 : 0.022) * (0.6 + spool) : 0, t, 0.3);
    }
    const v = sim.tas;
    this.windGain.gain.setTargetAtTime(Math.min(0.5, (v * v) / 9000) * (interior ? 0.5 : 1), t, 0.1);
    this.windFilter.frequency.setTargetAtTime(300 + v * 18, t, 0.1);
    this.horn.gain.setTargetAtTime(stallWarning > 0.5 && !sim.failures.electrical ? 0.06 : 0, t, 0.03);
    this.rainGain.gain.setTargetAtTime(this.rain * (interior ? 0.5 : 0.28), t, 0.3);
    if (sim.onGround && !this.wasGround && sim.vs < -0.3) this.chirp(Math.min(1, -sim.vs / 2));
    this.wasGround = sim.onGround;
  }
}
