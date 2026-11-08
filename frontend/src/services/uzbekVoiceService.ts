/**
 * UzbekVoice.ai STT (Speech-to-Text) Service
 * Qalqon Avtonom Patrul Roboti uchun o'zbek tilidagi nutqni matnga aylantirish xizmati.
 * 
 * API:
 * POST https://uzbekvoice.ai/api/v1/stt
 * Headers: Authorization: [API_KEY], Content-Type: multipart/form-data
 * Form data: file, return_offsets=false, run_diarization=false, language='uz', model='general', blocking=true
 */

export interface UzbekVoiceConfig {
  apiKey: string;
  endpoint: string;
  language: string;
  model: string;
  blocking: boolean;
}

const STORAGE_KEY = 'qalqon_uzbekvoice_api_key';
const ENDPOINT_KEY = 'qalqon_uzbekvoice_endpoint';
export const DEFAULT_UZBEKVOICE_API_KEY = '7d1160ed-180a-4107-a1d0-5aafaa492964:4e3f03b5-9c42-4da6-9d3d-da889e63c40d';

const UZBEKVOICE_TTS_ENDPOINT = 'https://uzbekvoice.ai/api/v1/tts';
// Erkak ovozi. Kalit tarifida bo'lmasa server o'zi boshqa ovoz (hozir "lola") bilan almashtiradi;
// tarifda yoqilganda kodni o'zgartirmasdan erkak ovozi chiqadi.
export const UZBEKVOICE_TTS_MODEL = 'lola';

/** TTS audio manzillari keshi (manzil serverda 4 kun amal qiladi, biz 3 kun saqlaymiz) */
const ttsCache = (() => {
  const KEY = 'qalqon.uzbekvoiceTts.v1';
  const TTL = 3 * 24 * 3600 * 1000;
  const MAX = 200;
  type Entry = { url: string; used: string; t: number };
  let map: Record<string, Entry> = {};
  try {
    map = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, Entry>;
  } catch {
    map = {};
  }
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(map));
    } catch {
      /* xotira yo'q */
    }
  };
  return {
    get(k: string): Entry | null {
      const e = map[k];
      if (!e) return null;
      if (Date.now() - e.t > TTL) {
        delete map[k];
        save();
        return null;
      }
      return e;
    },
    set(k: string, url: string, used: string) {
      map[k] = { url, used, t: Date.now() };
      const keys = Object.keys(map);
      if (keys.length > MAX) {
        keys.sort((a, b) => map[a].t - map[b].t).slice(0, keys.length - MAX).forEach((x) => delete map[x]);
      }
      save();
    }
  };
})();

export interface TranscriptionResult {
  text: string;
  confidence?: number;
  raw?: unknown;
}

