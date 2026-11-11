import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useRobot } from '../context/RobotContext';
import {
  Radar,
  Battery,
  AlertTriangle,
  Cpu,
  Usb,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import { lidarSerialService, type LidarFrameData } from '../services/lidarSerialService';
import type { LidarPoint } from '../types/robot';

export const LidarRadarView: React.FC = () => {
  const { battery, addLog } = useRobot();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Nuqtalar faqat haqiqiy LiDAR dan (Web Serial). Port yopiq bo'lsa radar bo'sh
  const pointsRef = useRef<LidarPoint[]>([]);

  // Web Serial Port Holati
  const [isPortOpen, setIsPortOpen] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [portName, setPortName] = useState<string>('');
  const [portError, setPortError] = useState<string | null>(null);

  // Real-vaqt telemetriyasi
  const [liveRateHz, setLiveRateHz] = useState<number>(10.0);
  const [liveSpeedRpm, setLiveSpeedRpm] = useState<number>(600);
  const [livePackets, setLivePackets] = useState<number>(0);
  const [hardwareSectors, setHardwareSectors] = useState<{ front: number; right: number; rear: number; left: number } | null>(null);

  const isSerialSupported = lidarSerialService.isSupported();

  // Portni ochish (Web Serial API @ 230400 bps)
  const handleOpenPort = useCallback(async () => {
    try {
      setIsOpening(true);
      setPortError(null);

      const res = await lidarSerialService.openPort(230400);
      setIsPortOpen(true);
      setPortName(res.portName);
      addLog('SERIAL', 'success', `LiDAR porti ochildi: ${res.portName} @ 230400 bps`);

      // Kadrlar kelganda qabul qilish
      lidarSerialService.onFrame((data: LidarFrameData) => {
        pointsRef.current = data.points;
        setHardwareSectors(data.sectors);
        setLiveRateHz(data.rateHz);
        setLiveSpeedRpm(data.speedRpm);
        setLivePackets(data.packetsReceived);
      });
    } catch (err: any) {
      const msg = err?.message || 'LiDAR portini ochishda xatolik yuz berdi';
      setPortError(msg);
      addLog('SERIAL', 'error', `LiDAR xatosi: ${msg}`);
    } finally {
      setIsOpening(false);
    }
  }, [addLog]);

  // Portni yopish
  const handleClosePort = useCallback(async () => {
    try {
      await lidarSerialService.closePort();
      setIsPortOpen(false);
      setPortName('');
      setHardwareSectors(null);
      pointsRef.current = [];
      addLog('SERIAL', 'info', 'LiDAR apparat porti yopildi.');
    } catch (err: any) {
      console.warn('Portni yopishda xatolik:', err);
    }
  }, [addLog]);

  // Komponent yopilganda portni tozalash
  useEffect(() => {
    return () => {
      lidarSerialService.closePort().catch(() => {});
    };
  }, []);

  // HTML5 Canvas Radar render sikli (Barqaror 30 FPS)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let animationId: number;
    let sweepAngle = 0;
    let lastTime = performance.now();
    const frameInterval = 1000 / 30;

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

      // Fon
      ctx.fillStyle = '#070b12';
      ctx.fillRect(0, 0, width, height);

      // Masofa halqalari (1m..5m)
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

        ctx.font = '10px monospace';
        ctx.fillStyle = 'rgba(0, 229, 255, 0.6)';
        ctx.fillText(`${i}m`, cx + 6, cy - r + 12);
      }

      // O'q chiziqlari
      ctx.strokeStyle = 'rgba(43, 60, 94, 0.5)';
      ctx.beginPath();
      ctx.moveTo(cx, 15);
      ctx.lineTo(cx, height - 15);
      ctx.moveTo(15, cy);
      ctx.lineTo(width - 15, cy);
      ctx.stroke();

      // Burchaklar
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px monospace';
      ctx.fillText('0° (OLD)', cx - 22, 14);
      ctx.fillText('180° (ORQA)', cx - 30, height - 4);
      ctx.fillText('270° (CHAP)', 4, cy - 4);
      ctx.fillText('90° (O\'NG)', width - 60, cy - 4);

      // Radar nuri sweep gradienti
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

      // Nur chizig'i
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

      // Haqiqiy LiDAR nuqtalari (360 gradus)
      const currentPoints = pointsRef.current || [];
      for (let j = 0; j < currentPoints.length; j++) {
        const pt = currentPoints[j];
        if (!pt || pt.distance <= 0.02) continue;

        const rad = ((pt.angle - 90) * Math.PI) / 180;
        const distRatio = Math.min(pt.distance, 5.0) / 5.0;
        const px = cx + Math.cos(rad) * (distRatio * maxRadius);
        const py = cy + Math.sin(rad) * (distRatio * maxRadius);

        ctx.beginPath();
        if (pt.distance < 0.45) {
          ctx.fillStyle = '#ff2238'; // Xavfli to'siq (< 0.45m)
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

      // Markaziy robot korpusi
      ctx.fillStyle = '#1d63ff';
      ctx.fillRect(cx - 8, cy - 12, 16, 24);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - 8, cy - 12, 16, 24);

      // Shinalar
      ctx.fillStyle = '#64748b';
      ctx.fillRect(cx - 12, cy - 12, 3, 8);
      ctx.fillRect(cx + 9, cy - 12, 3, 8);
      ctx.fillRect(cx - 12, cy + 4, 3, 8);
      ctx.fillRect(cx + 9, cy + 4, 3, 8);
    };

    animationId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationId);
  }, []);

  const activeSectors = isPortOpen ? hardwareSectors : null;
  const isDangerBlocked = !!activeSectors && activeSectors.front <= 0.45;
  const fmtM = (v: number | undefined) => (v === undefined ? '—' : `${v.toFixed(2)} m`);

  return (
    <div className="flex-1 flex flex-col lg:flex-row gap-4 p-3 sm:p-5 overflow-y-auto max-w-6xl mx-auto w-full select-none">
      {/* CHAP USTUN: 360° LiDAR Radar va Port Boshqaruvi */}
      <div className="hud-panel rounded-xl p-4 flex-1 flex flex-col items-center justify-between">
        {/* Yuqori Panel: Skaner Nomi va Tezkor Port Ochish Tugmasi */}
        <div className="w-full flex flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-tactical-700/60 font-mono text-xs">
          <div className="flex items-center space-x-2">
            <Radar className="w-4 h-4 text-police-cyan animate-spin" />
            <span className="font-bold text-white tracking-wider">
              360° LDROBOT STL-19P LAZER SKANER
            </span>
          </div>

          {/* Port Boshqaruv Tugmalari */}
          <div className="flex items-center gap-2">
            {isPortOpen ? (
              <div className="flex items-center gap-1.5 bg-emerald-950/80 border border-emerald-500/80 px-2 py-1 rounded text-emerald-300 font-bold text-[11px] shadow-[0_0_12px_rgba(0,230,118,0.4)]">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>PORT OCHIQ ({portName || 'CP2102 @ 230400 bps'})</span>
                <button
                  onClick={handleClosePort}
                  className="ml-1 px-1.5 py-0.5 rounded bg-rose-900/80 hover:bg-rose-800 text-rose-200 text-[10px] transition-all"
                  title="LiDAR Portini Yopish"
                >
                  Yopish
                </button>
              </div>
            ) : (
              <button
                onClick={handleOpenPort}
                disabled={isOpening}
                className="flex items-center gap-1.5 bg-police-blue hover:bg-blue-600 text-white font-bold text-xs px-3 py-1.5 rounded-lg border border-police-cyan shadow-[0_0_14px_rgba(29,99,255,0.8)] transition-all active:scale-95 animate-pulse"
                title="Haqiqiy LiDAR USB/COM portini ochish"
              >
                <Usb className="w-4 h-4 text-white" />
                <span>{isOpening ? 'Port qidirilmoqda...' : '⚡ LIDAR PORTINI OCHISH'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Xatolik xabarnomasi */}
        {portError && (
          <div className="w-full mb-2 p-2 bg-rose-950/80 border border-rose-600 rounded text-rose-200 text-xs font-mono flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{portError}</span>
            </div>
            <button
              onClick={() => setPortError(null)}
              className="text-rose-400 hover:text-white px-1"
            >
              ✕
            </button>
          </div>
        )}

        {/* Radar Dumaloq Kanvasi */}
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

        {/* 4 Sektorli Masofa Kartochkalari */}
        <div className="w-full grid grid-cols-4 gap-2 my-2 font-mono text-center">
          <div className={`p-1.5 rounded border ${
            isDangerBlocked
              ? 'bg-rose-950/80 border-rose-600 text-rose-300 animate-pulse'
              : 'bg-tactical-950/80 border-tactical-800 text-police-cyan'
          }`}>
            <div className="text-[9px] text-slate-400 font-bold">OLD (0°)</div>
            <div className="text-xs font-bold mt-0.5">{fmtM(activeSectors?.front)}</div>
          </div>

          <div className="p-1.5 rounded bg-tactical-950/80 border border-tactical-800 text-police-cyan">
            <div className="text-[9px] text-slate-400 font-bold">O'NG (90°)</div>
            <div className="text-xs font-bold mt-0.5">{fmtM(activeSectors?.right)}</div>
          </div>

          <div className="p-1.5 rounded bg-tactical-950/80 border border-tactical-800 text-police-cyan">
            <div className="text-[9px] text-slate-400 font-bold">ORQA (180°)</div>
            <div className="text-xs font-bold mt-0.5">{fmtM(activeSectors?.rear)}</div>
          </div>

          <div className="p-1.5 rounded bg-tactical-950/80 border border-tactical-800 text-police-cyan">
            <div className="text-[9px] text-slate-400 font-bold">CHAP (270°)</div>
            <div className="text-xs font-bold mt-0.5">{fmtM(activeSectors?.left)}</div>
          </div>
        </div>

        <div className="w-full flex items-center justify-between text-[11px] font-mono text-slate-400 pt-2 border-t border-tactical-700/60">
          <span>RADIUS: 5.0 METR (Maks: 12m)</span>
          <span className="text-police-cyan">FOV: 360° TO'LIQ DOIRA</span>
          <span>Aniqlik: ±15 mm (DToF)</span>
        </div>
      </div>

      {/* O'NG USTUN: Port Boshqaruvi va Parametrlar */}
      <div className="w-full lg:w-96 flex flex-col gap-4">
        {/* Maxsus Apparat Porti Kartochkasi */}
        <div className="hud-panel rounded-xl p-4">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-tactical-700/60 font-mono text-xs">
            <span className="font-bold text-white flex items-center space-x-2">
              <Usb className="w-4 h-4 text-police-cyan" />
              <span>LIDAR PORTI BOSHQARUVI</span>
            </span>
            <span
              className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                isPortOpen
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-600'
                  : 'bg-tactical-800 text-slate-400'
              }`}
            >
              {isPortOpen ? 'ULANGAN (ONLINE)' : 'PORT YOPIQ'}
            </span>
          </div>

          <div className="space-y-2 font-mono text-xs mb-3">
            <div className="flex justify-between p-2 rounded bg-tactical-950 border border-tactical-800">
              <span className="text-slate-400">Port turi:</span>
              <span className="text-white font-bold">Web Serial (USB-UART)</span>
            </div>

            <div className="flex justify-between p-2 rounded bg-tactical-950 border border-tactical-800">
              <span className="text-slate-400">Baudrate:</span>
              <span className="text-amber-400 font-bold">230400 bps</span>
            </div>

            <div className="flex justify-between p-2 rounded bg-tactical-950 border border-tactical-800">
              <span className="text-slate-400">Jonli oqim:</span>
              <span className="text-emerald-400 font-bold">
                {isPortOpen ? `${liveRateHz.toFixed(1)} Hz (${liveSpeedRpm} RPM)` : 'Kutish'}
              </span>
            </div>

            <div className="flex justify-between p-2 rounded bg-tactical-950 border border-tactical-800">
              <span className="text-slate-400">Qabul qilingan paketlar:</span>
              <span className="text-police-cyan font-bold">{livePackets} ta paket</span>
            </div>
          </div>

          {/* Asosiy Portni Ochish / Yopish Tugmasi */}
          {isPortOpen ? (
            <button
              onClick={handleClosePort}
              className="w-full py-2.5 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-mono font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95"
            >
              <XCircle className="w-4 h-4 text-white" />
              <span>LIDAR PORTINI YOPISH (DISCONNECT)</span>
            </button>
          ) : (
            <button
              onClick={handleOpenPort}
              disabled={isOpening || !isSerialSupported}
              className={`w-full py-2.5 px-3 rounded-lg font-mono font-bold text-xs flex items-center justify-center gap-2 transition-all active:scale-95 ${
                !isSerialSupported
                  ? 'bg-tactical-800 text-slate-500 cursor-not-allowed border border-tactical-700'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400 shadow-[0_0_15px_rgba(0,230,118,0.6)]'
              }`}
            >
              <Usb className="w-4 h-4 text-white" />
              <span>
                {!isSerialSupported
                  ? "Web Serial qo'llab-quvvatlanmaydi"
                  : isOpening
                  ? 'Port qidirilmoqda...'
                  : '⚡ LIDAR PORTINI OCHISH (COM / USB)'}
              </span>
            </button>
          )}

          {!isSerialSupported && (
            <div className="mt-2 text-[10px] font-mono text-amber-400/90 text-center">
              * Eslatma: Web Serial API uchun Chrome yoki Edge brauzeridan foydalaning.
            </div>
          )}
        </div>

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
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-400">Zaryad Darajasi:</span>
                <span className="text-white font-bold">{battery ? `${battery.percentage}%` : "o'lchanmaydi"}</span>
              </div>
              <div className="w-full h-3 bg-tactical-950 rounded-full overflow-hidden border border-tactical-700">
                <div
                  className="h-full bg-gradient-to-r from-emerald-600 to-police-cyan transition-all duration-500"
                  style={{ width: `${battery?.percentage ?? 0}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs pt-1">
              <div className="p-2 rounded bg-tactical-950 border border-tactical-800">
                <div className="text-[10px] text-slate-400">Kuchlanish</div>
                <div className="text-sm font-bold text-police-cyan">{battery ? `${battery.voltage.toFixed(2)} V` : '—'}</div>
              </div>
              <div className="p-2 rounded bg-tactical-950 border border-tactical-800">
                <div className="text-[10px] text-slate-400">Tok Sarfi</div>
                <div className="text-sm font-bold text-emerald-400">{battery ? `${battery.current.toFixed(1)} A` : '—'}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
