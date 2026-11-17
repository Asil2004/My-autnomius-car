import React, { useEffect, useState, useCallback } from 'react';
import {
  Compass,
  X,
  Target,
  RotateCcw,
  Sliders,
  Check,
  AlertTriangle,
  Info,
  Activity,
  Layers
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
  const [inverted, setInvertedState] = useState<boolean>(() => headingService.getInverted());
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
    });

    const timer = setInterval(() => {
      setDetails(headingService.getDetails());
      setInvertedState(headingService.getInverted());
    }, 100);

    return () => {
      unsub();
      clearInterval(timer);
    };
  }, []);

  const showBanner = (text: string) => {
    setSaveBanner(text);
    setTimeout(() => setSaveBanner(null), 2500);
  };

  // Yo'nalishni teskarisiga o'girish (Invert / Qarama-qarshi aylanishni to'g'rilash)
  const handleToggleInvert = useCallback(() => {
    const next = headingService.toggleInverted();
    setInvertedState(next);
    showBanner(next 
      ? "Yo'nalish teskarisiga o'girildi (Qarama-qarshi / Inverted)!" 
      : "Yo'nalish standart holatga qaytarildi (Normal)!"
    );
  }, []);

  // 1. Joriy burchakni 0° (Robotning to'g'riga yo'nalishi) deb belgilash
  const handleZeroHeading = useCallback(() => {
    const off = headingService.zeroCurrentHeading();
    setManualOffset(off);
    showBanner(`Muvaffaqiyatli! Joriy yo'nalish 0° (To'g'riga) deb belgilandi. Ofset: ${off}°`);
  }, []);

  // 2. Ma'lum yo'nalishga moslash (0 Shimol, 90 Sharq, 180 Janub, 270 G'arb)
  const handleCalibrateTo = useCallback((targetDeg: number, label: string) => {
    const off = headingService.calibrateTo(targetDeg);
    setManualOffset(off);
    showBanner(`Yo'nalish ${label} (${targetDeg}°) ga sozlandi. Ofset: ${off}°`);
  }, []);

  // 3. Nozik ofsetni o'zgartirish
  const handleOffsetChange = (newVal: number) => {
    const clamped = ((newVal % 360) + 360) % 360;
    setManualOffset(clamped);
    headingService.setOffset(clamped);
  };

  const handleAdjustDelta = (delta: number) => {
    handleOffsetChange(manualOffset + delta);
  };

  // 4. Zavod holatiga qaytarish
  const handleReset = useCallback(() => {
    headingService.resetCalibration();
    setManualOffset(0);
    showBanner("Kalibrlash ofseti 0° ga qaytarildi.");
  }, []);

  // 5. 2 soniyalik Statsionar Dreyf Testi
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

  // Kompas burchak nomini aniqlash (N, NE, E, SE, S, SW, W, NW)
  const getCompassDir = (deg: number) => {
    const dirs = ['SH (N)', 'SH-SH (NNE)', 'SH-SH (NE)', 'SH-SH (ENE)', 'SH (E)', 'J-SH (ESE)', 'J-SH (SE)', 'J-SH (SSE)', 'J (S)', 'J-G\' (SSW)', 'J-G\' (SW)', 'J-G\' (WSW)', 'G\' (W)', 'SH-G\' (WNW)', 'SH-G\' (NW)', 'SH-G\' (NNW)'];
    const idx = Math.round(deg / 22.5) % 16;
    return dirs[idx];
  };

  const currentHeading = headingState?.heading ?? details.heading;
  const rawDeg = details.rawHeading;
  const turnRate = headingState?.rate ?? details.rate;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 select-none">
      <div className="bg-tactical-950 border border-tactical-700/80 rounded-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-tactical-800 flex items-center justify-between sticky top-0 bg-tactical-950/95 z-10 backdrop-blur">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-400">
              <Compass className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white font-mono tracking-wider">
                PLANCHET GIROSKOP VA KOMPASINI KALIBRLASH
              </h2>
              <p className="text-[11px] text-slate-400 font-mono">
                Redmi Pad 2 Pro • Datchik yo'nalishi va dreyf nazorati
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
            <div className="p-2.5 rounded-lg bg-emerald-950/90 border border-emerald-500 text-emerald-300 flex items-center gap-2 animate-bounce">
              <Check className="w-4 h-4 shrink-0" />
              <span>{saveBanner}</span>
            </div>
          )}

          {/* ASOSIY VIZUAL KOMPAS SKANERI */}
          <div className="hud-panel rounded-xl p-4 flex flex-col items-center justify-center relative overflow-hidden bg-tactical-900/60 border border-tactical-800">
            {/* Dumaloq Kompas Diski */}
            <div className="relative w-48 h-48 sm:w-56 sm:h-56 rounded-full border-2 border-tactical-700 flex items-center justify-center shadow-[0_0_30px_rgba(245,158,11,0.15)] bg-tactical-950">
              {/* Tashqi gradus halqasi */}
              <div
                className="absolute inset-2 rounded-full border border-tactical-700/60 transition-transform duration-100 ease-out"
                style={{ transform: `rotate(${-currentHeading}deg)` }}
              >
                {/* 4 Asosiy Tomonlar */}
                <div className="absolute top-1 left-1/2 -translate-x-1/2 text-rose-500 font-extrabold text-xs">
                  N
                </div>
                <div className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-[10px]">
                  E
                </div>
                <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-slate-400 font-bold text-[10px]">
                  S
                </div>
                <div className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-[10px]">
                  W
                </div>

                {/* Markaziy chiziqlar */}
                <div className="absolute top-0 bottom-0 left-1/2 w-[1px] bg-tactical-800 -translate-x-1/2" />
                <div className="absolute left-0 right-0 top-1/2 h-[1px] bg-tactical-800 -translate-y-1/2" />
              </div>

              {/* Robot old ko'rsatkichi (Fiksirlangan old yo'nalish) */}
              <div className="absolute top-2 w-3 h-3 border-l-2 border-r-2 border-b-2 border-police-cyan rotate-180 drop-shadow-[0_0_6px_rgba(0,229,255,0.8)]" />

              {/* Markaziy Heading Qiymati */}
              <div className="relative flex flex-col items-center justify-center text-center z-10">
                <span className="text-3xl font-extrabold text-amber-400 font-mono tracking-tight drop-shadow">
                  {currentHeading.toFixed(1)}°
                </span>
                <span className="text-[10px] text-police-cyan font-bold uppercase mt-0.5">
                  {getCompassDir(currentHeading)}
                </span>
                {Math.abs(turnRate) >= 1 && (
                  <span className="text-[10px] text-slate-400 mt-0.5">
                    {turnRate > 0 ? '↻ O\'ngga' : '↺ Chapga'} {Math.abs(turnRate).toFixed(1)}°/s
                  </span>
                )}
              </div>
            </div>

            {/* Pitch & Roll (Egilish burchaklari) */}
            <div className="w-full grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-tactical-800">
              <div className="p-2 rounded bg-tactical-950 border border-tactical-800 flex justify-between items-center">
                <span className="text-slate-400">Pitch (Old-Orqa):</span>
                <span className={`font-bold ${Math.abs(details.pitch) > 10 ? 'text-rose-400' : 'text-slate-200'}`}>
                  {details.pitch > 0 ? `+${details.pitch}°` : `${details.pitch}°`}
                </span>
              </div>
              <div className="p-2 rounded bg-tactical-950 border border-tactical-800 flex justify-between items-center">
                <span className="text-slate-400">Roll (Chap-O'ng):</span>
                <span className={`font-bold ${Math.abs(details.roll) > 10 ? 'text-rose-400' : 'text-slate-200'}`}>
                  {details.roll > 0 ? `+${details.roll}°` : `${details.roll}°`}
                </span>
              </div>
            </div>
          </div>

          {/* TELEMETRIYA TAHLILI */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 rounded-lg bg-tactical-900 border border-tactical-800">
              <div className="text-[10px] text-slate-400">Datchik (Raw)</div>
              <div className="text-xs font-bold text-slate-200 mt-0.5">{rawDeg.toFixed(1)}°</div>
            </div>
            <div className="p-2 rounded-lg bg-tactical-900 border border-tactical-800">
              <div className="text-[10px] text-slate-400">Kalibrlash ofseti</div>
              <div className="text-xs font-bold text-amber-400 mt-0.5">
                {manualOffset > 0 ? `+${manualOffset.toFixed(1)}°` : `${manualOffset.toFixed(1)}°`}
              </div>
            </div>
            <div className="p-2 rounded-lg bg-tactical-900 border border-tactical-800">
              <div className="text-[10px] text-slate-400">Manba</div>
              <div className="text-xs font-bold text-police-cyan mt-0.5 uppercase">
                {details.source === 'device' ? 'Planshet' : details.source === 'imu' ? 'ESP32 IMU' : details.source}
              </div>
            </div>
          </div>

          {/* ESP32 MPU-6050 Uskunaviy Datchik Boshqaruvi */}
          <div className="p-3 bg-tactical-900/80 rounded-xl border border-police-cyan/40 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-police-cyan flex items-center gap-1.5">
                <Compass className="w-4 h-4 text-police-cyan" />
                <span>ESP32 MPU-6050 USKUNAVIY DATCHIK</span>
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${details.source === 'imu' ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/50' : 'bg-tactical-950 text-slate-400'}`}>
                {details.source === 'imu' ? 'FAOL (IMU)' : 'STANDBY'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Robot shassisiga o'rnatilgan MPU-6050 6-o'qli giroskop va akselerometrni to'g'ridan-to'g'ri boshqarish:
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

          {/* YO'NALISH POLARIZATSIYASI (BURILISH YO'NALISHINI TESKARI O'GIRISH) */}
          <div className="p-3 bg-tactical-900/80 rounded-xl border border-indigo-500/40 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-indigo-300 flex items-center gap-1.5">
                <RotateCcw className="w-4 h-4 text-indigo-400" />
                <span>BURILISH YO'NALISHI (POLARIZATSIYA)</span>
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${inverted ? 'bg-amber-950 text-amber-300 border border-amber-500/50' : 'bg-emerald-950 text-emerald-300 border border-emerald-500/50'}`}>
                {inverted ? 'TESKARI (INVERTED)' : 'STANDART (ODDIY)'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Agar robot o'ngga burilganda kompas chapga (yoki aksincha) aylanayotgan bo'lsa, ushbu tugma orqali yo'nalishni teskarisiga o'giring:
            </p>
            <button
              type="button"
              onClick={handleToggleInvert}
              className={`w-full py-2.5 px-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-all active:scale-95 ${
                inverted
                  ? 'bg-amber-500 hover:bg-amber-400 text-black shadow-[0_0_15px_rgba(245,158,11,0.4)]'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_15px_rgba(99,102,241,0.4)]'
              }`}
            >
              <RotateCcw className="w-4 h-4" />
              <span>
                {inverted
                  ? "🔄 HOZIR TESKARI (STANDARTGA QAYTARISH)"
                  : "🔄 YO'NALISHNI QARAMA-QARSHI (TESKARI) O'GIRISH"}
              </span>
            </button>
          </div>

          {/* 1-QADAM: 0° GA TARA SOZLASH (ASOSIY TUGMA) */}
          <div className="p-3 bg-tactical-900/80 rounded-xl border border-amber-500/40 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white flex items-center gap-1.5">
                <Target className="w-4 h-4 text-amber-400" />
                <span>1. OLDINGA QARATIB 0° GA SOZLASH (TARA)</span>
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
          </div>

          {/* 2-QADAM: KOMPASNING ANIQ TOMONLARI BO'YICHA */}
          <div className="p-3 bg-tactical-900/80 rounded-xl border border-tactical-800 space-y-2">
            <span className="font-bold text-slate-200 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-police-cyan" />
              <span>2. ANIQ TOMON BO'YICHA KALIBRLASH</span>
            </span>
            <p className="text-[11px] text-slate-400">
              Agar robot qaysi tomonga qarab turganini bilsangiz, quyidagi tugmalardan birini bosing:
            </p>
            <div className="grid grid-cols-4 gap-1.5 pt-1">
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

          {/* 3-QADAM: QO'LDA NOZIK SOZLASH (SLIDER VA +/-) */}
          <div className="p-3 bg-tactical-900/80 rounded-xl border border-tactical-800 space-y-2">
            <div className="flex justify-between items-center">
              <span className="font-bold text-slate-200 flex items-center gap-1.5">
                <Sliders className="w-4 h-4 text-emerald-400" />
                <span>3. NOZIK SOZLASH (MIKROMETR)</span>
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

          {/* 4-QADAM: STATSIONAR DREYF TESTI */}
          <div className="p-3 bg-tactical-900/80 rounded-xl border border-tactical-800 space-y-2">
            <div className="flex justify-between items-center">
              <span className="font-bold text-slate-200 flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-police-cyan" />
                <span>4. STATSIONAR DREYFNI TEKSHIRISH</span>
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
                    : `Dreyf sezildi: ±${driftResult.bias}°/s. Datchikni '8' shaklida aylantirish tavsiya etiladi.`}
                </span>
              </div>
            )}
          </div>

          {/* MAGNITOMETR (KOMPAS) VA SAKKIZ (FIGURE-8) MASLAHATI */}
          <div className="p-2.5 rounded-lg bg-tactical-950 border border-tactical-800 text-[11px] text-slate-400 flex items-start gap-2">
            <Info className="w-4 h-4 text-police-cyan shrink-0 mt-0.5" />
            <div>
              <b className="text-police-cyan">Redmi Pad 2 Pro kompasini tozalash:</b> Robot motorlari va batareyasi yaqin bo'lgani uchun magnitometr adashishi mumkin. Planshetni qo'lda havoda <b>"8" (sakkiz)</b> shaklida 2-3 marta aylantirsangiz, ichki magnitometr avtomatik o'zini qayta kalibrlaydi.
            </div>
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
