/**
 * RATSIYA: operator tugmani bosib turib gapiradi -> ovoz yoziladi -> robotga yuboriladi -> robot uni ratsiya
 * (politsiya radiostansiyasi) ovozi kabi qo'pol qilib, eng baland ovozda (100%) dinamikdan chiqaradi.
 *
 * Ratsiya filtri: tor chastota oralig'i (≈400–3000 Hz), o'rta chastotani kuchaytirish, yumshoq buzilish (distortion),
 * kompressor, fonda biroz shovqin; boshida va oxirida "chiq-shsh" (squelch) va oxirida "roger" signali.
 */

/** Robotning oddiy ovozi (nutq, signallar) shu ulushda; sirena va ratsiya esa 100% */
export const NORMAL_VOLUME = 0.6;
export const MAX_RADIO_MS = 15_000;

const toB64 = (buf: ArrayBuffer) => {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;

// =============================================================================
// OPERATOR: yozish
// =============================================================================
export class RadioRecorder {
  private rec: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private t0 = 0;
  private limitTimer: number | null = null;

  get recording() {
    return !!this.rec && this.rec.state === 'recording';
  }

  private starting: Promise<void> | null = null;

  start(onLimit?: () => void): Promise<void> {
    if (!this.starting) this.starting = this.doStart(onLimit);
    return this.starting;
  }

  private async doStart(onLimit?: () => void): Promise<void> {
    if (this.recording) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) =>
      MediaRecorder.isTypeSupported(m)
    );
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.rec.start(250);
    this.t0 = performance.now();
    this.limitTimer = window.setTimeout(() => onLimit?.(), MAX_RADIO_MS);
  }

  /** Yozuvni tugatish: base64 audio (juda qisqa bo'lsa null) */
  async stop(): Promise<{ audio: string; mime: string; ms: number } | null> {
    // Mikrofon hali ochilayotgan bo'lsa (tez bosib qo'yib yuborilgan), avval ochilishini kutamiz
    await this.starting?.catch(() => {});
    if (this.limitTimer) window.clearTimeout(this.limitTimer);
    this.limitTimer = null;
    const rec = this.rec;
    if (!rec) return null;
    const ms = Math.round(performance.now() - this.t0);
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      if (rec.state !== 'inactive') rec.stop();
      else resolve();
    });
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.rec = null;
    if (ms < 400 || !this.chunks.length) return null; // tasodifiy bosish
    const blob = new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' });
    return { audio: toB64(await blob.arrayBuffer()), mime: blob.type, ms };
  }

  cancel() {
    if (this.limitTimer) window.clearTimeout(this.limitTimer);
    try {
      this.rec?.stop();
    } catch {
      /* allaqachon to'xtagan */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.rec = null;
    this.stream = null;
  }
}

// =============================================================================
// ROBOT: ratsiya filtri bilan ijro
// =============================================================================
let ctx: AudioContext | null = null;
let busyUntil = 0;
const getCtx = () => {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
};

/** Brauzer ovozni faqat ekranga birinchi teginishdan keyin ruxsat etadi: har teginishda ovoz qurilmasini "uyg'otamiz" */
if (typeof document !== 'undefined') {
  const unlock = () => {
    try {
      getCtx();
    } catch {
      /* ovoz qurilmasi yo'q */
    }
  };
  document.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  document.addEventListener('keydown', unlock, { capture: true, passive: true });
}

function distortionCurve(amount: number) {
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

function noiseBuffer(c: BaseAudioContext, seconds: number) {
  const b = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * seconds)), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/** Ratsiya "chiq-shsh" (squelch) */
function squelch(c: AudioContext, at: number, out: AudioNode, len = 0.12) {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, len);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2500;
  bp.Q.value = 0.7;
  const g = c.createGain();
  g.gain.setValueAtTime(0.35, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + len);
  src.connect(bp).connect(g).connect(out);
  src.start(at);
}

/** "Roger beep": ikki qisqa ton */
function roger(c: AudioContext, at: number, out: AudioNode) {
  [1200, 1600].forEach((f, i) => {
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    const g = c.createGain();
    const s = at + i * 0.09;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.linearRampToValueAtTime(0.25, s + 0.01);
    g.gain.setValueAtTime(0.25, s + 0.07);
    g.gain.linearRampToValueAtTime(0.0001, s + 0.085);
    o.connect(g).connect(out);
    o.start(s);
    o.stop(s + 0.09);
  });
}

/**
 * Operator yozuvini robot dinamigida ratsiya ovozida 100% balandlikda ijro etadi.
 * Ketma-ket kelgan yozuvlar bir-birining ustiga chiqmaydi (navbat bilan).
 */
export async function playRadio(b64: string): Promise<number> {
  const c = getCtx();
  const buf = await c.decodeAudioData(fromB64(b64));
  const start = Math.max(c.currentTime + 0.05, busyUntil);

  // Chiqish: kompressor -> to'liq balandlik (100%)
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -24;
  comp.knee.value = 6;
  comp.ratio.value = 8;
  comp.attack.value = 0.003;
  comp.release.value = 0.15;
  const master = c.createGain();
  master.gain.value = 1.0;
  comp.connect(master).connect(c.destination);

  // Ovoz: oldin kuchaytirish -> tor polosa -> o'rta chastota -> buzilish -> kompressor
  const src = c.createBufferSource();
  src.buffer = buf;
  const pre = c.createGain();
  pre.gain.value = 2.2;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 420;
  hp.Q.value = 0.9;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2900;
  lp.Q.value = 0.9;
  const mid = c.createBiquadFilter();
  mid.type = 'peaking';
  mid.frequency.value = 1700;
  mid.gain.value = 7;
  mid.Q.value = 1.1;
  const shaper = c.createWaveShaper();
  shaper.curve = distortionCurve(28);
  shaper.oversample = '2x';
  const post = c.createGain();
  post.gain.value = 0.85;
  src.connect(pre).connect(hp).connect(lp).connect(mid).connect(shaper).connect(post).connect(comp);

  // Fondagi efir shovqini (ovoz davomida)
  const hiss = c.createBufferSource();
  hiss.buffer = noiseBuffer(c, buf.duration + 0.3);
  const hissBp = c.createBiquadFilter();
  hissBp.type = 'bandpass';
  hissBp.frequency.value = 3000;
  hissBp.Q.value = 0.6;
  const hissG = c.createGain();
  hissG.gain.value = 0.035;
  hiss.connect(hissBp).connect(hissG).connect(comp);

  squelch(c, start, comp);
  const voiceAt = start + 0.1;
  src.start(voiceAt);
  hiss.start(start + 0.05);
  const end = voiceAt + buf.duration;
  hiss.stop(end + 0.1);
  roger(c, end + 0.05, comp);
  squelch(c, end + 0.25, comp, 0.18);
  busyUntil = end + 0.5;
  return Math.round((busyUntil - c.currentTime) * 1000);
}
