import React, { useEffect, useRef, useState } from 'react';
import { VideoOff, RefreshCw } from 'lucide-react';
import { ptzCameraService, CAMERA_ROTATED_180, type PtzLens, type PtzCameraStatus } from '../services/ptzCameraService';
import { lensHub } from '../services/lensHub';
import { remoteLens } from '../services/ptzRelay';
import { camLinkSettings } from '../services/camLinkSettings';

const DRAW_FPS = 15;

/**
 * Kamera moduli (camera_server) linzasining jonli tasviri. Video bitta umumiy oqimdan (lensHub) olinadi va kerakli
 * linza kadrdan qirqib canvas ga chiziladi: oynalar qancha bo'lmasin serverga bitta ulanish, eski kadr qolib ketmaydi.
 */
export const PtzLensView: React.FC<{
  lens: PtzLens;
  /** tile: kichik oyna (kadr to'ldiriladi); main: katta oyna (kadr to'liq ko'rinadi) */
  variant: 'tile' | 'main';
  label: string;
  className?: string;
}> = ({ lens, variant, label, className = '' }) => {
  // Operator: tasvir robotdan WebRTC orqali keladi; robot: kamera serveridan to'g'ridan-to'g'ri
  const [remote] = useState(() => camLinkSettings.get().role === 'operator');
  const hub = remote ? remoteLens : lensHub;
  const statusSrc = remote ? remoteLens : ptzCameraService;
  const [base, setBase] = useState(() => ptzCameraService.getBase());
  const [status, setStatus] = useState<PtzCameraStatus>(() => statusSrc.getStatus());
  const [ok, setOk] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => ptzCameraService.onBaseChange(setBase), []);
  useEffect(() => statusSrc.subscribe(setStatus), [statusSrc]);
  useEffect(() => hub.acquire(), [hub]);

  // Chizish sikli: linza o'zgarsa yoki oqim yangilansa ham har kadrda aynan shu linza chiziladi
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
      if (lens >= lenses) return;
      const src = frame.src;
      const sw = frame.width;
      const sh = frame.height / lenses;
      const sy = sh * lens;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = Math.max(1, Math.round(wrap.clientWidth * dpr));
      const ch = Math.max(1, Math.round(wrap.clientHeight * dpr));
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      // tile: cover (bo'sh joy qolmaydi), main: contain (kadr to'liq)
      const scale = variant === 'tile' ? Math.max(cw / sw, ch / sh) : Math.min(cw / sw, ch / sh);
      const dw = sw * scale;
      const dh = sh * scale;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cw, ch);
      try {
        if (CAMERA_ROTATED_180) {
          // Kamera teskari o'rnatilgan: kadrni 180° aylantirib chizamiz
          ctx.save();
          ctx.translate(cw, ch);
          ctx.rotate(Math.PI);
        }
        ctx.drawImage(src, 0, sy, sw, sh, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
        if (CAMERA_ROTATED_180) ctx.restore();
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
  }, [lens, variant, hub]);

  const live = ok && status.video;
  const reason = !status.reachable
    ? 'Kamera serveri ishlamayapti'
    : !status.video
    ? status.error || 'Kameradan video kelmayapti'
    : status.lenses && lens >= status.lenses
    ? `Kamerada ${status.lenses} ta linza bor`
    : 'Ulanmoqda...';

  return (
    <div ref={wrapRef} className={`relative w-full h-full bg-black ${className}`} data-lens={lens}>
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
                : `Noutbukda camera_server/start.ps1 ni ishga tushiring. Manzil: ${base} (Sozlamalar → PTZ kamera moduli).`}
            </div>
          </div>
        ))}
    </div>
  );
};
