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
  Mic,
  Key,
  Eye,
  EyeOff,
  Bot,
  HardDrive,
  FolderOpen
} from 'lucide-react';
import { nvrRecordingService, type NvrDiskStatus, type NvrStorageStats } from '../services/nvrRecordingService';
import { uzbekVoiceService } from '../services/uzbekVoiceService';
import { aiDialogService } from '../services/aiDialogService';
import { edgeTtsService } from '../services/edgeTtsService';
import { tacticalAudio } from '../services/audioService';

export const SettingsView: React.FC = () => {
  const { system, setRpiConfig, isSimulationMode, toggleSimulationMode } = useRobot();
  const [ipInput, setIpInput] = useState(system.rpiIp);
  const [portInput, setPortInput] = useState(system.rpiPort.toString());
  const [saveSuccess, setSaveSuccess] = useState(false);

  // UzbekVoice.ai va AI Sozlamalari
  const [uvApiKey, setUvApiKey] = useState(() => uzbekVoiceService.getApiKey());
  const [geminiApiKey, setGeminiApiKey] = useState(() => aiDialogService.getGeminiKey());
  const [showUvKey, setShowUvKey] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [uvSaveSuccess, setUvSaveSuccess] = useState(false);
  const [testSpeechStatus, setTestSpeechStatus] = useState<string | null>(null);

  const handleSaveAIKeys = (e: React.FormEvent) => {
    e.preventDefault();
    uzbekVoiceService.setApiKey(uvApiKey);
    aiDialogService.setGeminiKey(geminiApiKey);
    setUvSaveSuccess(true);
    tacticalAudio.playCommandBeep();
    setTimeout(() => setUvSaveSuccess(false), 2500);
  };

  const handleTestTTS = () => {
    setTestSpeechStatus("Ovoz yangramoqda (Sardor 1x)...");
    edgeTtsService.speak(
      "Assalomu alaykum! UzbekVoice va QALQON nutq tizimi muvaffaqiyatli ulandi.",
      { voice: 'uz-UZ-SardorNeural', rate: 1.0 },
      undefined,
      () => setTestSpeechStatus(null)
    );
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const portNum = parseInt(portInput, 10) || 8000;
    setRpiConfig(ipInput, portNum);
    setSaveSuccess(true);
    tacticalAudio.playClick();
    setTimeout(() => setSaveSuccess(false), 2500);
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

            {/* O'zbek Voice AI & Speech-to-Speech (API Sozlamalari) */}
      <div className="hud-panel rounded-xl p-4 border border-police-cyan/30 bg-gradient-to-br from-tactical-950 via-tactical-900 to-police-blue/10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 mb-4 border-b border-tactical-800 gap-2">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-police-blue/20 border border-police-cyan/50 flex items-center justify-center">
              <Mic className="w-6 h-6 text-police-cyan" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-mono text-sm font-extrabold text-white tracking-wider">
                  O'ZBEK VOICE AI & SPEECH-TO-SPEECH (API SOZLAMALARI)
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-police-cyan/15 text-police-cyan border border-police-cyan/30">
                  uzbekvoice.ai
                </span>
              </div>
              <p className="text-xs font-mono text-slate-400">
                O'zbekcha nutqni aniqlash (STT), AI miya javobi va Sardor 1x TTS sintezi
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-mono font-bold ${
              uvApiKey.trim()
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
            }`}>
              {uvApiKey.trim() ? '● API KALIT ULANGAN' : '○ KALIT KIRITILMAGAN'}
            </span>
          </div>
        </div>

        <form onSubmit={handleSaveAIKeys} className="space-y-4 font-mono text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* UzbekVoice STT API Key */}
            <div className="space-y-1.5">
              <label className="block text-slate-200 font-bold flex items-center justify-between">
                <span className="flex items-center space-x-1.5 text-police-cyan">
                  <Key className="w-3.5 h-3.5" />
                  <span>UzbekVoice.ai API Kaliti (STT):</span>
                </span>
                <span className="text-[10px] text-slate-400 font-normal">Majburiy</span>
              </label>
              <div className="relative">
                <input
                  type={showUvKey ? 'text' : 'password'}
                  value={uvApiKey}
                  onChange={(e) => setUvApiKey(e.target.value)}
                  placeholder="[API_KEY] ni kiriting (masalan, uv_live_...)"
                  className="w-full bg-tactical-950 border border-tactical-700 rounded-lg pl-3 pr-10 py-2.5 text-white font-mono placeholder-slate-500 focus:outline-none focus:border-police-cyan"
                />
                <button
                  type="button"
                  onClick={() => setShowUvKey(!showUvKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {showUvKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-slate-400">
                STT Endpoint: <code className="text-police-cyan">https://uzbekvoice.ai/api/v1/stt</code> (multipart/form-data)
              </p>
            </div>

            {/* Optional Gemini LLM API Key */}
            <div className="space-y-1.5">
              <label className="block text-slate-200 font-bold flex items-center justify-between">
                <span className="flex items-center space-x-1.5 text-amber-300">
                  <Bot className="w-3.5 h-3.5" />
                  <span>Gemini LLM API Kaliti (Kengaytirilgan AI):</span>
                </span>
                <span className="text-[10px] text-slate-400 font-normal">Ixtiyoriy</span>
              </label>
              <div className="relative">
                <input
                  type={showGeminiKey ? 'text' : 'password'}
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  placeholder="AIzaSy... (bo'sh qolsa lokal qoidalar ishlaydi)"
                  className="w-full bg-tactical-950 border border-tactical-700 rounded-lg pl-3 pr-10 py-2.5 text-white font-mono placeholder-slate-500 focus:outline-none focus:border-amber-400"
                />
                <button
                  type="button"
                  onClick={() => setShowGeminiKey(!showGeminiKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {showGeminiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-slate-400">
                Erkin muloqot va fuqarolarning savollariga batafsil AI javobi uchun
              </p>
            </div>

          </div>

          {/* Tugmalar va Holat */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
            <div className="flex items-center space-x-2 w-full sm:w-auto">
              <button
                type="submit"
                className="flex-1 sm:flex-none px-5 py-2.5 rounded-lg bg-police-blue hover:bg-blue-600 text-white font-mono font-bold flex items-center justify-center space-x-2 transition-all shadow-lg shadow-police-blue/20"
              >
                <Save className="w-4 h-4" />
                <span>AI KALITLARINI SAQLASH</span>
              </button>

              <button
                type="button"
                onClick={handleTestTTS}
                className="px-4 py-2.5 rounded-lg bg-tactical-800 hover:bg-tactical-700 border border-tactical-600 text-slate-200 font-mono flex items-center space-x-1.5 transition-all"
              >
                <Volume2 className="w-4 h-4 text-emerald-400" />
                <span>Ovozni Sinash</span>
              </button>
            </div>

            {uvSaveSuccess && (
              <div className="p-2 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 flex items-center space-x-2 text-[11px] font-mono animate-fade-in">
                <CheckCircle2 className="w-4 h-4" />
                <span>API kalitlari muvaffaqiyatli saqlandi!</span>
              </div>
            )}

            {testSpeechStatus && (
              <div className="text-emerald-400 text-[11px] font-mono flex items-center space-x-1 animate-pulse">
                <span>{testSpeechStatus}</span>
              </div>
            )}
          </div>
        </form>

        {/* Texnik cURL spetsifikatsiyasi */}
        <div className="mt-4 pt-3 border-t border-tactical-800/80">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-mono text-slate-400 font-semibold">
              O'zbek Voice STT API Protokoli (cURL):
            </span>
          </div>
          <pre className="p-2.5 rounded-lg bg-tactical-950 border border-tactical-800 text-[10px] font-mono text-slate-300 overflow-x-auto leading-relaxed">
{`curl --request POST \
  --url https://uzbekvoice.ai/api/v1/stt \
  --header 'Authorization: [API_KEY]' \
  --header 'Content-Type: multipart/form-data' \
  --form 'file=@recording.wav' \
  --form return_offsets=false \
  --form run_diarization=false \
  --form language='uz' \
  --form model='general' \
  --form blocking=true`}
          </pre>
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
