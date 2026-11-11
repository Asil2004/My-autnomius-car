import React, { useState } from 'react';
import { useRobot } from '../context/RobotContext';
import type { PatrolMode } from '../types/robot';
import { VoiceAssistantPanel } from './VoiceAssistantPanel';
import {
  Brain,
  Eye,
  Crosshair,
  Layers,
  Zap,
  CheckCircle2,
  Cpu,
  Navigation,
  Footprints
} from 'lucide-react';

export const AIAutonomousView: React.FC = () => {
  const { patrolMode, setPatrolMode, detectedObjects, aiProcessingFps, sonars } = useRobot();
  const [activeTab, setActiveTab] = useState<'voice' | 'vision' | 'fusion' | 'roadmap'>('voice');

  const modes: { id: PatrolMode; name: string; desc: string; icon: React.ComponentType<{ className?: string }> }[] = [
    {
      id: 'AUTONOMOUS',
      name: 'AVTONOM SLAM PATRUL',
      desc: 'Oldindan chizilgan LiDAR xaritasi va Nav2 trayektoriyasi bo\'yicha to\'liq avtomat patrullik',
      icon: Navigation,
    },
    {
      id: 'GAP_FOLLOW',
      name: 'F1TENTH GAP-FOLLOW',
      desc: 'To\'siqlar orasidagi eng keng bo\'sh yo\'lakni (gap) topib to\'xtamasdan aylanib o\'tish',
      icon: Footprints,
    },
    {
      id: 'SENTRY_STATIONARY',
      name: 'STATSIONAR KUZATUV (SENTRY)',
      desc: 'Bir nuqtada turib 360° PTZ va AI orqali piyodalar hamda qoidabuzarliklarni nazorat qilish',
      icon: Eye,
    },
    {
      id: 'MANUAL',
      name: 'OPERATOR TELEOPERATSIYASI',
      desc: 'Pult yoki klaviatura orqali to\'g\'ridan-to\'g\'ri masofaviy boshqaruv rejimi',
      icon: Crosshair,
    },
  ];

  // Calculated Sensor Fusion Time To Collision (TTC)
  const currentSpeedMs = 0.6; // ~0.6 m/s at level 2
  // Old masofa kameradan (to'siq aniqlash ishlamaguncha noma'lum)
  const distanceFrontM = sonars.front !== null ? sonars.front / 100 : null;
  const ttcSeconds = distanceFrontM !== null ? +(distanceFrontM / currentSpeedMs).toFixed(2) : Infinity;

  return (
    <div className="flex-1 flex flex-col p-3 sm:p-5 overflow-y-auto max-w-6xl mx-auto w-full select-none space-y-4">
      {/* Top Selector Bar */}
      <div className="hud-panel rounded-xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-police-blue/20 border border-police-cyan/40 flex items-center justify-center">
            <Brain className="w-6 h-6 text-police-cyan" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-white font-mono tracking-wider">
              AI INTELLEKT & AVTONOM PATRUL
            </h2>
            <p className="text-xs font-mono text-slate-400">
              Edge TFLite (UIUC CS437) • F1TENTH Gap-Follow • Sensor Fusion
            </p>
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="flex flex-wrap bg-tactical-950 p-1 rounded-lg border border-tactical-700/60 font-mono text-xs">
          <button
            onClick={() => setActiveTab('voice')}
            className={`px-3 py-1.5 rounded transition-all ${
              activeTab === 'voice' ? 'bg-police-blue text-white font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            Ovozli muloqot & API
          </button>
          <button
            onClick={() => setActiveTab('vision')}
            className={`px-3 py-1.5 rounded transition-all ${
              activeTab === 'vision' ? 'bg-police-blue text-white font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            Neyron Tarmoq
          </button>
          <button
            onClick={() => setActiveTab('fusion')}
            className={`px-3 py-1.5 rounded transition-all ${
              activeTab === 'fusion' ? 'bg-police-blue text-white font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            Sensor Fusion
          </button>
          <button
            onClick={() => setActiveTab('roadmap')}
            className={`px-3 py-1.5 rounded transition-all ${
              activeTab === 'roadmap' ? 'bg-police-blue text-white font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            Loyiha Yo'l Xaritasi
          </button>
        </div>
      </div>

      {/* TAB CONTENT: Ovozli muloqot, robot yuzi sozlamalari va API kalitlari (bosh sahifadan ko'chirilgan) */}
      {activeTab === 'voice' && <VoiceAssistantPanel />}

      {/* Patrol Mode Switcher Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {modes.map((m) => {
          const Icon = m.icon;
          const isActive = patrolMode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setPatrolMode(m.id)}
              className={`p-3.5 rounded-xl border text-left flex flex-col justify-between transition-all ${
                isActive
                  ? 'bg-police-blue/20 border-police-cyan shadow-[0_0_15px_rgba(0,229,255,0.25)]'
                  : 'bg-tactical-900/80 border-tactical-700/60 hover:border-tactical-500'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Icon className={`w-5 h-5 ${isActive ? 'text-police-cyan' : 'text-slate-400'}`} />
                  {isActive && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-police-cyan/20 text-police-cyan border border-police-cyan/50 font-bold">
                      FAOL
                    </span>
                  )}
                </div>
                <h3 className="font-mono text-xs font-bold text-white mb-1">{m.name}</h3>
                <p className="text-[11px] text-slate-400 leading-snug">{m.desc}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* TAB CONTENT: Vision & Object Detection */}
      {activeTab === 'vision' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Edge Detection Pipeline View */}
          <div className="lg:col-span-2 hud-panel rounded-xl p-4 flex flex-col">
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-tactical-700/60 font-mono text-xs">
              <span className="font-bold text-white flex items-center space-x-2">
                <Cpu className="w-4 h-4 text-police-cyan" />
                <span>UIUC TFLITE DETEKSIYA MODELLARI</span>
              </span>
              <span className="text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-700 font-bold">
                {aiProcessingFps} FPS • RPi 5 On-Device
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
              {/* Person & Signs Detection List */}
              <div className="space-y-2.5">
                <div className="text-xs font-mono text-slate-300 font-bold uppercase tracking-wider mb-2">
                  Aniqlangan Belgilar & Odamlar:
                </div>
                {detectedObjects.map((obj) => (
                  <div
                    key={obj.id}
                    className="p-3 rounded-lg bg-tactical-950/80 border border-tactical-700 flex items-center justify-between"
                  >
                    <div className="flex items-center space-x-2.5">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: obj.color, boxShadow: `0 0 8px ${obj.color}` }}
                      />
                      <div>
                        <div className="text-xs font-bold text-white font-mono">{obj.label}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          Ishonchlilik: {(obj.confidence * 100).toFixed(0)}%
                        </div>
                      </div>
                    </div>
                    <div className="text-right font-mono">
                      <div className="text-xs text-police-cyan font-bold">{obj.distance} metr</div>
                      <div className="text-[9px] text-slate-500">Known Object Size</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Mathematical Focal Distance Formula box */}
              <div className="p-3 rounded-lg bg-tactical-950/90 border border-tactical-700/80 font-mono text-xs flex flex-col justify-between">
                <div>
                  <div className="text-police-cyan font-bold mb-2 flex items-center space-x-1.5">
                    <Crosshair className="w-4 h-4" />
                    <span>FOKUS / MASOFA FORMULASI:</span>
                  </div>
                  <div className="p-2.5 rounded bg-tactical-900 border border-tactical-800 text-[11px] text-slate-300 leading-relaxed mb-3">
                    <div className="text-emerald-400 font-bold mb-1">
                      Masofa (D) = (W × F) / P
                    </div>
                    <div>• <b>W:</b> Ob'ekt haqiqiy kengligi (sm)</div>
                    <div>• <b>F:</b> Kamera fokus masofasi (px)</div>
                    <div>• <b>P:</b> Kadrda egallagan piksellar (px)</div>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Odam yuzi kadrda 150 piksel bo'lsa masofa ~1 m, 50 piksel bo'lsa ~3 m deb baholanadi.
                  </p>
                </div>
                <div className="mt-3 pt-2 border-t border-tactical-800 text-[10px] text-police-cyan">
                  OpenCV Aruco / AprilTag markerlari 1 sm aniqlik bilan kalibrovka qilingan.
                </div>
              </div>
            </div>
          </div>

          {/* Classes & Speed Sign Compliance Card */}
          <div className="hud-panel rounded-xl p-4 flex flex-col justify-between">
            <div>
              <div className="font-mono text-xs font-bold text-white mb-3 pb-2 border-b border-tactical-700/60">
                BELGILARGA MUNOSABAT REJASI
              </div>

              <div className="space-y-3 font-mono text-xs">
                <div className="p-2.5 rounded bg-tactical-950 border border-tactical-800 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="w-3 h-3 rounded-full bg-rose-500 animate-pulse" />
                    <span className="text-white font-semibold">STOP Belgisi</span>
                  </div>
                  <span className="text-rose-400 text-[11px] font-bold">AVTO-TO'XTOV (3 soniya)</span>
                </div>

                <div className="p-2.5 rounded bg-tactical-950 border border-tactical-800 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="w-3 h-3 rounded-full bg-amber-400" />
                    <span className="text-white font-semibold">Qizil Svetofor</span>
                  </div>
                  <span className="text-amber-400 text-[11px] font-bold">KUTISH REJIMI</span>
                </div>

                <div className="p-2.5 rounded bg-tactical-950 border border-tactical-800 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="w-3 h-3 rounded-full bg-emerald-400" />
                    <span className="text-white font-semibold">Yashil Svetofor</span>
                  </div>
                  <span className="text-emerald-400 text-[11px] font-bold">HARAKAT RUXSATI</span>
                </div>

                <div className="p-2.5 rounded bg-tactical-950 border border-tactical-800 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="w-3 h-3 rounded-full bg-blue-400" />
                    <span className="text-white font-semibold">Piyoda (Odam)</span>
                  </div>
                  <span className="text-blue-300 text-[11px] font-bold">MASOFA SAQLASH</span>
                </div>
              </div>
            </div>

            <div className="mt-4 p-2.5 rounded bg-tactical-900 border border-tactical-700/80 text-[11px] font-mono text-slate-300">
              <span className="text-police-cyan font-bold">Model Fayli:</span> road_signs_quantized.tflite (Edge TPU optimallashtirilgan).
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: Sensor Fusion & TTC */}
      {activeTab === 'fusion' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="hud-panel rounded-xl p-4">
            <h3 className="font-mono text-sm font-bold text-white mb-2 flex items-center space-x-2">
              <Layers className="w-4 h-4 text-police-cyan" />
              <span>SENSOR FUSION: "AQL + REFLEKS" ARXITEKTURASI</span>
            </h3>
            <p className="text-xs text-slate-300 mb-4 leading-relaxed font-sans">
              "Qalqon" roboti kompyuter ko'rishi (kamera) bilan ultratovush datchiklarini birlashtirib ishlaydi:
            </p>

            <div className="space-y-3 font-mono text-xs">
              <div className="p-3 rounded-lg bg-tactical-950 border border-tactical-700">
                <div className="text-police-cyan font-bold mb-1">1. Kamera (AQL):</div>
                <div className="text-slate-400 text-[11px]">
                  Yo'nalish va yo'l chizig'ini topadi, ob'ektlar (piyoda, belgi, to'siq) turini aniqlaydi.
                </div>
              </div>

              <div className="p-3 rounded-lg bg-tactical-950 border border-tactical-700">
                <div className="text-rose-400 font-bold mb-1">2. Ultratovush HC-SR04 (REFLEKS):</div>
                <div className="text-slate-400 text-[11px]">
                  Oldidagi to'siqqacha aniq masofani o'lchab, 22 sm dan kam bo'lganda dasturiy qotishlarsiz darhol tormozlaydi.
                </div>
              </div>

              <div className="p-3 rounded-lg bg-tactical-950 border border-tactical-700">
                <div className="text-emerald-400 font-bold mb-1">3. LiDAR Skaner (360° STRATEGIYA):</div>
                <div className="text-slate-400 text-[11px]">
                  Barcha burchaklar bo'yicha to'siqlarni xaritaga tushiradi va bo'sh yo'laklarni (Gap-Follow) hisoblaydi.
                </div>
              </div>
            </div>
          </div>

          <div className="hud-panel rounded-xl p-4 flex flex-col justify-between">
            <div>
              <h3 className="font-mono text-sm font-bold text-white mb-2 flex items-center space-x-2">
                <Zap className="w-4 h-4 text-amber-400" />
                <span>F1TENTH TTC (TIME TO COLLISION) TIZIMI</span>
              </h3>
              <p className="text-xs text-slate-300 mb-4 font-sans">
                Tezlik va to'siq masofasi nisbati orqali to'qnashuv vaqti real-vaqtda hisoblanadi:
              </p>

              <div className="p-4 rounded-xl bg-tactical-950 border border-tactical-700 font-mono text-center">
                <div className="text-xs text-slate-400 mb-1">JORIY TO'QNASHUV VAQTI (TTC):</div>
                <div className={`text-4xl font-black ${ttcSeconds < 1.0 ? 'text-rose-500 animate-pulse' : 'text-emerald-400'}`}>
                  {ttcSeconds > 10 ? '> 10.0' : ttcSeconds} soniya
                </div>
                <div className="text-[11px] text-slate-400 mt-2">
                  Old masofa: {sonars.front ?? '—'} sm • Tezlik: {currentSpeedMs} m/s
                </div>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-tactical-900 border border-tactical-800 text-[11px] font-mono text-slate-300 mt-4">
              Agar TTC &lt; 0.8 soniya bo'lsa yoki masofa &lt; 22 sm ga tushsa, mikrokontroller darhol favqulodda tormoz beradi.
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: 4-Stage Roadmap from PDF */}
      {activeTab === 'roadmap' && (
        <div className="hud-panel rounded-xl p-4 sm:p-6">
          <div className="font-mono text-sm font-bold text-white mb-4 pb-2 border-b border-tactical-700/60 flex items-center justify-between">
            <span>BOSQICHMA-BOSQICH AMALIY YO'L XARITASI (ROADMAP)</span>
            <span className="text-xs text-police-cyan">IIV Avtonom Patrul Roboti</span>
          </div>

          <div className="space-y-4">
            {/* Stage 1 */}
            <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-600/40">
              <div className="flex items-center justify-between font-mono text-xs font-bold text-emerald-400 mb-2">
                <span className="flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>1-BOSQICH: Asosiy Mexatronika va Teleoperatsiya</span>
                </span>
                <span className="px-2 py-0.5 rounded bg-emerald-900/50 text-emerald-300 border border-emerald-600/50">
                  ERISHILGAN NATIJA ✓
                </span>
              </div>
              <ul className="text-xs text-slate-300 space-y-1 font-mono list-disc list-inside">
                <li>Mecanum 4WD shassi + L293D Shield + Arduino Uno</li>
                <li>Raspberry Pi veb-strimi (8000-port MJPEG)</li>
                <li>Klaviatura va sensor tugmalardan boshqaruv (W, A, S, D, Q, E)</li>
                <li>Ultratovushli xavfsizlik to'xtashi (&lt;22 sm)</li>
              </ul>
            </div>

            {/* Stage 2 */}
            <div className="p-3.5 rounded-xl bg-police-blue/15 border border-police-cyan/40">
              <div className="flex items-center justify-between font-mono text-xs font-bold text-police-cyan mb-2">
                <span className="flex items-center space-x-2">
                  <Zap className="w-4 h-4 text-police-cyan animate-pulse" />
                  <span>2-BOSQICH: Kompyuter Ko'rishi & AI Deteksiya</span>
                </span>
                <span className="px-2 py-0.5 rounded bg-police-blue/40 text-police-cyan border border-police-cyan/50">
                  JARAYONDA / FAOL
                </span>
              </div>
              <ul className="text-xs text-slate-300 space-y-1 font-mono list-disc list-inside">
                <li>Kamerani 35-40° burchak ostida polga qaratish</li>
                <li>UIUC loyihasidagi 'road_signs_quantized.tflite' modelini ulash</li>
                <li>Odam va qizil STOP belgisini ko'rganda avtomatik to'xtash</li>
              </ul>
            </div>

            {/* Stage 3 */}
            <div className="p-3.5 rounded-xl bg-tactical-900/80 border border-tactical-700/60">
              <div className="flex items-center justify-between font-mono text-xs font-bold text-slate-300 mb-2">
                <span>3-BOSQICH: Multunus O'rganish & Mini-Radar</span>
                <span className="px-2 py-0.5 rounded bg-tactical-800 text-slate-400">Rejalashtirilgan</span>
              </div>
              <ul className="text-xs text-slate-400 space-y-1 font-mono list-disc list-inside">
                <li>Multunus uslubida klaviaturadan ma'lumot yig'ish va o'rgatish</li>
                <li>Servo motorga ultratovush datchigini o'rnatib mini-radar qilish</li>
              </ul>
            </div>

            {/* Stage 4 */}
            <div className="p-3.5 rounded-xl bg-tactical-900/80 border border-tactical-700/60">
              <div className="flex items-center justify-between font-mono text-xs font-bold text-slate-300 mb-2">
                <span>4-BOSQICH: Yakuniy IIV Patrul Minorasi</span>
                <span className="px-2 py-0.5 rounded bg-tactical-800 text-slate-400">Yakuniy Bosqich</span>
              </div>
              <ul className="text-xs text-slate-400 space-y-1 font-mono list-disc list-inside">
                <li>2020 Alyuminiy vertikal minora karkasini yig'ish (~1.15m balandlik)</li>
                <li>8.7 dyuymli bronlangan planshet (102 SOS chaqiruv paneli) va politsiya stroboskopi</li>
                <li>LD19 LiDAR qo'shib to'liq SLAM xaritasini ishga tushirish</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
