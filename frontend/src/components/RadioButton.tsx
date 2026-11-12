import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Radio } from 'lucide-react';
import { RadioRecorder, MAX_RADIO_MS } from '../services/radioVoice';
import { operatorCalls } from '../services/voiceCall';
import { tacticalAudio } from '../services/audioService';
import { useRobot, watchedRobotId } from '../context/RobotContext';

/**
 * RATSIYA (operator): tugmani bosib turib gapiring, qo'yib yuborganda ovoz tanlangan robotga ketadi va robot
 * dinamigida ratsiya ovozida 100% balandlikda eshitiladi. Bir marta bosish ham ishlaydi: bosish -> gapirish -> yana bosish.
 */
export const RadioButton: React.FC = () => {
  const { addLog } = useRobot();
  const recRef = useRef<RadioRecorder | null>(null);
  const [state, setState] = useState<'idle' | 'rec' | 'sending'>('idle');
  const [secs, setSecs] = useState(0);
  const pressAtRef = useRef(0);

  useEffect(() => {
    if (state !== 'rec') return;
    const t0 = Date.now();
    const t = window.setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 250);
    return () => window.clearInterval(t);
  }, [state]);

  const finish = useCallback(async () => {
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    setState('sending');
    const clip = await rec.stop().catch(() => null);
    const robotId = watchedRobotId();
    if (!clip) {
      setState('idle');
      return;
    }
    if (!robotId) {
      addLog('SYSTEM', 'warn', "Ratsiya: onlayn robot yo'q");
      setState('idle');
      return;
    }
    const ok = await operatorCalls.sendCommand(robotId, { type: 'radio', ...clip });
    tacticalAudio.playClick();
    addLog('SYSTEM', ok ? 'success' : 'error', ok ? `Ratsiya ${robotId} robotiga yuborildi (${(clip.ms / 1000).toFixed(1)} s)` : "Ratsiya yuborilmadi (aloqa yo'q)");
    setState('idle');
  }, [addLog]);

  const begin = useCallback(async () => {
    if (recRef.current || state === 'sending') return;
    const rec = new RadioRecorder();
    recRef.current = rec;
    pressAtRef.current = Date.now();
    try {
      await rec.start(() => void finish());
      tacticalAudio.playCommandBeep();
      setSecs(0);
      setState('rec');
    } catch {
      recRef.current = null;
      addLog('SYSTEM', 'error', 'Ratsiya: mikrofonga ruxsat berilmadi');
      setState('idle');
    }
  }, [addLog, finish, state]);

  // Bosib turish: qo'yib yuborganda yuboriladi. Qisqa bosish (<350 ms): yozish davom etadi, keyingi bosishda yuboriladi
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    if (state === 'rec') {
      void finish();
      return;
    }
    void begin();
  };
  const onUp = () => {
    if (state !== 'rec' && !recRef.current) return;
    if (Date.now() - pressAtRef.current > 350) void finish();
  };

  useEffect(() => () => recRef.current?.cancel(), []);

  return (
    <button
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerLeave={(e) => {
        if (e.buttons) onUp();
      }}
      onContextMenu={(e) => e.preventDefault()}
      disabled={state === 'sending'}
      title={`Ratsiya: bosib turib gapiring, qo'yib yuboring (maks. ${MAX_RADIO_MS / 1000} s). Ovoz robotda ratsiya ovozida chiqadi`}
      aria-label="Ratsiya: robotga ovoz yuborish"
      className={`px-2.5 py-1.5 rounded font-mono text-xs font-bold flex items-center gap-1.5 border transition-all select-none touch-none ${
        state === 'rec'
          ? 'bg-rose-600 text-white border-rose-300 animate-pulse shadow-[0_0_14px_rgba(244,63,94,0.7)]'
          : state === 'sending'
          ? 'bg-amber-600/40 text-amber-200 border-amber-500'
          : 'bg-emerald-900/40 hover:bg-emerald-800/60 text-emerald-300 border-emerald-500/60'
      }`}
    >
      <Radio className="w-4 h-4" />
      <span>{state === 'rec' ? `${secs}s · qo'yib yuboring` : state === 'sending' ? 'Yuborilmoqda…' : 'RATSIYA'}</span>
    </button>
  );
};
