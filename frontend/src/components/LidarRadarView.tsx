import React, { useEffect, useRef } from 'react';
import { useRobot } from '../context/RobotContext';
import {
  Radar,
  Zap,
  Battery,
  ShieldCheck,
  AlertTriangle,
  Cpu,
  RefreshCw,
  Usb
} from 'lucide-react';

export const LidarRadarView: React.FC = () => {
  const { lidarPoints, lidarInfo, setLidarMode, battery, isMoving } = useRobot();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointsRef = useRef(lidarPoints);

  useEffect(() => {
    pointsRef.current = lidarPoints;
  }, [lidarPoints]);

  // Render High-tech LiDAR Radar sweep on HTML5 Canvas (Optimized 30 FPS)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let animationId: number;
    let sweepAngle = 0;
    let lastTime = performance.now();
    const frameInterval = 1000 / 30; // Lock canvas to 30 FPS for battery & GPU savings

    const render = (currentTime: number) => {
      animationId = requestAnimationFrame(render);

      if (document.hidden) return;

      const elapsed = currentTime - lastTime;
      if (elapsed < frameInterval - 1) return;
      lastTime = currentTime - (elapsed % frameInterval);

      const width = canvas.width;
      const height = canvas.height;
      const cx = width / 2;
      const cy = height / 2;
      const maxRadius = Math.min(cx, cy) - 20;

      // Dark tactical canvas background
      ctx.fillStyle = '#070b12';
      ctx.fillRect(0, 0, width, height);

      // Distance rings (1m, 2m, 3m, 4m, 5m)
      const rings = 5;
      for (let i = 1; i <= rings; i++) {
        const r = (maxRadius / rings) * i;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.strokeStyle = i === rings ? 'rgba(0, 229, 255, 0.4)' : 'rgba(43, 60, 94, 0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash(i % 2 === 0 ? [4, 4] : []);
        ctx.stroke();
        ctx.setLineDash([]);

        // Ring labels (meters)
        ctx.font = '10px monospace';
        ctx.fillStyle = 'rgba(0, 229, 255, 0.6)';
        ctx.fillText(`${i}m`, cx + 6, cy - r + 12);
      }

      // Crosshairs & degree axes
      ctx.strokeStyle = 'rgba(43, 60, 94, 0.5)';
      ctx.beginPath();
      ctx.moveTo(cx, 15);
      ctx.lineTo(cx, height - 15);
      ctx.moveTo(15, cy);
      ctx.lineTo(width - 15, cy);
      ctx.stroke();

      // Degree markings (0°, 90°, 180°, 270°)
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px monospace';
      ctx.fillText('0° (OLD)', cx - 22, 14);
      ctx.fillText('180° (ORQA)', cx - 30, height - 4);
      ctx.fillText('270° (CHAP)', 4, cy - 4);
      ctx.fillText('90° (O\'NG)', width - 60, cy - 4);

      // Sweeping Beam Gradient
      sweepAngle = (sweepAngle + 0.05) % (2 * Math.PI);
      const sweepGradient = ctx.createRadialGradient(cx, cy, 10, cx, cy, maxRadius);
      sweepGradient.addColorStop(0, 'rgba(0, 229, 255, 0.25)');
      sweepGradient.addColorStop(1, 'rgba(0, 229, 255, 0.0)');

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, maxRadius, sweepAngle - 0.4, sweepAngle);
      ctx.closePath();
      ctx.fillStyle = sweepGradient;
      ctx.fill();

      // Sweeping leading line
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(
        cx + Math.cos(sweepAngle) * maxRadius,
        cy + Math.sin(sweepAngle) * maxRadius
      );
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      // Render LiDAR obstacles/points (fast draw without expensive canvas blur)
      const currentPoints = pointsRef.current || [];
      for (let j = 0; j < currentPoints.length; j++) {
        const pt = currentPoints[j];
        const rad = ((pt.angle - 90) * Math.PI) / 180;
        const distRatio = Math.min(pt.distance, 5.0) / 5.0;
        const px = cx + Math.cos(rad) * (distRatio * maxRadius);
        const py = cy + Math.sin(rad) * (distRatio * maxRadius);

        ctx.beginPath();
        if (pt.distance < 0.45) {
          ctx.fillStyle = '#ff2238'; // Favqulodda to'siq zonasi (<0.45m)
          ctx.arc(px, py, 4, 0, 2 * Math.PI);
          ctx.fill();
        } else if (pt.distance < 1.2) {
          ctx.fillStyle = '#ffb300';
          ctx.arc(px, py, 3, 0, 2 * Math.PI);
          ctx.fill();
        } else {
          ctx.fillStyle = '#00e676';
          ctx.arc(px, py, 2, 0, 2 * Math.PI);
          ctx.fill();
        }
      }

      // Center Robot Icon / Chassis footprint
      ctx.fillStyle = '#1d63ff';
      ctx.fillRect(cx - 8, cy - 12, 16, 24);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - 8, cy - 12, 16, 24);

      // Mecanum wheel representations
      ctx.fillStyle = '#64748b';
      ctx.fillRect(cx - 12, cy - 12, 3, 8); // FL
      ctx.fillRect(cx + 9, cy - 12, 3, 8);  // FR
      ctx.fillRect(cx - 12, cy + 4, 3, 8);  // RL
      ctx.fillRect(cx + 9, cy + 4, 3, 8);   // RR
    };

    animationId = requestAnimationFrame(render);

    return () => cancelAnimationFrame(animationId);
  }, []);

  const isHardware = lidarInfo.mode === 'HARDWARE';
  const isDangerBlocked = (lidarInfo.sectors?.front ?? 2.0) <= 0.45;

  return (
    <div className="flex-1 flex flex-col lg:flex-row gap-4 p-3 sm:p-5 overflow-y-auto max-w-6xl mx-auto w-full select-none">
      {/* LEFT: 360° LDROBOT STL-19P LiDAR Skaner Radar Canvas */}
      <div className="hud-panel rounded-xl p-4 flex-1 flex flex-col items-center justify-between">
        <div className="w-full flex flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-tactical-700/60 font-mono text-xs">
          <div className="flex items-center space-x-2">
            <Radar className="w-4 h-4 text-police-cyan animate-spin" />
            <span className="font-bold text-white tracking-wider">
              360° LDROBOT STL-19P LAZER SKANER
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`text-[10px] px-2 py-0.5 rounded border font-bold flex items-center gap-1 ${
                isHardware
                  ? 'text-emerald-400 bg-emerald-950/60 border-emerald-700'
                  : 'text-amber-400 bg-amber-950/60 border-amber-700'
              }`}
            >
              {isHardware ? (
                <>
                  <ShieldCheck className="w-3 h-3 text-emerald-400" />
                  HAQIQIY APPARAT (ONLINE)
                </>
              ) : (
                <>
                  <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" />
                  SIMULYATOR REJIMI
                </>
              )}
            </span>

            <button
              onClick={() => setLidarMode(isHardware ? 'SIMULATION' : 'HARDWARE')}
              className="text-[10px] px-2 py-0.5 rounded bg-tactical-800 hover:bg-tactical-700 text-slate-300 border border-tactical-600 transition-all active:scale-95"
              title="Rejimni almashtirish"
            >
              Rejim: {isHardware ? 'Apparat' : 'Simulyator'}
            </button>
          </div>
        </div>

        {/* High-res Radar Canvas */}
        <div className="relative my-2 w-full max-w-[380px] sm:max-w-[420px] aspect-square flex items-center justify-center rounded-full bg-tactical-950 p-1 border-2 border-police-blue/30 shadow-[0_0_25px_rgba(0,229,255,0.15)]">
          <canvas
            ref={canvasRef}
            width={400}
            height={400}
            className="w-full h-full rounded-full"
          />

          {isDangerBlocked && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-rose-950/90 text-rose-300 border border-rose-600 px-3 py-1 rounded-full font-mono text-[10px] font-bold flex items-center gap-1.5 shadow-lg animate-pulse">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
              <span>XAVF: OLD TO'SIQ &lt; 0.45m (AVTOTORMOZ)</span>
            </div>
          )}
        </div>

        {/* 4 Sector Real Distance Cards */}
        <div className="w-full grid grid-cols-4 gap-2 my-2 font-mono text-center">
          <div className={`p-1.5 rounded border ${
            (lidarInfo.sectors?.front ?? 2.0) <= 0.45
              ? 'bg-rose-950/80 border-rose-600 text-rose-300 animate-pulse'
              : 'bg-tactical-950/80 border-tactical-800 text-police-cyan'
          }`}>
            <div className="text-[9px] text-slate-400 font-bold">OLD (0°)</div>
            <div className="text-xs font-bold mt-0.5">{(lidarInfo.sectors?.front ?? 2.80).toFixed(2)} m</div>
          </div>

          <div className="p-1.5 rounded bg-tactical-950/80 border border-tactical-800 text-police-cyan">
            <div className="text-[9px] text-slate-400 font-bold">O'NG (90°)</div>
            <div className="text-xs font-bold mt-0.5">{(lidarInfo.sectors?.right ?? 2.40).toFixed(2)} m</div>
          </div>

          <div className="p-1.5 rounded bg-tactical-950/80 border border-tactical-800 text-police-cyan">
            <div className="text-[9px] text-slate-400 font-bold">ORQA (180°)</div>
            <div className="text-xs font-bold mt-0.5">{(lidarInfo.sectors?.rear ?? 3.50).toFixed(2)} m</div>
          </div>

          <div className="p-1.5 rounded bg-tactical-950/80 border border-tactical-800 text-police-cyan">
            <div className="text-[9px] text-slate-400 font-bold">CHAP (270°)</div>
            <div className="text-xs font-bold mt-0.5">{(lidarInfo.sectors?.left ?? 2.10).toFixed(2)} m</div>
          </div>
        </div>

        <div className="w-full flex items-center justify-between text-[11px] font-mono text-slate-400 pt-2 border-t border-tactical-700/60">
          <span>RADIUS: 5.0 METR (Maks: 12m)</span>
          <span className="text-police-cyan">FOV: 360° TO'LIQ DOIRA</span>
          <span>Aniqlik: ±15 mm (DToF)</span>
        </div>
      </div>

      {/* RIGHT: LDROBOT STL-19P Hardware Specs & Telemetry */}
      <div className="w-full lg:w-96 flex flex-col gap-4">
        {/* LDROBOT STL-19P Apparat Spetsifikatsiyasi */}
        <div className="hud-panel rounded-xl p-4">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-tactical-700/60 font-mono text-xs">
            <span className="font-bold text-white flex items-center space-x-2">
              <Cpu className="w-4 h-4 text-police-cyan" />
              <span>LDROBOT STL-19P PARAMETRLARI</span>
            </span>
            <span className="text-[10px] text-emerald-400">Class 1 Eye-Safe</span>
          </div>

          <div className="space-y-2 font-mono text-xs">
            <div className="flex justify-between p-2 rounded bg-tactical-950 border border-tactical-800">
              <span className="text-slate-400">Sensor Modeli:</span>
              <span className="text-white font-bold">LDROBOT STL-19P (LD19)</span>
            </div>

            <div className="flex justify-between p-2 rounded bg-tactical-950 border border-tactical-800">
              <span className="text-slate-400">O'lchash Texnologiyasi:</span>
              <span className="text-police-cyan font-bold">DToF (Time-of-Flight)</span>
            </div>

            <div className="flex justify-between p-2 rounded bg-tactical-950 border border-tactical-800">
              <span className="text-slate-400">Aloqa Porti &amp; Baud:</span>
              <span className="text-amber-400 font-bold">UART @ 230400 bps</span>
            </div>

            <div className="flex justify-between p-2 rounded bg-tactical-950 border border-tactical-800">
              <span className="text-slate-400">Aylanish Chastotasi:</span>
              <span className="text-emerald-400 font-bold">{lidarInfo.rateHz.toFixed(1)} Hz (600 RPM)</span>
            </div>

            <div className="flex justify-between p-2 rounded bg-tactical-950 border border-tactical-800">
              <span className="text-slate-400">Namuna Olish Tezligi:</span>
              <span className="text-white font-bold">4500 nuqta/sek (4.5 kHz)</span>
            </div>

            <div className="flex justify-between p-2 rounded bg-tactical-950 border border-tactical-800">
              <span className="text-slate-400">Masofa Diapazoni:</span>
              <span className="text-slate-300 font-bold">0.05 m — 12.00 m</span>
            </div>

            <div className="flex justify-between p-2 rounded bg-tactical-950 border border-tactical-800">
              <span className="text-slate-400">Ko'rish Burchagi (FOV):</span>
              <span className="text-police-cyan font-bold">360° Gorizontal</span>
            </div>
          </div>

          <div className="mt-3 p-2.5 rounded bg-blue-950/40 border border-blue-800/60 font-mono text-[11px] text-blue-200 flex items-start gap-2">
            <Usb className="w-4 h-4 text-police-cyan shrink-0 mt-0.5" />
            <div>
              <b className="text-police-cyan">Ulanish:</b> STL-19P LiDAR CP2102 USB-to-UART drayveri orqali 230400 baudda avtomatik ochiladi.
            </div>
          </div>
        </div>

        {/* LiFePO4 12V Battery Station */}
        <div className="hud-panel rounded-xl p-4">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-tactical-700/60 font-mono text-xs">
            <span className="font-bold text-white flex items-center space-x-2">
              <Battery className="w-4 h-4 text-emerald-400" />
              <span>12V LiFePO4 AKKUMULYATOR</span>
            </span>
            <span className="text-[10px] text-slate-400">Pastki Og'irlik Markazi</span>
          </div>

          <div className="space-y-3 font-mono">
            {/* Battery bar */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-400">Zaryad Darajasi:</span>
                <span className="text-white font-bold">{battery.percentage}%</span>
              </div>
              <div className="w-full h-3 bg-tactical-950 rounded-full overflow-hidden border border-tactical-700">
                <div
                  className="h-full bg-gradient-to-r from-emerald-600 to-police-cyan transition-all duration-500"
                  style={{ width: `${battery.percentage}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs pt-1">
              <div className="p-2 rounded bg-tactical-950 border border-tactical-800">
                <div className="text-[10px] text-slate-400">Kuchlanish</div>
                <div className="text-sm font-bold text-police-cyan">{battery.voltage.toFixed(2)} V</div>
              </div>
              <div className="p-2 rounded bg-tactical-950 border border-tactical-800">
                <div className="text-[10px] text-slate-400">Tok Sarfi</div>
                <div className="text-sm font-bold text-emerald-400">{battery.current.toFixed(1)} A</div>
              </div>
            </div>
          </div>
        </div>

        {/* 4x DC Motors Status (L293D Shield M1-M4) */}
        <div className="hud-panel rounded-xl p-4 flex-1">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-tactical-700/60 font-mono text-xs">
            <span className="font-bold text-white flex items-center space-x-2">
              <Zap className="w-4 h-4 text-police-cyan" />
              <span>4X REDUKTORLI MOTORLAR (M1-M4)</span>
            </span>
            <span className="text-[10px] text-slate-400">4WD Mecanum</span>
          </div>

          <div className="grid grid-cols-2 gap-2 font-mono text-xs">
            <div className="p-2.5 rounded bg-tactical-950 border border-tactical-800">
              <div className="text-[10px] text-slate-400 font-bold">M1: OLD CHAP (FL)</div>
              <div className="text-white font-bold mt-1">{isMoving ? 'FAOL (PWM)' : 'KUTISH'}</div>
            </div>

            <div className="p-2.5 rounded bg-tactical-950 border border-tactical-800">
              <div className="text-[10px] text-slate-400 font-bold">M2: OLD O'NG (FR)</div>
              <div className="text-white font-bold mt-1">{isMoving ? 'FAOL (PWM)' : 'KUTISH'}</div>
            </div>

            <div className="p-2.5 rounded bg-tactical-950 border border-tactical-800">
              <div className="text-[10px] text-slate-400 font-bold">M3: ORQA CHAP (RL)</div>
              <div className="text-white font-bold mt-1">{isMoving ? 'FAOL (PWM)' : 'KUTISH'}</div>
            </div>

            <div className="p-2.5 rounded bg-tactical-950 border border-tactical-800">
              <div className="text-[10px] text-slate-400 font-bold">M4: ORQA O'NG (RR)</div>
              <div className="text-white font-bold mt-1">{isMoving ? 'FAOL (PWM)' : 'KUTISH'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
