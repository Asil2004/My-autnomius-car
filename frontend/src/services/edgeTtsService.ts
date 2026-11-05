/**
 * Microsoft Edge TTS Service - uz-UZ-SardorNeural (1.0x)
 * Qalqon robotining o'zbek tilidagi tabiiy neural nutq sintezi tizimi.
 * 
 * Bu xizmat:
 * 1. Oldindan sintez qilingan haqiqiy uz-UZ-SardorNeural audio fayllarini (100% tabiiy ovoz) ijro etadi.
 * 2. Dinamik matnlar uchun brauzerdagi uz-UZ-SardorNeural yoki o'zbek ovozini tanlaydi (rus yoki ingliz ovoziga o'tmaydi).
 */

export interface EdgeTtsOptions {
  voice?: string;
  rate?: number; // 1.0 = 1x
  pitch?: number;
}

// Audio yo'li sayt bazasiga nisbatan: GitHub Pages'da sayt /My-autnomius-car/ ichida turadi,
// shuning uchun "/audio/..." (domen ildizi) 404 berib, brauzerning boshqa (ayol/ingliz) ovoziga tushib qolardi.
const AUDIO_BASE = `${import.meta.env.BASE_URL}audio/`;
const a = (file: string) => `${AUDIO_BASE}${file}`;

// Oldindan Microsoft Edge TTS uz-UZ-SardorNeural 1x da tayyorlangan tiniq audiolarning xaritasi
const PRE_RENDERED_SARDOR_AUDIO: Record<string, string> = {
  // Asosiy tanishuv / demo
  "assalomu alaykum! men qalqon avtonom patrul robotiman. jamoat xavfsizligini ta'minlashga tayyorman!": a('sardor_intro.mp3'),
  "assalomu alaykum men qalqon avtonom patrul robotiman": a('sardor_intro.mp3'),

  // Shaxs tasdiqlandi umumiy
  "assalomu alaykum! qalqon tizimi shaxsingizni tasdiqladi.": a('sardor_face_verified.mp3'),
  "assalomu alaykum qalqon tizimi shaxsingizni tasdiqladi": a('sardor_face_verified.mp3'),

  // Shaxslar bo'yicha
  "sarvar": a('sardor_greet_sarvar.mp3'),
  "asilbek": a('sardor_greet_asilbek.mp3'),
  "boburjon": a('sardor_greet_boburjon.mp3'),
  "zulfiddin": a('sardor_greet_zulfiddin.mp3'),
  "muhammadali": a('sardor_greet_muhammadali.mp3'),

  // Ogohlantirishlar
  "diqqat! hududda shubhali harakat aniqlandi.": a('sardor_alert.mp3'),
  "patrul nazorati xizmati muvaffaqiyatli ishga tushirildi.": a('sardor_patrol_active.mp3')
};

class EdgeTtsService {
  public readonly defaultVoice = 'uz-UZ-SardorNeural';
  public readonly defaultRate = 1.0; // 1x
  private isSpeaking = false;
  private currentAudio: HTMLAudioElement | null = null;
  private voices: SpeechSynthesisVoice[] = [];

