/**
 * Microsoft Edge TTS Service - uz-UZ-SardorNeural (1.0x)
 * Qalqon robotining o'zbek tilidagi tabiiy neural nutq sintezi tizimi.
 */

export interface EdgeTtsOptions {
  voice?: string;
  rate?: number; // 1.0 = 1x
  pitch?: number;
}

class EdgeTtsService {
  public readonly defaultVoice = 'uz-UZ-SardorNeural';
  public readonly defaultRate = 1.0; // 1x
  private isSpeaking = false;

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

      // uz-UZ-SardorNeural / Microsoft Sardor Online (Natural) ovozini tanlash
      const voices = window.speechSynthesis.getVoices();
      const targetVoiceName = (options?.voice ?? this.defaultVoice).toLowerCase();

      const matchedVoice = voices.find(v =>
        v.name.toLowerCase().includes('sardor') ||
        v.voiceURI.toLowerCase().includes('sardor') ||
        v.name.toLowerCase().includes(targetVoiceName)
      ) || voices.find(v =>
        v.lang === 'uz-UZ' || v.lang === 'uz' || v.lang.startsWith('uz')
      ) || voices.find(v =>
        v.name.toLowerCase().includes('natural') && (v.lang.includes('uz') || v.lang.includes('ru'))
      );

      if (matchedVoice) {
        utterance.voice = matchedVoice;
      }

      this.isSpeaking = true;
      if (onStart) onStart();

      const handleDone = () => {
        this.isSpeaking = false;
        if (onEnd) onEnd();
      };

      utterance.onend = handleDone;
      utterance.onerror = (e) => {
        console.warn('[EdgeTTS] Ovoz chiqarishda ogohlantirish:', e);
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
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.isSpeaking = false;
  }

  public getSpeakingState(): boolean {
    return this.isSpeaking;
  }
}

export const edgeTtsService = new EdgeTtsService();
