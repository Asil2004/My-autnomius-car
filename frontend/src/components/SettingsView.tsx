import React, { useState } from 'react';
import { useRobot } from '../context/RobotContext';
import {
  Sliders,
  Server,
  Cable,
  CheckCircle2,
  Volume2,
  Terminal,
  Save
} from 'lucide-react';
import { tacticalAudio } from '../services/audioService';

export const SettingsView: React.FC = () => {
  const { system, setRpiConfig, isSimulationMode, toggleSimulationMode } = useRobot();
  const [ipInput, setIpInput] = useState(system.rpiIp);
  const [portInput, setPortInput] = useState(system.rpiPort.toString());
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const portNum = parseInt(portInput, 10) || 8000;
    setRpiConfig(ipInput, portNum);
    setSaveSuccess(true);
    tacticalAudio.playClick();
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  const testAudioTone = () => {
    tacticalAudio.playCommandBeep();
    setTimeout(() => tacticalAudio.playObstacleAlert(), 300);
  };

  return (
    <div className="flex-1 flex flex-col p-3 sm:p-5 overflow-y-auto max-w-5xl mx-auto w-full select-none space-y-4">
      {/* Header */}
      <div className="hud-panel rounded-xl p-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-police-blue/20 border border-police-cyan/40 flex items-center justify-center">
            <Sliders className="w-6 h-6 text-police-cyan" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-white font-mono tracking-wider">
              TIZIM VA USKUNALAR SOZLAMALARI
            </h2>
            <p className="text-xs font-mono text-slate-400">
              Raspberry Pi 5 • Arduino Uno • L293D Shield • 12V LiFePO4
            </p>
          </div>
        </div>

        <button
          onClick={toggleSimulationMode}
          className={`px-3 py-1.5 rounded-lg font-mono text-xs font-bold border transition-all ${
            isSimulationMode
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
              : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
          }`}
        >
          {isSimulationMode ? 'SIMULYATSIYA REJIMI' : 'HAQIQIY ROBOT (LIVE)'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Raspberry Pi Connection Form */}
        <div className="hud-panel rounded-xl p-4 flex flex-col justify-between">
          <div>
            <h3 className="font-mono text-sm font-bold text-white mb-2 flex items-center space-x-2">
              <Server className="w-4 h-4 text-police-cyan" />
              <span>RASPBERRY PI VEB-KONTROLLER ALOQASI</span>
            </h3>
            <p className="text-xs text-slate-400 mb-4 font-mono">
              Fayl: <span className="text-slate-200">~/qalqon/pi_patrol.py</span>
            </p>

            <form onSubmit={handleSave} className="space-y-3 font-mono text-xs">
              <div>
                <label className="block text-slate-300 mb-1 font-semibold">RPi IP Manzili:</label>
                <input
                  type="text"
                  value={ipInput}
                  onChange={(e) => setIpInput(e.target.value)}
                  placeholder="10.37.227.167"
                  className="w-full bg-tactical-950 border border-tactical-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-police-cyan"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-semibold">Veb-Server Porti:</label>
                <input
                  type="number"
                  value={portInput}
                  onChange={(e) => setPortInput(e.target.value)}
                  placeholder="8000"
                  className="w-full bg-tactical-950 border border-tactical-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-police-cyan"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-lg bg-police-blue hover:bg-blue-600 text-white font-mono font-bold flex items-center justify-center space-x-2 transition-all"
                >
                  <Save className="w-4 h-4" />
                  <span>SOZLAMALARNI SAQLASH</span>
                </button>
              </div>

              {saveSuccess && (
                <div className="p-2 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 flex items-center space-x-2 text-[11px]">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Konfiguratsiya muvaffaqiyatli yangilandi!</span>
                </div>
              )}
            </form>
          </div>

          <div className="mt-4 pt-3 border-t border-tactical-700/60 flex items-center justify-between text-xs font-mono">
            <span className="text-slate-400">Audio test signallari:</span>
            <button
              onClick={testAudioTone}
              className="px-2.5 py-1 rounded bg-tactical-800 hover:bg-tactical-700 text-police-cyan border border-tactical-600 flex items-center space-x-1"
            >
              <Volume2 className="w-3.5 h-3.5" />
              <span>Sinov Tone</span>
            </button>
          </div>
        </div>

        {/* Arduino Serial & Protocols */}
        <div className="hud-panel rounded-xl p-4 flex flex-col justify-between">
          <div>
            <h3 className="font-mono text-sm font-bold text-white mb-2 flex items-center space-x-2">
              <Terminal className="w-4 h-4 text-emerald-400" />
              <span>ARDUINO SERIAL PROTOKOLI (115200 BAUD)</span>
            </h3>
            <p className="text-xs text-slate-400 mb-3 font-mono">
              Fayl: <span className="text-slate-200">arduino_l293d_patrol.ino</span>
            </p>

            <div className="space-y-2 font-mono text-[11px]">
              <div className="p-2 rounded bg-tactical-950 border border-tactical-800 flex justify-between">
                <span className="text-police-cyan font-bold">'F' / 'B'</span>
                <span className="text-slate-300">Oldinga / Orqaga harakatlanish</span>
              </div>
              <div className="p-2 rounded bg-tactical-950 border border-tactical-800 flex justify-between">
                <span className="text-police-cyan font-bold">'L' / 'R'</span>
                <span className="text-slate-300">Chapga / O'ngga burilish</span>
              </div>
              <div className="p-2 rounded bg-tactical-950 border border-tactical-800 flex justify-between">
                <span className="text-police-cyan font-bold">'Q' / 'E'</span>
                <span className="text-slate-300">Chapga / O'ngga Strafe yonlama</span>
              </div>
              <div className="p-2 rounded bg-tactical-950 border border-tactical-800 flex justify-between">
                <span className="text-rose-400 font-bold">'S'</span>
                <span className="text-slate-300">Barcha motorlarni darhol to'xtatish</span>
              </div>
              <div className="p-2 rounded bg-tactical-950 border border-tactical-800 flex justify-between">
                <span className="text-amber-400 font-bold">'1', '2', '3'</span>
                <span className="text-slate-300">Tezlik uzatmasi: 130, 190, 250 PWM</span>
              </div>
            </div>
          </div>

          <div className="mt-3 p-2 rounded bg-rose-950/40 border border-rose-800/60 font-mono text-[10px] text-rose-300">
            <b>Xavfsizlik sharti:</b> Agar old masofa &lt; 22 sm bo'lsa, harakat to'xtatiladi va <code>WARN:OBSTACLE_FRONT</code> signali qaytariladi.
          </div>
        </div>
      </div>

      {/* Hardware Wiring Pinout Table (PDF Section 3) */}
      <div className="hud-panel rounded-xl p-4">
        <h3 className="font-mono text-sm font-bold text-white mb-3 flex items-center space-x-2">
          <Cable className="w-4 h-4 text-police-cyan" />
          <span>USKUNALARNI ULAGICHLAR JADVALI (TEXNIK PASPORT)</span>
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs border-collapse">
            <thead>
              <tr className="border-b border-tactical-700 bg-tactical-950 text-police-cyan">
                <th className="py-2.5 px-3">Uskuna / Modul</th>
                <th className="py-2.5 px-3">Ulanish Nuqtasi</th>
                <th className="py-2.5 px-3">Belgilanishi / Pin</th>
                <th className="py-2.5 px-3">Vazifasi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-tactical-800 text-slate-300">
              <tr className="hover:bg-tactical-900/60">
                <td className="py-2 px-3 font-bold text-white">Arduino -&gt; RPi</td>
                <td className="py-2 px-3">USB-A dan USB-B kabel</td>
                <td className="py-2 px-3 text-police-cyan">/dev/ttyACM0 (115200)</td>
                <td className="py-2 px-3">Buyruqlar va xavf signallari almashinuvi</td>
              </tr>
              <tr className="hover:bg-tactical-900/60">
                <td className="py-2 px-3 font-bold text-white">Old HC-SR04</td>
                <td className="py-2 px-3">L293D Shield A0 va A1</td>
                <td className="py-2 px-3 text-police-cyan">Trig = A0, Echo = A1</td>
                <td className="py-2 px-3 text-rose-400 font-semibold">Old to'siqni o'lchash (Favqulodda tormoz &lt;22sm)</td>
              </tr>
              <tr className="hover:bg-tactical-900/60">
                <td className="py-2 px-3 font-bold text-white">Orqa HC-SR04</td>
                <td className="py-2 px-3">L293D Shield A2 va A3</td>
                <td className="py-2 px-3 text-police-cyan">Trig = A2, Echo = A3</td>
                <td className="py-2 px-3">Orqaga harakatda to'siqni aniqlash</td>
              </tr>
              <tr className="hover:bg-tactical-900/60">
                <td className="py-2 px-3 font-bold text-white">4 ta DC Motor</td>
                <td className="py-2 px-3">L293D vintli klemmalari</td>
                <td className="py-2 px-3 text-police-cyan">M1, M2, M3, M4</td>
                <td className="py-2 px-3">4WD Mecanum mustaqil harakatlantirish</td>
              </tr>
              <tr className="hover:bg-tactical-900/60">
                <td className="py-2 px-3 font-bold text-white">Akkumulyator</td>
                <td className="py-2 px-3">L293D EXT_PWR klemmasi</td>
                <td className="py-2 px-3 text-police-cyan">+ va - (GND)</td>
                <td className="py-2 px-3 text-emerald-400 font-semibold">Motorlarga 12V LiFePO4 yuqori tok yetkazish</td>
              </tr>
              <tr className="hover:bg-tactical-900/60 bg-amber-950/20">
                <td className="py-2 px-3 font-bold text-amber-300">Sariq Jumper</td>
                <td className="py-2 px-3 text-amber-200">L293D ustidagi PWR</td>
                <td className="py-2 px-3 text-rose-400 font-black">SUG'URIB OLINADI</td>
                <td className="py-2 px-3 text-amber-300 font-semibold">Arduino va motor quvvatini ajratish (Xavfsizlik)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
