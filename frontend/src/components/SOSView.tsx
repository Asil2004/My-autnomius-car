import React, { useState } from 'react';
import { useRobot } from '../context/RobotContext';
import {
  PhoneOff,
  Shield,
  Ambulance,
  Flame,
  Mic,
  MicOff,
  MapPin,
  CheckCircle,
  AlertOctagon,
  Clock
} from 'lucide-react';

export const SOSView: React.FC = () => {
  const { sos, triggerSOS, cancelSOS, system } = useRobot();
  const [micActive, setMicActive] = useState(true);

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-start p-3 sm:p-6 overflow-y-auto max-w-4xl mx-auto w-full select-none">
      {/* Top Banner: Vandal-Proof Public Safety Kiosk HUD */}
      <div className="w-full hud-panel rounded-xl p-4 mb-4 flex flex-col sm:flex-row items-center justify-between border-police-blue/40">
        <div className="flex items-center space-x-3 mb-2 sm:mb-0">
          <div className="w-12 h-12 rounded-lg bg-rose-600/20 border border-rose-500/50 flex items-center justify-center">
            <Shield className="w-7 h-7 text-rose-500 animate-pulse" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-white tracking-wider font-mono">
              O'ZBEKISTON RESPUBLIKASI IIV
            </h1>
            <p className="text-xs text-police-cyan font-mono">
              "QALQON" AVTONOM PATRUL — TEZKOR SOS TERMINALI
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 text-xs font-mono text-slate-300 bg-tactical-950/80 px-3 py-1.5 rounded-lg border border-tactical-700">
          <MapPin className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{sos.callerLocation}</span>
        </div>
      </div>

      {/* Main Interactive SOS Arena */}
      <div className="w-full flex-1 flex flex-col items-center justify-center hud-panel rounded-2xl p-6 sm:p-10 border-2 border-tactical-700/80 relative overflow-hidden">
        {/* Ambient Pulsing Glow */}
        <div
          className={`absolute inset-0 pointer-events-none transition-all duration-700 ${
            sos.active
              ? 'bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-rose-950/70 via-tactical-950/80 to-tactical-950'
              : 'bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-950/30 via-tactical-950/80 to-tactical-950'
          }`}
        />

        {!sos.active ? (
          /* IDLE / READY STATE */
          <div className="relative z-10 flex flex-col items-center text-center max-w-lg">
            <span className="text-xs uppercase font-mono tracking-widest text-police-cyan font-bold mb-2">
              Jamoat Xavfsizligi va Huquq-Tartibot
            </span>
            <h2 className="text-2xl sm:text-3xl font-black text-white mb-2">
              FAVQULODDA YORDAM KERAKMI?
            </h2>
            <p className="text-sm text-slate-400 mb-8">
              Quyidagi qizil tugmani bosing. Robot darhol IIV tezkor navbatchilik bo'limi bilan jonli video-audio aloqani o'rnatadi.
            </p>

            {/* Giant Pulse SOS Button */}
            <div className="relative my-4">
              <span className="absolute -inset-4 rounded-full bg-rose-600/30 animate-ping" />
              <span className="absolute -inset-8 rounded-full bg-rose-600/15 animate-pulse" />
              <button
                onClick={triggerSOS}
                className="relative w-44 h-44 sm:w-52 sm:h-52 rounded-full bg-gradient-to-tr from-rose-700 via-rose-600 to-red-500 border-4 border-rose-300 text-white font-mono font-black shadow-[0_0_50px_rgba(255,34,56,0.8)] active:scale-95 transition-transform flex flex-col items-center justify-center"
              >
                <AlertOctagon className="w-16 h-16 text-white mb-1 drop-shadow-md animate-bounce" />
                <span className="text-4xl font-extrabold tracking-wider">SOS</span>
                <span className="text-xl font-bold tracking-widest mt-1">102</span>
              </button>
            </div>

            {/* Quick Service Categories */}
            <div className="grid grid-cols-3 gap-3 w-full mt-8">
              <button
                onClick={() => triggerSOS()}
                className="p-3 rounded-xl bg-tactical-900/90 border border-tactical-700 hover:border-police-blue transition-all flex flex-col items-center"
              >
                <Shield className="w-6 h-6 text-police-cyan mb-1.5" />
                <span className="font-mono text-xs font-bold text-white">IIV 102</span>
                <span className="text-[10px] text-slate-400 mt-0.5">Politsiya</span>
              </button>

              <button
                onClick={() => triggerSOS()}
                className="p-3 rounded-xl bg-tactical-900/90 border border-tactical-700 hover:border-emerald-500 transition-all flex flex-col items-center"
              >
                <Ambulance className="w-6 h-6 text-emerald-400 mb-1.5" />
                <span className="font-mono text-xs font-bold text-white">TEZ YORDAM</span>
                <span className="text-[10px] text-slate-400 mt-0.5">103 Shifokor</span>
              </button>

              <button
                onClick={() => triggerSOS()}
                className="p-3 rounded-xl bg-tactical-900/90 border border-tactical-700 hover:border-amber-500 transition-all flex flex-col items-center"
              >
                <Flame className="w-6 h-6 text-amber-500 mb-1.5" />
                <span className="font-mono text-xs font-bold text-white">FVV 101</span>
                <span className="text-[10px] text-slate-400 mt-0.5">Qutqaruv</span>
              </button>
            </div>
          </div>
        ) : (
          /* ACTIVE EMERGENCY CALL IN PROGRESS */
          <div className="relative z-10 w-full max-w-xl flex flex-col items-center">
            {/* Live Call Banner */}
            <div className="w-full bg-rose-600 text-white py-2 px-4 rounded-xl flex items-center justify-between mb-4 shadow-[0_0_20px_rgba(255,34,56,0.7)] animate-pulse">
              <div className="flex items-center space-x-2 font-mono text-sm font-black">
                <AlertOctagon className="w-5 h-5" />
                <span>FAVQULODDA ALOQA O'RNATILDI</span>
              </div>
              <div className="flex items-center space-x-1.5 font-mono text-sm">
                <Clock className="w-4 h-4" />
                <span>{formatDuration(sos.callDuration)}</span>
              </div>
            </div>

            {/* Simulated Live Dispatcher Feed Screen */}
            <div className="w-full h-56 sm:h-72 rounded-xl bg-tactical-950 border-2 border-rose-500/80 overflow-hidden relative flex flex-col justify-between p-3 scanlines">
              {/* Dispatcher Header */}
              <div className="flex items-center justify-between z-10">
                <div className="bg-tactical-900/90 px-2.5 py-1 rounded border border-tactical-700 flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                  <span className="text-xs font-mono font-bold text-white">
                    IIV DISPETCHER: {sos.operatorName}
                  </span>
                </div>
                <div className="bg-rose-950/80 text-rose-300 text-[11px] font-mono px-2 py-0.5 rounded border border-rose-800">
                  REC • HD 1080P
                </div>
              </div>

              {/* Center Dispatcher Avatar / Visualizer */}
              <div className="self-center flex flex-col items-center">
                <div className="w-20 h-20 rounded-full border-2 border-police-cyan bg-police-blue/20 flex items-center justify-center mb-2 shadow-[0_0_20px_rgba(0,229,255,0.4)]">
                  <Shield className="w-10 h-10 text-police-cyan" />
                </div>
                <span className="text-xs font-mono text-emerald-400 flex items-center space-x-1">
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>Ikki tomonlama ovoz va video uzatilmoqda</span>
                </span>
              </div>

              {/* Stream bottom HUD */}
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 z-10 bg-tactical-950/80 p-1.5 rounded">
                <span>GEO: 41.3111, 69.2797</span>
                <span>STROBE & SIRENA: FAOL</span>
                <span>RPi IP: {system.rpiIp}</span>
              </div>
            </div>

            {/* In-Call Controls */}
            <div className="flex items-center justify-center space-x-4 mt-6">
              <button
                onClick={() => setMicActive(!micActive)}
                className={`p-3.5 rounded-full border transition-all ${
                  micActive
                    ? 'bg-tactical-900 border-tactical-700 text-slate-200'
                    : 'bg-rose-950 border-rose-700 text-rose-400'
                }`}
              >
                {micActive ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
              </button>

              {/* End Call Button */}
              <button
                onClick={cancelSOS}
                className="px-6 py-3.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-mono font-bold flex items-center space-x-2 shadow-[0_0_20px_rgba(255,34,56,0.6)] active:scale-95 transition-all"
              >
                <PhoneOff className="w-5 h-5" />
                <span>ALOQANI YAKUNLASH</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Public Guidelines Footer */}
      <div className="w-full mt-4 text-center text-xs font-mono text-slate-500">
        Robot minora balandligi: ~1.15m • 4mm Lexan brona • 12V LiFePO4 avtonom quvvat tizimi
      </div>
    </div>
  );
};
