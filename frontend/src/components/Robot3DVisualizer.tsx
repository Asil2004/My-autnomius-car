import React, { useState } from 'react';
import { Sparkles, Compass } from 'lucide-react';

interface Robot3DVisualizerProps {
  heading: number;
  pitch: number;
  roll: number;
  rate?: number;
  source: string;
  mountingAngle?: number;
  inverted?: boolean;
}

export const Robot3DVisualizer: React.FC<Robot3DVisualizerProps> = ({
  heading,
  pitch,
  roll,
  rate = 0,
  source,
  mountingAngle = 0,
  inverted = false
}) => {
  const [viewMode, setViewMode] = useState<'3d' | 'top'>('3d');

  // Xavfsiz burchak qiymatlari
  const safeHeading = isFinite(heading) ? heading : 0;
  const safePitch = isFinite(pitch) ? Math.max(-85, Math.min(85, pitch)) : 0;
  const safeRoll = isFinite(roll) ? Math.max(-85, Math.min(85, roll)) : 0;
  const safeRate = isFinite(rate) ? rate : 0;

  // 3D ko'rinish uchun burchaklar
  // rotateX: 55° boshlang'ich qiyalik + pitch egilishi
  // rotateY: roll yonboshlanishi
  // rotateZ: heading (yoki nisbiy burilish)
  const transform3D = `rotateX(${55 - safePitch}deg) rotateY(${safeRoll}deg) rotateZ(${-safeHeading}deg)`;

  return (
    <div className="w-full bg-tactical-950/90 rounded-2xl border border-tactical-800 p-4 flex flex-col items-center relative overflow-hidden shadow-2xl">
      {/* Yuqori rejim almashtirgich */}
      <div className="w-full flex items-center justify-between mb-3 z-10 flex-wrap gap-2">
        <div className="flex items-center space-x-2">
          <span className="p-1 rounded bg-amber-500/20 text-amber-400 text-xs font-mono font-bold flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5" />
            <span>JONLI AVTOMOBIL VIZUALIZATORI</span>
          </span>
          <span className="text-[10px] font-mono text-slate-400">
            {source === 'imu' ? '⚡ ESP32 MPU-6050' : '📱 Planshet'}
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-tactical-900 border border-tactical-800 text-police-cyan flex items-center gap-1">
            <Compass className="w-3 h-3" />
            <span>{mountingAngle}° {inverted ? '(Inv)' : ''}</span>
          </span>
        </div>

        <div className="flex bg-tactical-900 rounded-lg p-0.5 border border-tactical-800 text-[11px] font-mono">
          <button
            type="button"
            onClick={() => setViewMode('3d')}
            className={`px-2.5 py-1 rounded-md transition-all font-bold ${
              viewMode === '3d'
                ? 'bg-amber-500 text-black shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            3D Perspektiva
          </button>
          <button
            type="button"
            onClick={() => setViewMode('top')}
            className={`px-2.5 py-1 rounded-md transition-all font-bold ${
              viewMode === 'top'
                ? 'bg-amber-500 text-black shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            2D Yuqoridan
          </button>
        </div>
      </div>

      {/* ASOSIY ANIMATSIYA SAHNASI */}
      <div className="relative w-full h-64 sm:h-72 flex items-center justify-center overflow-hidden rounded-xl bg-gradient-to-b from-tactical-950 via-slate-950 to-tactical-900 border border-tactical-800/80">
        {/* Kibernetik koordinata to'ri */}
        <div
          className="absolute inset-0 opacity-20 pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(to right, #00e5ff 1px, transparent 1px), linear-gradient(to bottom, #00e5ff 1px, transparent 1px)',
            backgroundSize: '24px 24px'
          }}
        />

        {viewMode === '3d' ? (
          /* ========================================================================= */
          /* 1. 3D PERSPEKTIVA KO'RINISHI (PITCH, ROLL, YAW BILAN ROTATSIYA)             */
          /* ========================================================================= */
          <div
            className="relative w-48 h-48 sm:w-56 sm:h-56 flex items-center justify-center transition-transform duration-100 ease-out"
            style={{
              perspective: '900px',
              perspectiveOrigin: '50% 50%'
            }}
          >
            {/* Robot Soyasi (Yerda qoladi) */}
            <div
              className="absolute w-28 h-40 rounded-3xl bg-black/60 blur-md pointer-events-none"
              style={{
                transform: 'rotateX(55deg) translateZ(-40px)'
              }}
            />

            {/* 3D Robot Korpus Kontayneri */}
            <div
              className="relative w-36 h-48 transition-transform duration-100 ease-out"
              style={{
                transformStyle: 'preserve-3d',
                transform: transform3D
              }}
            >
              {/* Old Faralar Nuri (Oldinga yorug'lik taratadi) */}
              <div
                className="absolute -top-16 left-1/2 -translate-x-1/2 w-32 h-24 pointer-events-none opacity-40 blur-sm"
                style={{
                  background:
                    'radial-gradient(ellipse at 50% 100%, rgba(0,229,255,0.8) 0%, rgba(0,229,255,0) 70%)',
                  transform: 'rotateX(-20deg)'
                }}
              />

              {/* 4 TA KATTA PROTEKTORLI BALONLAR */}
              {/* Chap Old Balon */}
              <div className="absolute -left-4 top-2 w-5 h-12 rounded-lg bg-neutral-900 border-2 border-neutral-700 shadow-lg flex flex-col justify-around py-1">
                <div className="w-full h-1 bg-neutral-800" />
                <div className="w-full h-1 bg-neutral-800" />
                <div className="w-full h-1 bg-neutral-800" />
              </div>
              {/* O'ng Old Balon */}
              <div className="absolute -right-4 top-2 w-5 h-12 rounded-lg bg-neutral-900 border-2 border-neutral-700 shadow-lg flex flex-col justify-around py-1">
                <div className="w-full h-1 bg-neutral-800" />
                <div className="w-full h-1 bg-neutral-800" />
                <div className="w-full h-1 bg-neutral-800" />
              </div>
              {/* Chap Orqa Balon */}
              <div className="absolute -left-4 bottom-2 w-5 h-12 rounded-lg bg-neutral-900 border-2 border-neutral-700 shadow-lg flex flex-col justify-around py-1">
                <div className="w-full h-1 bg-neutral-800" />
                <div className="w-full h-1 bg-neutral-800" />
                <div className="w-full h-1 bg-neutral-800" />
              </div>
              {/* O'ng Orqa Balon */}
              <div className="absolute -right-4 bottom-2 w-5 h-12 rounded-lg bg-neutral-900 border-2 border-neutral-700 shadow-lg flex flex-col justify-around py-1">
                <div className="w-full h-1 bg-neutral-800" />
                <div className="w-full h-1 bg-neutral-800" />
                <div className="w-full h-1 bg-neutral-800" />
              </div>

              {/* ASOSIY SHASSI VANNASI (Qora baquvvat korpus) */}
              <div className="w-full h-full rounded-2xl bg-gradient-to-b from-neutral-800 via-neutral-900 to-black border-2 border-tactical-600 shadow-[0_0_20px_rgba(0,0,0,0.8)] relative p-2 flex flex-col justify-between overflow-hidden">
                {/* Old qism: Planshet Kronshteyni va Faralar */}
                <div className="w-full flex items-center justify-between border-b border-tactical-700 pb-1.5">
                  <div className="w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_8px_#00e5ff]" />
                  <div className="px-2 py-0.5 rounded bg-tactical-800 border border-tactical-600 text-[8px] font-bold text-amber-400">
                    📱 PLANSHET
                  </div>
                  <div className="w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_8px_#00e5ff]" />
                </div>

                {/* O'rta qism: DATCHIK BO'LMASI (MPU-6050 Ko'k platasi) */}
                <div className="relative my-auto w-full flex flex-col items-center justify-center p-2 rounded-xl bg-tactical-950/80 border border-cyan-500/40">
                  {/* MPU-6050 Datchik moduli (Rasmga mos holatda) */}
                  <div className="relative w-12 h-14 bg-blue-600 rounded-md border border-blue-400 shadow-[0_0_12px_rgba(37,99,235,0.6)] flex flex-col items-center justify-between p-1">
                    {/* Markaziy Chip */}
                    <div className="w-5 h-5 bg-neutral-900 rounded-sm border border-neutral-700 flex items-center justify-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                    </div>

                    {/* Datchik Ko'rsatkich Nuri */}
                    <div className="text-[6px] font-mono text-white font-extrabold tracking-tighter">
                      MPU-6050
                    </div>

                    {/* Yashil PWR LED va Pinlar (Orqaga qaragan) */}
                    <div className="w-full flex items-center justify-between px-0.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981] animate-pulse" />
                      <div className="flex gap-0.5">
                        <div className="w-0.5 h-2 bg-amber-400" />
                        <div className="w-0.5 h-2 bg-amber-400" />
                        <div className="w-0.5 h-2 bg-amber-400" />
                        <div className="w-0.5 h-2 bg-amber-400" />
                      </div>
                    </div>
                  </div>

                  <span className="text-[7px] text-cyan-300 font-mono font-bold mt-1">
                    ▲ OLDINGA QARAGAN
                  </span>
                </div>

                {/* Orqa qism: 12V Akkumulyator va BTS7960 Motor Drayverlar */}
                <div className="w-full flex items-center justify-between border-t border-tactical-800 pt-1.5 text-[8px] font-mono text-slate-400">
                  <div className="flex items-center gap-1">
                    <div className="w-2.5 h-2.5 rounded bg-blue-500" />
                    <span>BTS</span>
                  </div>
                  <div className="px-1.5 py-0.5 rounded bg-slate-800 text-[7px] font-bold text-slate-300">
                    🔋 12V AKB
                  </div>
                  <div className="flex items-center gap-1">
                    <span>BTS</span>
                    <div className="w-2.5 h-2.5 rounded bg-blue-500" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ========================================================================= */
          /* 2. 2D KOMPAS VA YUQORIDAN KO'RINISH (360° AZIMUT HALQASI)                  */
          /* ========================================================================= */
          <div className="relative w-52 h-52 sm:w-60 sm:h-60 rounded-full border-2 border-tactical-700 flex items-center justify-center shadow-[0_0_30px_rgba(0,229,255,0.15)] bg-tactical-950">
            {/* Tashqi kompas daraja halqasi */}
            <div
              className="absolute inset-2 rounded-full border border-tactical-700/60 transition-transform duration-100 ease-out"
              style={{ transform: `rotate(${-safeHeading}deg)` }}
            >
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
              {/* Qadamli chiziqlar */}
              <div className="absolute top-0 bottom-0 left-1/2 w-[1px] bg-tactical-800 -translate-x-1/2" />
              <div className="absolute left-0 right-0 top-1/2 h-[1px] bg-tactical-800 -translate-y-1/2" />
            </div>

            {/* Robot 2D Maketi (Oldinga qaragan) */}
            <div className="relative w-28 h-36 flex flex-col items-center justify-between p-2 rounded-xl bg-neutral-900 border-2 border-police-cyan shadow-[0_0_15px_rgba(0,229,255,0.4)] z-10">
              {/* Old Faralar */}
              <div className="w-full flex justify-between px-1">
                <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#00e5ff]" />
                <div className="text-[8px] font-bold text-cyan-300">OLD (FRONT)</div>
                <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#00e5ff]" />
              </div>

              {/* MPU-6050 Datchik belgisi */}
              <div className="w-10 h-10 rounded bg-blue-700 border border-blue-400 flex flex-col items-center justify-center shadow">
                <div className="w-3 h-3 bg-black rounded-sm" />
                <span className="text-[6px] text-white font-extrabold mt-0.5">MPU6050</span>
              </div>

              {/* Orqa */}
              <div className="text-[7px] text-slate-400 font-mono">🔋 AKB / MOTOR</div>

              {/* 4 Balon */}
              <div className="absolute -left-3 top-2 w-3 h-8 bg-neutral-800 rounded border border-neutral-600" />
              <div className="absolute -right-3 top-2 w-3 h-8 bg-neutral-800 rounded border border-neutral-600" />
              <div className="absolute -left-3 bottom-2 w-3 h-8 bg-neutral-800 rounded border border-neutral-600" />
              <div className="absolute -right-3 bottom-2 w-3 h-8 bg-neutral-800 rounded border border-neutral-600" />
            </div>
          </div>
        )}

        {/* Burchak ko'rsatkichi (O'ng burchakdagi panel) */}
        <div className="absolute bottom-2 right-2 bg-tactical-950/90 border border-tactical-800 rounded-lg p-2 font-mono text-[10px] space-y-0.5 shadow-lg">
          <div className="flex justify-between gap-3">
            <span className="text-slate-400">Azimut (Heading):</span>
            <span className="font-bold text-amber-400">{safeHeading.toFixed(1)}°</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-slate-400">Pitch (Old-Orqa):</span>
            <span className={`font-bold ${Math.abs(safePitch) > 10 ? 'text-rose-400' : 'text-slate-200'}`}>
              {safePitch > 0 ? `+${safePitch.toFixed(1)}°` : `${safePitch.toFixed(1)}°`}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-slate-400">Roll (Chap-O'ng):</span>
            <span className={`font-bold ${Math.abs(safeRoll) > 10 ? 'text-rose-400' : 'text-slate-200'}`}>
              {safeRoll > 0 ? `+${safeRoll.toFixed(1)}°` : `${safeRoll.toFixed(1)}°`}
            </span>
          </div>
          {Math.abs(safeRate) >= 0.5 && (
            <div className="flex justify-between gap-3 pt-0.5 border-t border-tactical-850">
              <span className="text-slate-400">Tezlik:</span>
              <span className="font-bold text-emerald-400">
                {safeRate > 0 ? '↻' : '↺'} {Math.abs(safeRate).toFixed(1)}°/s
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
