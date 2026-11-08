import React, { useEffect, useState } from 'react';
import { Video } from 'lucide-react';
import { ptzCameraService, DEFAULT_PTZ_BASE, type PtzCameraStatus } from '../services/ptzCameraService';

/** Sozlamalar: PTZ kamera moduli (camera_server) manzili va holati */
export const PtzCameraCard: React.FC = () => {
  const [base, setBase] = useState(() => ptzCameraService.getBase());
  const [input, setInput] = useState(base);
  const [status, setStatus] = useState<PtzCameraStatus>(() => ptzCameraService.getStatus());

  useEffect(
    () =>
      ptzCameraService.onBaseChange((b) => {
        setBase(b);
        setInput(b);
      }),
    []
  );
  useEffect(() => ptzCameraService.subscribe(setStatus), []);

  const tone = !status.reachable ? 'text-rose-400' : status.video ? 'text-police-green' : 'text-amber-300';

  return (
    <div className="hud-panel rounded-xl p-4 space-y-3 font-mono" data-ptz-camera-settings>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Video className="w-4 h-4 text-police-cyan" />
          PTZ KAMERA MODULI (PTZ + O'NG + CHAP)
        </h3>
        <span className={`text-xs font-bold ${tone}`}>
          {!status.reachable
            ? 'Server topilmadi'
            : status.video
            ? `Ulangan • ${status.lenses} linza${status.ptz ? ' • PTZ tayyor' : ''}`
            : `Server bor, video yo'q${status.error ? `: ${status.error}` : ''}`}
        </span>
      </div>
      <p className="text-xs text-slate-400">
        Uch linzali kamera: 1-linza PTZ (joystik bilan buriladi), 2-linza o'ngga, 3-linza chapga qaragan. Video va burish
        buyruqlari kamera serveri (camera_server/start.ps1) orqali o'tadi.
      </p>
      <div className="flex gap-2 flex-wrap items-center">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
          placeholder={DEFAULT_PTZ_BASE}
          className="flex-1 min-w-[220px] bg-tactical-900 border border-tactical-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-police-cyan"
        />
        {input.trim() !== base && (
          <button
            type="button"
            onClick={() => ptzCameraService.setBase(input)}
            className="px-3 py-2 rounded-lg bg-police-blue text-white text-xs font-bold"
          >
            Saqlash
          </button>
        )}
        <button
          type="button"
          onClick={() => void ptzCameraService.refresh()}
          className="px-3 py-2 rounded-lg bg-tactical-800 border border-tactical-700 text-slate-200 text-xs"
        >
          Tekshirish
        </button>
      </div>
      <div className="text-[11px] text-slate-500">
        Kamera serveri shu kompyuterda bo'lsa: {DEFAULT_PTZ_BASE}. Boshqa qurilmada (masalan Raspberry Pi) bo'lsa:
        http://&lt;IP&gt;:8090/camera
      </div>
    </div>
  );
};
