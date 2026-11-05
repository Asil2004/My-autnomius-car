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
export const DEFAULT_UZBEKVOICE_API_KEY = '4a3c6d14-77b1-4758-852a-70468a800e3b:a3a4bd8a-7f6d-4a4c-81ad-7ce2af0db63c';

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
    
    // Fayl nomini mime-type ga mos ravishda uzatamiz
    const filename = audioBlob.type.includes('wav') ? 'speech.wav' 
      : audioBlob.type.includes('mp3') ? 'speech.mp3' 
      : audioBlob.type.includes('ogg') ? 'speech.ogg' 
      : 'speech.webm';

    formData.append('file', audioBlob, filename);
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
      } catch (proxyErr) {
        throw new Error(
          "Ovozli serverga ulanishda xatolik yuz berdi. Internet yoki CORS cheklovini tekshiring: " +
          (fetchErr instanceof Error ? fetchErr.message : String(fetchErr))
        );
      }
    }

    if (!response.ok) {
      let errDetail = `Status: ${response.status} ${response.statusText}`;
      try {
        const errJson = await response.json();
        errDetail = errJson.message || errJson.error || JSON.stringify(errJson);
      } catch {
        const errText = await response.text();
        if (errText) errDetail = errText.slice(0, 200);
      }
      throw new Error(`UzbekVoice.ai STT xatoligi (${response.status}): ${errDetail}`);
    }

    const data = await response.json();

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
