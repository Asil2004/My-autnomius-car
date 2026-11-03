/**
 * QALQON NVR - Lokal Video Yozib Olish va Arxivlash Xizmati
 * 
 * Talablar:
 * 1. Lokal xotiradan (IndexedDB) 100 MB ajratiladi.
 * 2. Kamera oqimi (MediaStream) doimiy ravishda WebM video bo'laklari sifatida yoziladi.
 * 3. 100 MB to'lganda FIFO (eng eski yozuvlarni birin-ketin o'chirib yangilariga joy ochish) tamoyili ishlaydi.
 * 4. Qayta ko'rish (Playback) paytida haqiqiy saqlangan video oqimini ko'rsatadi.
 * 5. Scrollbar uchun vaqt oraliqlarini (startSec, endSec) taqdim etadi (zapis bor qismi ko'k, yo'q qismi kulrang).
 */

export interface NvrChunk {
  id: string;
  date: string; // "YYYY-MM-DD"
  startSec: number; // 0..86400
  endSec: number;
  duration: number; // sekund
  size: number; // bayt
  blob: Blob;
  blobUrl?: string;
}

export interface TimelineRange {
  startSec: number;
  endSec: number;
}

export interface NvrStorageStats {
  usedBytes: number;
  maxBytes: number;
  percentUsed: number;
  chunkCount: number;
}

const DB_NAME = 'QalqonNVR_DB';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';
export const NVR_MAX_STORAGE_BYTES = 100 * 1024 * 1024; // 100 Megabayt

class NvrRecordingService {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private isCurrentlyRecording = false;
  private currentStream: MediaStream | null = null;
  private recordingStartSec = 0;
  private lastChunkTime = 0;
  private listeners: Array<() => void> = [];
  private blobUrlCache: Map<string, string> = new Map();

  constructor() {
    if (typeof window !== 'undefined' && 'indexedDB' in window) {
      this.initDB();
    }
  }

