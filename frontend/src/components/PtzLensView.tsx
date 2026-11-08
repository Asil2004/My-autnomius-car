import React, { useEffect, useRef, useState } from 'react';
import { VideoOff, RefreshCw } from 'lucide-react';
import { ptzCameraService, type PtzLens, type PtzCameraStatus } from '../services/ptzCameraService';

/**
 * Kamera moduli (camera_server) linzasining jonli MJPEG videosi.
 * Kadr kelmasa yoki uzilsa 5 s da bir qayta ulanadi; server topilmasa sababi ko'rsatiladi.
 */
export const PtzLensView: React.FC<{
  lens: PtzLens;
  /** tile: kichik oyna (object-cover, qisqa yozuv); main: katta oyna (object-contain, to'liq ko'rsatma) */
  variant: 'tile' | 'main';
  label: string;
  className?: string;
}> = ({ lens, variant, label, className = '' }) => {
  const [base, setBase] = useState(() => ptzCameraService.getBase());
  const [status, setStatus] = useState<PtzCameraStatus>(() => ptzCameraService.getStatus());
  const [nonce, setNonce] = useState(0);
  const [ok, setOk] = useState(false);

  useEffect(() => ptzCameraService.onBaseChange(setBase), []);
  useEffect(() => ptzCameraService.subscribe(setStatus), []);
  // MJPEG oqimida Chrome "load" hodisasini har doim chiqarmaydi: birinchi kadr kelganini naturalWidth dan bilamiz.
  // 5 s ichida kadr kelmasa qayta ulanadi (server keyinroq ishga tushsa ham video o'zi paydo bo'ladi)
  const imgRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    if (ok) return;
    const started = Date.now();
    const t = window.setInterval(() => {
      if ((imgRef.current?.naturalWidth ?? 0) > 0) setOk(true);
      else if (Date.now() - started > 5000) setNonce((n) => n + 1);
    }, 400);
    return () => clearInterval(t);
  }, [ok, nonce]);
  // Server video yo'qolganini aytsa (kamera uzildi), oqimni qayta ulashga o'tamiz
  useEffect(() => {
    if (ok && status.reachable === false) setOk(false);
  }, [ok, status.reachable]);
  useEffect(() => {
    setOk(false);
    setNonce((n) => n + 1);
  }, [base]);

  const reason = !status.reachable
    ? 'Kamera serveri ishlamayapti'
    : !status.video
    ? status.error || 'Kameradan video kelmayapti'
    : status.lenses && lens >= status.lenses
    ? `Kamerada ${status.lenses} ta linza bor`
    : 'Ulanmoqda...';

  return (
    <div className={`relative w-full h-full bg-black ${className}`}>
      <img
        ref={imgRef}
        key={nonce}
        src={ptzCameraService.streamUrl(lens, nonce)}
        alt={label}
        onLoad={() => setOk(true)}
        onError={() => setOk(false)}
        className={`absolute inset-0 w-full h-full ${variant === 'tile' ? 'object-cover' : 'object-contain'} ${ok ? '' : 'invisible'}`}
        draggable={false}
      />
      {!ok &&
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
              {status.reachable
                ? "Kamera quvvati va LAN kabelini, V380 ilovasida ONVIF yoqilganini tekshiring."
                : `Noutbukda camera_server/start.ps1 ni ishga tushiring. Manzil: ${base} (Sozlamalar → PTZ kamera moduli).`}
            </div>
          </div>
        ))}
    </div>
  );
};
