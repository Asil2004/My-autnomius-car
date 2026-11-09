/**
 * BITTA OQIM, UCHTA LINZA: kamera serveridan butun kadr (3 linza ustma-ust, CP-159-1) bitta MJPEG ulanish orqali
 * olinadi va har bir oyna (PTZ / o'ng / chap, kichik va katta) o'z linzasini shu kadrdan qirqib chizadi.
 *
 * Nega <img> emas, fetch: Chrome <img> MJPEG ulanishini element o'chirilgandan keyin ham ochiq qoldirishi mumkin.
 * Bunday ulanishlar to'planib, bitta serverga 6 ulanish chegarasi to'lardi: yangi oqim navbatda qolib, tasvir
 * chiqmasdi, oyna almashganda esa eski kadr qolib ketardi. fetch + AbortController ulanishni kafolatli yopadi.
 *
 * Multipart oqim ("--frame / Content-Length / JPEG") qo'lda ajratiladi, har kadr ImageBitmap ga aylantiriladi.
 * 5 s kadr kelmasa (kamera yoki tarmoq qotdi) ulanish o'zi qayta ochiladi.
 */
import { ptzCameraService } from './ptzCameraService';

const RETRY_MS = 2000;
const STALL_MS = 5000;
const MAX_BUFFER = 4 * 1024 * 1024;

export interface LensFrame {
  src: CanvasImageSource;
  width: number;
  height: number;
  /** Kadr qabul qilingan vaqt (performance.now) */
  t: number;
}

const enc = new TextEncoder();
const HEADER_END = enc.encode('\r\n\r\n');

function indexOf(buf: Uint8Array, pat: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= buf.length - pat.length; i++) {
    for (let j = 0; j < pat.length; j++) if (buf[i + j] !== pat[j]) continue outer;
    return i;
  }
  return -1;
}

export class LensHub {
  private readonly url: (gen: number) => string;
  constructor(url: (gen: number) => string) {
    this.url = url;
  }
  private users = 0;
  private gen = 0;
  private abort: AbortController | null = null;
  private frame: LensFrame | null = null;
  private watchdog: number | null = null;
  private unsubBase: (() => void) | null = null;

  /** Oqimdan foydalanuvchi oyna qo'shildi. Qaytgan funksiya chaqirilsa ajraladi (oxirgisi ketsa ulanish yopiladi) */
  acquire(): () => void {
    this.users++;
    if (this.users === 1) this.open();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.users--;
      if (this.users === 0) this.close();
    };
  }

  /** Oxirgi kadr (hali kelmagan bo'lsa yoki eskirgan bo'lsa null) */
  current(): LensFrame | null {
    const f = this.frame;
    return f && performance.now() - f.t < STALL_MS ? f : null;
  }

  private open() {
    this.unsubBase = ptzCameraService.onBaseChange(() => this.restart());
    // Kadr kelmay qolsa (kamera uzildi, server qayta ishga tushdi) ulanishni yangilash
    this.watchdog = window.setInterval(() => {
      const f = this.frame;
      if (!f || performance.now() - f.t > STALL_MS) this.restart();
    }, STALL_MS);
    this.restart();
  }

  private close() {
    this.unsubBase?.();
    this.unsubBase = null;
    if (this.watchdog) window.clearInterval(this.watchdog);
    this.watchdog = null;
    this.gen++;
    this.abort?.abort();
    this.abort = null;
    this.setFrame(null);
  }

  private setFrame(f: LensFrame | null) {
    const old = this.frame;
    this.frame = f;
    if (old && old.src instanceof ImageBitmap && old.src !== f?.src) old.src.close();
  }

  private restart() {
    const gen = ++this.gen;
    this.abort?.abort();
    const ctrl = new AbortController();
    this.abort = ctrl;
    void this.read(gen, ctrl).catch(() => {
      /* uzildi: quyida qayta urinadi */
    }).finally(() => {
      if (gen === this.gen && this.users > 0) {
        window.setTimeout(() => {
          if (gen === this.gen && this.users > 0) this.restart();
        }, RETRY_MS);
      }
    });
  }

  private async read(gen: number, ctrl: AbortController) {
    const res = await fetch(this.url(gen), { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    let buf = new Uint8Array(0);
    let decoding = false;

    while (gen === this.gen) {
      const { value, done } = await reader.read();
      if (done) break;
      // Bufferga qo'shish
      const merged = new Uint8Array(buf.length + value.length);
      merged.set(buf);
      merged.set(value, buf.length);
      buf = merged;

      // To'liq kadrlarni ajratish: "--frame\r\nContent-Type: ...\r\nContent-Length: N\r\n\r\n<JPEG N bayt>\r\n"
      for (;;) {
        const hEnd = indexOf(buf, HEADER_END);
        if (hEnd < 0) break;
        const header = new TextDecoder().decode(buf.subarray(0, hEnd));
        const m = /content-length:\s*(\d+)/i.exec(header);
        if (!m) {
          buf = buf.subarray(hEnd + 4); // sarlavhasiz qism: o'tkazib yuboramiz
          continue;
        }
        const len = Number(m[1]);
        const start = hEnd + 4;
        if (buf.length < start + len) break; // kadr hali to'liq kelmagan
        const jpeg = buf.slice(start, start + len);
        buf = buf.subarray(start + len);
        // Dekoder band bo'lsa oraliq kadr tashlab yuboriladi (kechikish yig'ilmaydi)
        if (!decoding) {
          decoding = true;
          createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' }))
            .then((bmp) => {
              if (gen !== this.gen) {
                bmp.close();
                return;
              }
              this.setFrame({ src: bmp, width: bmp.width, height: bmp.height, t: performance.now() });
            })
            .catch(() => {
              /* buzilgan kadr */
            })
            .finally(() => {
              decoding = false;
            });
        }
      }
      if (buf.length > MAX_BUFFER) buf = new Uint8Array(0); // himoya: chegarasiz o'smasin
    }
    reader.cancel().catch(() => {});
  }
}

export const lensHub = new LensHub((gen) => ptzCameraService.fullStreamUrl(gen));

/** APK ichidagi USB web-kamera oqimi (Face ID manbai, planshet Android tashqi kamerani bermaganda) */
export const usbWebcamHub = new LensHub((gen) => `${ptzCameraService.getBase()}/webcam/stream?_=${gen}`);
