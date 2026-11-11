import React, { useCallback, useEffect, useState } from 'react';
import { ScanFace } from 'lucide-react';
import { faceCameraSettings, type CameraOption, type FaceCameraChoice } from '../services/faceCameraSettings';

/** Sozlamalar: Face ID kamerasi manbai (frontal yoki USB web-kamera) */
export const FaceCameraCard: React.FC = () => {
  const [choice, setChoice] = useState<FaceCameraChoice>(() => faceCameraSettings.get());
  const [cams, setCams] = useState<CameraOption[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      let list = await faceCameraSettings.list();
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

  const hasExternal = cams.some((c) => c.external);

  return (
    <div className="hud-panel rounded-xl p-4 space-y-3 font-mono" data-face-camera-settings>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <ScanFace className="w-4 h-4 text-police-cyan" />
          FACE ID KAMERA MANBAI
        </h3>
        <span className="text-xs text-slate-400">{cams.length} ta kamera topildi</span>
      </div>
      <div className="flex gap-2 flex-wrap items-center">
        <select
          value={choice}
          onChange={(e) => faceCameraSettings.set(e.target.value)}
          className="flex-1 min-w-[220px] bg-tactical-900 border border-tactical-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-police-cyan"
        >
          <option value="auto">Avtomatik (USB web-kamera bo'lsa o'sha, bo'lmasa frontal)</option>
          <option value="front">Planshet frontal kamerasi</option>
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
          {busy ? 'Qidirilmoqda…' : 'Qayta qidirish'}
        </button>
      </div>
      <p className={`text-[11px] ${hasExternal ? 'text-police-green' : 'text-slate-500'}`}>
        {hasExternal
          ? 'USB web-kamera topildi. Tanlov darhol HUD va robot yuzi ekranida qo\'llanadi.'
          : "USB web-kamera ro'yxatda yo'q. Kamerani ulab \"Qayta qidirish\"ni bosing. Agar baribir chiqmasa, bu qurilmaning Android tizimi tashqi USB kameralarni brauzerga bermaydi."}
      </p>
    </div>
  );
};
