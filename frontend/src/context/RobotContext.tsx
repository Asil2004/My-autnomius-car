import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type {
  MecanumCommand,
  SpeedLevel,
  SonarSensors,
  BatteryState,
  PTZState,
  DetectedObject,
  PatrolMode,
  SystemStatus,
  GPSState,
  RemoteStatus
} from '../types/robot';
import { tacticalAudio, SIREN_TONE_NAMES, type SirenTone } from '../services/audioService';
import { robotCall, operatorCalls, type RobotCommand } from '../services/voiceCall';
import { ptzCameraService } from '../services/ptzCameraService';
import { playRadio } from '../services/radioVoice';
import { camLinkSettings } from '../services/camLinkSettings';
import { fleetWatcher, selectedRobotStore } from '../services/robotCamLink';

/** Operator kuzatayotgan robot: tanlangani (onlayn bo'lsa), aks holda birinchi onlayn robot */
export function watchedRobotId(): string {
  const robots = fleetWatcher.getState().robots;
  const chosen = selectedRobotStore.get();
  if (chosen && robots.some((r) => r.id === chosen && r.online)) return chosen;
  return robots.find((r) => r.online)?.id || chosen || '';
}
import { headingService } from '../services/headingService';
import { navigationService } from '../services/navigationService';
import { autopilotService } from '../services/autopilotService';
import { esp32Service } from '../services/esp32Service';

export interface LogMessage {
  id: string;
  time: string;
  source: 'SERIAL' | 'RPI' | 'AI' | 'SONAR' | 'SYSTEM' | 'GPS';
  level: 'info' | 'warn' | 'error' | 'success';
  text: string;
}

interface RobotContextType {
  activeTab: 'hud' | 'ai' | 'telemetry' | 'maps' | 'settings';
  setActiveTab: (tab: 'hud' | 'ai' | 'telemetry' | 'maps' | 'settings') => void;
  
  // Motion & Mecanum
  lastCommand: MecanumCommand;
  speedLevel: SpeedLevel;
  sendMecanumCommand: (cmd: MecanumCommand) => void;
  sendJoystickCoordinates: (x: number, y: number) => void;
  esp32Ip: string;
  setEsp32Ip: (ip: string) => void;
  esp32Enabled: boolean;
  setEsp32Enabled: (enabled: boolean) => void;

  // Masofaviy admin (internet orqali, 2-planshet): Pi telemetriyasidan
  remote: RemoteStatus | null;
  setRemoteAllowed: (allowed: boolean) => void;
  setSpeedLevel: (lvl: SpeedLevel) => void;
  isMoving: boolean;
  
  // Sensors
  sonars: SonarSensors;
  setSonars: React.Dispatch<React.SetStateAction<SonarSensors>>;
  isFrontBlocked: boolean;
  /** Haqiqiy batareya ma'lumoti hali kelmagan bo'lsa null */
  battery: BatteryState | null;

  // Camera as Primary Eye / Obstacle Sensor
  cameraObstacle: {
    active: boolean;
    distanceCm: number;
    label: string;
    isBlocked: boolean;
    evasionDirection: 'CLEAR' | 'LEFT' | 'RIGHT' | 'REVERSE';
  };
  updateCameraObstacle: (
    distanceCm: number,
    label?: string,
    evasionDirection?: 'CLEAR' | 'LEFT' | 'RIGHT' | 'REVERSE'
  ) => void;
  
  // Camera & PTZ
  ptz: PTZState;
  setPTZ: React.Dispatch<React.SetStateAction<PTZState>>;
  
  // Police Strobe & Siren
  strobeActive: boolean;
  sirenActive: boolean;
  /** Hozir chalinayotgan sirena ovozi (pult tugmasi) yoki null */
  sirenTone: SirenTone | null;
  setSirenTone: (tone: SirenTone | null) => void;
  toggleStrobe: () => void;
  toggleSiren: () => void;
  
  // Modes
  patrolMode: PatrolMode;
  setPatrolMode: (mode: PatrolMode) => void;
  