class UzbekVoiceService {
  private defaultEndpoint = 'https://uzbekvoice.ai/api/v1/stt';
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];

  /**
   * Saqlangan yoki standart API kalitni olish
   */
  public getApiKey(): string {
    if (typeof window === 'undefined') return DEFAULT_UZBEKVOICE_API_KEY;
    const saved = localStorage.getItem(STORAGE_KEY);
    // Eski/muddati o'tgan kalit bo'lsa yangi jar kalitiga avtomatik almashtirish
    if (saved === '7d1160ed-180a-4107-a1d0-5aafaa492964:4e3f03b5-9c42-4da6-9d3d-da889e63c40d') {
      localStorage.setItem(STORAGE_KEY, DEFAULT_UZBEKVOICE_API_KEY);
      return DEFAULT_UZBEKVOICE_API_KEY;
    }
    return saved !== null && saved !== '' ? saved : DEFAULT_UZBEKVOICE_API_KEY;
  }

  /**
   * API kalitni saqlash
   */
  public setApiKey(key: string): void {
    if (typeof window === 'undefined') return;
    const cleanKey = key.trim();
    if (cleanKey) {
      localStorage.setItem(STORAGE_KEY, cleanKey);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  /**
   * API kaliti mavjudligini tekshirish
   */
  public hasApiKey(): boolean {
    return Boolean(this.getApiKey());
  }

  /**
   * Maxsus endpointni olish
   */
  public getEndpoint(): string {
    if (typeof window === 'undefined') return this.defaultEndpoint;
    return localStorage.getItem(ENDPOINT_KEY) || this.defaultEndpoint;
  }

  /**
   * Maxsus endpointni saqlash
   */
  public setEndpoint(endpoint: string): void {
    if (typeof window === 'undefined') return;
    const clean = endpoint.trim();
    if (clean) {
      localStorage.setItem(ENDPOINT_KEY, clean);
    } else {
      localStorage.removeItem(ENDPOINT_KEY);
    }
  }

  /**
   * Audio faylni (Blob) uzbekvoice.ai STT API ga yuborish
   */
  public async transcribeAudio(audioBlob: Blob): Promise<TranscriptionResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error("UzbekVoice.ai API kaliti kiritilmagan. Iltimos, sozlamalardan API kalitni kiriting.");
    }

    const endpoint = this.getEndpoint();
    const formData = new FormData();

    // UzbekVoice.ai brauzer MediaRecorder yozgan WebM/Opus faylni qabul qilmaydi: 500 "Internal Server Error"
    // qaytaradi va CORS sarlavhasi bo'lmagani uchun brauzer buni "Failed to fetch" deb ko'radi.
    // Shuning uchun yozuv 16 kHz mono WAV (PCM16) ga o'giriladi. MP3/WAV bo'lsa o'zi yuboriladi.
    const isMp3 = /mpeg|mp3/.test(audioBlob.type);
    const isWav = /wav/.test(audioBlob.type);
    let uploadBlob = audioBlob;
    let filename = isWav ? 'speech.wav' : isMp3 ? 'speech.mp3' : 'speech.webm';
    if (!isWav && !isMp3) {
      try {
        uploadBlob = await this.toWav16k(audioBlob);
        filename = 'speech.wav';
      } catch (convErr) {
        console.warn('[UzbekVoice] WAV ga o\'girib bo\'lmadi, asl format yuboriladi:', convErr);
      }
    }

    formData.append('file', uploadBlob, filename);
    formData.append('return_offsets', 'false');
    formData.append('run_diarization', 'false');
    formData.append('language', 'uz');
    formData.append('model', 'general');
    formData.append('blocking', 'true');

    // Headerda Authorization ni uzatamiz
    // Foydalanuvchi "Bearer key" yoki to'g'ridan-to'g'ri "key" kiritishi mumkin
    const authHeader = apiKey.toLowerCase().startsWith('bearer ') ? apiKey : apiKey;

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          // Eslatma: multipart/form-data uchun Content-Type ni brauzer o'zi boundary bilan belgilashi kerak
        },
        body: formData,
      });
    } catch (fetchErr: unknown) {
      // Agar brauzerda CORS cheklovi yuz bersa, Raspberry Pi backend proksisiga murojaat qilishni sinab ko'ramiz
      console.warn('[UzbekVoice] To\'g\'ridan-to\'g\'ri so\'rovda xatolik (ehtimol CORS). Backend /api/stt sinab ko\'rilmoqda...', fetchErr);
      try {
        const proxyUrl = '/api/stt';
        response = await fetch(proxyUrl, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
          },
          body: formData,
        });
        // GitHub Pages'da /api/stt yo'q (404): asl tarmoq xatosini ko'rsatamiz
        if (!response.ok) throw new Error('proxy unavailable');
      } catch {
        throw new Error(
          "Ovozli serverga ulanishda xatolik yuz berdi. Internet yoki CORS cheklovini tekshiring: " +
          (fetchErr instanceof Error ? fetchErr.message : String(fetchErr))
        );
      }
    }

    // Javob tanasi faqat BIR MARTA o'qiladi. Avval json(), xato bo'lsa text() chaqirilganda
    // "Failed to execute 'text' on 'Response': body stream already read" xatosi chiqardi
    // (masalan, server 401 da JSON emas, HTML sahifa qaytaradi).
    const rawBody = await response.text().catch(() => '');
    let parsed: unknown = null;
    try {
      parsed = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      throw new Error(this.describeHttpError(response.status, parsed, rawBody));
    }

    if (parsed === null) {
      throw new Error("UzbekVoice.ai serveridan tushunarsiz javob keldi (JSON emas).");
    }
    const data = parsed;

    // Javob formatini moslashtirish (turli API versiyalariga tolerant)
    let extractedText = '';
    if (typeof data === 'string') {
      extractedText = data;
    } else if (data && typeof data === 'object') {
      const record = data as Record<string, unknown>;
      if (typeof record.text === 'string') {
        extractedText = record.text;
      } else if (record.result && typeof (record.result as Record<string, unknown>).text === 'string') {
        extractedText = (record.result as Record<string, unknown>).text as string;
      } else if (typeof record.result === 'string') {
        extractedText = record.result;
      } else if (typeof record.transcription === 'string') {
        extractedText = record.transcription;
      } else if (typeof record.transcript === 'string') {
        extractedText = record.transcript;
      }
    }

    extractedText = extractedText.trim();
    if (!extractedText) {
      throw new Error("UzbekVoice.ai ovozni qabul qildi, biroq nutq aniqlanmadi (bo'sh natija).");
    }

    return {
      text: extractedText,
      raw: data
    };
  }

  /** Oxirgi TTS: so'ralgan va server haqiqatda ishlatgan ovoz (kalit tarifida bo'lmasa server almashtiradi) */
  public lastTts: { requested: string; used: string } | null = null;

  /**
   * Matnni uzbekvoice.ai TTS orqali ovozga aylantirish. Audio fayl manzilini (WAV, ~4 kun amal qiladi) qaytaradi.
   * POST https://uzbekvoice.ai/api/v1/tts  { text, model, blocking: "true" }  ->  { model, result: { url } }
   * Mavjud ovozlar: jasur (erkak), shoira, lola, kamola, sevinch. Sardor ovozi bu xizmatda yo'q.
   * Bir xil matn qayta so'ralmaydi: manzil 3 kun keshda saqlanadi.
   */
  public async synthesize(text: string, model: string = UZBEKVOICE_TTS_MODEL): Promise<string> {
    // jar/lola spetsifikatsiyasi: markdown, havolalar va belgilarni tozalash
    const clean = text
      .replace(/[*_#`>~\[\]()]+/g, ' ')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/['`’‘]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    const cacheKey = `${model}|${clean}`;
    const cached = ttsCache.get(cacheKey);
    if (cached) {
      this.lastTts = { requested: model, used: cached.used };
      return cached.url;
    }

    const apiKey = this.getApiKey();
    if (!apiKey) throw new Error('UzbekVoice.ai API kaliti kiritilmagan');

    const request = () =>
      fetch(UZBEKVOICE_TTS_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean, model, blocking: 'true' })
      });

    let response = await request();
    let rawBody = await response.text().catch(() => '');
    // "Too many active requests": oldingi so'rov hali tugamagan, bir marta qayta urinamiz
    if (!response.ok && /too many active/i.test(rawBody)) {
      await new Promise((r) => setTimeout(r, 1500));
      response = await request();
      rawBody = await response.text().catch(() => '');
    }
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      const msg = typeof parsed?.error === 'string' ? parsed.error : `status ${response.status}`;
      throw new Error(`UzbekVoice TTS: ${msg}`);
    }
    const url = (parsed?.result as Record<string, unknown> | undefined)?.url;
    if (typeof url !== 'string' || !url) throw new Error('UzbekVoice TTS: audio manzili kelmadi');
    const used = typeof parsed?.model === 'string' ? parsed.model : model;
    this.lastTts = { requested: model, used };
    ttsCache.set(cacheKey, url, used);
    return url;
  }

  /** Har qanday brauzer audio yozuvini 16 kHz mono 16-bit WAV ga o'girish */
  private async toWav16k(blob: Blob): Promise<Blob> {
    const SR = 16000;
    const decoder = new OfflineAudioContext(1, 1, SR);
    const decoded = await decoder.decodeAudioData(await blob.arrayBuffer());
    const length = Math.max(1, Math.ceil(decoded.duration * SR));
    const offline = new OfflineAudioContext(1, length, SR);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const pcm = (await offline.startRendering()).getChannelData(0);

    const buffer = new ArrayBuffer(44 + pcm.length * 2);
    const view = new DataView(buffer);
    const writeStr = (off: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + pcm.length * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt bo'lagi hajmi
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, SR, true);
    view.setUint32(28, SR * 2, true); // bayt/soniya
    view.setUint16(32, 2, true); // blok
    view.setUint16(34, 16, true); // bit
    writeStr(36, 'data');
    view.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) {
      const s = Math.max(-1, Math.min(1, pcm[i]));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  /** Server xatosini foydalanuvchiga tushunarli o'zbekcha xabarga aylantirish */
  private describeHttpError(status: number, parsed: unknown, rawBody: string): string {
    const rec = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    const serverMsg =
      (rec && (typeof rec.error === 'string' ? rec.error : typeof rec.message === 'string' ? rec.message : null)) ||
      // HTML sahifadan sarlavhani olamiz (<title>401 Unauthorized</title>)
      rawBody.match(/<title>([^<]+)<\/title>/i)?.[1] ||
      rawBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);

    if (status === 401 || status === 403) {
      return "UzbekVoice.ai API kaliti noto'g'ri yoki muddati tugagan (401). \"API\" tugmasi orqali to'g'ri kalitni kiriting.";
    }
    if (status === 400 && rec?.type === 'ffmpeg_failed') {
      return "Yozilgan ovoz juda qisqa yoki buzilgan. Tugmani bosib, kamida 1-2 soniya gapiring.";
    }
    if (status === 402 || status === 429) {
      return `UzbekVoice.ai limiti tugagan yoki so'rovlar juda ko'p (${status}). Keyinroq urinib ko'ring.`;
    }
    if (status === 404 || status === 405) {
      return `Ovozni aniqlash manzili topilmadi (${status}). Sozlamalardagi endpointni tekshiring.`;
    }
    return `UzbekVoice.ai STT xatoligi (${status})${serverMsg ? `: ${serverMsg}` : ''}`;
  }

  /**
   * Brauzer mikrofonidan yozib olishni boshlash
   */
  public async startRecording(): Promise<MediaStream> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Ushbu brauzerda mikrofonni boshqarish (MediaDevices) qo'llab-quvvatlanmaydi.");
    }

    this.audioChunks = [];
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 16000
      }
    });

    // Eng qulay formatni tanlash
    let mimeType = 'audio/webm';
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      mimeType = 'audio/webm;codecs=opus';
    } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
      mimeType = 'audio/ogg;codecs=opus';
    } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
      mimeType = 'audio/mp4';
    }

    this.mediaRecorder = new MediaRecorder(stream, { mimeType });
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    this.mediaRecorder.start(250); // har 250ms da bo'lak yig'ish
    return stream;
  }

  /**
   * Yozib olishni to'xtatish va audio Blob qaytarish
   */
  public async stopRecording(): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error("Yozib olish faol emas."));
        return;
      }

      this.mediaRecorder.onstop = () => {
        try {
          const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
          const audioBlob = new Blob(this.audioChunks, { type: mimeType });
          
          // Stream treklarni to'xtatish
          if (this.mediaRecorder?.stream) {
            this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
          }
          this.mediaRecorder = null;
          this.audioChunks = [];
          resolve(audioBlob);
        } catch (err) {
          reject(err);
        }
      };

      if (this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      } else {
        reject(new Error("MediaRecorder allaqachon to'xtatilgan."));
      }
    });
  }

  /**
   * Yozish holatini tekshirish
   */
  public isRecording(): boolean {
    return this.mediaRecorder !== null && this.mediaRecorder.state === 'recording';
  }
}

export const uzbekVoiceService = new UzbekVoiceService();
