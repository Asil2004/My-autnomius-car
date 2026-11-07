import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Volume2,
  Lightbulb,
  Sliders,
  Settings,
  OctagonAlert,
  LogOut,
  ExternalLink,
  Shield,
  Compass
} from 'lucide-react';
import { tacticalAudio } from '../services/audioService';

interface ESP32RemoteViewProps {
  onExit: () => void;
}

export const ESP32RemoteView: React.FC<ESP32RemoteViewProps> = ({ onExit }) => {
  // Sozlamalar holati
  const [connType, setConnType] = useState<'mqtt' | 'http'>(
    () => (localStorage.getItem('qalqon_conn_type') as 'mqtt' | 'http') || 'mqtt'
  );
  const [mqttTopic, setMqttTopic] = useState<string>(
    () => localStorage.getItem('qalqon_mqtt_topic') || 'qalqon/robot/cmd'
  );
  const [espIp, setEspIp] = useState<string>(
    () => localStorage.getItem('qalqon_esp_ip') || '192.168.43.50'
  );

  // Ulanish va holat
  const [connected, setConnected] = useState(false);
  const [statusText, setStatusText] = useState('ULANMOQDA...');
  const [speed, setSpeed] = useState<number>(100);
  const [currentCmd, setCurrentCmd] = useState<string>('S');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hornActive, setHornActive] = useState(false);
  const [lightActive, setLightActive] = useState(false);

  // Ko'p tugmali (Multi-touch va klaviatura) holat registri
  const inputState = useRef({
    fwd: false,
    back: false,
    left: false,
    right: false
  });
  const [activeKeys, setActiveKeys] = useState({
    fwd: false,
    back: false,
    left: false,
    right: false
  });

  // MQTT Mijoz va heartbeat ref
  const mqttClientRef = useRef<any>(null);
  const heartbeatRef = useRef<number | null>(null);
  const currentCmdRef = useRef<string>('S');

  // ============================================================================
  // MQTT ULANTIRISH (Browser WebSocket orqali HiveMQ brokeriga)
  // ============================================================================
  useEffect(() => {
    if (connType !== 'mqtt') {
      setConnected(true);
      setStatusText('LOKAL (HTTP)');
      return;
    }

    let isMounted = true;
    setStatusText('ULANMOQDA...');
    setConnected(false);

    const initMqtt = async () => {
      try {
        if (!(window as any).mqtt) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/mqtt@5.10.4/dist/mqtt.min.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('MQTT kutubxonasini yuklab bo\'lmadi'));
            document.head.appendChild(script);
          });
        }

        if (!isMounted) return;

        const mqttLib = (window as any).mqtt;
        const clientId = 'qalqon_web_' + Math.random().toString(16).substring(2, 10);

        const client = mqttLib.connect('wss://broker.hivemq.com:8884/mqtt', {
          clientId,
          clean: true,
          connectTimeout: 5000
        });

        mqttClientRef.current = client;

        client.on('connect', () => {
          if (!isMounted) return;
          setConnected(true);
          setStatusText('ONLINE (MQTT Bulut)');
        });

        client.on('error', (err: any) => {
          if (!isMounted) return;
          console.warn('[ESP32RemoteView] MQTT error:', err);
          setConnected(false);
          setStatusText('XATOLIK');
        });

        client.on('close', () => {
          if (!isMounted) return;
          setConnected(false);
          setStatusText('UZILDI');
        });
      } catch (e) {
        if (!isMounted) return;
        console.warn('MQTT ulanish xatosi:', e);
        setStatusText('KUTUBXONA XATOSI');
      }
    };

    initMqtt();

    return () => {
      isMounted = false;
      if (mqttClientRef.current) {
        mqttClientRef.current.end(true);
        mqttClientRef.current = null;
      }
    };
  }, [connType]);

  // ============================================================================
  // BUYRUQ YUBORISH
  // ============================================================================
  const sendRaw = useCallback(
    (cmd: string) => {
      if (connType === 'mqtt') {
        if (mqttClientRef.current && mqttClientRef.current.connected) {
          mqttClientRef.current.publish(mqttTopic, cmd);
        }
      } else {
        fetch(`http://${espIp}/move?dir=${cmd}`, { mode: 'no-cors' }).catch(() => {});
      }
    },
    [connType, mqttTopic, espIp]
  );

  // ============================================================================
  // DIFFERENSIAL BOG'LANGAN BUYRUQNI HISOBLASH (Multi-touch & Multi-key)
  // ============================================================================
  const evaluateMovement = useCallback(() => {
    const { fwd, back, left, right } = inputState.current;
    setActiveKeys({ fwd, back, left, right });

    let nextCmd = 'S';

    if (fwd && !back) {
      if (left && !right) {
        nextCmd = 'G'; // Oldinga-chapga silliq egri burilish!
      } else if (right && !left) {
        nextCmd = 'I'; // Oldinga-o'ngga silliq egri burilish!
      } else {
        nextCmd = 'F'; // To'g'ri oldinga
      }
    } else if (back && !fwd) {
      if (left && !right) {
        nextCmd = 'H'; // Orqaga-chapga egri burilish!
      } else if (right && !left) {
        nextCmd = 'J'; // Orqaga-o'ngga egri burilish!
      } else {
        nextCmd = 'B'; // To'g'ri orqaga
      }
    } else if (left && !right) {
      nextCmd = 'L'; // Joyida chapga tank-burilish
    } else if (right && !left) {
      nextCmd = 'R'; // Joyida o'ngga tank-burilish
    } else {
      nextCmd = 'S'; // To'xtash
    }

    if (nextCmd !== currentCmdRef.current) {
      currentCmdRef.current = nextCmd;
      setCurrentCmd(nextCmd);

      if (nextCmd === 'S') {
        if (heartbeatRef.current) {
          window.clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }
        sendRaw('S');
      } else {
        tacticalAudio.playCommandBeep();
        sendRaw(nextCmd);

        // Keep-alive heartbeat (uzluksiz yuborib turish)
        if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
        heartbeatRef.current = window.setInterval(() => {
          if (currentCmdRef.current !== 'S') {
            sendRaw(currentCmdRef.current);
          }
        }, 250);
      }
    }
  }, [sendRaw]);

  // Alohida yo'nalishlarni o'zgartirish
  const setInput = useCallback(
    (key: 'fwd' | 'back' | 'left' | 'right', active: boolean) => {
      inputState.current[key] = active;
      evaluateMovement();
    },
    [evaluateMovement]
  );

  // Diagonal bosish
  const setDiagonal = useCallback(
    (fwdOrBack: 'fwd' | 'back', leftOrRight: 'left' | 'right', active: boolean) => {
      inputState.current[fwdOrBack] = active;
      inputState.current[leftOrRight] = active;
      evaluateMovement();
    },
    [evaluateMovement]
  );

  // Favqulodda to'xtatish
  const stopAll = useCallback(() => {
    inputState.current = { fwd: false, back: false, left: false, right: false };
    evaluateMovement();
  }, [evaluateMovement]);

  const handleSpeedChange = (val: number) => {
    setSpeed(val);
    const pwm = Math.round((val / 100) * 255);
    if (connType === 'mqtt') {
      sendRaw(`V:${pwm}`);
    } else {
      fetch(`http://${espIp}/speed?val=${pwm}`, { mode: 'no-cors' }).catch(() => {});
    }
  };

  const toggleHorn = () => {
    const next = !hornActive;
    setHornActive(next);
    sendRaw(next ? 'HORN_ON' : 'HORN_OFF');
  };

  const toggleLight = () => {
    const next = !lightActive;
    setLightActive(next);
    sendRaw(next ? 'LIGHT_ON' : 'LIGHT_OFF');
  };

  // ============================================================================
  // KLAVIATURA TINGLOVCHISI (W, A, S, D, ArrowKeys, Space)
  // ============================================================================
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
      if (e.repeat) return;

      const key = e.key.toLowerCase();
      if (key === 'w' || key === 'arrowup') setInput('fwd', true);
      else if (key === 's' || key === 'arrowdown') setInput('back', true);
      else if (key === 'a' || key === 'arrowleft') setInput('left', true);
      else if (key === 'd' || key === 'arrowright') setInput('right', true);
      else if (key === ' ') stopAll();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w' || key === 'arrowup') setInput('fwd', false);
      else if (key === 's' || key === 'arrowdown') setInput('back', false);
      else if (key === 'a' || key === 'arrowleft') setInput('left', false);
      else if (key === 'd' || key === 'arrowright') setInput('right', false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [setInput, stopAll]);

  // Sozlamalarni saqlash
  const handleSaveSettings = () => {
    localStorage.setItem('qalqon_conn_type', connType);
    localStorage.setItem('qalqon_mqtt_topic', mqttTopic);
    localStorage.setItem('qalqon_esp_ip', espIp);
    setSettingsOpen(false);
  };

  const getMotionStatusLabel = () => {
    switch (currentCmd) {
      case 'F': return 'To\'g\'ri Oldinga (⬆️)';
      case 'B': return 'Orqaga (⬇️)';
      case 'L': return 'Joyida Chapga (↺)';
      case 'R': return 'Joyida O\'ngga (↻)';
      case 'G': return 'Oldinga-Chapga Silliq (↖️)';
      case 'I': return 'Oldinga-O\'ngga Silliq (↗️)';
      case 'H': return 'Orqaga-Chapga (↙️)';
      case 'J': return 'Orqaga-O\'ngga (↘️)';
      default: return 'To\'xtab turibdi (STOP)';
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#0b1320] text-slate-100 overflow-hidden select-none font-sans">
      {/* Yuqori Panel */}
      <header className="h-13 bg-gradient-to-r from-teal-700 to-teal-900 px-4 flex items-center justify-between shadow-md border-b border-teal-600/40 z-10">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => {
              tacticalAudio.playClick();
              onExit();
            }}
            title="Chiqish"
            className="p-1.5 rounded-lg bg-black/20 hover:bg-black/40 text-white transition-colors cursor-pointer"
          >
            <LogOut className="w-5 h-5" />
          </button>
          <div className="flex items-center space-x-2">
            <Shield className="w-5 h-5 text-teal-300" />
            <span className="font-bold text-sm tracking-wider">QALQON ESP32</span>
          </div>
          <span
            className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full transition-colors ${
              connected ? 'bg-emerald-500 text-black' : 'bg-rose-500 text-white'
            }`}
          >
            {statusText}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          {/* Standalone HTML sahifasiga havola */}
          <a
            href="./controller.html"
            target="_blank"
            rel="noopener noreferrer"
            title="Alohida Pult Oynasida Ochish"
            className="p-2 rounded-lg bg-teal-800/60 hover:bg-teal-700 text-teal-200 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
          </a>

          <button
            onClick={() => setSettingsOpen(true)}
            title="Sozlamalar"
            className="p-2 rounded-lg bg-teal-800/60 hover:bg-teal-700 text-teal-200 transition-colors cursor-pointer"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Sozlamalar Modali */}
      {settingsOpen && (
        <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 max-w-sm w-full shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-teal-400 flex items-center space-x-2">
              <Sliders className="w-5 h-5" />
              <span>Boshqaruv Sozlamalari</span>
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Ulanish usuli:</label>
                <select
                  value={connType}
                  onChange={(e) => setConnType(e.target.value as 'mqtt' | 'http')}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white outline-none"
                >
                  <option value="mqtt">Internet orqali (MQTT Cloud - Har qayerdan)</option>
                  <option value="http">Lokal Wi-Fi orqali (ESP32 HTTP)</option>
                </select>
              </div>

              {connType === 'mqtt' ? (
                <div>
                  <label className="block text-slate-400 mb-1">MQTT Mavzusi (Topic):</label>
                  <input
                    type="text"
                    value={mqttTopic}
                    onChange={(e) => setMqttTopic(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white font-mono outline-none"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    ESP32 ham aynan shu mavzuga ulangan bo'lishi kerak.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-slate-400 mb-1">ESP32 IP Manzili:</label>
                  <input
                    type="text"
                    value={espIp}
                    onChange={(e) => setEspIp(e.target.value)}
                    placeholder="192.168.43.50"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white font-mono outline-none"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Planshet Hotspotidan ESP32 olgan ichki IP.
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setSettingsOpen(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Bekor qilish
              </button>
              <button
                onClick={handleSaveSettings}
                className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold cursor-pointer"
              >
                Saqlash
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Asosiy 3 Ustunli Boshqaruv Qismi */}
      <div className="flex-1 grid grid-cols-[1.2fr_1fr_1.2fr] gap-4 p-4 max-w-4xl mx-auto w-full h-[calc(100dvh-52px)]">
        {/* Chap Ustun: Oldinga va Orqaga */}
        <div className="flex flex-col gap-3">
          {/* Oldinga */}
          <button
            onTouchStart={(e) => { e.preventDefault(); setInput('fwd', true); }}
            onTouchEnd={(e) => { e.preventDefault(); setInput('fwd', false); }}
            onTouchCancel={(e) => { e.preventDefault(); setInput('fwd', false); }}
            onMouseDown={() => setInput('fwd', true)}
            onMouseUp={() => setInput('fwd', false)}
            onMouseLeave={() => setInput('fwd', false)}
            className={`flex-1 rounded-2xl flex flex-col items-center justify-center border-2 transition-all cursor-pointer ${
              activeKeys.fwd
                ? 'bg-teal-600 border-teal-400 shadow-[0_0_25px_rgba(20,184,166,0.6)] scale-98'
                : 'bg-slate-800/90 border-slate-700 hover:border-slate-600 shadow-lg'
            }`}
          >
            <ArrowUp className="w-14 h-14 text-slate-100" />
            <span className="text-[11px] font-mono text-slate-300 font-bold mt-1">OLDINGA (W)</span>
          </button>

          {/* Diagonallar: Oldinga-Chapga va Oldinga-O'ngga tezkor tugmalari */}
          <div className="grid grid-cols-2 gap-2 h-14">
            <button
              onTouchStart={(e) => { e.preventDefault(); setDiagonal('fwd', 'left', true); }}
              onTouchEnd={(e) => { e.preventDefault(); setDiagonal('fwd', 'left', false); }}
              onMouseDown={() => setDiagonal('fwd', 'left', true)}
              onMouseUp={() => setDiagonal('fwd', 'left', false)}
              onMouseLeave={() => setDiagonal('fwd', 'left', false)}
              className={`rounded-xl flex items-center justify-center border text-xs font-mono font-bold transition-all ${
                activeKeys.fwd && activeKeys.left
                  ? 'bg-teal-600 border-teal-400 text-white'
                  : 'bg-slate-800/80 border-slate-700 text-teal-300 hover:bg-slate-700'
              }`}
            >
              ↖️ Egri Chap
            </button>
            <button
              onTouchStart={(e) => { e.preventDefault(); setDiagonal('fwd', 'right', true); }}
              onTouchEnd={(e) => { e.preventDefault(); setDiagonal('fwd', 'right', false); }}
              onMouseDown={() => setDiagonal('fwd', 'right', true)}
              onMouseUp={() => setDiagonal('fwd', 'right', false)}
              onMouseLeave={() => setDiagonal('fwd', 'right', false)}
              className={`rounded-xl flex items-center justify-center border text-xs font-mono font-bold transition-all ${
                activeKeys.fwd && activeKeys.right
                  ? 'bg-teal-600 border-teal-400 text-white'
                  : 'bg-slate-800/80 border-slate-700 text-teal-300 hover:bg-slate-700'
              }`}
            >
              Egri O'ng ↗️
            </button>
          </div>

          {/* Orqaga */}
          <button
            onTouchStart={(e) => { e.preventDefault(); setInput('back', true); }}
            onTouchEnd={(e) => { e.preventDefault(); setInput('back', false); }}
            onTouchCancel={(e) => { e.preventDefault(); setInput('back', false); }}
            onMouseDown={() => setInput('back', true)}
            onMouseUp={() => setInput('back', false)}
            onMouseLeave={() => setInput('back', false)}
            className={`flex-1 rounded-2xl flex flex-col items-center justify-center border-2 transition-all cursor-pointer ${
              activeKeys.back
                ? 'bg-teal-600 border-teal-400 shadow-[0_0_25px_rgba(20,184,166,0.6)] scale-98'
                : 'bg-slate-800/90 border-slate-700 hover:border-slate-600 shadow-lg'
            }`}
          >
            <ArrowDown className="w-14 h-14 text-slate-100" />
            <span className="text-[11px] font-mono text-slate-300 font-bold mt-1">ORQAGA (S)</span>
          </button>
        </div>

        {/* O'rta Ustun: Tezlik, STOP va Holat */}
        <div className="flex flex-col justify-between items-center py-2">
          {/* Tezlik Qutisi */}
          <div className="w-full bg-slate-800/90 border border-slate-700 rounded-xl p-3 text-center shadow-md">
            <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
              Tezlik Quvvati
            </span>
            <div className="text-xl font-bold font-mono text-teal-400 my-0.5">{speed}%</div>
            <input
              type="range"
              min={25}
              max={100}
              value={speed}
              onChange={(e) => handleSpeedChange(Number(e.target.value))}
              className="w-full accent-teal-400 cursor-pointer h-1.5 bg-slate-900 rounded-lg"
            />
          </div>

          {/* Holat Ko'rsatkichi */}
          <div className="w-full bg-slate-900/80 border border-teal-500/40 rounded-xl p-2.5 text-center shadow-inner">
            <div className="text-[10px] font-mono text-slate-400 flex items-center justify-center space-x-1">
              <Compass className="w-3.5 h-3.5 text-teal-400" />
              <span>JORIY HARAKAT:</span>
            </div>
            <div className="text-xs font-mono font-bold text-teal-300 mt-0.5">
              {getMotionStatusLabel()}
            </div>
          </div>

          {/* Markaziy STOP Tugmasi */}
          <button
            onClick={() => {
              tacticalAudio.playClick();
              stopAll();
            }}
            title="Favqulodda To'xtatish"
            className="w-24 h-24 rounded-full bg-gradient-to-br from-slate-800 to-slate-950 border-4 border-rose-500 shadow-[0_0_25px_rgba(244,63,94,0.4)] flex flex-col items-center justify-center active:scale-90 active:bg-rose-600 transition-all cursor-pointer"
          >
            <OctagonAlert className="w-10 h-10 text-rose-500 active:text-white" />
            <span className="text-[10px] font-black text-rose-500 active:text-white mt-1">STOP</span>
          </button>

          {/* Pastki Signal va Fara Tugmalari */}
          <div className="flex gap-3 justify-center w-full">
            <button
              onClick={toggleHorn}
              title="Signal (Gudok)"
              className={`w-13 h-13 rounded-xl border flex items-center justify-center transition-all cursor-pointer ${
                hornActive
                  ? 'bg-amber-500 border-amber-300 text-black shadow-[0_0_15px_rgba(245,158,11,0.5)]'
                  : 'bg-slate-800/90 border-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              <Volume2 className="w-6 h-6" />
            </button>
            <button
              onClick={toggleLight}
              title="Fara / Yoritgich"
              className={`w-13 h-13 rounded-xl border flex items-center justify-center transition-all cursor-pointer ${
                lightActive
                  ? 'bg-amber-400 border-amber-200 text-black shadow-[0_0_15px_rgba(251,191,36,0.6)]'
                  : 'bg-slate-800/90 border-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              <Lightbulb className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* O'ng Ustun: Chapga va O'ngga Burilish */}
        <div className="flex flex-col gap-3">
          {/* Joyida Chapga */}
          <button
            onTouchStart={(e) => { e.preventDefault(); setInput('left', true); }}
            onTouchEnd={(e) => { e.preventDefault(); setInput('left', false); }}
            onTouchCancel={(e) => { e.preventDefault(); setInput('left', false); }}
            onMouseDown={() => setInput('left', true)}
            onMouseUp={() => setInput('left', false)}
            onMouseLeave={() => setInput('left', false)}
            className={`flex-1 rounded-2xl flex flex-col items-center justify-center border-2 transition-all cursor-pointer ${
              activeKeys.left
                ? 'bg-teal-600 border-teal-400 shadow-[0_0_25px_rgba(20,184,166,0.6)] scale-98'
                : 'bg-slate-800/90 border-slate-700 hover:border-slate-600 shadow-lg'
            }`}
          >
            <ArrowLeft className="w-14 h-14 text-slate-100" />
            <span className="text-[11px] font-mono text-slate-300 font-bold mt-1">CHAPGA (A)</span>
          </button>

          {/* Diagonallar: Orqaga-Chapga va Orqaga-O'ngga */}
          <div className="grid grid-cols-2 gap-2 h-14">
            <button
              onTouchStart={(e) => { e.preventDefault(); setDiagonal('back', 'left', true); }}
              onTouchEnd={(e) => { e.preventDefault(); setDiagonal('back', 'left', false); }}
              onMouseDown={() => setDiagonal('back', 'left', true)}
              onMouseUp={() => setDiagonal('back', 'left', false)}
              onMouseLeave={() => setDiagonal('back', 'left', false)}
              className={`rounded-xl flex items-center justify-center border text-xs font-mono font-bold transition-all ${
                activeKeys.back && activeKeys.left
                  ? 'bg-teal-600 border-teal-400 text-white'
                  : 'bg-slate-800/80 border-slate-700 text-teal-300 hover:bg-slate-700'
              }`}
            >
              ↙️ Orqa-Chap
            </button>
            <button
              onTouchStart={(e) => { e.preventDefault(); setDiagonal('back', 'right', true); }}
              onTouchEnd={(e) => { e.preventDefault(); setDiagonal('back', 'right', false); }}
              onMouseDown={() => setDiagonal('back', 'right', true)}
              onMouseUp={() => setDiagonal('back', 'right', false)}
              onMouseLeave={() => setDiagonal('back', 'right', false)}
              className={`rounded-xl flex items-center justify-center border text-xs font-mono font-bold transition-all ${
                activeKeys.back && activeKeys.right
                  ? 'bg-teal-600 border-teal-400 text-white'
                  : 'bg-slate-800/80 border-slate-700 text-teal-300 hover:bg-slate-700'
              }`}
            >
              Orqa-O'ng ↘️
            </button>
          </div>

          {/* Joyida O'ngga */}
          <button
            onTouchStart={(e) => { e.preventDefault(); setInput('right', true); }}
            onTouchEnd={(e) => { e.preventDefault(); setInput('right', false); }}
            onTouchCancel={(e) => { e.preventDefault(); setInput('right', false); }}
            onMouseDown={() => setInput('right', true)}
            onMouseUp={() => setInput('right', false)}
            onMouseLeave={() => setInput('right', false)}
            className={`flex-1 rounded-2xl flex flex-col items-center justify-center border-2 transition-all cursor-pointer ${
              activeKeys.right
                ? 'bg-teal-600 border-teal-400 shadow-[0_0_25px_rgba(20,184,166,0.6)] scale-98'
                : 'bg-slate-800/90 border-slate-700 hover:border-slate-600 shadow-lg'
            }`}
          >
            <ArrowRight className="w-14 h-14 text-slate-100" />
            <span className="text-[11px] font-mono text-slate-300 font-bold mt-1">O'NGGA (D)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
export default ESP32RemoteView;
