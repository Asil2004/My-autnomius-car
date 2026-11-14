import React, { useEffect, useRef, useState } from 'react';
import { VideoOff, RefreshCw } from 'lucide-react';
import { ptzCameraService, CAMERA_ROTATED_180, type PtzCameraStatus } from '../services/ptzCameraService';
import { lensHub } from '../services/lensHub';
import { remoteLens } from '../services/ptzRelay';
import { camLinkSettings } from '../services/camLinkSettings';

const DRAW_FPS = 15;
// Chap | PTZ (markaz) | O'ng tartibida yonma-yon: uchta linzani bitta keng "panorama" qilib ko'rsatadi.
// Geometrik moslashtirish (stitching) yo'q — har bir linza o'z joyiga qirqib qo'yiladi, chegarada ingichka chiziq bor.
const PANORAMA_ORDER = [2, 0, 1] as const;

/**
 * PTZ / o'ng / chap uchta linzani bitta kengaytirilgan ("panorama") ko'rinishda birlashtirib ko'rsatadi.
 * Video PtzLensView bilan bitta umumiy oqimdan (lensHub) olinadi — qo'shimcha server ulanishi kerak emas.
 */
export const PanoramaLensView: React.FC<{
  /** tile: kichik oyna; main: katta oyna */
  variant: 'tile' | 'main';
  label: string;
  className?: string;
}> = ({ variant, label, className = '' }) => {
  const [remote] = useState(() => camLinkSettings.get().role === 'operator');
  const hub = remote ? remoteLens : lensHub;
  const statusSrc = remote ? remoteLens : ptzCameraService;
  const [status, setStatus] = useState<PtzCameraStatus>(() => statusSrc.getStatus());
  const [ok, setOk] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => statusSrc.subscribe(setStatus), [statusSrc]);
  useEffect(() => hub.acquire(), [hub]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    let shown = false;
    setOk(false);
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 1000 / DRAW_FPS) return;
      last = now;
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      const frame = hub.current();
      if (!canvas || !wrap) return;
      if (!frame) {
        if (shown) {
          shown = false;
          setOk(false);
        }
        return;
      }
      // Linzalar soni kadr nisbatidan (16:9 bo'laklar): CP-159-1 da 1920x3240 = 3 ta
      const lenses = Math.max(1, Math.round((frame.height * 16) / (frame.width * 9)));
      const order = PANORAMA_ORDER.filter((l) => l < lenses);
      if (order.length === 0) return;
      const src = frame.src;
      const sw = frame.width;
      const sh = frame.height / lenses;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = Math.max(1, Math.round(wrap.clientWidth * dpr));
      const ch = Math.max(1, Math.round(wrap.clientHeight * dpr));
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cw, ch);

      const gap = Math.max(1, Math.round(2 * dpr));
      const slotW = (cw - gap * (order.length - 1)) / order.length;
      try {
        order.forEach((lens, i) => {
          const sy = sh * lens;
          const x0 = i * (slotW + gap);
          // tile: cover (bo'sh joy qolmaydi), main: contain (kadr to'liq)
          const scale = variant === 'tile' ? Math.max(slotW / sw, ch / sh) : Math.min(slotW / sw, ch / sh);
          const dw = sw * scale;
          const dh = sh * scale;
          ctx.save();
          ctx.beginPath();
          ctx.rect(x0, 0, slotW, ch);
          ctx.clip();
          ctx.translate(x0, 0);
          if (CAMERA_ROTATED_180) {
            // Kamera teskari o'rnatilgan: har bir linza kadri o'z joyida 180° aylantirib chiziladi
            ctx.translate(slotW, ch);
            ctx.rotate(Math.PI);
          }
          ctx.drawImage(src, 0, sy, sw, sh, (slotW - dw) / 2, (ch - dh) / 2, dw, dh);
          ctx.restore();
        });
        // Linzalar orasidagi chegara chizig'i
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        for (let i = 1; i < order.length; i++) ctx.fillRect(i * (slotW + gap) - gap, 0, gap, ch);
      } catch {
        return; // kadr hali dekodlanmagan
      }
      if (!shown) {
        shown = true;
        setOk(true);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [variant, hub]);

  const live = ok && status.video;
  const reason = !status.reachable
    ? 'Kamera serveri ishlamayapti'
    : !status.video
    ? status.error || 'Kameradan video kelmayapti'
    : 'Ulanmoqda...';

  return (
    <div ref={wrapRef} className={`relative w-full h-full bg-black ${className}`} data-panorama="1">
      <canvas ref={canvasRef} aria-label={label} className={`absolute inset-0 w-full h-full ${live ? '' : 'invisible'}`} />
      {!live &&
        (variant === 'tile' ? (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-slate-500" title={reason}>
            <VideoOff className="w-4 h-4" />
            <span className="text-[10px]">Signal yo'q</span>
          </span>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center bg-tactical-950">
            {status.reachable ? <RefreshCw className="w-9 h-9 text-police-cyan animate-spin" /> : <VideoOff className="w-10 h-10 text-slate-500" />}
            <div className="text-sm font-semibold text-slate-200">
              {label}: {reason}
            </div>
            <div className="text-xs text-slate-400 max-w-md leading-relaxed">
              {remote
                ? "Robotga PTZ kamera moduli ulanib, robot planshetida kamera serveri tasviri ochilganda shu yerda ko'rinadi."
                : status.reachable
                ? "Kamera quvvati va LAN kabelini, V380 ilovasida ONVIF yoqilganini tekshiring."
                : 'Kamera serveri bilan aloqa yo\'q (Sozlamalar → PTZ kamera moduli).'}
            </div>
          </div>
        ))}
    </div>
  );
};
