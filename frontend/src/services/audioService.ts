// Tactical Synthesized Web Audio Engine
import { NORMAL_VOLUME } from './radioVoice';

/** Sirena pultidagi 4 tugma */
export type SirenTone = 'A' | 'B' | 'C' | 'D';

export const SIREN_TONE_NAMES: Record<SirenTone, string> = {
  A: 'Wail (uzun)',
  B: 'Yelp (tez)',
  C: 'Hi-Lo (ikki tonli)',
  D: 'Phaser (keskin)'
};

const SIREN_PRESETS: Record<SirenTone, { center: number; depth: number; rate: number; lfoType: OscillatorType }> = {
  // Wail: 650 -> 1500 Hz, sikl ~4 s
  A: { center: 1075, depth: 425, rate: 0.25, lfoType: 'triangle' },
  // Yelp: 650 -> 1500 Hz, sikl ~0.3 s
  B: { center: 1075, depth: 425, rate: 3.3, lfoType: 'triangle' },
  // Hi-Lo: 650 / 1000 Hz, har biri ~0.45 s
  C: { center: 825, depth: 175, rate: 1.1, lfoType: 'square' },
  // Phaser: 900 -> 1700 Hz arra, ~12 Hz
  D: { center: 1300, depth: 400, rate: 12, lfoType: 'sawtooth' }
};

class TacticalAudioService {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private sirenOsc: OscillatorNode | null = null;

  private initCtx() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (muted && this.sirenOsc) {
      this.stopSiren();
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  // Taktik tugma bosilganda qisqa, aniq texnik chertish (click)
  public playClick() {
    if (this.isMuted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1200, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(400, this.ctx.currentTime + 0.04);
      gain.gain.setValueAtTime(0.12 * NORMAL_VOLUME, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.04);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.04);
    } catch {
      // Ignore audio failure
    }
  }

  // Buyruq jo'natilganda (Mecanum F, B, L, R va hk)
  public playCommandBeep() {
    if (this.isMuted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.1 * NORMAL_VOLUME, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.06);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.06);
    } catch {
      // Ignore
    }
  }

  // To'siq xavfi bo'lganda ogohlantirish (Sonar < 22cm)
  public playObstacleAlert() {
    if (this.isMuted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, this.ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(880, this.ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.18 * NORMAL_VOLUME, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.12);
    } catch {
      // Ignore
    }
  }

  /**
   * POLITSIYA SIRENASI: politsiya mashinasi sirena pultidagi kabi 4 xil ovoz (A, B, C, D).
   *   A  WAIL   — sekin ko'tarilib-tushuvchi uzun sirena (~4 s sikl)
   *   B  YELP   — tez "uv-uv" sirenasi (~0.3 s sikl)
   *   C  HI-LO  — ikki tonli (650/1000 Hz) navbatma-navbat
   *   D  PHASER — juda tez, keskin "piercer" (~12 Hz)
   * Ovoz Web Audio da sintez qilinadi: asosiy ton (kvadrat + arra to'lqini) chastotasini LFO surib turadi.
   */
  private sirenNodes: AudioNode[] = [];
  private sirenTone: SirenTone | null = null;

  public getSirenTone(): SirenTone | null {
    return this.sirenTone;
  }

  public startSiren(tone: SirenTone = 'A') {
    if (this.isMuted) return;
    this.stopSiren();
    try {
      this.initCtx();
      const ctx = this.ctx;
      if (!ctx) return;
      const t = ctx.currentTime;
      const p = SIREN_PRESETS[tone];

      // Ikki osillyator: kvadrat (baland, "karnay" ovozi) + arra (tiniqlik)
      const sq = ctx.createOscillator();
      sq.type = 'square';
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      sq.frequency.setValueAtTime(p.center, t);
      saw.frequency.setValueAtTime(p.center, t);
      saw.detune.setValueAtTime(6, t);

      // LFO: chastotani center ± depth oralig'ida suradi
      const lfo = ctx.createOscillator();
      lfo.type = p.lfoType;
      lfo.frequency.setValueAtTime(p.rate, t);
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(p.depth, t);
      lfo.connect(depth);
      depth.connect(sq.frequency);
      depth.connect(saw.frequency);

      // Karnay tembri: yuqori chastotalarni biroz kesish, keyin umumiy balandlik (yumshoq boshlanish)
      const tone1 = ctx.createGain();
      tone1.gain.setValueAtTime(0.55, t);
      const tone2 = ctx.createGain();
      tone2.gain.setValueAtTime(0.35, t);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(3800, t);
      // Sirena 100% balandlikda: kompressor qirqilishsiz eng baland darajani ushlab turadi
      const out = ctx.createGain();
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(0.9, t + 0.08);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.setValueAtTime(-12, t);
      comp.ratio.setValueAtTime(6, t);
      comp.attack.setValueAtTime(0.003, t);
      comp.release.setValueAtTime(0.1, t);

      sq.connect(tone1);
      saw.connect(tone2);
      tone1.connect(lp);
      tone2.connect(lp);
      lp.connect(out);
      out.connect(comp);
      comp.connect(ctx.destination);

      sq.start(t);
      saw.start(t);
      lfo.start(t);
      this.sirenOsc = sq;
      this.sirenNodes = [sq, saw, lfo, depth, tone1, tone2, lp, out, comp];
      this.sirenTone = tone;
    } catch {
      // Ignore
    }
  }

  public stopSiren() {
    const ctx = this.ctx;
    if (ctx && this.sirenNodes.length) {
      for (const n of this.sirenNodes) {
        try {
          if (n instanceof OscillatorNode) n.stop(ctx.currentTime + 0.02);
          n.disconnect();
        } catch {
          // Ignore
        }
      }
    }
    this.sirenNodes = [];
    this.sirenOsc = null;
    this.sirenTone = null;
  }
}

export const tacticalAudio = new TacticalAudioService();
