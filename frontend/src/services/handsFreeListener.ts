/**
 * Qo'l tegizmasdan tinglash (bosh sahifadagi robot uchun).
 *
 * Mikrofon doim eshitib turadi; ovoz shovqin darajasidan sezilarli baland bo'lganda gap boshlandi deb hisoblanadi,
 * ~0.9 s jimlikdan keyin gap tugadi deb, butun gap 16 kHz mono WAV ko'rinishida qaytariladi (UzbekVoice.ai uchun).
 * Gap boshi yo'qolmasligi uchun oxirgi ~0.4 s doim saqlanadi (pre-roll).
 * Robot gapirayotganda tinglash to'xtatiladi (o'z ovozini eshitib qolmasligi uchun).
 */

export interface ListenerOptions {
  /** Tugallangan gap (16 kHz mono WAV) */
  onUtterance: (wav: Blob) => void;
}

const TARGET_SR = 16000;
const PRE_ROLL_MS = 400;
const END_SILENCE_MS = 1000;
const MAX_UTTERANCE_MS = 12000;
const MIN_VOICED_MS = 450;
const START_FRAMES = 2; // shuncha ketma-ket baland kadrdan keyin gap boshlandi deb hisoblanadi

function encodeWav16k(chunks: Float32Array[], srcRate: number): Blob {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const merged = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  // Chiziqli interpolyatsiya bilan 16 kHz ga o'tkazish
  const ratio = srcRate / TARGET_SR;
  const outLen = Math.floor(total / ratio);
  const pcm = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(total - 1, i0 + 1);
    const v = merged[i0] + (merged[i1] - merged[i0]) * (pos - i0);
    const s = Math.max(-1, Math.min(1, v));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buf);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_SR, true);
  view.setUint32(28, TARGET_SR * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  w(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: 'audio/wav' });
}

export class HandsFreeListener {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private proc: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private paused = false;
  private running = false;

  // Gap aniqlash holati
  private noise = 0.01;
  private loudFrames = 0;
  private inSpeech = false;
  private preRoll: Float32Array[] = [];
  private speech: Float32Array[] = [];
  private speechMs = 0;
  private voicedMs = 0;
  private silentMs = 0;

  private opts: ListenerOptions;

  constructor(opts: ListenerOptions) {
    this.opts = opts;
  }

  public isRunning(): boolean {
    return this.running;
  }

  public async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
      });
      if (!this.running) {
        this.stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.ctx = new AudioContext();
      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.proc = this.ctx.createScriptProcessor(4096, 1, 1);
      this.proc.onaudioprocess = (e) => this.onFrame(e.inputBuffer.getChannelData(0), e.inputBuffer.sampleRate);
      this.source.connect(this.proc);
      this.proc.connect(this.ctx.destination); // chiqish jim (nol), faqat qayta ishlash uchun ulanadi
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
      console.info(`[Suhbat] Tinglash boshlandi (audio: ${this.ctx.state})`);
    } catch (err) {
      this.running = false;
      throw err;
    }
  }

  /** Brauzer AudioContext'ni faqat foydalanuvchi bosgandan keyin ishga tushiradi */
  public resume(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume().catch(() => {});
  }

  public setPaused(p: boolean): void {
    this.paused = p;
    if (p) this.reset();
  }

  public stop(): void {
    this.running = false;
    this.reset();
    try {
      this.source?.disconnect();
      this.proc?.disconnect();
    } catch {
      /* allaqachon uzilgan */
    }
    if (this.proc) this.proc.onaudioprocess = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => {});
    this.stream = null;
    this.ctx = null;
    this.proc = null;
    this.source = null;
  }

  private speechMsTotal(chunks: Float32Array[], sr: number): number {
    return (chunks.reduce((s, c) => s + c.length, 0) / sr) * 1000;
  }

  private reset() {
    this.inSpeech = false;
    this.loudFrames = 0;
    this.speech = [];
    this.speechMs = 0;
    this.voicedMs = 0;
    this.silentMs = 0;
  }

  private onFrame(input: Float32Array, sr: number) {
    if (this.paused || !this.running) return;
    const frame = new Float32Array(input); // bufer qayta ishlatiladi, nusxa olamiz
    const frameMs = (frame.length / sr) * 1000;
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);
    const threshold = Math.max(0.012, this.noise * 3.2);

    if (!this.inSpeech) {
      this.preRoll.push(frame);
      while (this.preRoll.length * frameMs > PRE_ROLL_MS) this.preRoll.shift();
      if (rms > threshold) {
        this.loudFrames++;
        if (this.loudFrames >= START_FRAMES) {
          this.inSpeech = true;
          this.speech = [...this.preRoll];
          this.speechMs = this.speech.length * frameMs;
          this.voicedMs = this.loudFrames * frameMs;
          this.silentMs = 0;
        }
      } else {
        this.loudFrames = 0;
        // Shovqin darajasini faqat jim paytda sekin moslashtiramiz
        this.noise = this.noise * 0.95 + rms * 0.05;
      }
      return;
    }

    this.speech.push(frame);
    this.speechMs += frameMs;
    if (rms > threshold * 0.6) {
      this.voicedMs += frameMs;
      this.silentMs = 0;
    } else {
      this.silentMs += frameMs;
    }
    if (this.silentMs >= END_SILENCE_MS || this.speechMs >= MAX_UTTERANCE_MS) {
      const chunks = this.speech;
      const voiced = this.voicedMs;
      this.reset();
      this.preRoll = [];
      if (voiced >= MIN_VOICED_MS) {
        console.info(`[Suhbat] Gap eshitildi: ${(this.speechMsTotal(chunks, sr) / 1000).toFixed(1)} s`);
        this.opts.onUtterance(encodeWav16k(chunks, sr));
      }
    }
  }
}
