import React, { useEffect, useState } from 'react';
import { Mic, Key, Eye, EyeOff, Bot, Save, Volume2, CheckCircle2, Camera, CameraOff, Hand } from 'lucide-react';
import { uzbekVoiceService } from '../services/uzbekVoiceService';
import { aiDialogService } from '../services/aiDialogService';
import { edgeTtsService } from '../services/edgeTtsService';
import { tacticalAudio } from '../services/audioService';
import { faceViewSettings, type FaceViewSettings } from '../services/faceViewSettings';
import { SpeechToSpeechModal } from './SpeechToSpeechModal';

/**
 * AI & Avtonom bo'limi: ovozli muloqot va robot yuzi (bosh sahifa) sozlamalari.
 * Bosh sahifadan ko'chirilgan: kamera, avto-salom, ovozni sinash, ovozli muloqot (S2S) va API kalitlari.
 */
export const VoiceAssistantPanel: React.FC = () => {
  const [settings, setSettings] = useState<FaceViewSettings>(() => faceViewSettings.get());
  useEffect(() => faceViewSettings.subscribe(setSettings), []);

  const [uvApiKey, setUvApiKey] = useState(() => uzbekVoiceService.getApiKey());
  const [geminiApiKey, setGeminiApiKey] = useState(() => aiDialogService.getGeminiKey());
  const [showUvKey, setShowUvKey] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [s2sOpen, setS2sOpen] = useState(false);

  const handleSaveKeys = (e: React.FormEvent) => {
    e.preventDefault();
    uzbekVoiceService.setApiKey(uvApiKey);
    aiDialogService.setGeminiKey(geminiApiKey);
    setSaved(true);
    tacticalAudio.playCommandBeep();
    setTimeout(() => setSaved(false), 2500);
  };

  const handleTestVoice = () => {
    if (speaking) return;
    setSpeaking(true);
    edgeTtsService.speak(
      "Assalomu alaykum! Men QALQON avtonom patrul robotiman. Jamoat xavfsizligini ta'minlashga tayyorman!",
      { voice: 'uz-UZ-SardorNeural', rate: 1.0 },
      undefined,
      () => setSpeaking(false)
    );
  };

  const toggleBtn = (on: boolean) =>
    `flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-mono font-bold border transition-all ${
      on ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/50' : 'bg-tactical-900 text-slate-400 border-tactical-700'
    }`;

  return (
    <div className="space-y-4">
      {/* Robot yuzi (bosh sahifa) boshqaruvi */}
      <div className="hud-panel rounded-xl p-4 space-y-3">
        <h3 className="font-mono text-sm font-bold text-white flex items-center space-x-2">
          <Bot className="w-4 h-4 text-police-cyan" />
          <span>ROBOT YUZI VA OVOZLI MULOQOT</span>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              tacticalAudio.playClick();
              faceViewSettings.set({ cameraEnabled: !settings.cameraEnabled });
            }}
            className={toggleBtn(settings.cameraEnabled)}
            title="Bosh sahifadagi old kamera: yuz tanish va video arxiv"
          >
            {settings.cameraEnabled ? <Camera className="w-4 h-4" /> : <CameraOff className="w-4 h-4" />}
            {settings.cameraEnabled ? 'Kamera: yoqilgan' : "Kamera: o'chirilgan"}
          </button>
          <button
            onClick={() => {
              tacticalAudio.playClick();
              faceViewSettings.set({ autoGreet: !settings.autoGreet });
            }}
            className={toggleBtn(settings.autoGreet)}
            title="Kamera insonni ko'rganda avtomatik salomlashish"
          >
            <Hand className="w-4 h-4" />
            {settings.autoGreet ? 'Avto-salom: faol' : "Avto-salom: o'chiq"}
          </button>
          <button
            onClick={handleTestVoice}
            disabled={speaking}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-mono font-bold bg-tactical-900 text-slate-200 border border-tactical-700 hover:bg-tactical-800 disabled:opacity-50"
          >
            <Volume2 className="w-4 h-4 text-emerald-400" />
            {speaking ? 'Gapirmoqda...' : 'Ovozni sinash'}
          </button>
          <button
            onClick={() => {
              tacticalAudio.playCommandBeep();
              setS2sOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono font-bold bg-gradient-to-r from-police-blue to-cyan-600 hover:from-blue-600 hover:to-cyan-500 text-white border border-police-cyan/50"
          >
            <Mic className="w-4 h-4" />
            Ovozli muloqot (S2S)
          </button>
        </div>
        <p className="text-[11px] font-mono text-slate-500">
          Kamera va avto-salom sozlamalari bosh sahifadagi robot yuziga darhol qo'llanadi va eslab qolinadi.
        </p>
      </div>

      {/* API kalitlari (bosh sahifadagi ovozli muloqot oynasidan va Sozlamalardan ko'chirilgan) */}
      <div className="hud-panel rounded-xl p-4 border border-police-cyan/30">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 mb-4 border-b border-tactical-800 gap-2">
          <div>
            <h3 className="font-mono text-sm font-extrabold text-white tracking-wider flex items-center gap-2">
              <Key className="w-4 h-4 text-police-cyan" />
              API KALITLARI: UZBEKVOICE.AI (STT) VA GEMINI
            </h3>
            <p className="text-xs font-mono text-slate-400">O'zbekcha nutqni aniqlash, AI javobi va Sardor 1x ovozi</p>
          </div>
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-mono font-bold ${
              uvApiKey.trim()
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
            }`}
          >
            {uvApiKey.trim() ? '● API KALIT ULANGAN' : '○ KALIT KIRITILMAGAN'}
          </span>
        </div>

        <form onSubmit={handleSaveKeys} className="space-y-4 font-mono text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-slate-200 font-bold flex items-center justify-between">
                <span className="flex items-center space-x-1.5 text-police-cyan">
                  <Key className="w-3.5 h-3.5" />
                  <span>UzbekVoice.ai API kaliti (STT):</span>
                </span>
                <span className="text-[10px] text-slate-400 font-normal">Majburiy</span>
              </label>
              <div className="relative">
                <input
                  type={showUvKey ? 'text' : 'password'}
                  value={uvApiKey}
                  onChange={(e) => setUvApiKey(e.target.value)}
                  placeholder="[API_KEY] ni kiriting"
                  className="w-full bg-tactical-950 border border-tactical-700 rounded-lg pl-3 pr-10 py-2.5 text-white font-mono placeholder-slate-500 focus:outline-none focus:border-police-cyan"
                />
                <button
                  type="button"
                  onClick={() => setShowUvKey(!showUvKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  aria-label={showUvKey ? 'Kalitni yashirish' : "Kalitni ko'rsatish"}
                >
                  {showUvKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-slate-400">
                Endpoint: <code className="text-police-cyan">https://uzbekvoice.ai/api/v1/stt</code>
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-slate-200 font-bold flex items-center justify-between">
                <span className="flex items-center space-x-1.5 text-amber-300">
                  <Bot className="w-3.5 h-3.5" />
                  <span>Gemini LLM API kaliti:</span>
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
                  aria-label={showGeminiKey ? 'Kalitni yashirish' : "Kalitni ko'rsatish"}
                >
                  {showGeminiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-slate-400">Erkin savollarga batafsil AI javobi uchun</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3 pt-1">
            <button
              type="submit"
              className="px-5 py-2.5 rounded-lg bg-police-blue hover:bg-blue-600 text-white font-mono font-bold flex items-center justify-center space-x-2"
            >
              <Save className="w-4 h-4" />
              <span>AI KALITLARINI SAQLASH</span>
            </button>
            {saved && (
              <div className="p-2 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 flex items-center space-x-2 text-[11px] font-mono">
                <CheckCircle2 className="w-4 h-4" />
                <span>API kalitlari saqlandi</span>
              </div>
            )}
          </div>
        </form>
      </div>

      <SpeechToSpeechModal isOpen={s2sOpen} onClose={() => setS2sOpen(false)} />
    </div>
  );
};
