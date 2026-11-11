/**
 * QALQON NVR - kamera tasvirini avtomatik yozib olish va aylanma (FIFO) arxivlash xizmati
 *
 * Ikki xil saqlash joyi:
 * 1. DISK (asosiy): kompyuterdagi tanlangan papka (masalan, D:\QALQON_NVR), 1 GB. Brauzerning File System Access API
 *    orqali yoziladi (Chrome / Edge). Papka bir marta tanlanadi, keyin eslab qolinadi.
 *    Tuzilishi:  <papka>/2026-11-05/132500-132530.webm  (sana / boshlanish-tugash vaqti)
 * 2. BRAUZER (zaxira): papka tanlanmagan yoki ruxsat berilmagan bo'lsa, IndexedDB, 100 MB.
 *
 * Joy to'lganda eng eski yozuv(lar) o'chiriladi va yangisi yoziladi.
 *
 * Har bir yozuv 30 soniyalik alohida, o'zi ochiladigan WebM fayl (MediaRecorder har segmentda qayta ishga tushadi).
 * Aks holda (bitta MediaRecorder timeslice bilan) faqat birinchi bo'lak o'ynaladi, qolganlarida sarlavha bo'lmaydi.
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

export type NvrStorageMode = 'disk' | 'browser';

export interface NvrDiskStatus {
  /** Brauzer diskka yozishni qo'llab-quvvatlaydimi (Chrome / Edge kompyuter versiyasi) */
  supported: boolean;
  mode: NvrStorageMode;
  /** Tanlangan papka nomi (brauzer to'liq yo'lni bermaydi) */
  folderName: string | null;
  /** Papka tanlangan, lekin bu seansda ruxsat qayta so'ralishi kerak (bir marta bosish kifoya) */
  needsPermission: boolean;
  recording: boolean;
  lastError: string | null;
}

const DB_NAME = 'QalqonNVR_DB';
const DB_VERSION = 2;
const STORE_NAME = 'recordings';
const KV_STORE = 'kv';
const KV_DIR_HANDLE = 'diskDirHandle';

/** Brauzer (IndexedDB) zaxira chegarasi */
export const NVR_MAX_STORAGE_BYTES = 100 * 1024 * 1024;
/** Diskdagi papka chegarasi: 1 GB */
export const NVR_DISK_MAX_BYTES = 1024 * 1024 * 1024;
/** Bitta video faylning davomiyligi */
const SEGMENT_MS = 30_000;
const VIDEO_BITRATE = 800_000;

// File System Access API ning TS kutubxonasida yo'q qismlari
type PermissionMode = { mode: 'read' | 'readwrite' };
interface DirHandle extends FileSystemDirectoryHandle {
  queryPermission(d: PermissionMode): Promise<PermissionState>;
  requestPermission(d: PermissionMode): Promise<PermissionState>;
}
type DirectoryPicker = (opts?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: string }) => Promise<DirHandle>;

