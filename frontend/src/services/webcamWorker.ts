/// <reference lib="webworker" />
/**
 * APK USB web-kamera MJPEG oqimini FON OQIMIDA o'qish: fetch, kadrlarni ajratish, JPEG ochish va video trekka yozish
 * butunlay shu yerda. Sahifaning asosiy oqimi (yuz aniqlash, interfeys) band bo'lsa ham tasvir qotmaydi.
 *
 * Kirish: { url, writable } (writable = MediaStreamTrackGenerator.writable, worker ga uzatilgan)
 * Chiqish: { type: 'frame', width, height } birinchi kadrda, { type: 'error', message }
 */
const enc = new TextEncoder();
const HEADER_END = enc.encode('\r\n\r\n');

function indexOf(buf: Uint8Array, pat: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= buf.length - pat.length; i++) {
    for (let j = 0; j < pat.length; j++) if (buf[i + j] !== pat[j]) continue outer;
    return i;
  }
  return -1;
}

let stopped = false;
let ctrl: AbortController | null = null;

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  if (msg?.type === 'stop') {
    stopped = true;
    ctrl?.abort();
    return;
  }
  const { url, writable } = msg as { url: string; writable: WritableStream<VideoFrame> };
  const writer = writable.getWriter();
  let announced = false;
  let decoding = false;

  while (!stopped) {
    try {
      ctrl = new AbortController();
      let lastFrame = performance.now();
      // 5 s kadr kelmasa (kamera yoki server qotdi) ulanish qayta ochiladi
      const stall = setInterval(() => {
        if (performance.now() - lastFrame > 5000) ctrl?.abort();
      }, 2000);
      try {
        const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader();
        let buf = new Uint8Array(0);
        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          const merged = new Uint8Array(buf.length + value.length);
          merged.set(buf);
          merged.set(value, buf.length);
          buf = merged;
          for (;;) {
            const hEnd = indexOf(buf, HEADER_END);
            if (hEnd < 0) break;
            const header = new TextDecoder().decode(buf.subarray(0, hEnd));
            const m = /content-length:\s*(\d+)/i.exec(header);
            if (!m) {
              buf = buf.subarray(hEnd + 4);
              continue;
            }
            const len = Number(m[1]);
            const start = hEnd + 4;
            if (buf.length < start + len) break;
            const jpeg = buf.slice(start, start + len);
            buf = buf.subarray(start + len);
            lastFrame = performance.now();
            // Dekoder band bo'lsa kadr tashlanadi: kechikish yig'ilmaydi
            if (decoding) continue;
            decoding = true;
            createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' }))
              .then(async (bmp) => {
                const frame = new VideoFrame(bmp, { timestamp: Math.round(performance.now() * 1000) });
                if (!announced) {
                  announced = true;
                  (self as unknown as Worker).postMessage({ type: 'frame', width: bmp.width, height: bmp.height });
                }
                bmp.close();
                try {
                  await writer.write(frame);
                } catch {
                  frame.close();
                  stopped = true; // trek to'xtatilgan
                }
              })
              .catch(() => {})
              .finally(() => {
                decoding = false;
              });
          }
          if (buf.length > 4 * 1024 * 1024) buf = new Uint8Array(0);
        }
        reader.cancel().catch(() => {});
      } finally {
        clearInterval(stall);
      }
    } catch (err) {
      if (!announced) (self as unknown as Worker).postMessage({ type: 'error', message: String(err) });
    }
    if (!stopped) await new Promise((r) => setTimeout(r, 1500));
  }
  try {
    await writer.close();
  } catch {
    /* allaqachon yopilgan */
  }
};
