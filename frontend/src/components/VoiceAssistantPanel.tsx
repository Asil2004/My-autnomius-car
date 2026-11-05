import React, { useEffect, useState } from 'react';
import { Mic, Key, Eye, EyeOff, Bot, Save, Volume2, CheckCircle2, Camera, CameraOff, Hand, Ear } from 'lucide-react';
import { uzbekVoiceService } from '../services/uzbekVoiceService';
import { aiDialogService } from '../services/aiDialogService';
import { edgeTtsService } from '../services/edgeTtsService';
import { tacticalAudio } from '../services/audioService';
import { faceViewSettings, type FaceViewSettings } from '../services/faceViewSettings';
import { SpeechToSpeechModal } from './SpeechToSpeechModal';
import { answerCache } from '../services/answerCache';
import { qaCount } from '../services/localKnowledge';
import { situationService, weatherText } from '../services/situationService';

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

  // Lokal bilim bazasi va AI javoblari keshi
  const knowledge = qaCount();
  const [cacheSize, setCacheSize] = useState(() => answerCache.size());

  // Kalitni saqlab, erkin savol bilan AI javobini sinash (Gemini ishlayaptimi yoki yo'qmi ko'rinadi)
  const [brainTest, setBrainTest] = useState<string | null>(null);
  const handleTestBrain = async () => {
    aiDialogService.setGeminiKey(geminiApiKey);
    setBrainTest('...');
    const r = await aiDialogService.respond("Toshkent qaysi davlatning poytaxti? Bir gap bilan javob ber.", { skipCache: true });
    setCacheSize(answerCache.size());
    setBrainTest(
      r.source === 'gemini_llm'
        ? `✓ Gemini ishlayapti: ${r.answer}`
        : `✗ Gemini javob bermadi${aiDialogService.lastLlmError ? ` (${aiDialogService.lastLlmError})` : ' (kalit kiritilmagan)'}. Lokal javob: ${r.answer}`
    );
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

  // Joriy holat: vaqt, GPS manzil, ob-havo (robot shundan javob beradi)
  const [situation, setSituation] = useState(() => situationService.get());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => situationService.subscribe(setSituation), []);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // AI javoblari ovozi (uzbekvoice.ai TTS): qaysi ovoz haqiqatda ishlatilganini ko'rsatamiz
  const [aiVoiceInfo, setAiVoiceInfo] = useState<string | null>(null);
  const handleTestAiVoice = () => {
    if (speaking) return;
    uzbekVoiceService.setApiKey(uvApiKey);
    uzbekVoiceService.lastTts = null;
    setSpeaking(true);
    setAiVoiceInfo('...');
    edgeTtsService.speak(
      `Hurmatli fuqaro, men sizga yordam berishga tayyorman. Hozir soat ${new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}.`,
      { rate: 1.0 },
      undefined,
      () => {
        setSpeaking(false);
        const t = uzbekVoiceService.lastTts;
        setAiVoiceInfo(
          t
            ? t.used === t.requested
              ? `✓ uzbekvoice.ai ovozi: ${t.used}`
              : `✓ uzbekvoice.ai ovozi: ${t.used} ("${t.requested}" kalitingiz tarifida yoqilmagan, server almashtirdi)`
            : "Brauzerdagi o'zbekcha ovoz ishlatildi (Edge brauzerida Sardor)"
        );
      }
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
            onClick={() => {
              tacticalAudio.playClick();
              faceViewSettings.set({ listen: !settings.listen });
            }}
            className={toggleBtn(settings.listen)}
            title="Bosh sahifadagi robot mikrofon orqali gapingizni o'zi eshitadi va javob beradi"
          >
            <Ear className="w-4 h-4" />
            {settings.listen ? 'Tinglash: faol' : "Tinglash: o'chiq"}
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
            onClick={handleTestAiVoice}
            disabled={speaking}
            title="AI javoblari uzbekvoice.ai TTS orqali o'qiladi"
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-mono font-bold bg-tactical-900 text-slate-200 border border-tactical-700 hover:bg-tactical-800 disabled:opacity-50"
          >
            <Volume2 className="w-4 h-4 text-police-cyan" />
            AI javob ovozi
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
        {aiVoiceInfo && <p className="text-[11px] font-mono text-police-cyan">{aiVoiceInfo}</p>}
        <p className="text-[11px] font-mono text-slate-500">
          Bosh sahifada robot gapingizni o'zi eshitadi: tugma bosish shart emas, gapiring va 1 soniya jim turing. Birinchi marta
          ekranga bir bosish va mikrofonga ruxsat berish kerak. Sozlamalar darhol qo'llanadi va eslab qolinadi.
        </p>
      </div>

      {/* Joriy holat: robot "soat necha", "ob-havo qanday", "qayerdamiz" savollariga shundan javob beradi */}
      <div className="hud-panel rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-mono text-sm font-bold text-white">JORIY HOLAT (VAQT, JOY, OB-HAVO)</h3>
          <button
            onClick={() => void situationService.refresh(true)}
            className="px-3 py-1.5 rounded-lg text-[11px] font-mono font-bold bg-tactical-900 text-slate-300 border border-tactical-700 hover:bg-tactical-800"
          >
            Yangilash
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-mono">
          <div className="bg-tactical-900/60 rounded-lg p-2.5 border border-tactical-700">
            <div className="text-slate-500 text-[10px]">VAQT VA SANA</div>
            <div className="text-white font-bold">{new Date(now).toLocaleTimeString('uz-UZ', { hour12: false })}</div>
            <div className="text-slate-300">{situationService.dateText(new Date(now))}</div>
          </div>
          <div className="bg-tactical-900/60 rounded-lg p-2.5 border border-tactical-700">
            <div className="text-slate-500 text-[10px]">MANZIL (GPS)</div>
            {situation.fix?.real ? (
              <>
                <div className="text-white">{situation.address?.short ?? 'Manzil aniqlanmoqda...'}</div>
                <div className="text-slate-500 text-[10px]">
                  {situation.fix.lat.toFixed(5)}, {situation.fix.lon.toFixed(5)}
                  {situation.fix.accuracy ? ` ±${Math.round(situation.fix.accuracy)} m` : ''}
                </div>
              </>
            ) : (
              <div className="text-amber-300">{situation.gpsError ?? 'GPS qidirilmoqda...'} — taxminan Navoiy</div>
            )}
          </div>
          <div className="bg-tactical-900/60 rounded-lg p-2.5 border border-tactical-700">
            <div className="text-slate-500 text-[10px]">OB-HAVO</div>
            {situation.weather ? (
              <>
                <div className="text-white font-bold">
                  {Math.round(situation.weather.temp)}°C, {weatherText(situation.weather.code)}
                </div>
                <div className="text-slate-500 text-[10px]">
                  shamol {Math.round(situation.weather.wind)} m/s · namlik {situation.weather.humidity}% · yangilangan{' '}
                  {new Date(situation.weather.t).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', hour12: false })}
                </div>
              </>
            ) : (
              <div className="text-amber-300">Ob-havo yuklanmoqda...</div>
            )}
          </div>
        </div>
        <p className="text-[11px] font-mono text-slate-500">
          Robotdan so'rang: "Soat necha?", "Bugun nechanchi?", "Ob-havo qanday?", "Ertaga havo qanday?", "Biz qayerdamiz?".
          Manzil har 80 m siljishda, ob-havo har 15 daqiqada yangilanadi va internetsiz ham oxirgisi aytiladi.
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
            <button
              type="button"
              onClick={handleTestBrain}
              disabled={brainTest === '...'}
              className="px-4 py-2.5 rounded-lg bg-tactical-800 hover:bg-tactical-700 border border-tactical-600 text-slate-200 font-mono flex items-center space-x-1.5 disabled:opacity-50"
            >
              <Bot className="w-4 h-4 text-amber-300" />
              <span>AI miyasini tekshirish</span>
            </button>
            {saved && (
              <div className="p-2 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 flex items-center space-x-2 text-[11px] font-mono">
                <CheckCircle2 className="w-4 h-4" />
                <span>API kalitlari saqlandi</span>
              </div>
            )}
          </div>
          {brainTest && brainTest !== '...' && (
            <div className="p-2.5 rounded-lg bg-tactical-950 border border-tactical-800 text-[11px] text-slate-200 leading-relaxed">
              {brainTest}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 p-2.5 rounded-lg bg-tactical-950 border border-tactical-800 text-[11px] text-slate-300">
            <span>
              Lokal bilim: <b className="text-white">{knowledge.topics}</b> mavzu ({knowledge.samples} savol shakli) + huquqiy baza
            </span>
            <span>
              AI javoblari keshi: <b className="text-white">{cacheSize}</b> ta
            </span>
            {cacheSize > 0 && (
              <button
                type="button"
                onClick={() => {
                  answerCache.clear();
                  setCacheSize(0);
                }}
                className="px-2 py-1 rounded bg-tactical-800 hover:bg-tactical-700 border border-tactical-600 text-slate-300"
              >
                Keshni tozalash
              </button>
            )}
            <span className="text-slate-500 w-full">
              Gemini bir marta javob bergan savol keshda saqlanadi va keyin internetsiz ham darhol javob beriladi.
            </span>
          </div>
          {!geminiApiKey.trim() && (
            <p className="text-[11px] text-amber-300">
              Gemini kalitisiz robot faqat tayyor mavzularga (xavfsizlik, huquq, 102, o'zi haqida) javob beradi. Kalitni
              aistudio.google.com saytida bepul olish mumkin.
            </p>
          )}
        </form>
      </div>

      <SpeechToSpeechModal isOpen={s2sOpen} onClose={() => setS2sOpen(false)} />
    </div>
  );
};
