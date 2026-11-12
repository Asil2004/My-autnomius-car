import React, { useEffect, useState } from 'react';
import { camLinkSettings } from '../services/camLinkSettings';
import { RadioButton } from './RadioButton';
import { useRobot } from '../context/RobotContext';
import {
  Shield,
  Radio,
  Volume2,
  VolumeX,
  Siren,
  BatteryCharging,
  BatteryMedium,
  OctagonAlert,
  LogOut,
  Gamepad2
} from 'lucide-react';
import { tacticalAudio, SIREN_TONE_NAMES, type SirenTone } from '../services/audioService';

interface NavbarProps {
  onLockScreen?: () => void;
  onOpenController?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onLockScreen, onOpenController }) => {
  const {
    battery,
    strobeActive,
    toggleStrobe,
    sirenTone,
    setSirenTone,
    isMuted,
    toggleMute,
    sendMecanumCommand,
    isMoving
  } = useRobot();
  const [isOperator, setIsOperator] = useState(() => camLinkSettings.get().role === 'operator');
  useEffect(() => camLinkSettings.subscribe((s) => setIsOperator(s.role === 'operator')), []);

  return (
    <header className="w-full bg-tactical-950/90 border-b border-tactical-700/60 backdrop-blur-md px-3 py-2 flex items-center justify-between select-none z-30">
      {/* Left: Emblem & Identification */}
      <div className="flex items-center space-x-3">
        <div className="relative flex items-center justify-center w-10 h-10 rounded bg-police-blue/15 border border-police-blue/40 shadow-inner">
          <Shield className="w-6 h-6 text-police-cyan drop-shadow-[0_0_8px_rgba(0,229,255,0.6)]" />
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-500" />
        </div>
        <div>
          <div className="flex items-center space-x-2">
            <span className="font-extrabold tracking-wider text-base text-white font-mono">
              QALQON
            </span>
            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-police-blue/20 text-police-cyan border border-police-blue/40">
              IIV-ROBOT-01
            </span>
          </div>
          <div className="text-[11px] font-mono text-tactical-500 flex items-center space-x-1.5">
            <Radio className="w-3 h-3 text-emerald-400" />
            <span className="text-emerald-400">OPERATOR PANEL</span>
          </div>
        </div>
      </div>

      {/* Center: Tactical Strobe status bar */}
      <div className="hidden sm:flex items-center space-x-2 px-3 py-1 rounded bg-tactical-900 border border-tactical-700/50">
        <div
          className={`w-3.5 h-3.5 rounded-full border border-red-500/50 ${
            strobeActive ? 'strobe-red-active' : 'bg-red-950'
          }`}
        />
        <span className="text-[11px] font-mono text-slate-300 font-semibold uppercase tracking-wider">
          {strobeActive ? 'STROBOSKOP YONIQ' : 'STROBOSKOP'}
        </span>
        <div
          className={`w-3.5 h-3.5 rounded-full border border-blue-500/50 ${
            strobeActive ? 'strobe-blue-active' : 'bg-blue-950'
          }`}
        />
      </div>

      {/* Right Controls: Battery, Sound, Strobe & Emergency Stop & Lock to Face */}
      <div className="flex items-center space-x-2">
        {/* Batareya: faqat haqiqiy o'lchov kelganda ko'rsatiladi */}
        {battery && (
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-tactical-900 border border-tactical-700/60 font-mono text-xs">
            {battery.isCharging ? (
              <BatteryCharging className="w-4 h-4 text-emerald-400 animate-pulse" />
            ) : (
              <BatteryMedium className={`w-4 h-4 ${battery.percentage < 25 ? 'text-rose-500' : 'text-emerald-400'}`} />
            )}
            <span className="text-white font-bold">{battery.voltage.toFixed(1)}V</span>
            <span className="text-slate-400 text-[10px]">({battery.percentage}%)</span>
          </div>
        )}

        {/* Strobe Toggle */}
        <button
          onClick={toggleStrobe}
          title="Politsiya stroboskopi"
          className={`p-2 rounded border transition-all ${
            strobeActive
              ? 'bg-rose-600/30 border-rose-500 text-rose-300 shadow-[0_0_12px_rgba(255,34,56,0.5)] animate-pulse'
              : 'bg-tactical-900 border-tactical-700/60 text-slate-400 hover:text-white'
          }`}
        >
          <Siren className="w-4 h-4" />
        </button>

        {/* Sirena pulti: politsiya mashinasi pultidagi kabi 4 xil ovoz. Faol tugma qayta bosilsa o'chadi */}
        <div
          role="group"
          aria-label="Sirena pulti"
          className={`flex items-center gap-1 p-1 rounded-lg border ${
            sirenTone ? 'border-rose-500/70 bg-rose-950/40 shadow-[0_0_12px_rgba(244,63,94,0.45)]' : 'border-tactical-700/60 bg-tactical-900'
          }`}
        >
          {(['A', 'B', 'C', 'D'] as SirenTone[]).map((t) => (
            <button
              key={t}
              onClick={() => setSirenTone(t)}
              title={`Sirena ${t}: ${SIREN_TONE_NAMES[t]}${sirenTone === t ? " (o'chirish uchun qayta bosing)" : ''}`}
              aria-pressed={sirenTone === t}
              className={`w-7 h-7 rounded-full font-mono font-black text-xs transition-all active:scale-90 ${
                sirenTone === t
                  ? 'bg-rose-500 text-white ring-2 ring-rose-200 animate-pulse'
                  : 'bg-rose-300/90 text-rose-800 hover:bg-rose-200'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Ratsiya: operator ovozi robotda ratsiya ovozida (faqat operator qurilmasida) */}
        {isOperator && <RadioButton />}

        {/* Audio Mute */}
        <button
          onClick={toggleMute}
          title={isMuted ? 'Ovozni yoqish' : 'Ovozni o\'chirish'}
          className="p-2 rounded bg-tactical-900 border border-tactical-700/60 text-slate-400 hover:text-white transition-colors"
        >
          {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
        </button>

        {/* Emergency E-STOP */}
        <button
          onClick={() => sendMecanumCommand('S')}
          title="FAVQULODDA E-STOP"
          className={`px-3 py-1.5 rounded font-mono font-black text-xs flex items-center space-x-1.5 transition-all ${
            isMoving
              ? 'bg-rose-600 text-white animate-pulse shadow-[0_0_15px_rgba(255,34,56,0.7)]'
              : 'bg-tactical-800 text-rose-400 border border-rose-700/60 hover:bg-rose-900/50'
          }`}
        >
          <OctagonAlert className="w-4 h-4" />
          <span className="hidden sm:inline">E-STOP</span>
        </button>

        {/* ESP32 Masofaviy Boshqaruv Pulti */}
        {onOpenController && (
          <button
            onClick={() => {
              tacticalAudio.playClick();
              onOpenController();
            }}
            title="ESP32 Masofaviy Boshqaruv Pulti"
            className="px-2.5 py-1.5 rounded bg-teal-900/40 hover:bg-teal-800/60 border border-teal-500/60 text-teal-300 font-mono text-xs flex items-center space-x-1 transition-all"
          >
            <Gamepad2 className="w-4 h-4" />
            <span className="hidden md:inline">PULT</span>
          </button>
        )}

        {/* Lock Screen / Return to 3D Robot Face View */}
        {onLockScreen && (
          <button
            onClick={() => {
              tacticalAudio.playClick();
              onLockScreen();
            }}
            title="Patrul Yuz Ekraniga Qaytish (Qulflash)"
            className="px-2.5 py-1.5 rounded bg-police-blue/20 hover:bg-police-blue/40 border border-police-cyan/60 text-police-cyan font-mono text-xs flex items-center space-x-1 transition-all"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden md:inline">YUZ EKRANI</span>
          </button>
        )}
      </div>
    </header>
  );
};
