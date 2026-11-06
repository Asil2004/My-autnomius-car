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
  Shield
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

  // Ulanish holati
  const [connected, setConnected] = useState(false);
  const [statusText, setStatusText] = useState('ULANMOQDA...');
  const [speed, setSpeed] = useState<number>(100);
  const [activeCmd, setActiveCmd] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hornActive, setHornActive] = useState(false);
  const [lightActive, setLightActive] = useState(false);

  // MQTT Mijoz ref
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
        // Agar window.mqtt yuklanmagan bo'lsa, dinamik yuklaymiz
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
  // BUYRUQ YUBORISH FUNKSIYALARI
  // ============================================================================
  const sendRaw = useCallback(
    (cmd: string) => {
      if (connType === 'mqtt') {
        if (mqttClientRef.current && mqttClientRef.current.connected) {
          mqttClientRef.current.publish(mqttTopic, cmd);
        }
      } else {
        // Lokal Wi-Fi (ESP32 WebServer)
        fetch(`http://${espIp}/move?dir=${cmd}`, { mode: 'no-cors' }).catch(() => {});
      }
    },
    [connType, mqttTopic, espIp]
  );

  const sendCommand = useCallback(
    (cmd: string) => {
      currentCmdRef.current = cmd;
      sendRaw(cmd);
    },
    [sendRaw]
  );

  const startMovement = useCallback(
    (cmd: string) => {
      setActiveCmd(cmd);
      tacticalAudio.playCommandBeep();
      sendCommand(cmd);

      if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = window.setInterval(() => {
        if (currentCmdRef.current !== 'S') {
          sendCommand(currentCmdRef.current);
        }
      }, 250);
    },
    [sendCommand]
  );

  const stopMovement = useCallback(() => {
    setActiveCmd(null);
    if (heartbeatRef.current) {
      window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    sendCommand('S');
  }, [sendCommand]);

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
      if (key === 'w' || key === 'arrowup') startMovement('F');
      else if (key === 's' || key === 'arrowdown') startMovement('B');
      else if (key === 'a' || key === 'arrowleft') startMovement('L');
      else if (key === 'd' || key === 'arrowright') startMovement('R');
      else if (key === ' ') stopMovement();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (['w', 'arrowup', 's', 'arrowdown', 'a', 'arrowleft', 'd', 'arrowright'].includes(key)) {
        stopMovement();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [startMovement, stopMovement]);

  // Sozlamalarni saqlash
  const handleSaveSettings = () => {
    localStorage.setItem('qalqon_conn_type', connType);
    localStorage.setItem('qalqon_mqtt_topic', mqttTopic);
    localStorage.setItem('qalqon_esp_ip', espIp);
    setSettingsOpen(false);
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
            className="p-1.5 rounded-lg bg-black/20 hover:bg-black/40 text-white transition-colors"
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
            className="p-2 rounded-lg bg-teal-800/60 hover:bg-teal-700 text-teal-200 transition-colors"
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
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Bekor qilish
              </button>
              <button
                onClick={handleSaveSettings}
                className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold"
              >
                Saqlash
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Asosiy 3 Ustunli Boshqaruv Qismi */}
      <div className="flex-1 grid grid-cols-[1.2fr_1fr_1.2fr] gap-4 p-4 max-w-4xl mx-auto w-full h-[calc(100vh-52px)]">
        {/* Chap Ustun: Oldinga va Orqaga */}
        <div className="flex flex-col gap-4">
          {/* Oldinga */}
          <button
            onTouchStart={(e) => {
              e.preventDefault();
              startMovement('F');
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              stopMovement();
            }}
            onTouchCancel={(e) => {
              e.preventDefault();
              stopMovement();
            }}
            onMouseDown={() => startMovement('F')}
            onMouseUp={stopMovement}
            onMouseLeave={() => {
              if (activeCmd === 'F') stopMovement();
            }}
            className={`flex-1 rounded-2xl flex items-center justify-center border-2 transition-all cursor-pointer ${
              activeCmd === 'F'
                ? 'bg-teal-600 border-teal-400 shadow-[0_0_25px_rgba(20,184,166,0.6)] scale-98'
                : 'bg-slate-800/90 border-slate-700 hover:border-slate-600 shadow-lg'
            }`}
          >
            <ArrowUp className="w-16 h-16 text-slate-100" />
          </button>

          {/* Orqaga */}
          <button
            onTouchStart={(e) => {
              e.preventDefault();
              startMovement('B');
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              stopMovement();
            }}
            onTouchCancel={(e) => {
              e.preventDefault();
              stopMovement();
            }}
            onMouseDown={() => startMovement('B')}
            onMouseUp={stopMovement}
            onMouseLeave={() => {
              if (activeCmd === 'B') stopMovement();
            }}
            className={`flex-1 rounded-2xl flex items-center justify-center border-2 transition-all cursor-pointer ${
              activeCmd === 'B'
                ? 'bg-teal-600 border-teal-400 shadow-[0_0_25px_rgba(20,184,166,0.6)] scale-98'
                : 'bg-slate-800/90 border-slate-700 hover:border-slate-600 shadow-lg'
            }`}
          >
            <ArrowDown className="w-16 h-16 text-slate-100" />
          </button>
        </div>

        {/* O'rta Ustun: Tezlik, STOP va Qo'shimchalar */}
        <div className="flex flex-col justify-between items-center py-2">
          {/* Tezlik Qutisi */}
          <div className="w-full bg-slate-800/90 border border-slate-700 rounded-xl p-3 text-center shadow-md">
            <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
              Tezlik
            </span>
            <div className="text-xl font-bold font-mono text-teal-400 my-0.5">{speed}%</div>
            <input
              type="range"
              min={20}
              max={100}
              value={speed}
              onChange={(e) => handleSpeedChange(Number(e.target.value))}
              className="w-full accent-teal-400 cursor-pointer h-1.5 bg-slate-900 rounded-lg"
            />
          </div>

          {/* Markaziy STOP Tugmasi */}
          <button
            onClick={() => {
              tacticalAudio.playClick();
              stopMovement();
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
              className={`w-13 h-13 rounded-xl border flex items-center justify-center transition-all ${
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
              className={`w-13 h-13 rounded-xl border flex items-center justify-center transition-all ${
                lightActive
                  ? 'bg-amber-400 border-amber-200 text-black shadow-[0_0_15px_rgba(251,191,36,0.6)]'
                  : 'bg-slate-800/90 border-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              <Lightbulb className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* O'ng Ustun: Chapga va O'ngga */}
        <div className="flex flex-col gap-4">
          {/* Joyida Chapga */}
          <button
            onTouchStart={(e) => {
              e.preventDefault();
              startMovement('L');
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              stopMovement();
            }}
            onTouchCancel={(e) => {
              e.preventDefault();
              stopMovement();
            }}
            onMouseDown={() => startMovement('L')}
            onMouseUp={stopMovement}
            onMouseLeave={() => {
              if (activeCmd === 'L') stopMovement();
            }}
            className={`flex-1 rounded-2xl flex items-center justify-center border-2 transition-all cursor-pointer ${
              activeCmd === 'L'
                ? 'bg-teal-600 border-teal-400 shadow-[0_0_25px_rgba(20,184,166,0.6)] scale-98'
                : 'bg-slate-800/90 border-slate-700 hover:border-slate-600 shadow-lg'
            }`}
          >
            <ArrowLeft className="w-16 h-16 text-slate-100" />
          </button>

          {/* Joyida O'ngga */}
          <button
            onTouchStart={(e) => {
              e.preventDefault();
              startMovement('R');
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              stopMovement();
            }}
            onTouchCancel={(e) => {
              e.preventDefault();
              stopMovement();
            }}
            onMouseDown={() => startMovement('R')}
            onMouseUp={stopMovement}
            onMouseLeave={() => {
              if (activeCmd === 'R') stopMovement();
            }}
            className={`flex-1 rounded-2xl flex items-center justify-center border-2 transition-all cursor-pointer ${
              activeCmd === 'R'
                ? 'bg-teal-600 border-teal-400 shadow-[0_0_25px_rgba(20,184,166,0.6)] scale-98'
                : 'bg-slate-800/90 border-slate-700 hover:border-slate-600 shadow-lg'
            }`}
          >
            <ArrowRight className="w-16 h-16 text-slate-100" />
          </button>
        </div>
      </div>
    </div>
  );
};
export default ESP32RemoteView;
