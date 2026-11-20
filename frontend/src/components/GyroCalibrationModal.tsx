import React, { useEffect, useState, useCallback } from 'react';
import {
  Compass,
  X,
  Target,
  RotateCcw,
  Sliders,
  Check,
  AlertTriangle,
  Activity,
  Sparkles
} from 'lucide-react';
import { headingService, type HeadingState } from '../services/headingService';
import { esp32Service } from '../services/esp32Service';

interface GyroCalibrationModalProps {
  onClose: () => void;
}

export const GyroCalibrationModal: React.FC<GyroCalibrationModalProps> = ({ onClose }) => {
  const [headingState, setHeadingState] = useState<HeadingState | null>(() => headingService.getState());
  const [details, setDetails] = useState(() => headingService.getDetails());
  const [manualOffset, setManualOffset] = useState<number>(() => headingService.getOffset());
  const [mountingAngle, setMountingAngleState] = useState<number>(() => headingService.getMountingAngle());
  const [inverted, setInvertedState] = useState<boolean>(() => headingService.getInverted());
  const [invertPitch, setInvertPitchState] = useState<boolean>(() => headingService.getInvertPitch());
  const [invertRoll, setInvertRollState] = useState<boolean>(() => headingService.getInvertRoll());

  const [driftTesting, setDriftTesting] = useState(false);
  const [driftResult, setDriftResult] = useState<{ bias: number; status: 'good' | 'warn' } | null>(null);
  const [driftProgress, setDriftProgress] = useState(0);
  const [saveBanner, setSaveBanner] = useState<string | null>(null);

  // Datchik ma'lumotlarini kuzatib borish
  useEffect(() => {
    const unsub = headingService.subscribe((s) => {
      setHeadingState(s);
      setDetails(headingService.getDetails());
      setInvertedState(headingService.getInverted());
      setMountingAngleState(headingService.getMountingAngle());
      setInvertPitchState(headingService.getInvertPitch());
      setInvertRollState(headingService.getInvertRoll());
    });

    const timer = setInterval(() => {
      setDetails(headingService.getDetails());
      setInvertedState(headingService.getInverted());
      setMountingAngleState(headingService.getMountingAngle());
      setInvertPitchState(headingService.getInvertPitch());
      setInvertRollState(headingService.getInvertRoll());
    }, 80);

    return () => {
      unsub();
      clearInterval(timer);
    };
  }, []);

  const showBanner = (text: string) => {
    setSaveBanner(text);
    setTimeout(() => setSaveBanner(null), 2500);
  };

  // 1. Datchik o'rnatilish burchagini o'zgartirish (0, 90, 180, 270)
  const handleMountingChange = (angle: number) => {
    headingService.setMountingAngle(angle);
    setMountingAngleState(angle);
    showBanner(`Datchik yo'nalishi: ${angle}° ga o'zgartirildi!`);
  };

  // 2. Yaw Invert (Burilish yo'nalishini qarama-qarshi qilish)
  const handleToggleInvert = useCallback(() => {
    const next = headingService.toggleInverted();
    setInvertedState(next);
    showBanner(next 
      ? "Burilish yo'nalishi teskarisiga o'girildi (Inverted)!" 
      : "Burilish yo'nalishi standart holatga qaytarildi (Normal)!"
    );
  }, []);

  // 3. Pitch Invert
  const handleToggleInvertPitch = useCallback(() => {
    const next = headingService.toggleInvertPitch();
    setInvertPitchState(next);
    showBanner(next ? "Pitch (Old-Orqa) teskarilandii" : "Pitch standartga qaytarildi");
  }, []);

  // 4. Roll Invert
  const handleToggleInvertRoll = useCallback(() => {
    const next = headingService.toggleInvertRoll();
    setInvertRollState(next);
    showBanner(next ? "Roll (Chap-O'ng) teskarilandi" : "Roll standartga qaytarildi");
  }, []);

  // 5. Gorizontni tekislash (Level TARA: Pitch & Roll nolga tenglanadi)
  const handleZeroLevel = useCallback(() => {
    headingService.zeroLevel();
    showBanner("Gorizont tekislandi! Joriy holat 0.0° Pitch & 0.0° Roll deb olindi.");
  }, []);

  // 6. Gorizont ofsetlarini tozalash
  const handleResetLevel = useCallback(() => {
    headingService.resetLevel();
    showBanner("Gorizont ofsetlari tozalandi.");
  }, []);

  // 7. Joriy yo'nalishni 0° (Robotning to'g'riga yo'nalishi) deb belgilash
  const handleZeroHeading = useCallback(() => {
    const off = headingService.zeroCurrentHeading();
    setManualOffset(off);
    showBanner(`Muvaffaqiyatli! Joriy yo'nalish 0° (To'g'riga) deb belgilandi. Ofset: ${off}°`);
  }, []);

  // 8. Ma'lum yo'nalishga moslash (0 Shimol, 90 Sharq, 180 Janub, 270 G'arb)
  const handleCalibrateTo = useCallback((targetDeg: number, label: string) => {
    const off = headingService.calibrateTo(targetDeg);
    setManualOffset(off);
    showBanner(`Yo'nalish ${label} (${targetDeg}°) ga sozlandi. Ofset: ${off}°`);
  }, []);

  // 9. Nozik ofsetni o'zgartirish
  const handleOffsetChange = (newVal: number) => {
    const clamped = ((newVal % 360) + 360) % 360;
    setManualOffset(clamped);
    headingService.setOffset(clamped);
  };

  const handleAdjustDelta = (delta: number) => {
    handleOffsetChange(manualOffset + delta);
  };

  // 10. Rasmdagi haqiqiy montajga 1-klik bilan moslash
  const handleApplyPhotoPreset = useCallback(() => {
    headingService.setMountingAngle(0);
    setMountingAngleState(0);

    headingService.setInverted(true);
    setInvertedState(true);

    headingService.zeroLevel();
    setInvertPitchState(headingService.getInvertPitch());
    setInvertRollState(headingService.getInvertRoll());

    const off = headingService.zeroCurrentHeading();
    setManualOffset(off);

    showBanner("✨ Rasmdagi montajga moslandi: 0° Montaj, Yaw Invert ON (O'ngga to'g'ri burilish), Gorizont tekislandi!");
  }, []);

  // 11. Zavod holatiga qaytarish
  const handleReset = useCallback(() => {
    headingService.resetCalibration();
    setManualOffset(0);
    showBanner("Kalibrlash ofseti 0° ga qaytarildi.");
  }, []);

  // 11. Statsionar Dreyf Testi
  const runDriftTest = useCallback(() => {
    setDriftTesting(true);
    setDriftProgress(0);
    setDriftResult(null);

    const samples: number[] = [];
    const startTime = performance.now();
    const duration = 2000;

    const interval = setInterval(() => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(100, Math.round((elapsed / duration) * 100));
      setDriftProgress(progress);

      const st = headingService.getState();
      if (st) samples.push(st.rate);

      if (elapsed >= duration) {
        clearInterval(interval);
        setDriftTesting(false);

        const avgRate = samples.length > 0
          ? samples.reduce((a, b) => a + Math.abs(b), 0) / samples.length
          : 0;

        const bias = Math.round(avgRate * 100) / 100;
        setDriftResult({
          bias,
          status: bias <= 0.8 ? 'good' : 'warn'
        });
      }
    }, 50);
  }, []);

  const currentHeading = headingState?.heading ?? details.heading;
  const rawDeg = details.rawHeading;
  const turnRate = headingState?.rate ?? details.rate;
  const currentPitch = details.pitch;
  const currentRoll = details.roll;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 select-none">
      <div className="bg-tactical-950 border border-tactical-700/80 rounded-2xl w-full max-w-2xl max-h-[94vh] overflow-y-auto flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-tactical-800 flex items-center justify-between sticky top-0 bg-tactical-950/95 z-20 backdrop-blur">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-400">
              <Compass className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white font-mono tracking-wider flex items-center gap-2">
                <span>ROBOT GIROSKOP & IMU KALIBRLASH</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">3D REAL-TIME</span>
              </h2>
              <p className="text-[11px] text-slate-400 font-mono">
                MPU-6050 & Planshet giroskopi • 3D vizualizatsiya va datchik montaji
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-tactical-800 transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 font-mono text-xs">
          {/* Saqlash Xabarnomasi */}
          {saveBanner && (
            <div className="p-2.5 rounded-lg bg-emerald-950/90 border border-emerald-500 text-emerald-300 flex items-center gap-2 shadow-lg animate-bounce">
              <Check className="w-4 h-4 shrink-0" />
              <span>{saveBanner}</span>
            </div>
          )}

          {/* 2D GIROSKOP ORIENTATSIYA KO'RSATGICHI */}
          <div className="p-4 bg-tactical-900/90 rounded-xl border border-tactical-700/80 grid grid-cols-2 sm:grid-cols-4 gap-3 shadow-inner">
            <div className="text-center p-2 rounded bg-tactical-950 border border-tactical-800">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Kurs (Heading)</div>
              <div className="text-xl font-bold text-amber-400 font-mono">{Math.round(currentHeading)}°</div>
              <div className="text-[10px] text-slate-500">{details.source}</div>
            </div>
            <div className="text-center p-2 rounded bg-tactical-950 border border-tactical-800">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Tanga (Pitch)</div>
              <div className="text-xl font-bold text-police-cyan font-mono">{Math.round(currentPitch)}°</div>
              <div className="text-[10px] text-slate-500">old/orqa</div>
            </div>
            <div className="text-center p-2 rounded bg-tactical-950 border border-tactical-800">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Kren (Roll)</div>
              <div className="text-xl font-bold text-emerald-400 font-mono">{Math.round(currentRoll)}°</div>
              <div className="text-[10px] text-slate-500">o'ng/chap</div>
            </div>
            <div className="text-center p-2 rounded bg-tactical-950 border border-tactical-800">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Burilish Tezl.</div>
              <div className="text-xl font-bold text-indigo-400 font-mono">{Math.round(turnRate)}°/s</div>
              <div className="text-[10px] text-slate-500">gyro rate</div>
            </div>
          </div>

          {/* TEZKOR PRESET: RASMDAGI MONTAJ (TAVSIYA ETILADI) */}
          <div className="p-3 bg-gradient-to-r from-amber-950/70 via-tactical-900 to-indigo-950/70 rounded-xl border-2 border-amber-500/70 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg">
            <div className="space-y-1 text-left w-full sm:w-auto">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-amber-500 text-black text-[10px] font-black uppercase tracking-wider">
                  Tavsiya etiladi
                </span>
                <span className="font-bold text-slate-100 text-xs font-mono">
                  📸 Rasmdagi Montajga 1-Klik Bilan Moslash
                </span>
              </div>
              <p className="text-[11px] text-slate-300 font-sans leading-tight">
                MPU-6050 shassiga gorizontal yopishtirilgan (Pinlar orqada, chip oldinda). Ushbu tugma <b>0° Montaj</b>, <b>Yaw Invert (O'ngga to'g'ri burilish)</b> va <b>Gorizont tekislash</b>ni bir vaqtda to'g'rilaydi:
              </p>
            </div>
            <button
              type="button"
              onClick={handleApplyPhotoPreset}
              className="w-full sm:w-auto shrink-0 px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 active:scale-95 text-black font-mono font-black text-xs flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(245,158,11,0.5)] transition-all"
            >
              <Sparkles className="w-4 h-4" />
              <span>RASMGA MOSLASH</span>
            </button>
          </div>

          {/* TELEMETRIYA TAHLILI */}
          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="p-2 rounded-lg bg-tactical-900 border border-tactical-800">
              <div className="text-[10px] text-slate-400">Datchik (Raw)</div>
              <div className="text-xs font-bold text-slate-200 mt-0.5">{rawDeg.toFixed(1)}°</div>
            </div>
            <div className="p-2 rounded-lg bg-tactical-900 border border-tactical-800">
              <div className="text-[10px] text-slate-400">Heading (Tara)</div>
              <div className="text-xs font-bold text-amber-400 mt-0.5">{currentHeading.toFixed(1)}°</div>
            </div>
            <div className="p-2 rounded-lg bg-tactical-900 border border-tactical-800">
              <div className="text-[10px] text-slate-400">Gorizont (P / R)</div>
              <div className="text-xs font-bold text-emerald-400 mt-0.5">{currentPitch.toFixed(1)}° / {currentRoll.toFixed(1)}°</div>
            </div>
            <div className="p-2 rounded-lg bg-tactical-900 border border-tactical-800">
              <div className="text-[10px] text-slate-400">Manba</div>
              <div className="text-xs font-bold text-police-cyan mt-0.5 uppercase">
                {details.source === 'device' ? 'Planshet' : details.source === 'imu' ? 'ESP32 IMU' : details.source}
              </div>
            </div>
          </div>

          {/* 1. DATCHIK MONTAJ YO'NALISHI (SENSOR MOUNTING ANGLE) */}
          <div className="p-3 bg-tactical-900/80 rounded-xl border border-tactical-700 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-amber-400 flex items-center gap-1.5">
                <Compass className="w-4 h-4 text-amber-400" />
                <span>1. DATCHIK O'RNATILISH YO'NALISHI (MONTAJ HOLATI)</span>
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-amber-950 text-amber-300 border border-amber-500/40">
                {mountingAngle}° PRESET
              </span>
            </div>
            <p className="text-[11px] text-slate-300">
              Rasmdagi kabi datchik hot-glue bilan shassiga gorizontal yopishtirilgan (Pinlar orqaga qaragan, chip oldinga). Agar datchik boshqa burchakda o'rnatilgan bo'lsa, mos tugmani tanlang:
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleMountingChange(0)}
                className={`p-2.5 rounded-lg border text-center font-bold transition-all active:scale-95 flex flex-col items-center justify-center gap-1 ${
                  mountingAngle === 0
                    ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                    : 'bg-tactical-950 border-tactical-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="text-xs">0° STANDART</span>
                <span className="text-[9px] font-normal text-slate-400">(Rasmdagi: Pinlar orqada)</span>
              </button>
              <button
                type="button"
                onClick={() => handleMountingChange(90)}
                className={`p-2.5 rounded-lg border text-center font-bold transition-all active:scale-95 flex flex-col items-center justify-center gap-1 ${
                  mountingAngle === 90
                    ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                    : 'bg-tactical-950 border-tactical-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="text-xs">90° O'NGLI</span>
                <span className="text-[9px] font-normal text-slate-400">(Pinlar chap tomonda)</span>
              </button>
              <button
                type="button"
                onClick={() => handleMountingChange(180)}
                className={`p-2.5 rounded-lg border text-center font-bold transition-all active:scale-95 flex flex-col items-center justify-center gap-1 ${
                  mountingAngle === 180
                    ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                    : 'bg-tactical-950 border-tactical-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="text-xs">180° TESKARI</span>
                <span className="text-[9px] font-normal text-slate-400">(Pinlar old tomonda)</span>
              </button>
              <button
                type="button"
                onClick={() => handleMountingChange(270)}
                className={`p-2.5 rounded-lg border text-center font-bold transition-all active:scale-95 flex flex-col items-center justify-center gap-1 ${
                  mountingAngle === 270
                    ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                    : 'bg-tactical-950 border-tactical-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="text-xs">270° CHAPLI</span>
                <span className="text-[9px] font-normal text-slate-400">(Pinlar o'ng tomonda)</span>
              </button>
            </div>
          </div>

          {/* 2. BURILISH VA EGILISH POLARIZATSIYASI (INVERT TOGGLES) */}
          <div className="p-3 bg-tactical-900/80 rounded-xl border border-indigo-500/40 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-indigo-300 flex items-center gap-1.5">
                <RotateCcw className="w-4 h-4 text-indigo-400" />
                <span>2. O'Q VA BURILISH POLARIZATSIYASI (INVERT)</span>
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Agar robot o'ngga burilganda kompas chapga (yoki teskari) aylanayotgan bo'lsa, ushbu tugma orqali yo'nalishni teskarisiga o'giring:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
              <button
                type="button"
                onClick={handleToggleInvert}
                className={`py-2.5 px-3 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95 ${
                  inverted
                    ? 'bg-amber-500 text-black shadow-[0_0_12px_rgba(245,158,11,0.4)]'
                    : 'bg-tactical-950 border border-tactical-700 text-slate-300 hover:bg-tactical-800'
                }`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{inverted ? "Yaw: TESKARI" : "Yaw: STANDART"}</span>
              </button>
              <button
                type="button"
                onClick={handleToggleInvertPitch}
                className={`py-2.5 px-3 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95 ${
                  invertPitch
                    ? 'bg-amber-500 text-black shadow-[0_0_12px_rgba(245,158,11,0.4)]'
                    : 'bg-tactical-950 border border-tactical-700 text-slate-300 hover:bg-tactical-800'
                }`}
              >
                <span>{invertPitch ? "Pitch (Old): TESKARI" : "Pitch: STANDART"}</span>
              </button>
              <button
                type="button"
                onClick={handleToggleInvertRoll}
                className={`py-2.5 px-3 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95 ${
                  invertRoll
                    ? 'bg-amber-500 text-black shadow-[0_0_12px_rgba(245,158,11,0.4)]'
                    : 'bg-tactical-950 border border-tactical-700 text-slate-300 hover:bg-tactical-800'
                }`}
              >
                <span>{invertRoll ? "Roll (Yon): TESKARI" : "Roll: STANDART"}</span>
              </button>
            </div>
          </div>

          {/* 3. GORIZONTNI NOLGA TEKISLASH (LEVEL TARA) */}
          <div className="p-3 bg-tactical-900/80 rounded-xl border border-emerald-500/40 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                <Target className="w-4 h-4 text-emerald-400" />
                <span>3. GORIZONTNI NOLGA TEKISLASH (LEVEL TARA)</span>
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                P: {currentPitch.toFixed(1)}° | R: {currentRoll.toFixed(1)}°
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Robotni tekis polga qo'ying. Shassi yoki datchik ozgina qiya bo'lsa, ushbu tugma orqali gorizontni <b>0.0° Pitch & 0.0° Roll</b> ga tekislang:
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleZeroLevel}
                className="flex-1 py-2.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(16,185,129,0.3)] transition-all active:scale-95"
              >
                <Target className="w-4 h-4" />
                <span>🎯 GORIZONTNI NOLGA TEKISLASH (0.0° PITCH & ROLL)</span>
              </button>
              <button
                type="button"
                onClick={handleResetLevel}
                title="Gorizont ofsetini tozalash"
                className="px-3 py-2.5 rounded-lg bg-tactical-950 hover:bg-tactical-800 border border-tactical-700 text-slate-400 font-bold transition-all"
              >
                Qaytarish
              </button>
            </div>
          </div>

          {/* 4. HEADING TARA: 0° (OLDINGA QARATIB NOL QILISH) */}
          <div className="p-3 bg-tactical-900/80 rounded-xl border border-amber-500/40 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white flex items-center gap-1.5">
                <Target className="w-4 h-4 text-amber-400" />
                <span>4. OLDINGA QARATIB 0° GA SOZLASH (HEADING TARA)</span>
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Robotni xonada yoki yo'lda to'g'ri oldinga qaratib qo'ying va ushbu tugmani bosing. Robotning hozirgi holati 0° deb belgilanadi:
            </p>
            <button
              onClick={handleZeroHeading}
              className="w-full py-2.5 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(245,158,11,0.4)] transition-all active:scale-95"
            >
              <Target className="w-4 h-4" />
              <span>HOZIRGI YO'NALISHNI 0° (OLDINGA) QILISH</span>
            </button>

            {/* 4 Asosiy Kompas Tomoni */}
            <div className="grid grid-cols-4 gap-1.5 pt-2">
              <button
                onClick={() => handleCalibrateTo(0, "Shimol")}
                className="py-1.5 bg-tactical-950 hover:bg-tactical-800 border border-rose-500/50 text-rose-300 rounded font-bold transition-all active:scale-95"
              >
                0° (N)
              </button>
              <button
                onClick={() => handleCalibrateTo(90, "Sharq")}
                className="py-1.5 bg-tactical-950 hover:bg-tactical-800 border border-tactical-700 text-slate-200 rounded font-bold transition-all active:scale-95"
              >
                90° (E)
              </button>
              <button
                onClick={() => handleCalibrateTo(180, "Janub")}
                className="py-1.5 bg-tactical-950 hover:bg-tactical-800 border border-tactical-700 text-slate-200 rounded font-bold transition-all active:scale-95"
              >
                180° (S)
              </button>
              <button
                onClick={() => handleCalibrateTo(270, "G'arb")}
                className="py-1.5 bg-tactical-950 hover:bg-tactical-800 border border-tactical-700 text-slate-200 rounded font-bold transition-all active:scale-95"
              >
                270° (W)
              </button>
            </div>
          </div>

          {/* 5. ESP32 MPU-6050 USKUNAVIY DATCHIK BOSHQARUVI */}
          <div className="p-3 bg-tactical-900/80 rounded-xl border border-police-cyan/40 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-police-cyan flex items-center gap-1.5">
                <Compass className="w-4 h-4 text-police-cyan" />
                <span>5. ESP32 MPU-6050 USKUNAVIY BUYRUQLAR</span>
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${details.source === 'imu' ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/50' : 'bg-tactical-950 text-slate-400'}`}>
                {details.source === 'imu' ? 'FAOL (IMU)' : 'STANDBY'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Robot shassisiga o'rnatilgan MPU-6050 6-o'qli giroskop va akselerometrni to'g'ridan-to'g'ri ESP32 ichida qayta hisoblash:
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={async () => {
                  await esp32Service.zeroImu();
                  showBanner("ESP32 MPU-6050 0° (Nol)ga tenglandi.");
                }}
                className="py-2 px-3 rounded-lg bg-tactical-950 hover:bg-tactical-800 border border-police-cyan/60 text-police-cyan font-bold transition-all active:scale-95 text-center"
              >
                🎯 ESP32 0° Qilish
              </button>
              <button
                type="button"
                onClick={async () => {
                  showBanner("ESP32 MPU-6050 kalibrlanmoqda (1s qimirlatmang)...");
                  await esp32Service.calibrateImu();
                  showBanner("ESP32 giroskop muvaffaqiyatli kalibrlandi!");
                }}
                className="py-2 px-3 rounded-lg bg-tactical-950 hover:bg-tactical-800 border border-amber-500/60 text-amber-300 font-bold transition-all active:scale-95 text-center"
              >
                ⚙️ ESP32 Kalibrlash
              </button>
            </div>
          </div>

          {/* 6. NOZIK SOZLASH (SLIDER VA +/-) */}
          <div className="p-3 bg-tactical-900/80 rounded-xl border border-tactical-800 space-y-2">
            <div className="flex justify-between items-center">
              <span className="font-bold text-slate-200 flex items-center gap-1.5">
                <Sliders className="w-4 h-4 text-emerald-400" />
                <span>6. NOZIK SOZLASH (MIKROMETR)</span>
              </span>
              <span className="text-amber-400 font-bold">{manualOffset.toFixed(1)}°</span>
            </div>

            <input
              type="range"
              min="0"
              max="359"
              step="0.5"
              value={manualOffset}
              onChange={(e) => handleOffsetChange(parseFloat(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer"
            />

            <div className="flex gap-1.5 justify-between pt-1">
              <button
                onClick={() => handleAdjustDelta(-5)}
                className="flex-1 py-1 bg-tactical-950 hover:bg-tactical-800 border border-tactical-700 rounded text-slate-300 font-bold"
              >
                -5°
              </button>
              <button
                onClick={() => handleAdjustDelta(-1)}
                className="flex-1 py-1 bg-tactical-950 hover:bg-tactical-800 border border-tactical-700 rounded text-slate-300 font-bold"
              >
                -1°
              </button>
              <button
                onClick={() => handleAdjustDelta(1)}
                className="flex-1 py-1 bg-tactical-950 hover:bg-tactical-800 border border-tactical-700 rounded text-slate-300 font-bold"
              >
                +1°
              </button>
              <button
                onClick={() => handleAdjustDelta(5)}
                className="flex-1 py-1 bg-tactical-950 hover:bg-tactical-800 border border-tactical-700 rounded text-slate-300 font-bold"
              >
                +5°
              </button>
              <button
                onClick={handleReset}
                title="Ofsetni nolga qaytarish"
                className="px-2.5 py-1 bg-rose-950/80 hover:bg-rose-900 border border-rose-700 text-rose-300 rounded font-bold flex items-center gap-1"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Nol</span>
              </button>
            </div>
          </div>

          {/* 7. STATSIONAR DREYF TESTI */}
          <div className="p-3 bg-tactical-900/80 rounded-xl border border-tactical-800 space-y-2">
            <div className="flex justify-between items-center">
              <span className="font-bold text-slate-200 flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-police-cyan" />
                <span>7. STATSIONAR DREYFNI TEKSHIRISH</span>
              </span>
              {driftTesting && (
                <span className="text-police-cyan font-bold">{driftProgress}%</span>
              )}
            </div>
            <p className="text-[11px] text-slate-400">
              Robotni qimirlatmasdan 2 soniya ushlab turing va datchik suzishi (drift) ni tekshiring:
            </p>

            <button
              onClick={runDriftTest}
              disabled={driftTesting}
              className="w-full py-2 px-3 rounded-lg bg-tactical-800 hover:bg-tactical-700 text-white font-bold border border-tactical-600 flex items-center justify-center gap-2 transition-all active:scale-95"
            >
              <Activity className={`w-4 h-4 ${driftTesting ? 'animate-spin' : ''}`} />
              <span>{driftTesting ? 'O\'lchanmoqda (qimirlatmang)...' : '🔍 2 Soniyalik Dreyf Sinovini Boshlash'}</span>
            </button>

            {driftResult && (
              <div
                className={`p-2 rounded text-[11px] border flex items-center gap-2 ${
                  driftResult.status === 'good'
                    ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300'
                    : 'bg-amber-950/80 border-amber-500 text-amber-300'
                }`}
              >
                {driftResult.status === 'good' ? <Check className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                <span>
                  {driftResult.status === 'good'
                    ? `Datchik juda barqaror! O'rtacha dreyf: ±${driftResult.bias}°/s (Zo'r)`
                    : `Dreyf sezildi: ±${driftResult.bias}°/s. ESP32 Kalibrlash tugmasini bosing.`}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-tactical-800 flex justify-end gap-2 bg-tactical-950">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-police-blue hover:bg-blue-600 text-white font-mono font-bold text-xs shadow transition-all active:scale-95"
          >
            Yopish va Saqlash
          </button>
        </div>
      </div>
    </div>
  );
};