interface DiskEntry {
  date: string;
  name: string;
  size: number;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const dateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const secOfDay = (d: Date) => d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
const hhmmss = (sec: number) => `${pad(Math.floor(sec / 3600))}${pad(Math.floor((sec % 3600) / 60))}${pad(sec % 60)}`;
const parseHhmmss = (s: string) => Number(s.slice(0, 2)) * 3600 + Number(s.slice(2, 4)) * 60 + Number(s.slice(4, 6));
const FILE_RE = /^(\d{6})-(\d{6})\.(webm|mp4)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class NvrRecordingService {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private listeners: Array<() => void> = [];
  private blobUrlCache: Map<string, string> = new Map();

  // Yozish
  private currentStream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private segmentTimer: number | null = null;
  private recording = false;
  private mimeType = '';

  // Disk
  private dirHandle: DirHandle | null = null;
  private diskGranted = false;
  private diskIndex: DiskEntry[] | null = null; // eski -> yangi tartibda
  private diskQueue: Promise<void> = Promise.resolve();
  private lastError: string | null = null;
  /** Disk chegarasi (standart 1 GB; sinov uchun o'zgartirish mumkin) */
  public diskMaxBytes = NVR_DISK_MAX_BYTES;

  constructor() {
    if (typeof window !== 'undefined' && 'indexedDB' in window) {
      void this.restoreDiskFolder();
    }
  }

  // ===========================================================================
  // IndexedDB (zaxira ombor + papka manzilini eslab qolish)
  // ===========================================================================
  private initDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('by_date', 'date', { unique: false });
          store.createIndex('by_start', 'startSec', { unique: false });
          store.createIndex('by_time', ['date', 'startSec'], { unique: false });
        }
        if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        console.error('[NVR] IndexedDB ochishda xatolik:', request.error);
        reject(request.error);
      };
    });
    return this.dbPromise;
  }

  private async kvGet<T>(key: string): Promise<T | undefined> {
    const db = await this.initDB();
    return new Promise((resolve) => {
      const req = db.transaction(KV_STORE, 'readonly').objectStore(KV_STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => resolve(undefined);
    });
  }

  private async kvSet(key: string, value: unknown): Promise<void> {
    const db = await this.initDB();
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction(KV_STORE, 'readwrite').objectStore(KV_STORE).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private getAllChunksRaw(db: IDBDatabase): Promise<NvrChunk[]> {
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  public subscribe(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private notify() {
    this.listeners.forEach((cb) => {
      try {
        cb();
      } catch {
        /* tinglovchi xatosi yozishga ta'sir qilmaydi */
      }
    });
  }

  // ===========================================================================
  // Disk papkasi (File System Access API)
  // ===========================================================================
  public isDiskSupported(): boolean {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  }

  private get mode(): NvrStorageMode {
    return this.dirHandle && this.diskGranted ? 'disk' : 'browser';
  }

  public getDiskStatus(): NvrDiskStatus {
    return {
      supported: this.isDiskSupported(),
      mode: this.mode,
      folderName: this.dirHandle?.name ?? null,
      needsPermission: !!this.dirHandle && !this.diskGranted,
      recording: this.recording,
      lastError: this.lastError
    };
  }

  /** Oldin tanlangan papkani tiklash. Ruxsat saqlangan bo'lsa (Chrome "har safar ruxsat berish"), darhol diskka yozadi */
  private async restoreDiskFolder(): Promise<void> {
    try {
      const handle = await this.kvGet<DirHandle>(KV_DIR_HANDLE);
      if (!handle) return;
      this.dirHandle = handle;
      this.diskGranted = (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
      if (this.diskGranted) await this.scanDisk();
    } catch (err) {
      console.warn('[NVR] Saqlangan papkani tiklab bo\'lmadi:', err);
    }
    this.notify();
  }

  /** Foydalanuvchi papka tanlaydi (masalan, D:\QALQON_NVR). Tugma bosilganda chaqirilishi shart */
  public async chooseDiskFolder(): Promise<boolean> {
    const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
    if (!picker) {
      this.lastError = "Bu brauzer diskka yozishni qo'llab-quvvatlamaydi. Kompyuterda Chrome yoki Edge'dan foydalaning.";
      this.notify();
      return false;
    }
    try {
      const handle = await picker({ id: 'qalqon-nvr', mode: 'readwrite' });
      this.dirHandle = handle;
      this.diskGranted = (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
      await this.kvSet(KV_DIR_HANDLE, handle);
      this.lastError = null;
      if (this.diskGranted) await this.scanDisk();
      this.notify();
      return this.diskGranted;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return false; // foydalanuvchi bekor qildi
      this.lastError = err instanceof Error ? err.message : String(err);
      this.notify();
      return false;
    }
  }

  /**
   * Yangi seansda papkaga yozish ruxsatini qayta so'rash. Brauzer faqat foydalanuvchi bosganda so'rashga ruxsat beradi,
   * shuning uchun ekrandagi istalgan bosishda chaqiriladi.
   */
  public async resumeDiskAccess(): Promise<boolean> {
    if (!this.dirHandle || this.diskGranted) return this.diskGranted;
    try {
      this.diskGranted = (await this.dirHandle.requestPermission({ mode: 'readwrite' })) === 'granted';
      if (this.diskGranted) {
        this.lastError = null;
        await this.scanDisk();
      }
    } catch (err) {
      console.warn('[NVR] Diskka ruxsat olinmadi:', err);
    }
    this.notify();
    return this.diskGranted;
  }

  /** Papkadagi barcha yozuvlarni o'qib, hajm indeksini tuzish (eski -> yangi) */
  private async scanDisk(): Promise<void> {
    if (!this.dirHandle) return;
    const index: DiskEntry[] = [];
    for await (const [date, h] of this.dirHandle.entries()) {
      if (h.kind !== 'directory' || !DATE_RE.test(date)) continue;
      for await (const [name, fh] of (h as DirHandle).entries()) {
        if (fh.kind !== 'file' || !FILE_RE.test(name)) continue;
        const file = await (fh as FileSystemFileHandle).getFile();
        index.push({ date, name, size: file.size });
      }
    }
    index.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date.localeCompare(b.date)));
    this.diskIndex = index;
  }

  /** 1 GB chegarasi: yangi fayl sig'ishi uchun eng eski fayllarni o'chirish */
  private async enforceDiskQuota(incoming: number): Promise<void> {
    if (!this.dirHandle || !this.diskIndex) return;
    let used = this.diskIndex.reduce((s, e) => s + e.size, 0);
    while (this.diskIndex.length > 0 && used + incoming > this.diskMaxBytes) {
      const oldest = this.diskIndex.shift()!;
      used -= oldest.size;
      try {
        const dir = await this.dirHandle.getDirectoryHandle(oldest.date);
        await dir.removeEntry(oldest.name);
        this.revokeUrl(`${oldest.date}/${oldest.name}`);
        console.log(`[NVR] 1 GB to'ldi: eng eski yozuv o'chirildi ${oldest.date}/${oldest.name}`);
        // Bo'sh qolgan sana papkasini ham o'chiramiz
        if (!this.diskIndex.some((e) => e.date === oldest.date)) {
          await this.dirHandle.removeEntry(oldest.date, { recursive: true }).catch(() => {});
        }
      } catch (err) {
        console.warn('[NVR] Eski faylni o\'chirib bo\'lmadi:', err);
      }
    }
  }

  private async saveToDisk(blob: Blob, date: string, startSec: number, endSec: number): Promise<void> {
    if (!this.dirHandle) throw new Error('Papka tanlanmagan');
    if (!this.diskIndex) await this.scanDisk();
    await this.enforceDiskQuota(blob.size);
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const name = `${hhmmss(startSec)}-${hhmmss(endSec)}.${ext}`;
    const dir = await this.dirHandle.getDirectoryHandle(date, { create: true });
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
    this.diskIndex!.push({ date, name, size: blob.size });
  }

  // ===========================================================================
  // Brauzer (IndexedDB) zaxira ombori
  // ===========================================================================
  private async enforceBrowserQuota(incomingSize: number): Promise<void> {
    const db = await this.initDB();
    const all = await this.getAllChunksRaw(db);
    let totalBytes = all.reduce((sum, item) => sum + (item.size || 0), 0);
    if (totalBytes + incomingSize <= NVR_MAX_STORAGE_BYTES) return;
    all.sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.startSec - b.startSec));
    const store = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME);
    while (all.length > 0 && totalBytes + incomingSize > NVR_MAX_STORAGE_BYTES) {
      const oldest = all.shift()!;
      store.delete(oldest.id);
      totalBytes -= oldest.size || 0;
      this.revokeUrl(oldest.id);
    }
  }

  private async saveToBrowser(blob: Blob, date: string, startSec: number, endSec: number): Promise<void> {
    await this.enforceBrowserQuota(blob.size);
    const db = await this.initDB();
    const chunk: NvrChunk = {
      id: `rec_${date}_${hhmmss(startSec)}_${Math.floor(Math.random() * 10000)}`,
      date,
      startSec,
      endSec,
      duration: Math.max(1, endSec - startSec),
      size: blob.size,
      blob
    };
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(chunk);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /** Tayyor segmentni joriy omborga (disk yoki brauzer) navbat bilan saqlash */
  public saveChunk(blob: Blob, date: string, startSec: number, endSec: number): Promise<void> {
    if (blob.size === 0) return Promise.resolve();
    this.diskQueue = this.diskQueue.then(async () => {
      try {
        if (this.mode === 'disk') {
          try {
            await this.saveToDisk(blob, date, startSec, endSec);
            this.lastError = null;
          } catch (err) {
            // Disk uzildi yoki ruxsat bekor qilindi: yozuv yo'qolmasin, brauzerga saqlanadi
            this.lastError = `Diskka yozib bo'lmadi: ${err instanceof Error ? err.message : String(err)}`;
            this.diskGranted = false;
            await this.saveToBrowser(blob, date, startSec, endSec);
          }
        } else {
          await this.saveToBrowser(blob, date, startSec, endSec);
        }
      } catch (err) {
        console.warn('[NVR] Yozuvni saqlashda xatolik:', err);
      }
      this.notify();
    });
    return this.diskQueue;
  }

  // ===========================================================================
  // Yozib olish: 30 soniyalik o'zi ochiladigan segmentlar
  // ===========================================================================
  private pickMimeType(): string {
    const candidates = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm', 'video/mp4'];
    return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
  }

  /** Kamera oqimini avtomatik yozishni boshlash (kamera yoqilganda chaqiriladi) */
  public startRecording(stream: MediaStream): void {
    if (typeof MediaRecorder === 'undefined') return;
    if (this.recording && this.currentStream === stream) return;
    this.stopRecording();
    this.currentStream = stream;
    this.recording = true;
    this.mimeType = this.pickMimeType();
    this.startSegment();
    console.log(`[NVR] Avtomatik yozuv boshlandi (${this.mode === 'disk' ? 'disk, 1 GB' : 'brauzer, 100 MB'}).`);
    this.notify();
  }

  private startSegment(): void {
    const stream = this.currentStream;
    if (!this.recording || !stream) return;
    if (!stream.getVideoTracks().some((t) => t.readyState === 'live')) {
      this.stopRecording();
      return;
    }
    let rec: MediaRecorder;
    try {
      const opts: MediaRecorderOptions = { videoBitsPerSecond: VIDEO_BITRATE };
      if (this.mimeType) opts.mimeType = this.mimeType;
      // Faqat video: ovoz yozilmaydi
      rec = new MediaRecorder(new MediaStream(stream.getVideoTracks()), opts);
    } catch (err) {
      console.warn('[NVR] MediaRecorder ishga tushmadi:', err);
      this.recording = false;
      this.notify();
      return;
    }
    const parts: Blob[] = [];
    const started = new Date();
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) parts.push(e.data);
    };
    rec.onstop = () => {
      const ended = new Date();
      const date = dateStr(started);
      const startSec = secOfDay(started);
      // Yarim tundan o'tgan segment shu kun oxirida tugaydi
      const endSec = dateStr(ended) === date ? Math.max(startSec + 1, secOfDay(ended)) : 86399;
      void this.saveChunk(new Blob(parts, { type: rec.mimeType || 'video/webm' }), date, startSec, endSec);
      // Keyingi segment darhol boshlanadi
      if (this.recorder === rec) this.startSegment();
    };
    this.recorder = rec;
    rec.start(1000);
    this.segmentTimer = window.setTimeout(() => {
      if (rec.state !== 'inactive') rec.stop();
    }, SEGMENT_MS);
  }

  public stopRecording(): void {
    if (this.segmentTimer) window.clearTimeout(this.segmentTimer);
    this.segmentTimer = null;
    const rec = this.recorder;
    this.recorder = null; // onstop keyingi segmentni boshlamasligi uchun
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop(); // oxirgi qism ham saqlanadi
      } catch {
        /* allaqachon to'xtagan */
      }
    }
    const was = this.recording;
    this.recording = false;
    this.currentStream = null;
    if (was) this.notify();
  }

  public getIsRecording(): boolean {
    return this.recording;
  }

  // ===========================================================================
  // Qayta ko'rish (Playback) va statistika
  // ===========================================================================
  private revokeUrl(key: string) {
    const url = this.blobUrlCache.get(key);
    if (url) {
      URL.revokeObjectURL(url);
      this.blobUrlCache.delete(key);
    }
  }

  private urlFor(key: string, blob: Blob): string {
    let url = this.blobUrlCache.get(key);
    if (!url) {
      url = URL.createObjectURL(blob);
      this.blobUrlCache.set(key, url);
    }
    return url;
  }

  public async getRecordingsForDate(date: string): Promise<NvrChunk[]> {
    const records: NvrChunk[] = [];
    // Diskdagi yozuvlar
    if (this.mode === 'disk' && this.dirHandle) {
      try {
        const dir = (await this.dirHandle.getDirectoryHandle(date)) as DirHandle;
        for await (const [name, fh] of dir.entries()) {
          const m = FILE_RE.exec(name);
          if (fh.kind !== 'file' || !m) continue;
          const file = await (fh as FileSystemFileHandle).getFile();
          const startSec = parseHhmmss(m[1]);
          const endSec = parseHhmmss(m[2]);
          const id = `${date}/${name}`;
          records.push({ id, date, startSec, endSec, duration: Math.max(1, endSec - startSec), size: file.size, blob: file, blobUrl: this.urlFor(id, file) });
        }
      } catch {
        /* bu sanada papka yo'q */
      }
    }
    // Brauzerdagi yozuvlar (zaxira, yoki disk tanlanishidan oldingilari)
    try {
      const db = await this.initDB();
      const browserRecs = await new Promise<NvrChunk[]>((resolve) => {
        const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).index('by_date').getAll(IDBKeyRange.only(date));
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
      for (const r of browserRecs) records.push({ ...r, blobUrl: this.urlFor(r.id, r.blob) });
    } catch {
      /* IndexedDB yo'q */
    }
    records.sort((a, b) => a.startSec - b.startSec);
    return records;
  }

  /** Vaqt shkalasi uchun yozuv bor oraliqlar (ko'k bloklar) */
  public async getTimelineRanges(date: string): Promise<TimelineRange[]> {
    const chunks = await this.getRecordingsForDate(date);
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

  public async findChunkAt(date: string, sec: number): Promise<{ chunk: NvrChunk; offsetSec: number } | null> {
    const chunks = await this.getRecordingsForDate(date);
    for (const c of chunks) {
      if (sec >= c.startSec && sec <= c.endSec) return { chunk: c, offsetSec: sec - c.startSec };
    }
    const past = chunks.filter((c) => c.startSec <= sec);
    if (past.length > 0) {
      const closest = past[past.length - 1];
      if (sec - closest.endSec < 15) return { chunk: closest, offsetSec: closest.duration };
    }
    return null;
  }

  /** Joriy ombor (disk 1 GB yoki brauzer 100 MB) statistikasi */
  public async getStorageStats(): Promise<NvrStorageStats> {
    if (this.mode === 'disk') {
      if (!this.diskIndex) await this.scanDisk().catch(() => {});
      const idx = this.diskIndex ?? [];
      const usedBytes = idx.reduce((s, e) => s + e.size, 0);
      return {
        usedBytes,
        maxBytes: this.diskMaxBytes,
        percentUsed: Math.min(100, +((usedBytes / this.diskMaxBytes) * 100).toFixed(1)),
        chunkCount: idx.length
      };
    }
    try {
      const all = await this.getAllChunksRaw(await this.initDB());
      const usedBytes = all.reduce((sum, item) => sum + (item.size || 0), 0);
      return {
        usedBytes,
        maxBytes: NVR_MAX_STORAGE_BYTES,
        percentUsed: Math.min(100, +((usedBytes / NVR_MAX_STORAGE_BYTES) * 100).toFixed(1)),
        chunkCount: all.length
      };
    } catch {
      return { usedBytes: 0, maxBytes: NVR_MAX_STORAGE_BYTES, percentUsed: 0, chunkCount: 0 };
    }
  }

  /** Brauzerdagi zaxira yozuvlarni tozalash (diskdagi fayllarga tegmaydi) */
  public async clearAll(): Promise<void> {
    const db = await this.initDB();
    db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).clear();
    this.blobUrlCache.forEach((url) => URL.revokeObjectURL(url));
    this.blobUrlCache.clear();
    this.notify();
  }
}

export const nvrRecordingService = new NvrRecordingService();
