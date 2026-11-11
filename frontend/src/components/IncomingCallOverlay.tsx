import React, { useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, MapPin } from 'lucide-react';
import { operatorCalls, type CallInfo } from '../services/voiceCall';
import { fleetWatcher, selectedRobotStore } from '../services/robotCamLink';
import { mapFocus } from '../services/mapFocus';
import { tacticalAudio } from '../services/audioService';
import { useRobot } from '../context/RobotContext';

/** Robot joylashuvi: chaqiruvdagi nuqta, bo'lmasa park telemetriyasidan */
function robotPos(c: CallInfo): { lat: number; lon: number } | null {
  if (c.lat !== undefined && c.lon !== undefined) return { lat: c.lat, lon: c.lon };
  const n = fleetWatcher.getState().robots.find((r) => r.id === c.robotId)?.tel?.nav;
  return n ? { lat: n.lat, lon: n.lon } : null;
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * OPERATOR: robotdan "102" chaqiruvi. Istalgan bo'limda ekran ustida chiqadi, signal chaladi, xarita robot joylashuviga
 * teleport bo'ladi. "Javob berish" -> robot bilan ikki tomonlama ovozli aloqa.
 */
export const IncomingCallOverlay: React.FC = () => {
  const { setActiveTab } = useRobot();
  const [calls, setCalls] = useState<CallInfo[]>(() => operatorCalls.list());
  const [, setTick] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const announcedRef = useRef(new Set<string>());

  useEffect(() => operatorCalls.subscribe(setCalls), []);

  const ringing = calls.filter((c) => c.state === 'ringing');
  const mine = calls.find((c) => c.mine && c.state === 'active');
  const others = calls.filter((c) => c.state === 'active' && !c.mine);

  // Yangi chaqiruv: xarita bo'limi ochiladi, robot tanlanadi va xarita uning joylashuviga teleport bo'ladi
  useEffect(() => {
    for (const c of ringing) {
      if (announcedRef.current.has(c.callId)) continue;
      announcedRef.current.add(c.callId);
      selectedRobotStore.set(c.robotId);
      setActiveTab('maps');
      const p = robotPos(c);
      if (p) mapFocus.request(p.lat, p.lon, { label: `102 · ${c.robotId}`, alert: true });
    }
  }, [ringing, setActiveTab]);

  // Javob berilmaguncha signal chalinadi
  const hasRinging = ringing.length > 0;
  useEffect(() => {
    if (!hasRinging) return;
    tacticalAudio.playObstacleAlert();
    const t = window.setInterval(() => tacticalAudio.playObstacleAlert(), 1400);
    return () => window.clearInterval(t);
  }, [hasRinging]);

  // Suhbat soatini yangilash
  useEffect(() => {
    if (!mine) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [mine]);

  if (!ringing.length && !mine && !others.length) return null;

  const showOnMap = (c: CallInfo) => {
    selectedRobotStore.set(c.robotId);
    setActiveTab('maps');
    const p = robotPos(c);
    if (p) mapFocus.request(p.lat, p.lon, { label: `102 · ${c.robotId}`, alert: true });
  };

  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[1000] w-[min(26rem,calc(100%-2rem))] flex flex-col gap-2 font-mono">
      {ringing.map((c) => (
        <div key={c.callId} className="rounded-2xl border-2 border-red-500 bg-red-950/95 backdrop-blur-md p-4 shadow-[0_0_40px_rgba(239,68,68,0.6)] call-102-ring">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-red-600 flex items-center justify-center text-white text-xl font-black shrink-0">102</div>
            <div className="min-w-0">
              <div className="text-white font-black text-base">Fuqaro chaqiruvi</div>
              <div className="text-red-200 text-sm truncate">{c.robotId} robotidan · {fmt(Date.now() - c.t)}</div>
            </div>
          </div>
          {micError && <div className="mt-2 text-amber-300 text-xs">{micError}</div>}
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              onClick={async () => {
                setMicError(null);
                const ok = await operatorCalls.accept(c.robotId);
                if (!ok) setMicError("Mikrofonga ruxsat bering yoki chaqiruv allaqachon tugagan");
              }}
              className="col-span-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center justify-center gap-2"
            >
              <Phone className="w-4 h-4" /> Javob berish
            </button>
            <button
              onClick={() => operatorCalls.dismiss(c.robotId)}
              className="py-2.5 rounded-xl bg-tactical-800 hover:bg-tactical-700 text-slate-200 font-bold flex items-center justify-center gap-1"
              title="Faqat shu ekrandan yopish (boshqa operatorlar javob berishi mumkin)"
            >
              <PhoneOff className="w-4 h-4" /> Yopish
            </button>
          </div>
          <button onClick={() => showOnMap(c)} className="mt-2 w-full text-xs text-red-200 hover:text-white flex items-center justify-center gap-1">
            <MapPin className="w-3.5 h-3.5" /> Xaritada ko'rsatish
          </button>
        </div>
      ))}

      {mine && (
        <div className="rounded-2xl border-2 border-emerald-400 bg-emerald-950/95 backdrop-blur-md p-3 shadow-xl flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-emerald-600 flex items-center justify-center text-white font-black shrink-0">102</div>
          <div className="min-w-0 flex-1">
            <div className="text-white font-bold text-sm">Suhbat: {mine.robotId}</div>
            <div className="text-emerald-300 text-xs">{fmt(Date.now() - (mine.since ?? Date.now()))}</div>
          </div>
          <button onClick={() => showOnMap(mine)} title="Xaritada ko'rsatish" className="p-2 rounded-lg bg-emerald-900 text-emerald-200 hover:text-white">
            <MapPin className="w-4 h-4" />
          </button>
          <button onClick={() => operatorCalls.hangup()} className="px-3 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold flex items-center gap-1.5">
            <PhoneOff className="w-4 h-4" /> Tugatish
          </button>
        </div>
      )}

      {!mine &&
        others.map((c) => (
          <div key={c.callId} className="rounded-xl border border-tactical-700 bg-tactical-950/95 px-3 py-2 text-xs text-slate-300 flex items-center justify-between">
            <span>102 · {c.robotId}: {c.by || 'boshqa operator'} gaplashmoqda</span>
            <button onClick={() => showOnMap(c)} className="text-police-cyan hover:text-white flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" /> Xarita
            </button>
          </div>
        ))}
    </div>
  );
};
