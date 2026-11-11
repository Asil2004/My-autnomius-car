/**
 * NVR yozuvi uchun "ramkali" video oqim: kamera kadri + odam identifikatsiya ramkalari + sana-vaqt bitta canvasga
 * chiziladi va shu canvas oqimi yoziladi. Shunda qayta ko'rishda ramkalar videoning o'zida (yozilgan paytdagi holatda)
 * ko'rinadi, jonli AI ramkalarini ustidan chizish shart emas.
 */

export interface OverlayBox {
  /** Kadr ulushlarida (0..1), ekranda ko'rinadigan yo'nalishda (oyna rejimi hisobga olingan) */
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  label: string;
  /** O'ng pastki burchakdagi qo'shimcha matn, masalan "~1.4 m" */
  note?: string;
}

export interface AnnotatedStream {
  stream: MediaStream;
  stop: () => void;
}

interface Options {
  /** Kadr gorizontal aks ettirilib chizilsinmi (ekrandagi oyna rejimi bilan bir xil bo'lishi uchun) */
  mirror: () => boolean;
  /** Joriy ramkalar (har kadrda o'qiladi) */
  getBoxes: () => OverlayBox[];
  fps?: number;
  /** Chap yuqori burchakdagi yozuv: "QALQON HUD" */
  title?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

function stamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Kamera videosidan ramkali oqim yaratish. Brauzer canvas.captureStream ni qo'llamasa, null */
export function createAnnotatedStream(video: HTMLVideoElement, opts: Options): AnnotatedStream | null {
  const canvas = document.createElement('canvas');
  if (typeof canvas.captureStream !== 'function') return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const fps = opts.fps ?? 15;
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;

  const draw = () => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || video.readyState < 2) return;
    if (canvas.width !== vw || canvas.height !== vh) {
      canvas.width = vw;
      canvas.height = vh;
    }
    const W = canvas.width;
    const H = canvas.height;

    // 1. Kadr (ekrandagidek: oyna rejimida aks ettirilgan)
    ctx.save();
    if (opts.mirror()) {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, W, H);
    ctx.restore();

    // 2. Odam ramkalari, ism va masofa
    const fontPx = Math.max(14, Math.round(H / 36));
    ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    for (const b of opts.getBoxes()) {
      const x = b.x * W;
      const y = b.y * H;
      const w = b.w * W;
      const h = b.h * H;
      ctx.lineWidth = Math.max(2, Math.round(H / 240));
      ctx.strokeStyle = b.color;
      ctx.strokeRect(x, y, w, h);

      const tw = ctx.measureText(b.label).width + fontPx * 0.8;
      const th = fontPx * 1.4;
      const ly = y - th >= 0 ? y - th : y; // tepada joy bo'lmasa ramka ichiga
      ctx.fillStyle = b.color;
      ctx.fillRect(x, ly, Math.min(tw, Math.max(w, tw)), th);
      ctx.fillStyle = '#0b1220';
      ctx.fillText(b.label, x + fontPx * 0.4, ly + fontPx * 0.2);

      if (b.note) {
        const nw = ctx.measureText(b.note).width + fontPx * 0.6;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(x + w - nw - 4, y + h - th - 4, nw, th);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(b.note, x + w - nw - 4 + fontPx * 0.3, y + h - th - 4 + fontPx * 0.2);
      }
    }

    // 3. Sana-vaqt (yozuvning o'zida qoladi)
    const text = `${opts.title ?? 'QALQON'}  ${stamp(new Date())}`;
    const tw = ctx.measureText(text).width + fontPx;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(8, 8, tw, fontPx * 1.5);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, 8 + fontPx * 0.5, 8 + fontPx * 0.25);
  };

  draw();
  // setInterval: requestAnimationFrame fon rejimida to'xtab qoladi, yozuv esa davom etishi kerak
  const timer = window.setInterval(draw, Math.round(1000 / fps));
  const stream = canvas.captureStream(fps);

  return {
    stream,
    stop: () => {
      window.clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
    }
  };
}