  // AI Vision
  detectedObjects: DetectedObject[];
  setDetectedObjects: React.Dispatch<React.SetStateAction<DetectedObject[]>>;
  aiProcessingFps: number;
  
  // System & Connection
  system: SystemStatus;
  logs: LogMessage[];
  addLog: (source: LogMessage['source'], level: LogMessage['level'], text: string) => void;
  
  // Audio & Settings
  isMuted: boolean;
  toggleMute: () => void;

  // Qurilmaning haqiqiy GPS i
  gps: GPSState;
  startRealGPS: () => void;

  // ESP32 Direct MQTT & Local HTTP Control
  esp32Status: string;
  esp32Connected: boolean;
  hornActive: boolean;
  lightActive: boolean;
  toggleHorn: () => void;
  toggleLight: () => void;
}

const RobotContext = createContext<RobotContextType | null>(null);

export const RobotProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<'hud' | 'ai' | 'telemetry' | 'maps' | 'settings'>('hud');
  
  const [lastCommand, setLastCommand] = useState<MecanumCommand>('S');
  const [remote] = useState<RemoteStatus | null>(null);
  const [speedLevel, setSpeedLevelState] = useState<SpeedLevel>(2);
  const [isMoving, setIsMoving] = useState<boolean>(false);
  // Navigatsiya: faqat buyruq O'ZGARGANDA xabar beriladi ("to'xta" -> dead reckoning siljimaydi, tezlik 0).
  // Boshlang'ich 'S' hisobga olinmaydi: robot avtonom yurayotgan bo'lishi mumkin
  const prevCmdRef = useRef<MecanumCommand>('S');
  useEffect(() => {
    if (lastCommand === prevCmdRef.current) return;
    prevCmdRef.current = lastCommand;
    navigationService.setMoving(lastCommand !== 'S');
  }, [lastCommand]);

  // ESP32 Direct MQTT & Local HTTP boshqaruv holatlari
  const [esp32Connected, setEsp32Connected] = useState<boolean>(false);
  const [esp32Status, setEsp32Status] = useState<string>('ULANMOQDA...');
  const [hornActive, setHornActive] = useState<boolean>(false);
  const [lightActive, setLightActive] = useState<boolean>(false);
  const mqttClientRef = useRef<any>(null);
  const heartbeatRef = useRef<number | null>(null);
  const currentCmdRef = useRef<MecanumCommand>('S');
  const pressedKeysRef = useRef<{ [key: string]: boolean }>({});

  // ESP32 MQTT Ulanishi (HiveMQ broker orqali planshet va ESP32 simsiz aloqasi)
  useEffect(() => {
    let isMounted = true;
    const topic = localStorage.getItem('qalqon_mqtt_topic') || 'qalqon/robot/cmd';

    const initMqtt = async () => {
      try {
        if (!(window as any).mqtt) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/mqtt@5.10.4/dist/mqtt.min.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("MQTT yuklab bo'lmadi"));
            document.head.appendChild(script);
          });
        }
        if (!isMounted) return;

        const mqttLib = (window as any).mqtt;
        const clientId = 'qalqon_hud_' + Math.random().toString(16).substring(2, 10);
        const client = mqttLib.connect('wss://broker.hivemq.com:8884/mqtt', {
          clientId,
          clean: true,
          connectTimeout: 5000,
          reconnectPeriod: 3000
        });

        mqttClientRef.current = client;

        client.on('connect', () => {
          if (!isMounted) return;
          setEsp32Connected(true);
          setEsp32Status('ONLINE (MQTT)');
          addLogRef.current('SYSTEM', 'success', `ESP32 MQTT brokerga ulandi (${topic})`);
        });

        client.on('error', (err: any) => {
          if (!isMounted) return;
          console.warn('[RobotContext] MQTT xatosi:', err);
          setEsp32Connected(false);
          setEsp32Status('XATOLIK');
        });

        client.on('close', () => {
          if (!isMounted) return;
          setEsp32Connected(false);
          setEsp32Status('UZILDI');
        });
      } catch {
        if (!isMounted) return;
        setEsp32Connected(false);
        setEsp32Status('ULANMADI');
      }
    };

    initMqtt();

    return () => {
      isMounted = false;
      if (mqttClientRef.current) {
        try {
          mqttClientRef.current.end();
        } catch {}
      }
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
      }
    };
  }, []);

  
  // ESP32 Wi-Fi boshqaruvi holati
  const [esp32Ip, setEsp32IpState] = useState<string>(() => esp32Service.getIp());
  const [esp32Enabled, setEsp32EnabledState] = useState<boolean>(() => esp32Service.getEnabled());

  const setEsp32Ip = (ip: string) => {
    esp32Service.setIp(ip);
    setEsp32IpState(esp32Service.getIp());
    addLog('SERIAL', 'info', `ESP32 IP manzili yangilandi: ${esp32Service.getIp()}`);
  };

  const setEsp32Enabled = (enabled: boolean) => {
    esp32Service.setEnabled(enabled);
    setEsp32EnabledState(enabled);
    addLog('SERIAL', 'info', `ESP32 to'g'ridan-to'g'ri aloqa: ${enabled ? 'YOQILDI' : 'O`CHIRILDI'}`);
  };

  // 360° Analog Joystik koordinatalari (-100 dan +100 gacha)
  const sendJoystickCoordinates = useCallback((x: number, y: number) => {
    if (x === 0 && y === 0) {
      setIsMoving(false);
      setLastCommand('S');
    } else {
      setIsMoving(true);
    }
    // 1. esp32Service orqali lokal Wi-Fi HTTP ga tezkor yuborish
    esp32Service.sendJoystick(x, y);
    // 2. MQTT orqali ham joystik vektorini yuborish ("J:x,y")
    const topic = localStorage.getItem('qalqon_mqtt_topic') || 'qalqon/robot/cmd';
    if (mqttClientRef.current && mqttClientRef.current.connected) {
      try {
        mqttClientRef.current.publish(topic, `J:${x},${y}`);
      } catch {}
    }
  }, []);

  const sendRawToESP32 = useCallback((cmdStr: string) => {
    const topic = localStorage.getItem('qalqon_mqtt_topic') || 'qalqon/robot/cmd';
    if (mqttClientRef.current && mqttClientRef.current.connected) {
      try {
        mqttClientRef.current.publish(topic, cmdStr);
      } catch (e) {
        console.error('MQTT publish error:', e);
      }
    }
    const espIp = localStorage.getItem('qalqon_esp_ip');
    if (espIp) {
      fetch('http://' + espIp + '/move?dir=' + cmdStr, { mode: 'no-cors' }).catch(() => {});
    }
  }, []);

  const toggleHorn = useCallback(() => {
    setHornActive((prev) => {
      const next = !prev;
      sendRawToESP32(next ? 'HORN_ON' : 'HORN_OFF');
      addLogRef.current('SYSTEM', 'info', `Signal (Horn): ${next ? "YOQILDI" : "O'CHIRILDI"}`);
      return next;
    });
  }, [sendRawToESP32]);

  const toggleLight = useCallback(() => {
    setLightActive((prev) => {
      const next = !prev;
      sendRawToESP32(next ? 'LIGHT_ON' : 'LIGHT_OFF');
      addLogRef.current('SYSTEM', 'info', `Fara (Light): ${next ? "YOQILDI" : "O'CHIRILDI"}`);
      return next;
    });
  }, [sendRawToESP32]);

  // Alohida sonar datchiklari yo'q: old masofani kamera ("robot ko'zi") beradi, qolganlari ma'lumot kelmaguncha null
  const [sonars, setSonars] = useState<SonarSensors>({
    front: null,
    rear: null,
    left: null,
    right: null
  });

  const [cameraObstacle, setCameraObstacle] = useState<{
    active: boolean;
    distanceCm: number;
    label: string;
    isBlocked: boolean;
    evasionDirection: 'CLEAR' | 'LEFT' | 'RIGHT' | 'REVERSE';
  }>({
    active: false,
    distanceCm: 150,
    label: "Yo'l ochiq",
    isBlocked: false,
    evasionDirection: 'CLEAR'
  });

  const lastCameraObstacleUpdateRef = useRef<number>(0);

  const updateCameraObstacle = useCallback((
    distanceCm: number,
    label: string = "To'siq",
    evasionDirection: 'CLEAR' | 'LEFT' | 'RIGHT' | 'REVERSE' = 'CLEAR'
  ) => {
    lastCameraObstacleUpdateRef.current = Date.now();
    const clampedDist = Math.max(10, Math.min(300, Math.round(distanceCm)));
    const blocked = clampedDist <= 28;

    setCameraObstacle({
      active: true,
      distanceCm: clampedDist,
      label,
      isBlocked: blocked,
      evasionDirection
    });

    setSonars((prev) => ({
      ...prev,
      front: clampedDist
    }));

    if (blocked) {
      setSystem((s) => ({ ...s, serialWarning: `WARN:CAMERA_OBSTACLE (${clampedDist}sm)` }));
    } else {
      setSystem((s) => ({ ...s, serialWarning: null }));
    }
  }, []);

  // Batareya o'lchanmaydi (datchik yo'q): soxta qiymat ko'rsatilmaydi
  const [battery] = useState<BatteryState | null>(null);

  const [ptz, setPTZ] = useState<PTZState>({
    pan: 0,
    tilt: 15,
    zoom: 1,
    mode: 'AUTO_CAMERA'
  });

  const [strobeActive, setStrobeActive] = useState<boolean>(false);
  const [sirenActive, setSirenActive] = useState<boolean>(false);
  const [sirenTone, setSirenToneState] = useState<SirenTone | null>(null);
  const sirenToneRef = useRef<SirenTone | null>(null);
  const sirenCmdAtRef = useRef(0);
  const [patrolMode, setPatrolMode] = useState<PatrolMode>('MANUAL');

  // LiDAR ma'lumoti LiDAR bo'limida Web Serial orqali to'g'ridan-to'g'ri o'qiladi (lidarSerialService)

  const [aiProcessingFps] = useState<number>(24);
  const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([]);

  // Qurilmaning haqiqiy GPS i (koordinata birinchi signal kelguncha boshlang'ich nuqta, status SEARCHING)
  const [gps, setGps] = useState<GPSState>({
    latitude: 40.09985,
    longitude: 65.36835,
    altitude: 348,
    accuracy: 3.5,
    speed: 0,
    heading: 135,
    timestamp: Date.now(),
    isReal: false,
    status: 'SEARCHING'
  });

  const [system, setSystem] = useState<SystemStatus>({ serialWarning: null });

  const [isMuted, setIsMuted] = useState<boolean>(false);

  const [logs, setLogs] = useState<LogMessage[]>(() => [
    { id: '1', time: new Date().toTimeString().slice(0, 8), source: 'SYSTEM', level: 'info', text: 'Qalqon ishga tushdi.' }
  ]);

  const addLogRef = useRef<(source: LogMessage['source'], level: LogMessage['level'], text: string) => void>(() => undefined);
  const addLog = useCallback((source: LogMessage['source'], level: LogMessage['level'], text: string) => {
    const timeStr = new Date().toTimeString().slice(0, 8);
    const newLog: LogMessage = {
      id: Math.random().toString(36).substring(2, 9),
      time: timeStr,
      source,
      level,
      text
    };
    setLogs((prev) => [newLog, ...prev.slice(0, 49)]);
  }, []);
  useEffect(() => {
    addLogRef.current = addLog;
  }, [addLog]);

  // =========================================================================
  // HAQIQIY GPS (GEOLOCATION API) SIKLI
  // =========================================================================
  const watchIdRef = useRef<number | null>(null);

  const startRealGPS = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setGps((prev) => ({
        ...prev,
        isReal: false,
        status: 'UNAVAILABLE',
        error: "Qurilmangizda GPS / Geolocation qo'llab-quvvatlanmaydi"
      }));
      addLog('GPS', 'error', "GPS xatosi: Qurilmada geolokatsiya datchigi topilmadi");
      return;
    }

    setGps((prev) => ({ ...prev, status: 'SEARCHING' }));
    addLog('GPS', 'info', "Haqiqiy GPS sun'iy yo'ldosh signallari qidirilmoqda...");

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const speedKmH = pos.coords.speed !== null && pos.coords.speed !== undefined
          ? +(pos.coords.speed * 3.6).toFixed(1)
          : 0;
        headingService.pushGps(pos.coords.heading, speedKmH);
        // Markaziy navigatsiya (GPS + tezlik + giroskop): GPS uzilsa dead reckoning bilan davom etadi
        navigationService.pushGps({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
          // Qurilma tezlik bermasa (null) navigatsiya o'zi GPS nuqtalaridan hisoblaydi
          speedKmh: pos.coords.speed !== null && pos.coords.speed !== undefined ? speedKmH : null,
          courseDeg: pos.coords.heading
        });

        setGps({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          altitude: pos.coords.altitude !== null ? +pos.coords.altitude.toFixed(1) : 340,
          accuracy: pos.coords.accuracy ? +pos.coords.accuracy.toFixed(1) : 4.0,
          speed: speedKmH,
          heading: pos.coords.heading !== null && !isNaN(pos.coords.heading) ? Math.round(pos.coords.heading) : 0,
          timestamp: pos.timestamp,
          isReal: true,
          status: 'ONLINE',
          error: undefined
        });
      },
      (err) => {
        let msg = "GPS ulanishida xatolik";
        if (err.code === 1) msg = "GPS ruxsati berilmadi (Brauzerda geolokatsiyaga ruxsat bering)";
        else if (err.code === 2) msg = "GPS koordinatalarini aniqlab bo'lmadi";
        else if (err.code === 3) msg = "GPS vaqti tugadi (Timeout)";

        setGps((prev) => ({
          ...prev,
          status: err.code === 1 ? 'DENIED' : 'UNAVAILABLE',
          error: msg
        }));
        addLog('GPS', 'warn', `GPS Ogohlantirish: ${msg}`);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 10000
      }
    );
  }, [addLog]);

  // Sayt ochilganda avtomatik haqiqiy GPS ni ishga tushirish
  useEffect(() => {
    startRealGPS();
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [startRealGPS]);

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    tacticalAudio.setMuted(next);
  };

  const toggleStrobe = () => {
    setStrobeActive((prev) => {
      const next = !prev;
      tacticalAudio.playClick();
      addLog('SYSTEM', next ? 'warn' : 'info', `Stroboskop patrul chiroqlari: ${next ? 'YOQILDI' : 'O\'CHIRILDI'}`);
      return next;
    });
  };

  /** Shu qurilmada sirenani aniq holatga keltirish (robot plansheti dinamigi) */
  const applySiren = useCallback(
    (next: SirenTone | null, by?: string) => {
      sirenToneRef.current = next;
      setSirenToneState(next);
      setSirenActive(!!next);
      const who = by ? ` (${by})` : '';
      if (next) {
        tacticalAudio.startSiren(next);
        addLog('SYSTEM', 'warn', `Politsiya sirenasi FAOL: ${next} — ${SIREN_TONE_NAMES[next]}${who}`);
      } else {
        tacticalAudio.stopSiren();
        addLog('SYSTEM', 'info', `Politsiya sirenasi o'chirildi${who}`);
      }
    },
    [addLog]
  );

  /**
   * Sirena pulti tugmasi: A/B/C/D yoqadi, faol tugma qayta bosilsa o'chadi.
   * Robot qurilmasida o'zida chalinadi; OPERATORDA esa tanlangan robotga buyruq yuboriladi va robotda chalinadi.
   */
  const setSirenTone = useCallback(
    (tone: SirenTone | null) => {
      const next = tone && tone !== sirenToneRef.current ? tone : null;
      if (camLinkSettings.get().role !== 'operator') {
        applySiren(next);
        return;
      }
      const robotId = watchedRobotId();
      if (!robotId) {
        addLog('SYSTEM', 'warn', "Sirena: onlayn robot yo'q (robot planshetida sayt ochiq bo'lishi kerak)");
        return;
      }
      sirenToneRef.current = next;
      setSirenToneState(next);
      setSirenActive(!!next);
      sirenCmdAtRef.current = Date.now();
      void operatorCalls.sendCommand(robotId, { type: 'siren', tone: next }).then((ok) => {
        addLog('SYSTEM', ok ? 'warn' : 'error', ok ? `Sirena ${robotId} robotida: ${next ? `${next} — ${SIREN_TONE_NAMES[next]}` : "o'chirildi"}` : "Sirena buyrug'i yuborilmadi (aloqa yo'q)");
      });
    },
    [addLog, applySiren]
  );
  const toggleSiren = () => setSirenTone(sirenToneRef.current ? null : 'A');

  // ROBOT: operatordan kelgan sirena va ratsiya buyruqlari
  useEffect(() => {
    robotCall.setCommandHandler((c) => {
      if (c.type === 'siren') applySiren(c.tone, c.by);
      else if (c.type === 'ptz') {
        if (c.op === 'move') ptzCameraService.moveLocal(c.pan, c.tilt);
        else ptzCameraService.stopLocal();
      } else if (c.type === 'radio') {
        addLog('SYSTEM', 'warn', `Ratsiya: ${c.by || 'operator'} (${(c.ms / 1000).toFixed(1)} s)`);
        void playRadio(c.audio).catch((e) => addLog('SYSTEM', 'error', `Ratsiya ovozi ijro etilmadi: ${e instanceof Error ? e.message : e}`));
      }
    });
    return () => robotCall.setCommandHandler(null);
  }, [applySiren, addLog]);

  // OPERATOR: PTZ joystigi robotga yuboriladi (kamera moduli robotga ulangan, operator kompyuteriga emas)
  useEffect(() => {
    const apply = (role: string) =>
      ptzCameraService.setRemote(
        role === 'operator'
          ? (cmd) => {
              const id = watchedRobotId();
              if (id) void operatorCalls.sendCommand(id, { type: 'ptz', ...cmd } as RobotCommand);
            }
          : null
      );
    apply(camLinkSettings.get().role);
    const unsub = camLinkSettings.subscribe((s) => apply(s.role));
    return () => {
      unsub();
      ptzCameraService.setRemote(null);
    };
  }, []);

  // OPERATOR: robot telemetriyasidagi haqiqiy sirena holati pult tugmalarida ko'rinadi
  useEffect(
    () =>
      fleetWatcher.subscribe((f) => {
        if (camLinkSettings.get().role !== 'operator') return;
        const id = watchedRobotId();
        const tel = f.robots.find((r) => r.id === id)?.tel;
        // Buyruq yuborilgandan keyin 3 s robotdan yangilangan holat kelishini kutamiz (eski telemetriya tugmani qaytarmasin)
        if (!tel || tel.siren === undefined || Date.now() - tel.t > 5000 || Date.now() - sirenCmdAtRef.current < 3000) return;
        if (tel.siren !== sirenToneRef.current) {
          sirenToneRef.current = tel.siren;
          setSirenToneState(tel.siren);
          setSirenActive(!!tel.siren);
        }
      }),
    []
  );

  const setSpeedLevel = useCallback((lvl: SpeedLevel) => {
    setSpeedLevelState(lvl);
    tacticalAudio.playClick();
    const pwmMap: Record<SpeedLevel, number> = { 1: 130, 2: 190, 3: 250 };
    const pwm = pwmMap[lvl];
    addLog('SERIAL', 'info', `Tezlik rejimiga o'tildi: ${lvl} (${pwm} PWM)`);
    // ESP32 ga tezlikni uzatish
    sendRawToESP32(`V:${pwm}`);
    const espIp = localStorage.getItem('qalqon_esp_ip');
    if (espIp) {
      fetch(`http://${espIp}/speed?val=${pwm}`, { mode: 'no-cors' }).catch(() => {});
    }
  }, [sendRawToESP32, addLog]);

  const isFrontBlocked = (sonars.front ?? Infinity) <= 28 || cameraObstacle.isBlocked;

  // Mecanum Command Handler (ESP32 MQTT + Heartbeat + Local Fallback)
  const sendMecanumCommand = useCallback((cmd: MecanumCommand) => {
    // Qo'lda buyruq (joystik, klaviatura, ovoz) GPS avtopilotni darhol bekor qiladi
    if (!autopilotService.isSending() && autopilotService.getState().active) {
      autopilotService.stop('Qo‘lda boshqaruv: avtopilot o‘chirildi');
    }
    setLastCommand(cmd);
    setIsMoving(cmd !== 'S');

    const cmdNames: Record<MecanumCommand, string> = {
      F: 'Oldinga (F)',
      B: 'Orqaga (B)',
      L: 'Chapga Burilish (L)',
      R: "O'ngga Burilish (R)",
      Q: 'Chapga Strafe / Egri (Q)',
      E: "O'ngga Strafe / Egri (E)",
      G: 'Oldinga-Chapga Egri (G)',
      I: "Oldinga-O'ngga Egri (I)",
      H: 'Orqaga-Chapga (H)',
      J: "Orqaga-O'ngga (J)",
      S: "To'xtash (S)",
      U: 'Minora Yuqoriga (U)',
      D: 'Minora Pastga (D)'
    };

    if (cmd === 'S') {
      tacticalAudio.playClick();
      addLog('SERIAL', 'info', "STOP (S) komandasi yuborildi. Shassi to'xtadi.");
    } else {
      tacticalAudio.playCommandBeep();
      addLog('SERIAL', 'info', `Buyruq uzatildi: ${cmdNames[cmd] || cmd}`);
    }

    // Oldinga harakatda avtotormoz to'siq tekshiruvi
    const isGoingForward = cmd === 'F' || cmd === 'G' || cmd === 'I' || cmd === 'Q' || cmd === 'E';
    if (isGoingForward && ((sonars.front ?? Infinity) <= 28 || cameraObstacle.isBlocked)) {
      tacticalAudio.playObstacleAlert();
      addLog('AI', 'error', `🛑 AVTOTORMOZ: Kamera "Ko'zi" to'siqni aniqladi (${sonars.front} sm)! Oldinga harakat qulflandi!`);
      setLastCommand('S');
      setIsMoving(false);
      currentCmdRef.current = 'S';
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      sendRawToESP32('S');
      return;
    }

    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }

    currentCmdRef.current = cmd;

    // Skid-steer robot uchun moslash
    let espCmd: string = cmd;
    if (cmd === 'Q') espCmd = 'G';
    if (cmd === 'E') espCmd = 'I';

    esp32Service.sendCommand(cmd);
    sendRawToESP32(espCmd);

    // ESP32 safety taymeri uzilib qolmasligi uchun harakat davomida har 250ms da keep-alive yuboriladi
    if (cmd !== 'S') {
      heartbeatRef.current = window.setInterval(() => {
        sendRawToESP32(espCmd);
      }, 250);
    }
  }, [addLog, cameraObstacle.isBlocked, sendRawToESP32, sonars.front]);

  // Keyboard navigation listener (Multi-key W, A, S, D, Q, E, Space, 1, 2, 3)
  useEffect(() => {
    const evaluateKeys = (): MecanumCommand => {
      const p = pressedKeysRef.current;
      const fwd = !!(p['W'] || p['ARROWUP']);
      const back = !!(p['S'] || p['ARROWDOWN']);
      const left = !!(p['A'] || p['ARROWLEFT']);
      const right = !!(p['D'] || p['ARROWRIGHT']);
      const q = !!p['Q'];
      const e = !!p['E'];

      if (fwd && !back) {
        if (left && !right) return 'G';
        if (right && !left) return 'I';
        return 'F';
      }
      if (back && !fwd) {
        if (left && !right) return 'H';
        if (right && !left) return 'J';
        return 'B';
      }
      if (left && !right) return 'L';
      if (right && !left) return 'R';
      if (q) return 'G';
      if (e) return 'I';
      return 'S';
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

      const key = e.key.toUpperCase();
      if (['W', 'A', 'S', 'D', 'Q', 'E', 'ARROWUP', 'ARROWDOWN', 'ARROWLEFT', 'ARROWRIGHT'].includes(key)) {
        if (pressedKeysRef.current[key]) return;
        pressedKeysRef.current[key] = true;
        const nextCmd = evaluateKeys();
        if (nextCmd !== currentCmdRef.current) {
          sendMecanumCommand(nextCmd);
        }
      } else if (key === ' ' || key === 'ESCAPE') {
        e.preventDefault();
        pressedKeysRef.current = {};
        sendMecanumCommand('S');
      } else if (key === '1') setSpeedLevel(1);
      else if (key === '2') setSpeedLevel(2);
      else if (key === '3') setSpeedLevel(3);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

      const key = e.key.toUpperCase();
      if (['W', 'A', 'S', 'D', 'Q', 'E', 'ARROWUP', 'ARROWDOWN', 'ARROWLEFT', 'ARROWRIGHT'].includes(key)) {
        pressedKeysRef.current[key] = false;
        const nextCmd = evaluateKeys();
        if (nextCmd !== currentCmdRef.current) {
          sendMecanumCommand(nextCmd);
        }
      }
    };

    const handleBlur = () => {
      pressedKeysRef.current = {};
      if (currentCmdRef.current !== 'S') {
        sendMecanumCommand('S');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [sendMecanumCommand,
        sendJoystickCoordinates,
        esp32Ip,
        setEsp32Ip,
        esp32Enabled,
        setEsp32Enabled, setSpeedLevel]);


  // Masofaviy admin kill-switch Raspberry Pi (remote_control.py) da edi. Pi yo'q: holat kelmaydi (remote = null)
  const setRemoteAllowed = useCallback(
    (allowed: boolean) => {
      addLog('SYSTEM', 'warn', `Masofaviy admin ruxsati (${allowed ? 'yoqish' : "o'chirish"}) Raspberry Pi orqali ishlardi, Pi ulanmagan.`);
    },
    [addLog]
  );

  // GPS avtopilot: ESP32 buyrug'i va to'siq ma'lumoti (kamera + sonar) shu kontekstdan olinadi
  const sendCmdRef = useRef(sendMecanumCommand);
  sendCmdRef.current = sendMecanumCommand;
  const obstacleRef = useRef({ cameraObstacle, sonars });
  obstacleRef.current = { cameraObstacle, sonars };
  useEffect(() => {
    autopilotService.setDriver((cmd) => sendCmdRef.current(cmd));
    autopilotService.setObstacleProvider(() => {
      const { cameraObstacle: c, sonars: s } = obstacleRef.current;
      return {
        distanceCm: c.distanceCm,
        label: c.label,
        evasion: c.evasionDirection,
        cameraT: lastCameraObstacleUpdateRef.current,
        // Sonar datchigi yo'q (null): faqat kamera hisobga olinadi
        sonarFrontCm: s.front ?? Infinity
      };
    });
    return () => {
      autopilotService.stop();
      autopilotService.setDriver(null);
      autopilotService.setObstacleProvider(null);
    };
  }, []);

  return (
    <RobotContext.Provider
      value={{
        activeTab,
        setActiveTab,
        lastCommand,
        speedLevel,
        sendMecanumCommand,
        sendJoystickCoordinates,
        esp32Ip,
        setEsp32Ip,
        esp32Enabled,
        setEsp32Enabled,
        remote,
        setRemoteAllowed,
        setSpeedLevel,
        isMoving,
        sonars,
        setSonars,
        isFrontBlocked,
        cameraObstacle,
        updateCameraObstacle,
        battery,
        ptz,
        setPTZ,
        strobeActive,
        sirenActive,
        sirenTone,
        setSirenTone,
        toggleStrobe,
        toggleSiren,
        patrolMode,
        setPatrolMode,
        detectedObjects,
        setDetectedObjects,
        aiProcessingFps,
        system,
        logs,
        addLog,
        isMuted,
        toggleMute,
        gps,
        startRealGPS,
        esp32Status,
        esp32Connected,
        hornActive,
        lightActive,
        toggleHorn,
        toggleLight
      }}
    >
      {children}
    </RobotContext.Provider>
  );
};

export const useRobot = () => {
  const ctx = useContext(RobotContext);
  if (!ctx) throw new Error('useRobot must be used within RobotProvider');
  return ctx;
};
