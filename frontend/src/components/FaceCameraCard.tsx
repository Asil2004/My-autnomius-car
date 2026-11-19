import React, { useCallback, useEffect, useState } from 'react';
import { ScanFace } from 'lucide-react';
import {
  faceCameraSettings,
  type CameraOption,
  type FaceCameraChoice,
  type PiWebcamStatus
} from '../services/faceCameraSettings';

/** Sozlamalar: Face ID / Frontal kamerasi manbai (Raspberry Pi USB web-kamera, lokal USB yoki frontal) */
export const FaceCameraCard: React.FC = () => {
  const [choice, setChoice] = useState<FaceCameraChoice>(() => faceCameraSettings.get());
  const [piBase, setPiBase] = useState<string>(() => faceCameraSettings.getPiWebcamBase());
  const [piStatus, setPiStatus] = useState<PiWebcamStatus>({ reachable: false, connected: false });
  const [cams, setCams] = useState<CameraOption[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [piRes, initialList] = await Promise.all([
        faceCameraSettings.checkPiWebcam(),
        faceCameraSettings.list()
      ]);
      setPiStatus(piRes);

      let list = initialList;
      // Nomlar bo'sh: kameraga ruxsat hali berilmagan. Qisqa ochib-yopib ruxsat olamiz
      if (list.length && list.every((c) => !c.label || /^Kamera \d+$/.test(c.label))) {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          s.getTracks().forEach((t) => t.stop());
          list = await faceCameraSettings.list();
        } catch {
          /* ruxsat yo'q */
        }
      }
      setCams(list);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const md = navigator.mediaDevices;
    const onChange = () => void refresh();
    md?.addEventListener?.('devicechange', onChange);
    return () => md?.removeEventListener?.('devicechange', onChange);
  }, [refresh]);
  useEffect(() => faceCameraSettings.subscribe(setChoice), []);
  useEffect(() => faceCameraSettings.subscribePiBase(setPiBase), []);

  const hasExternal = cams.some((c) => c.external);

  const savePiBase = () => {
    faceCameraSettings.setPiWebcamBase(piBase);
    void refresh();
  };

  return (
    <div className="hud-panel rounded-xl p-4 space-y-3 font-mono" data-face-camera-settings>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <ScanFace className="w-4 h-4 text-police-cyan" />
          FACE ID / FRONTAL KAMERA MANBAI
        </h3>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`px-2 py-0.5 rounded border ${
              piStatus.connected
                ? 'bg-police-green/15 border-police-green/50 text-police-green'
                : 'bg-tactical-900 border-tactical-700 text-slate-400'
            }`}
          >
            {piStatus.connected
              ? `Pi USB: ONLINE (${piStatus.width}×${piStatus.height})`
              : 'Pi USB: Oflayn'}
          </span>
          <span className="text-slate-400">{cams.length} ta lokal</span>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <select
          value={choice}
          onChange={(e) => faceCameraSettings.set(e.target.value)}
          className="flex-1 min-w-[220px] bg-tactical-900 border border-tactical-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-police-cyan"
        >
          <option value="auto">Avtomatik (Pi USB web-kamera / lokal USB / frontal)</option>
          <option value="pi-webcam">🍓 Raspberry Pi USB web-kamera (/api/webcam/stream)</option>
          <option value="front">Planshet / qurilma frontal kamerasi</option>
          {cams.map((c) => (
            <option key={c.deviceId} value={c.deviceId}>
              {c.external ? '🔌 ' : ''}
              {c.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          className="px-3 py-2 rounded-lg bg-tactical-800 border border-tactical-700 text-slate-200 text-xs disabled:opacity-50"
        >
          {busy ? 'Tekshirilmoqda…' : 'Qayta tekshirish'}
        </button>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <input
          type="url"
          value={piBase}
          onChange={(e) => setPiBase(e.target.value)}
          placeholder="http://10.180.187.132:8000"
          className="flex-1 min-w-[200px] bg-tactical-900 border border-tactical-700 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-police-cyan"
        />
        <button
          type="button"
          onClick={savePiBase}
          className="px-3 py-1.5 rounded-lg bg-police-blue/25 border border-police-cyan/60 text-police-cyan hover:bg-police-blue/40 text-xs font-bold"
        >
          Pi manzilini saqlash
        </button>
      </div>

      <p className={`text-[11px] ${piStatus.connected || hasExternal ? 'text-police-green' : 'text-slate-500'}`}>
        {piStatus.connected
          ? `Raspberry Pi USB web-kamera faol (${piStatus.device ?? '/dev/video0'}${piStatus.name ? ` · ${piStatus.name}` : ''}). HUD Frontal oynasida va Taktil Chiziqda avtomatik ishlaydi.`
          : hasExternal
          ? "Lokal USB web-kamera topildi. Tanlov darhol HUD va robot yuzi ekranida qo'llanadi."
          : "Raspberry Pi ga USB web-kamera ulangan bo'lsa, lidar_bridge_server.py ni yangilab ishga tushiring (port 8000) va Pi manzilini kiriting."}
      </p>
    </div>
  );
};
