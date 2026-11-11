import React, { useEffect, useState } from 'react';
import { useRobot } from '../context/RobotContext';
import {
  Sliders,
  Server,
  Cable,
  CheckCircle2,
  Volume2,
  Terminal,
  Save,
  HardDrive,
  FolderOpen
} from 'lucide-react';
import { nvrRecordingService, type NvrDiskStatus, type NvrStorageStats } from '../services/nvrRecordingService';
import { tacticalAudio } from '../services/audioService';
import { CamLinkCard } from './CamLinkCard';
import { PtzCameraCard } from './PtzCameraCard';
import { FaceCameraCard } from './FaceCameraCard';

export const SettingsView: React.FC = () => {
  const { esp32Ip, setEsp32Ip, esp32Enabled, setEsp32Enabled } = useRobot();
  const [espIpInput, setEspIpInput] = useState(esp32Ip);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [espTestResult, setEspTestResult] = useState<string | null>(null);

  // UzbekVoice.ai / Gemini API kalitlari AI & Avtonom bo'limiga (VoiceAssistantPanel) ko'chirilgan

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setEsp32Ip(espIpInput);
    setSaveSuccess(true);
    tacticalAudio.playClick();
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  const handleTestEsp32 = async () => {
    setEspTestResult('Ulanmoqda...');
    try {
      await fetch(`${espIpInput}/move?dir=S`, { mode: 'no-cors' });
      setEspTestResult('Muvaffaqiyatli! STOP signali uzatildi.');
      setTimeout(() => setEspTestResult(null), 3000);
    } catch (e: any) {
      setEspTestResult('Xatolik: ' + (e?.message || 'Ulanib bo‘lmadi'));
      setTimeout(() => setEspTestResult(null), 4000);
    }
  };

  // Video arxiv holati
  const [nvrDisk, setNvrDisk] = useState<NvrDiskStatus>(() => nvrRecordingService.getDiskStatus());
  const [nvrStats, setNvrStats] = useState<NvrStorageStats>({ usedBytes: 0, maxBytes: 1, percentUsed: 0, chunkCount: 0 });
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      setNvrDisk(nvrRecordingService.getDiskStatus());
      void nvrRecordingService.getStorageStats().then((s) => alive && setNvrStats(s));
    };
    refresh();
    const unsub = nvrRecordingService.subscribe(refresh);
    return () => {
      alive = false;
      unsub();
    };
  }, []);

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
              Planshet (miya) • ESP32 motor moduli • 12V LiFePO4
            </p>
          </div>
        </div>
      </div>

      <CamLinkCard />

      <FaceCameraCard />
      <PtzCameraCard />

      {/* Video arxiv (NVR): kamera tasviri D diskdagi papkaga 1 GB aylanma yoziladi */}
      <div className="hud-panel rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="font-mono text-sm font-bold text-white flex items-center space-x-2">
            <HardDrive className="w-4 h-4 text-police-cyan" />
            <span>VIDEO ARXIV (NVR): AVTOMATIK YOZUV</span>
          </h3>
          <span className={`flex items-center gap-1.5 font-mono text-xs font-bold ${nvrDisk.recording ? 'text-rose-400' : 'text-slate-400'}`}>
            <span className={`w-2 h-2 rounded-full inline-block ${nvrDisk.recording ? 'bg-rose-500 animate-pulse' : 'bg-slate-600'}`} />
            {nvrDisk.recording ? 'YOZILMOQDA' : 'Kamera o\'chiq'}
          </span>
        </div>
        <p className="text-xs text-slate-400 font-mono">
          Kamera yoqilganda tasvir 30 soniyalik fayllar bo'lib yoziladi. Papkada 1 GB to'lganda eng eski yozuv avtomatik o'chadi.
          Papka tanlanmasa, brauzer xotirasiga (100 MB) yoziladi.
        </p>
        <div className="flex items-center gap-3 flex-wrap font-mono text-xs">
          <div className="flex-1 min-w-[220px] p-2.5 rounded-lg bg-tactical-950 border border-tactical-800">
            <div className="text-slate-400">Saqlash joyi:</div>
            <div className="text-white font-bold">
              {nvrDisk.mode === 'disk' ? `📁 ${nvrDisk.folderName} (disk, 1 GB)` : nvrDisk.needsPermission ? `📁 ${nvrDisk.folderName}: ruxsat kerak` : 'Brauzer xotirasi (100 MB)'}
            </div>
            <div className="text-police-cyan mt-1">
              {(nvrStats.usedBytes / (1024 * 1024)).toFixed(1)} MB / {Math.round(nvrStats.maxBytes / (1024 * 1024))} MB • {nvrStats.chunkCount} ta fayl
            </div>
            <div className="mt-1.5 h-1.5 rounded bg-tactical-800 overflow-hidden">
              <div className="h-full bg-police-cyan" style={{ width: `${nvrStats.percentUsed}%` }} />
            </div>
          </div>
          {nvrDisk.supported ? (
            <div className="flex flex-col gap-2">
              {nvrDisk.needsPermission && (
                <button
                  onClick={() => void nvrRecordingService.resumeDiskAccess()}
                  className="px-3 py-2 rounded-lg bg-amber-500/20 border border-amber-500/60 text-amber-300 font-bold animate-pulse"
                >
                  Diskka yozishni tiklash
                </button>
              )}
              <button
                onClick={() => void nvrRecordingService.chooseDiskFolder()}
                className="px-3 py-2 rounded-lg bg-police-blue hover:bg-blue-600 text-white font-bold flex items-center gap-2"
              >
                <FolderOpen className="w-4 h-4" />
                {nvrDisk.folderName ? 'Papkani almashtirish' : 'D diskdan papka tanlash'}
              </button>
            </div>
          ) : (
            <div className="text-amber-300 max-w-xs">Diskka yozish faqat kompyuterdagi Chrome yoki Edge brauzerida ishlaydi.</div>
          )}
        </div>
        {nvrDisk.lastError && <div className="text-rose-400 font-mono text-[11px]">{nvrDisk.lastError}</div>}
        <div className="text-[11px] text-slate-500 font-mono">
          Maslahat: D diskda masalan <span className="text-slate-300">QALQON_NVR</span> papkasini yarating va uni tanlang. Brauzer
          ruxsat so'raganda "Har safar ruxsat berish" ni tanlasangiz, keyingi ochilishlarda ham avtomatik yozadi. Yozuvlar
          <span className="text-slate-300"> sana/soat-soat.webm</span> ko'rinishida saqlanadi va istalgan pleyerda ochiladi.
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* ESP32 motor moduli aloqasi */}
        <div className="hud-panel rounded-xl p-4 flex flex-col justify-between">
          <div>
            <h3 className="font-mono text-sm font-bold text-white mb-2 flex items-center space-x-2">
              <Server className="w-4 h-4 text-police-cyan" />
              <span>ESP32 MOTOR MODULI ALOQASI</span>
            </h3>
            <p className="text-xs text-slate-400 mb-4 font-mono">
              Buyruqlar MQTT orqali doim yuboriladi; quyidagi IP yoqilsa, Wi-Fi orqali to'g'ridan-to'g'ri ham.
            </p>

            <form onSubmit={handleSave} className="space-y-3 font-mono text-xs">
              {/* ESP32 Wi-Fi Motor Moduli Sozlamalari */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-police-cyan font-bold flex items-center space-x-1.5">
                    <span>ESP32 Wi-Fi Motor Moduli:</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setEsp32Enabled(!esp32Enabled)}
                    className={`px-2.5 py-0.5 rounded text-[10px] font-bold ${
                      esp32Enabled ? 'bg-emerald-600 text-white' : 'bg-tactical-800 text-slate-400'
                    }`}
                  >
                    {esp32Enabled ? 'YOQILGAN' : 'O‘CHIRILGAN'}
                  </button>
                </div>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={espIpInput}
                    onChange={(e) => setEspIpInput(e.target.value)}
                    placeholder="http://192.168.43.50"
                    className="flex-1 bg-tactical-950 border border-tactical-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-police-cyan text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleTestEsp32}
                    className="px-3 py-2 rounded-lg bg-tactical-800 hover:bg-tactical-700 text-police-cyan border border-tactical-600 text-xs font-bold"
                  >
                    Test
                  </button>
                </div>
                {espTestResult && (
                  <p className="mt-1 text-[11px] text-emerald-400 font-mono">{espTestResult}</p>
                )}
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