  // Lab sinxroni uchun haqiqiy ovoz balandligini o'lchash (Web Audio)
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuf: Float32Array<ArrayBuffer> | null = null;
  private analysedAudio: HTMLAudioElement | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.initVoices();
      window.speechSynthesis.onvoiceschanged = () => this.initVoices();
    }
    if (typeof window !== 'undefined') {
      // AudioContext faqat foydalanuvchi harakatidan keyin ishlaydi
      const unlock = () => {
        this.ensureAudioCtx();
        if (this.audioCtx?.state === 'running') {
          window.removeEventListener('pointerdown', unlock, true);
          window.removeEventListener('keydown', unlock, true);
        }
      };
      window.addEventListener('pointerdown', unlock, true);
      window.addEventListener('keydown', unlock, true);
    }
  }

  private ensureAudioCtx(): void {
    try {
      if (!this.audioCtx) {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        this.audioCtx = new Ctx();
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 1024;
        this.analyser.smoothingTimeConstant = 0.2;
        this.analyser.connect(this.audioCtx.destination);
        this.levelBuf = new Float32Array(this.analyser.fftSize);
      }
      if (this.audioCtx.state === 'suspended') void this.audioCtx.resume();
    } catch {
      this.audioCtx = null;
      this.analyser = null;
    }
  }

  /** Audio elementni analizatorga ulash. Faqat AudioContext ishlayotgan bo'lsa (aks holda ovoz o'chib qolardi) */
  private attachAnalyser(audio: HTMLAudioElement): void {
    if (!this.audioCtx || !this.analyser || this.audioCtx.state !== 'running') return;
    try {
      this.audioCtx.createMediaElementSource(audio).connect(this.analyser);
      this.analysedAudio = audio;
    } catch {
      this.analysedAudio = null;
    }
  }

  /**
   * Hozir ijro etilayotgan Sardor audiosining balandligi 0..1.
   * null: o'lchab bo'lmaydi (masalan, Web Speech yo'li), unda chaqiruvchi o'zi taxminiy ritm beradi.
   */
  public getLevel(): number | null {
    const audio = this.currentAudio;
    if (!audio || audio !== this.analysedAudio || !this.analyser || !this.levelBuf) return null;
    if (audio.paused) return 0;
    this.analyser.getFloatTimeDomainData(this.levelBuf);
    let sum = 0;
    for (let i = 0; i < this.levelBuf.length; i++) sum += this.levelBuf[i] * this.levelBuf[i];
    const rms = Math.sqrt(sum / this.levelBuf.length);
    // Shovqin chegarasi va normallashtirish (nutq RMS ~0.03..0.25)
    return Math.min(1, Math.max(0, (rms - 0.012) * 6));
  }

  private initVoices(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.voices = window.speechSynthesis.getVoices();
    }
  }

  /**
   * Berilgan matn uchun mos audio faylni topish
   */
  private matchPreRenderedAudio(text: string): string | null {
    const clean = text.toLowerCase().trim().replace(/['`’]/g, "'");
    
    // Aniq to'g'ri kelishi
    if (PRE_RENDERED_SARDOR_AUDIO[clean]) {
      return PRE_RENDERED_SARDOR_AUDIO[clean];
    }

    // Ismlar bo'yicha salomlashuv
    if (clean.includes('sarvar')) return PRE_RENDERED_SARDOR_AUDIO['sarvar'];
    if (clean.includes('asilbek')) return PRE_RENDERED_SARDOR_AUDIO['asilbek'];
    if (clean.includes('boburjon')) return PRE_RENDERED_SARDOR_AUDIO['boburjon'];
    if (clean.includes('zulfiddin')) return PRE_RENDERED_SARDOR_AUDIO['zulfiddin'];
    if (clean.includes('muhammadali')) return PRE_RENDERED_SARDOR_AUDIO['muhammadali'];

    if (clean.includes('patrul robotiman') || clean.includes('avtonom patrul')) {
      return PRE_RENDERED_SARDOR_AUDIO["assalomu alaykum! men qalqon avtonom patrul robotiman. jamoat xavfsizligini ta'minlashga tayyorman!"];
    }

    if (clean.includes('shaxsingizni tasdiqladi')) {
      return PRE_RENDERED_SARDOR_AUDIO["assalomu alaykum! qalqon tizimi shaxsingizni tasdiqladi."];
    }

    return null;
  }

  /**
   * Microsoft Edge TTS uz-UZ-SardorNeural 1x ovozida matnni o'qish
   */
  public speak(
    text: string,
    options?: EdgeTtsOptions,
    onStart?: () => void,
    onEnd?: () => void
  ): void {
    if (!text || !text.trim()) return;

    this.stop();

    // 1-USUL: Haqiqiy tayyorlangan Microsoft Edge TTS uz-UZ-SardorNeural audioni o'ynatish
    const matchedAudioUrl = this.matchPreRenderedAudio(text);
    if (matchedAudioUrl) {
      try {
        const audio = new Audio(matchedAudioUrl);
        this.currentAudio = audio;
        audio.playbackRate = options?.rate ?? this.defaultRate; // 1.0x
        this.ensureAudioCtx();
        this.attachAnalyser(audio);

        audio.onplay = () => {
          this.isSpeaking = true;
          if (onStart) onStart();
        };

        const handleDone = () => {
          this.isSpeaking = false;
          this.currentAudio = null;
          if (onEnd) onEnd();
        };

        audio.onended = handleDone;
        audio.onerror = () => {
          // Fayl ochilmasa fallbackga o'tamiz
          console.warn('[EdgeTTS] Sardor audio fayli ochilmadi:', matchedAudioUrl);
          this.speakViaSpeechSynthesis(text, options, onStart, onEnd);
        };

        audio.play().catch((err: unknown) => {
          const name = err instanceof Error ? err.name : '';
          if (name === 'NotAllowedError') {
            // Brauzer foydalanuvchi teginmaguncha ovozni bloklaydi. Boshqa (ayol) ovozga o'tmaymiz:
            // Sardor audiosi birinchi teginish/tugma bosilishida ijro etiladi.
            this.isSpeaking = false;
            this.currentAudio = null;
            if (onEnd) onEnd();
            this.playOnFirstGesture(audio);
            return;
          }
          if (name === 'AbortError') return; // stop() chaqirilgan
          this.speakViaSpeechSynthesis(text, options, onStart, onEnd);
        });
        return;
      } catch {
        // Fallback
      }
    }

    // 2-USUL: Web Speech API orqali qat'iy o'zbekcha / Sardor ovozini qidirish
    this.speakViaSpeechSynthesis(text, options, onStart, onEnd);
  }

  private speakViaSpeechSynthesis(
    text: string,
    options?: EdgeTtsOptions,
    onStart?: () => void,
    onEnd?: () => void
  ): void {
    if (!('speechSynthesis' in window)) {
      console.warn('[EdgeTTS] Web Speech API brauzerda qo\'llab-quvvatlanmaydi.');
      if (onEnd) onEnd();
      return;
    }

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'uz-UZ';
      utterance.rate = options?.rate ?? this.defaultRate; // 1x
      utterance.pitch = options?.pitch ?? 1.0;

      if (this.voices.length === 0) {
        this.voices = window.speechSynthesis.getVoices();
      }

      // Faqat erkak ovozi: avval Sardor (Edge brauzerida "Microsoft Sardor Online (Natural)"),
      // bo'lmasa ayol ovozi (Madina) bo'lmagan o'zbek ovozi. Rus yoki boshqa tilga o'tmaydi.
      const isFemale = (v: SpeechSynthesisVoice) => /madina|female/i.test(`${v.name} ${v.voiceURI}`);
      const sardorVoice = this.voices.find(v => /sardor/i.test(`${v.name} ${v.voiceURI}`));
      const uzMaleVoice = this.voices.find(v =>
        (v.lang === 'uz-UZ' || v.lang === 'uz' || /uzbek/i.test(v.name)) && !isFemale(v)
      );
      const chosen = sardorVoice || uzMaleVoice;

      if (chosen) {
        utterance.voice = chosen;
      }
      if (!sardorVoice) {
        // Sardor topilmasa ovozni pastroq qilib erkak tembriga yaqinlashtiramiz
        utterance.pitch = options?.pitch ?? 0.8;
      }

      this.isSpeaking = true;
      if (onStart) onStart();

      const handleDone = () => {
        this.isSpeaking = false;
        if (onEnd) onEnd();
      };

      utterance.onend = handleDone;
      utterance.onerror = (e) => {
        console.warn('[EdgeTTS] Nutq yakunlandi:', e);
        handleDone();
      };

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('[EdgeTTS] Xatolik:', err);
      this.isSpeaking = false;
      if (onEnd) onEnd();
    }
  }

  private pendingGestureAudio: HTMLAudioElement | null = null;

  /** Autoplay bloklanganda audioni birinchi foydalanuvchi harakatida ijro etish */
  private playOnFirstGesture(audio: HTMLAudioElement): void {
    const hadPending = this.pendingGestureAudio !== null;
    this.pendingGestureAudio = audio;
    if (hadPending) return;
    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    const handler = () => {
      events.forEach(ev => window.removeEventListener(ev, handler, true));
      const pending = this.pendingGestureAudio;
      this.pendingGestureAudio = null;
      if (!pending || this.isSpeaking) return;
      pending.onended = () => { this.isSpeaking = false; this.currentAudio = null; };
      pending.onplay = () => { this.isSpeaking = true; };
      this.currentAudio = pending;
      pending.currentTime = 0;
      pending.play().catch(() => { this.currentAudio = null; });
    };
    events.forEach(ev => window.addEventListener(ev, handler, { capture: true }));
  }

  public stop(): void {
    this.pendingGestureAudio = null;
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
      } catch {}
      this.currentAudio = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.isSpeaking = false;
  }

  public getSpeakingState(): boolean {
    return this.isSpeaking;
  }
}

export const edgeTtsService = new EdgeTtsService();