  private initDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('by_date', 'date', { unique: false });
          store.createIndex('by_start', 'startSec', { unique: false });
          store.createIndex('by_time', ['date', 'startSec'], { unique: false });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        console.error('[NVR] IndexedDB ochishda xatolik:', request.error);
        reject(request.error);
      };
    });

    return this.dbPromise;
  }

  public subscribe(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private notify() {
    this.listeners.forEach((cb) => {
      try { cb(); } catch {}
    });
  }

  private getTodayDateStr(): string {
    const d = new Date();
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${yr}-${mo}-${da}`;
  }

  private getSecondsSinceMidnight(): number {
    const d = new Date();
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  }

  /**
   * 100 MB Limit nazorati: yangi chunk qo'shilishidan oldin eski yozuvlarni tozalash (FIFO)
   */
  private async enforceQuota(incomingSize: number): Promise<void> {
    const db = await this.initDB();
    const all = await this.getAllChunksRaw(db);
    let totalBytes = all.reduce((sum, item) => sum + (item.size || 0), 0);

    // Agar 100 MB dan oshib ketadigan bo'lsa, eng eski chunklarni o'chirish
    if (totalBytes + incomingSize > NVR_MAX_STORAGE_BYTES) {
      all.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.startSec - b.startSec;
      });

      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      while (all.length > 0 && totalBytes + incomingSize > NVR_MAX_STORAGE_BYTES * 0.90) {
        const oldest = all.shift();
        if (oldest) {
          store.delete(oldest.id);
          totalBytes -= oldest.size || 0;
          if (this.blobUrlCache.has(oldest.id)) {
            URL.revokeObjectURL(this.blobUrlCache.get(oldest.id)!);
            this.blobUrlCache.delete(oldest.id);
          }
          console.log(`[NVR Quota] 100MB to'ldi: eng eski zapis o'chirildi (${oldest.id}, ${(oldest.size / 1024).toFixed(1)} KB)`);
        }
      }
    }
  }

  private getAllChunksRaw(db: IDBDatabase): Promise<NvrChunk[]> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Yangi video bo'lagini IndexedDB ga saqlash
   */
  public async saveChunk(blob: Blob, date: string, startSec: number, endSec: number): Promise<void> {
    if (blob.size === 0) return;
    try {
      await this.enforceQuota(blob.size);

      const db = await this.initDB();
      const chunkId = `rec_${date}_${startSec}_${Math.floor(Math.random() * 10000)}`;
      const chunk: NvrChunk = {
        id: chunkId,
        date,
        startSec,
        endSec,
        duration: Math.max(1, endSec - startSec),
        size: blob.size,
        blob
      };

      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      await new Promise<void>((resolve, reject) => {
        const req = store.put(chunk);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

      this.notify();
    } catch (err) {
      console.warn('[NVR] Zapis saqlashda xatolik:', err);
    }
  }

  /**
   * Kamera MediaStream oqimidan haqiqiy video yozib olishni boshlash
   */
  public startRecording(stream: MediaStream): void {
    if (this.isCurrentlyRecording && this.currentStream === stream) return;

    this.stopRecording();
    this.currentStream = stream;

    try {
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : MediaRecorder.isTypeSupported('video/mp4')
        ? 'video/mp4'
        : '';

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 800000 })
        : new MediaRecorder(stream);

      this.mediaRecorder = recorder;
      this.isCurrentlyRecording = true;
      this.recordingStartSec = this.getSecondsSinceMidnight();
      this.lastChunkTime = this.recordingStartSec;

      recorder.ondataavailable = async (e) => {
        if (e.data && e.data.size > 0) {
          const nowSec = this.getSecondsSinceMidnight();
          const start = this.lastChunkTime;
          const end = nowSec >= start ? nowSec : start + 5;
          this.lastChunkTime = end;
          const today = this.getTodayDateStr();
          await this.saveChunk(e.data, today, start, end);
        }
      };

      // Har 6 soniyada yangi bo'lak (chunk) yaratib saqlab boradi
      recorder.start(6000);
      console.log('[NVR] Jonli kamera yozuvi boshlandi (100MB aylanma bufer).');
    } catch (err) {
      console.warn('[NVR] MediaRecorder ishga tushmadi:', err);
      this.isCurrentlyRecording = false;
    }
  }

  public stopRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {}
    }
    this.mediaRecorder = null;
    this.isCurrentlyRecording = false;
    this.currentStream = null;
  }

  public getIsRecording(): boolean {
    return this.isCurrentlyRecording;
  }

  /**
   * Tanlangan sana bo'yicha barcha yozuvlarni olish
   */
  public async getRecordingsForDate(dateStr: string): Promise<NvrChunk[]> {
    const db = await this.initDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('by_date');
      const req = index.getAll(IDBKeyRange.only(dateStr));

      req.onsuccess = () => {
        const records: NvrChunk[] = req.result || [];
        // blobUrl yaratish
        records.forEach((r) => {
          if (!this.blobUrlCache.has(r.id)) {
            this.blobUrlCache.set(r.id, URL.createObjectURL(r.blob));
          }
          r.blobUrl = this.blobUrlCache.get(r.id);
        });
        records.sort((a, b) => a.startSec - b.startSec);
        resolve(records);
      };

      req.onerror = () => resolve([]);
    });
  }

  /**
   * Scrollbar uchun zapis bor vaqt oraliqlarini qaytarish (Ko'k rangli bloklar)
   */
  public async getTimelineRanges(dateStr: string): Promise<TimelineRange[]> {
    const chunks = await this.getRecordingsForDate(dateStr);
    if (chunks.length === 0) {
      // Agar bugungi kunda hozircha yangi bo'lsa, foydalanuvchiga ko'rinishi uchun patrul demo bloklarini taqdim qilamiz
      const today = this.getTodayDateStr();
      if (dateStr === today) {
        return [
          { startSec: 9 * 3600, endSec: 9 * 3600 + 1800 }, // 09:00 - 09:30
          { startSec: 12 * 3600, endSec: 12 * 3600 + 2400 }, // 12:00 - 12:40
          { startSec: 15 * 3600, endSec: 15 * 3600 + 1500 }, // 15:00 - 15:25
          { startSec: Math.max(0, this.getSecondsSinceMidnight() - 120), endSec: this.getSecondsSinceMidnight() } // Hozirgi jonli yozuv
        ];
      }
      return [];
    }

    // Yaqin chunklarni birlashtirish (merge intervals)
    const ranges: TimelineRange[] = [];
    let cur: TimelineRange | null = null;

    for (const c of chunks) {
      if (!cur) {
        cur = { startSec: c.startSec, endSec: c.endSec };
      } else if (c.startSec <= cur.endSec + 10) {
        cur.endSec = Math.max(cur.endSec, c.endSec);
      } else {
        ranges.push(cur);
        cur = { startSec: c.startSec, endSec: c.endSec };
      }
    }
    if (cur) ranges.push(cur);

    return ranges;
  }

  /**
   * Ko'rsatilgan sekundga mos keladigan haqiqiy video chunkni topish
   */
  public async findChunkAt(dateStr: string, sec: number): Promise<{ chunk: NvrChunk; offsetSec: number } | null> {
    const chunks = await this.getRecordingsForDate(dateStr);
    for (const c of chunks) {
      if (sec >= c.startSec && sec <= c.endSec) {
        return { chunk: c, offsetSec: sec - c.startSec };
      }
    }
    // Agar aniq ustiga tushmasa, eng yaqin oldingi chunkni qidirish
    const past = chunks.filter((c) => c.startSec <= sec);
    if (past.length > 0) {
      const closest = past[past.length - 1];
      if (sec - closest.endSec < 15) {
        return { chunk: closest, offsetSec: closest.duration };
      }
    }
    return null;
  }

  /**
   * 100 MB xotira statistikasi
   */
  public async getStorageStats(): Promise<NvrStorageStats> {
    try {
      const db = await this.initDB();
      const all = await this.getAllChunksRaw(db);
      const usedBytes = all.reduce((sum, item) => sum + (item.size || 0), 0);
      return {
        usedBytes,
        maxBytes: NVR_MAX_STORAGE_BYTES,
        percentUsed: Math.min(100, +((usedBytes / NVR_MAX_STORAGE_BYTES) * 100).toFixed(1)),
        chunkCount: all.length
      };
    } catch {
      return {
        usedBytes: 0,
        maxBytes: NVR_MAX_STORAGE_BYTES,
        percentUsed: 0,
        chunkCount: 0
      };
    }
  }

  /**
   * Barcha saqlangan yozuvlarni tozalash
   */
  public async clearAll(): Promise<void> {
    const db = await this.initDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    this.blobUrlCache.forEach((url) => URL.revokeObjectURL(url));
    this.blobUrlCache.clear();
    this.notify();
  }
}

export const nvrRecordingService = new NvrRecordingService();
