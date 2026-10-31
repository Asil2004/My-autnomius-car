import React, { useState } from 'react';
import { useRobot } from '../context/RobotContext';
import type { SpeedLevel } from '../types/robot';
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  RotateCw,
  Square,
  Compass,
  Crosshair,
  Gauge,
  SlidersHorizontal,
  ShieldAlert,
  Zap,
  Maximize2
} from 'lucide-react';

export const HUDView: React.FC = () => {
  const {
    lastCommand,
    speedLevel,
    sendMecanumCommand,
    setSpeedLevel,
    sonars,
    isFrontBlocked,
    ptz,
    setPTZ,
    detectedObjects,
    system,
    isSimulationMode,
    logs
  } = useRobot();

  const [cameraFullscreen, setCameraFullscreen] = useState(false);
  const [streamError, setStreamError] = useState(false);

  // PTZ adjustments
  const adjustPTZ = (dPan: number, dTilt: number) => {
    setPTZ((prev) => ({
      ...prev,
      pan: Math.max(-180, Math.min(180, prev.pan + dPan)),
      tilt: Math.max(-30, Math.min(60, prev.tilt + dTilt)),
    }));
  };

  const getSonarColor = (distance: number, isCritical = false) => {
    if (isCritical || distance <= 22) return 'text-rose-500 bg-rose-950/60 border-rose-500 shadow-[0_0_10px_rgba(255,34,56,0.6)] animate-pulse';
    if (distance <= 45) return 'text-amber-400 bg-amber-950/40 border-amber-500/60';
    return 'text-emerald-400 bg-emerald-950/30 border-emerald-500/50';
  };

  return (
    <div className="flex-1 flex flex-col lg:flex-row gap-3 p-3 overflow-y-auto max-w-7xl mx-auto w-full">
      {/* LEFT COLUMN: Live Feed + HUD Overlays */}
      <div className={`flex flex-col gap-3 ${cameraFullscreen ? 'fixed inset-0 z-50 p-2 bg-tactical-950' : 'flex-1'}`}>
        <div className="hud-panel rounded-lg overflow-hidden flex flex-col flex-1 relative min-h-[320px] max-h-[520px]">
          {/* Header Bar inside Feed */}
          <div className="bg-tactical-950/80 px-3 py-2 border-b border-tactical-700/60 flex items-center justify-between z-10">
            <div className="flex items-center space-x-2 font-mono text-xs">
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <span className="font-bold text-white tracking-wider">360° PTZ GUMBAZ KAMERA</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-tactical-800 text-slate-300 border border-tactical-700">
                {ptz.mode}
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <span className="text-[11px] font-mono text-police-cyan hidden sm:inline">
                PAN: {ptz.pan > 0 ? `+${ptz.pan}` : ptz.pan}° | TILT: {ptz.tilt}°
              </span>
              <button
                onClick={() => setCameraFullscreen(!cameraFullscreen)}
                className="p-1 rounded bg-tactical-800 text-slate-300 hover:text-white"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Video Stream & Tactical Crosshair Viewport */}
          <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden scanlines">
            {!isSimulationMode && !streamError ? (
              <img
                src={`http://${system.rpiIp}:${system.rpiPort}/stream.mjpg`}
                alt="RPi Live Stream"
                onError={() => setStreamError(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              /* High-tech Tactical Simulation Stream with dynamic visual canvas */
              <div className="w-full h-full relative flex items-center justify-center bg-gradient-to-b from-tactical-950 via-[#0a1120] to-[#040810]">
                {/* Perspective Road & Grid */}
                <div className="absolute inset-0 opacity-25 pointer-events-none">
                  <div className="w-full h-full flex flex-col justify-end">
                    <div className="h-1/2 w-full bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/30 via-transparent to-transparent" />
                    <div className="h-1/2 border-t border-police-cyan/30 flex justify-center">
                      <div className="w-48 h-full border-x border-dashed border-police-cyan/40 transform -perspective-500 rotate-x-45" />
                    </div>
                  </div>
                </div>

                {/* AI Detected Objects Overlays */}
                {detectedObjects.map((obj) => (
                  <div
                    key={obj.id}
                    className="absolute border-2 transition-all duration-300 pointer-events-none flex flex-col justify-between"
                    style={{
                      borderColor: obj.color,
                      left: `${obj.box.x}%`,
                      top: `${obj.box.y}%`,
                      width: `${obj.box.width}%`,
                      height: `${obj.box.height}%`,
                      boxShadow: `0 0 15px ${obj.color}50`
                    }}
                  >
                    <div
                      className="px-1.5 py-0.5 text-[9px] font-mono font-bold tracking-tight text-white flex items-center justify-between"
                      style={{ backgroundColor: `${obj.color}cc` }}
                    >
                      <span>{obj.label}</span>
                      <span>{(obj.confidence * 100).toFixed(0)}%</span>
                    </div>
                    <div
                      className="px-1.5 py-0.2 text-[9px] font-mono self-end text-black font-extrabold"
                      style={{ backgroundColor: `${obj.color}cc` }}
                    >
                      D: {obj.distance}m
                    </div>
                  </div>
                ))}

                {/* Center Tactical Crosshair */}
                <div className="relative pointer-events-none flex items-center justify-center">
                  <Crosshair className="w-14 h-14 text-police-cyan/60 animate-pulse-subtle" />
                  <div className="absolute w-28 h-28 border border-dashed border-police-cyan/30 rounded-full" />
                  <div className="absolute -top-7 text-[10px] font-mono text-police-cyan/80">
                    N 41°18'31" E 69°16'44"
                  </div>
                </div>

                {/* Front Obstacle Warning Overlay */}
                {isFrontBlocked && (
                  <div className="absolute top-4 inset-x-4 bg-rose-600/90 text-white p-2.5 rounded border border-rose-400 flex items-center justify-center space-x-2 animate-bounce z-20 shadow-lg">
                    <ShieldAlert className="w-6 h-6 text-white animate-spin" />
                    <span className="font-mono font-black text-sm uppercase tracking-wide">
                      XAVF: OLD TO'SIQ ({sonars.front} sm &lt; 22 sm) — AVTOTORMOZ!
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Corner Bracket HUD Graphics */}
            <div className="absolute top-3 left-3 font-mono text-[10px] text-police-cyan/80 pointer-events-none bg-tactical-950/70 p-1.5 rounded border border-tactical-700/50">
              <div>FPS: 28.4</div>
              <div>LAT: 12ms</div>
              <div>FOV: 120°</div>
            </div>

            <div className="absolute bottom-3 left-3 font-mono text-[10px] text-police-cyan/80 pointer-events-none bg-tactical-950/70 p-1.5 rounded border border-tactical-700/50 flex items-center space-x-1.5">
              <Compass className="w-3.5 h-3.5 text-police-cyan animate-pulse" />
              <span>AZIMUT: 042° NE</span>
            </div>

            <div className="absolute bottom-3 right-3 font-mono text-[10px] text-slate-300 pointer-events-none bg-tactical-950/70 p-1.5 rounded border border-tactical-700/50">
              KOMANDA: <span className="font-bold text-police-cyan">{lastCommand}</span>
            </div>
          </div>

          {/* PTZ Quick Controls Bar */}
          <div className="bg-tactical-900/90 p-2 border-t border-tactical-700/60 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center space-x-1 font-mono text-slate-300">
              <SlidersHorizontal className="w-3.5 h-3.5 text-police-cyan" />
              <span className="text-[11px]">PTZ BURILISH:</span>
            </div>
            <div className="flex items-center space-x-1">
              <button
                onClick={() => adjustPTZ(-15, 0)}
                className="px-2 py-1 bg-tactical-800 hover:bg-tactical-700 border border-tactical-600 rounded text-slate-200 font-mono text-xs"
              >
                ◀ Chap
              </button>
              <button
                onClick={() => adjustPTZ(0, 10)}
                className="px-2 py-1 bg-tactical-800 hover:bg-tactical-700 border border-tactical-600 rounded text-slate-200 font-mono text-xs"
              >
                ▲ Yuqori
              </button>
              <button
                onClick={() => adjustPTZ(0, -10)}
                className="px-2 py-1 bg-tactical-800 hover:bg-tactical-700 border border-tactical-600 rounded text-slate-200 font-mono text-xs"
              >
                ▼ Quyi
              </button>
              <button
                onClick={() => adjustPTZ(15, 0)}
                className="px-2 py-1 bg-tactical-800 hover:bg-tactical-700 border border-tactical-600 rounded text-slate-200 font-mono text-xs"
              >
                O'ng ▶
              </button>
              <button
                onClick={() => setPTZ((p) => ({ ...p, pan: 0, tilt: 15, zoom: 1, mode: p.mode === 'AUTO_CAMERA' ? 'MANUAL' : 'AUTO_CAMERA' }))}
                className="px-2 py-1 bg-police-blue/30 text-police-cyan border border-police-blue/60 rounded font-mono text-xs hover:bg-police-blue/50"
              >
                {ptz.mode === 'AUTO_CAMERA' ? 'Avto' : 'Qo\'lda'}
              </button>
            </div>
          </div>
        </div>

        {/* HC-SR04 4X SONAR RADAR STATUS */}
        <div className="hud-panel rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-xs font-bold text-white flex items-center space-x-1.5">
              <Zap className="w-3.5 h-3.5 text-police-cyan" />
              <span>4X HC-SR04 ULTRATOVUSH SONARLARI</span>
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              Chegara: &lt;22sm = AVTOTORMOZ
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {/* Front */}
            <div className={`p-2 rounded border font-mono flex flex-col items-center justify-center transition-all ${getSonarColor(sonars.front, isFrontBlocked)}`}>
              <span className="text-[10px] text-slate-300 font-bold">OLD (TRIG A0, ECHO A1)</span>
              <span className="text-xl font-black mt-0.5">{sonars.front} sm</span>
              <span className="text-[9px] mt-0.5 font-semibold">
                {sonars.front <= 22 ? 'XAVF: TO\'SIQ!' : 'Xavfsiz'}
              </span>
            </div>

            {/* Rear */}
            <div className={`p-2 rounded border font-mono flex flex-col items-center justify-center transition-all ${getSonarColor(sonars.rear)}`}>
              <span className="text-[10px] text-slate-300 font-bold">ORQA (TRIG A2, ECHO A3)</span>
              <span className="text-xl font-black mt-0.5">{sonars.rear} sm</span>
              <span className="text-[9px] mt-0.5 font-semibold">
                {sonars.rear <= 22 ? 'Orqa to\'siq' : 'Ochiq'}
              </span>
            </div>

            {/* Left */}
            <div className={`p-2 rounded border font-mono flex flex-col items-center justify-center transition-all ${getSonarColor(sonars.left)}`}>
              <span className="text-[10px] text-slate-300 font-bold">CHAP YONLAMA</span>
              <span className="text-xl font-black mt-0.5">{sonars.left} sm</span>
              <span className="text-[9px] mt-0.5 font-semibold">Ochiq</span>
            </div>

            {/* Right */}
            <div className={`p-2 rounded border font-mono flex flex-col items-center justify-center transition-all ${getSonarColor(sonars.right)}`}>
              <span className="text-[10px] text-slate-300 font-bold">O'NG YONLAMA</span>
              <span className="text-xl font-black mt-0.5">{sonars.right} sm</span>
              <span className="text-[9px] mt-0.5 font-semibold">Ochiq</span>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: Mecanum Directional Controller & Speed & Logs */}
      <div className="w-full lg:w-96 flex flex-col gap-3">
        {/* Mecanum Kinematics Controller */}
        <div className="hud-panel rounded-lg p-3.5 flex flex-col items-center">
          <div className="w-full flex items-center justify-between pb-2 mb-2 border-b border-tactical-700/60 font-mono text-xs">
            <span className="font-bold text-white flex items-center space-x-1.5">
              <Gauge className="w-4 h-4 text-police-cyan" />
              <span>MECANUM 4WD BOSHQARUV</span>
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-tactical-800 text-police-cyan border border-tactical-700">
              L293D SHIELD
            </span>
          </div>

          {/* Speed Selector (1, 2, 3) */}
          <div className="w-full flex items-center justify-between bg-tactical-900/80 p-1.5 rounded border border-tactical-700/50 mb-3">
            <span className="text-[11px] font-mono text-slate-300 pl-1 font-semibold">TEZLIK (PWM):</span>
            <div className="flex space-x-1.5">
              {([1, 2, 3] as SpeedLevel[]).map((lvl) => {
                const pwmLabel = lvl === 1 ? '130' : lvl === 2 ? '190' : '250';
                const active = speedLevel === lvl;
                return (
                  <button
                    key={lvl}
                    onClick={() => setSpeedLevel(lvl)}
                    className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition-all ${
                      active
                        ? 'bg-police-blue text-white shadow-[0_0_10px_rgba(29,99,255,0.7)]'
                        : 'bg-tactical-800 text-slate-400 hover:text-white border border-tactical-700'
                    }`}
                  >
                    {lvl} <span className="text-[9px] opacity-75">({pwmLabel})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3x3 Mecanum Tactical Keypad */}
          <div className="grid grid-cols-3 gap-2 w-full max-w-[280px]">
            {/* Strafe Left (Q) */}
            <button
              onClick={() => sendMecanumCommand('Q')}
              title="Chapga Yonlama (Strafe Q)"
              className={`p-3.5 rounded-lg border font-mono font-bold flex flex-col items-center justify-center transition-all active:scale-95 ${
                lastCommand === 'Q'
                  ? 'bg-police-blue text-white border-police-cyan shadow-[0_0_14px_rgba(29,99,255,0.8)]'
                  : 'bg-tactical-900/90 text-slate-300 border-tactical-700/70 hover:bg-tactical-800'
              }`}
            >
              <RotateCcw className="w-5 h-5 text-police-cyan mb-1" />
              <span className="text-[11px]">STRAFE Q</span>
            </button>

            {/* Forward (F) */}
            <button
              onClick={() => sendMecanumCommand('F')}
              disabled={isFrontBlocked}
              title="Oldinga (F)"
              className={`p-3.5 rounded-lg border font-mono font-bold flex flex-col items-center justify-center transition-all active:scale-95 ${
                isFrontBlocked
                  ? 'opacity-40 bg-tactical-950 border-rose-900 cursor-not-allowed'
                  : lastCommand === 'F'
                  ? 'bg-emerald-600 text-white border-emerald-400 shadow-[0_0_14px_rgba(0,230,118,0.8)]'
                  : 'bg-tactical-900/90 text-slate-300 border-tactical-700/70 hover:bg-tactical-800'
              }`}
            >
              <ArrowUp className="w-6 h-6 text-emerald-400 mb-1" />
              <span className="text-xs">OLDINGA (F)</span>
            </button>

            {/* Strafe Right (E) */}
            <button
              onClick={() => sendMecanumCommand('E')}
              title="O'ngga Yonlama (Strafe E)"
              className={`p-3.5 rounded-lg border font-mono font-bold flex flex-col items-center justify-center transition-all active:scale-95 ${
                lastCommand === 'E'
                  ? 'bg-police-blue text-white border-police-cyan shadow-[0_0_14px_rgba(29,99,255,0.8)]'
                  : 'bg-tactical-900/90 text-slate-300 border-tactical-700/70 hover:bg-tactical-800'
              }`}
            >
              <RotateCw className="w-5 h-5 text-police-cyan mb-1" />
              <span className="text-[11px]">STRAFE E</span>
            </button>

            {/* Turn Left (L) */}
            <button
              onClick={() => sendMecanumCommand('L')}
              title="Chapga Burilish (L)"
              className={`p-3.5 rounded-lg border font-mono font-bold flex flex-col items-center justify-center transition-all active:scale-95 ${
                lastCommand === 'L'
                  ? 'bg-police-blue text-white border-police-cyan shadow-[0_0_14px_rgba(29,99,255,0.8)]'
                  : 'bg-tactical-900/90 text-slate-300 border-tactical-700/70 hover:bg-tactical-800'
              }`}
            >
              <ArrowLeft className="w-6 h-6 text-police-cyan mb-1" />
              <span className="text-xs">CHAP (L)</span>
            </button>

            {/* STOP (S) */}
            <button
              onClick={() => sendMecanumCommand('S')}
              title="To'xtatish (S)"
              className={`p-3.5 rounded-lg border-2 font-mono font-black flex flex-col items-center justify-center transition-all active:scale-95 ${
                lastCommand === 'S'
                  ? 'bg-rose-600 text-white border-rose-400 shadow-[0_0_18px_rgba(255,34,56,0.9)] animate-pulse'
                  : 'bg-tactical-800 text-rose-300 border-rose-600/70 hover:bg-rose-900/50'
              }`}
            >
              <Square className="w-6 h-6 text-white mb-1 fill-current" />
              <span className="text-xs">STOP (S)</span>
            </button>

            {/* Turn Right (R) */}
            <button
              onClick={() => sendMecanumCommand('R')}
              title="O'ngga Burilish (R)"
              className={`p-3.5 rounded-lg border font-mono font-bold flex flex-col items-center justify-center transition-all active:scale-95 ${
                lastCommand === 'R'
                  ? 'bg-police-blue text-white border-police-cyan shadow-[0_0_14px_rgba(29,99,255,0.8)]'
                  : 'bg-tactical-900/90 text-slate-300 border-tactical-700/70 hover:bg-tactical-800'
              }`}
            >
              <ArrowRight className="w-6 h-6 text-police-cyan mb-1" />
              <span className="text-xs">O'NG (R)</span>
            </button>

            {/* 360 Spin Left */}
            <button
              onClick={() => sendMecanumCommand('L')}
              title="360° Joyida Burilish"
              className="p-3 rounded-lg border font-mono text-[10px] text-slate-400 border-tactical-700/70 bg-tactical-900/90 hover:bg-tactical-800 flex flex-col items-center justify-center"
            >
              <RotateCcw className="w-4 h-4 mb-0.5 text-slate-400" />
              <span>360° BURIL</span>
            </button>

            {/* Backward (B) */}
            <button
              onClick={() => sendMecanumCommand('B')}
              title="Orqaga (B)"
              className={`p-3.5 rounded-lg border font-mono font-bold flex flex-col items-center justify-center transition-all active:scale-95 ${
                lastCommand === 'B'
                  ? 'bg-police-blue text-white border-police-cyan shadow-[0_0_14px_rgba(29,99,255,0.8)]'
                  : 'bg-tactical-900/90 text-slate-300 border-tactical-700/70 hover:bg-tactical-800'
              }`}
            >
              <ArrowDown className="w-6 h-6 text-police-cyan mb-1" />
              <span className="text-xs">ORQAGA (B)</span>
            </button>

            {/* 360 Spin Right */}
            <button
              onClick={() => sendMecanumCommand('R')}
              title="360° Joyida O'ngga Burilish"
              className="p-3 rounded-lg border font-mono text-[10px] text-slate-400 border-tactical-700/70 bg-tactical-900/90 hover:bg-tactical-800 flex flex-col items-center justify-center"
            >
              <RotateCw className="w-4 h-4 mb-0.5 text-slate-400" />
              <span>360° SPUR</span>
            </button>
          </div>

          {/* Teleskopik Minora Boshqaruvi (U va D) */}
          <div className="grid grid-cols-2 gap-2 mt-2">
            <button
              onClick={() => sendMecanumCommand('U')}
              title="Teleskopik Minorani Ko'tarish (U)"
              className="p-2 rounded-lg border font-mono text-xs font-bold text-police-cyan border-police-cyan/40 bg-tactical-900/90 hover:bg-tactical-800 flex items-center justify-center space-x-1"
            >
              <span>🗼 MINORA ↑ (U)</span>
            </button>
            <button
              onClick={() => sendMecanumCommand('D')}
              title="Teleskopik Minorani Tushirish (D)"
              className="p-2 rounded-lg border font-mono text-xs font-bold text-slate-300 border-tactical-700 bg-tactical-900/90 hover:bg-tactical-800 flex items-center justify-center space-x-1"
            >
              <span>🗼 MINORA ↓ (D)</span>
            </button>
          </div>

          <div className="mt-3 text-[10px] font-mono text-slate-400 text-center">
            Klaviatura: <span className="text-police-cyan">W, A, S, D, Q, E, Space (Stop), 1-3 (Tezlik)</span>
          </div>
        </div>

        {/* Real-time Telemetry & Arduino Serial Stream */}
        <div className="hud-panel rounded-lg p-3 flex flex-col flex-1 min-h-[160px]">
          <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-tactical-700/60 font-mono text-xs">
            <span className="font-bold text-white flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-police-cyan animate-pulse" />
              <span>SERIAL TELEMETRIYA KONSOLI</span>
            </span>
            <span className="text-[10px] text-slate-400">{system.arduinoPort}</span>
          </div>

          <div className="flex-1 bg-tactical-950/90 rounded border border-tactical-800 p-2 overflow-y-auto max-h-40 font-mono text-[11px] space-y-1">
            {logs.slice(0, 15).map((log) => (
              <div key={log.id} className="flex items-start space-x-1.5">
                <span className="text-slate-500 shrink-0">[{log.time}]</span>
                <span
                  className={`px-1 rounded text-[9px] font-bold shrink-0 ${
                    log.level === 'error'
                      ? 'bg-rose-950 text-rose-400'
                      : log.level === 'warn'
                      ? 'bg-amber-950 text-amber-400'
                      : log.level === 'success'
                      ? 'bg-emerald-950 text-emerald-400'
                      : 'bg-tactical-800 text-slate-300'
                  }`}
                >
                  {log.source}
                </span>
                <span
                  className={`break-all ${
                    log.level === 'error'
                      ? 'text-rose-400 font-semibold'
                      : log.level === 'warn'
                      ? 'text-amber-300'
                      : log.level === 'success'
                      ? 'text-emerald-300'
                      : 'text-slate-300'
                  }`}
                >
                  {log.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
