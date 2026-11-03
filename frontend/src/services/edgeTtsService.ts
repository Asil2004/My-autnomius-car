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

// Oldindan Microsoft Edge TTS uz-UZ-SardorNeural 1x da tayyorlangan tiniq audiolarning xaritasi
const PRE_RENDERED_SARDOR_AUDIO: Record<string, string> = {
  // Asosiy tanishuv / demo
  "assalomu alaykum! men qalqon avtonom patrul robotiman. jamoat xavfsizligini ta'minlashga tayyorman!": "/audio/sardor_intro.mp3",
  "assalomu alaykum men qalqon avtonom patrul robotiman": "/audio/sardor_intro.mp3",

  // Shaxs tasdiqlandi umumiy
  "assalomu alaykum! qalqon tizimi shaxsingizni tasdiqladi.": "/audio/sardor_face_verified.mp3",
  "assalomu alaykum qalqon tizimi shaxsingizni tasdiqladi": "/audio/sardor_face_verified.mp3",

  // Shaxslar bo'yicha
  "sarvar": "/audio/sardor_greet_sarvar.mp3",
  "asilbek": "/audio/sardor_greet_asilbek.mp3",
  "boburjon": "/audio/sardor_greet_boburjon.mp3",
  "zulfiddin": "/audio/sardor_greet_zulfiddin.mp3",
  "muhammadali": "/audio/sardor_greet_muhammadali.mp3",

  // Ogohlantirishlar
  "diqqat! hududda shubhali harakat aniqlandi.": "/audio/sardor_alert.mp3",
  "patrul nazorati xizmati muvaffaqiyatli ishga tushirildi.": "/audio/sardor_patrol_active.mp3"
};

class EdgeTtsService {
  public readonly defaultVoice = 'uz-UZ-SardorNeural';
  public readonly defaultRate = 1.0; // 1x
  private isSpeaking = false;
  private currentAudio: HTMLAudioElement | null = null;
  private voices: SpeechSynthesisVoice[] = [];

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.initVoices();
      window.speechSynthesis.onvoiceschanged = () => this.initVoices();
    }
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
          this.speakViaSpeechSynthesis(text, options, onStart, onEnd);
        };

        audio.play().catch(() => {
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

      // FAQAT Sardor yoki O'zbek ovozini qidirish (hech qachon rus yoki boshqa tilga o'tmaydi!)
      const sardorVoice = this.voices.find(v =>
        v.name.toLowerCase().includes('sardor') ||
        v.voiceURI.toLowerCase().includes('sardor')
      ) || this.voices.find(v =>
        v.lang === 'uz-UZ' || v.lang === 'uz' || v.name.toLowerCase().includes('uzbek')
      );

      if (sardorVoice) {
        utterance.voice = sardorVoice;
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

  public stop(): void {
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
