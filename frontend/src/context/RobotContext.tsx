import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type {
  MecanumCommand,
  SpeedLevel,
  SonarSensors,
  BatteryState,
  PTZState,
  DetectedObject,
  LidarPoint,
  LidarInfo,
  PatrolMode,
  SystemStatus,
  GPSState,
  RemoteStatus
} from '../types/robot';
import { tacticalAudio } from '../services/audioService';
import { headingService } from '../services/headingService';
import { navigationService } from '../services/navigationService';
import { autopilotService } from '../services/autopilotService';

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

  // Masofaviy admin (internet orqali, 2-planshet): Pi telemetriyasidan
  remote: RemoteStatus | null;
  setRemoteAllowed: (allowed: boolean) => void;
  setSpeedLevel: (lvl: SpeedLevel) => void;
  isMoving: boolean;
  
  // Sensors
  sonars: SonarSensors;
  setSonars: React.Dispatch<React.SetStateAction<SonarSensors>>;
  isFrontBlocked: boolean;
  battery: BatteryState;
  lidarPoints: LidarPoint[];
  lidarInfo: LidarInfo;
  setLidarMode: (mode: 'HARDWARE' | 'SIMULATION') => void;
  
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
  setRpiConfig: (ip: string, port: number) => void;
  logs: LogMessage[];
  addLog: (source: LogMessage['source'], level: LogMessage['level'], text: string) => void;
  
  // Audio & Settings
  isMuted: boolean;
  toggleMute: () => void;
  isSimulationMode: boolean;
  toggleSimulationMode: () => void;

  // Real & Simulated GPS Telemetry
  gps: GPSState;
  startRealGPS: () => void;
  toggleGPSMode: () => void;

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
  const [remote, setRemote] = useState<RemoteStatus | null>(null);
  const lastAdminLogRef = useRef({ cmd: '', t: 0 });
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

  const [sonars, setSonars] = useState<SonarSensors>({
    front: 58,
    rear: 140,
    left: 82,
    right: 95
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

  const [battery, setBattery] = useState<BatteryState>({
    voltage: 13.25,
    percentage: 88,
    temp: 27.4,
    current: 1.85,
    isCharging: false
  });

  const [ptz, setPTZ] = useState<PTZState>({
    pan: 0,
    tilt: 15,
    zoom: 1,
    mode: 'AUTO_CAMERA'
  });

  const [strobeActive, setStrobeActive] = useState<boolean>(false);
  const [sirenActive, setSirenActive] = useState<boolean>(false);
  const [patrolMode, setPatrolMode] = useState<PatrolMode>('MANUAL');

  // LDROBOT STL-19P Real Lidar State
  const [lidarInfo, setLidarInfo] = useState<LidarInfo>({
    model: 'LDROBOT STL-19P',
    type: '360° DToF Laser Scanner',
    mode: 'HARDWARE',
    isHardware: true,
    port: 'COM (CP2102) /dev/ttyUSB0',
    baudrate: 230400,
    rateHz: 10.0,
    sampleRate: 4500,
    rangeMin: 0.05,
    rangeMax: 12.0,
    accuracyMm: 15,
    pointsCount: 360,
    sectors: {
      front: 2.8,
      rear: 3.5,
      left: 2.1,
      right: 2.4
    },
    isBlocked: false,
    status: 'ONLINE'
  });

  const setLidarMode = useCallback((mode: 'HARDWARE' | 'SIMULATION') => {
    setLidarInfo((prev) => ({
      ...prev,
      mode,
      isHardware: mode === 'HARDWARE',
      status: mode === 'HARDWARE' ? 'ONLINE' : 'STANDBY'
    }));
  }, []);

  const [aiProcessingFps] = useState<number>(24);
  const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([
    {
      id: 'obj-1',
      label: 'Odam (Piyoda)',
      confidence: 0.94,
      distance: 2.8,
      box: { x: 38, y: 22, width: 24, height: 56 },
      color: '#00e676',
      category: 'person'
    },
    {
      id: 'obj-2',
      label: 'Mashina (Avtomobil)',
      confidence: 0.91,
      distance: 6.2,
      box: { x: 68, y: 35, width: 26, height: 38 },
      color: '#00e5ff',
      category: 'car'
    }
  ]);

  // GPS Telemetry State (Haqiqiy Geolocation yoki Simulyatsiya)
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

  const [system, setSystem] = useState<SystemStatus>({
    rpiConnected: true,
    arduinoConnected: true,
    rpiIp: (typeof window !== 'undefined' && window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') ? window.location.hostname : '10.255.89.119',
    rpiPort: 8000,
    arduinoPort: '/dev/ttyACM0 (115200 baud)',
    pingMs: 14,
    cpuUsage: 32,
    ramUsage: 44,
    uptimeSeconds: 1420,
    serialWarning: null
  });

  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isSimulationMode, setIsSimulationMode] = useState<boolean>(true);

  const [logs, setLogs] = useState<LogMessage[]>([
    { id: '1', time: '15:30:12', source: 'SYSTEM', level: 'info', text: 'Qalqon OS v2.4 yuklandi. Barcha datchiklar onlayn.' },
    { id: '2', time: '15:30:14', source: 'SERIAL', level: 'success', text: 'Arduino Uno ulandi: /dev/ttyACM0 @ 115200 baud.' },
    { id: '3', time: '15:30:15', source: 'RPI', level: 'info', text: 'Raspberry Pi veb-server ishga tushirildi (port 8000).' },
    { id: '4', time: '15:30:16', source: 'AI', level: 'info', text: 'TensorFlow COCO-SSD & Mobil kameralar detektori tayyor.' },
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

  const toggleGPSMode = useCallback(() => {
    if (gps.isReal) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setGps({
        latitude: 40.09985,
        longitude: 65.36835,
        altitude: 348,
        accuracy: 3.5,
        speed: 0,
        heading: 135,
        timestamp: Date.now(),
        isReal: false,
        status: 'SIMULATED'
      });
      addLog('GPS', 'info', "GPS: Simulyatsiya rejimiga o'tildi (Navoiy ko'chasi)");
    } else {
      startRealGPS();
    }
  }, [gps.isReal, startRealGPS, addLog]);

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

  const toggleSimulationMode = () => {
    setIsSimulationMode((prev) => !prev);
    tacticalAudio.playClick();
  };

  const toggleStrobe = () => {
    setStrobeActive((prev) => {
      const next = !prev;
      tacticalAudio.playClick();
      addLog('SYSTEM', next ? 'warn' : 'info', `Stroboskop patrul chiroqlari: ${next ? 'YOQILDI' : 'O\'CHIRILDI'}`);
      return next;
    });
  };

  const toggleSiren = () => {
    setSirenActive((prev) => {
      const next = !prev;
      if (next) {
        tacticalAudio.startSiren();
        addLog('SYSTEM', 'warn', 'Politsiya ovozli sirenasi FAOL');
      } else {
        tacticalAudio.stopSiren();
        addLog('SYSTEM', 'info', 'Politsiya sirenasi o\'chirildi');
      }
      return next;
    });
  };

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
    if (!isSimulationMode) {
      fetch(`http://${system.rpiIp}:${system.rpiPort}/cmd?speed=${lvl}`).catch(() => {});
    }
  }, [isSimulationMode, sendRawToESP32, system.rpiIp, system.rpiPort, addLog]);

  const isFrontBlocked = sonars.front <= 28 || cameraObstacle.isBlocked;

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
    if (isGoingForward && (sonars.front <= 28 || cameraObstacle.isBlocked)) {
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

    sendRawToESP32(espCmd);

    // ESP32 safety taymeri uzilib qolmasligi uchun harakat davomida har 250ms da keep-alive yuboriladi
    if (cmd !== 'S') {
      heartbeatRef.current = window.setInterval(() => {
        sendRawToESP32(espCmd);
      }, 250);
    }

    if (!isSimulationMode) {
      fetch(`http://${system.rpiIp}:${system.rpiPort}/cmd?c=${cmd}`).catch((err) => {
        console.error('RPi connection err:', err);
      });
    }
  }, [addLog, cameraObstacle.isBlocked, isSimulationMode, sendRawToESP32, sonars.front, system.rpiIp, system.rpiPort]);

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
  }, [sendMecanumCommand, setSpeedLevel]);

  // WebSocket ulanishi (Haqiqiy robot rejimida jonli telemetriya)
  useEffect(() => {
    if (isSimulationMode) return;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      try {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${proto}//${system.rpiIp}:${system.rpiPort}/ws`;
        ws = new WebSocket(url);

        ws.onopen = () => {
          setSystem((s) => ({ ...s, rpiConnected: true }));
          addLog('RPI', 'success', `Raspberry Pi telemetriyasiga ulandi (${url})`);
        };

        ws.onmessage = (ev) => {
          try {
            const d = JSON.parse(ev.data);
            if (d.sonars) setSonars(d.sonars);
            if (d.battery) {
              setBattery((prev) => ({
                ...prev,
                voltage: d.battery.voltage ?? prev.voltage,
                percentage: d.battery.percentage ?? prev.percentage,
                current: d.battery.current ?? prev.current,
                temp: d.battery.temp ?? prev.temp,
                isCharging: d.battery.isCharging ?? prev.isCharging
              }));
            }
            if (d.lidar) {
              if (d.lidar.points) {
                lidarPointsRef.current = d.lidar.points;
              }
              setLidarInfo((prev) => ({
                ...prev,
                model: d.lidar.model || 'LDROBOT STL-19P',
                mode: d.lidar.mode || prev.mode,
                isHardware: d.lidar.is_hardware ?? (d.lidar.mode === 'HARDWARE'),
                port: d.lidar.port || prev.port,
                rateHz: d.lidar.rate_hz || prev.rateHz,
                sectors: d.lidar.sectors || prev.sectors,
                pointsCount: d.lidar.points_count || (d.lidar.points ? d.lidar.points.length : prev.pointsCount),
                isBlocked: d.lidar.sectors ? d.lidar.sectors.front <= 0.45 : prev.isBlocked,
                status: 'ONLINE'
              }));
            }
            // Robot IMU / giroskop (imu.yaw, yaw, compass ...): xaritadagi marker yo'nalishi shu bilan boshqariladi
            headingService.ingestTelemetry(d);
            if (d.gps && d.gps.has_fix) {
              headingService.pushGps(d.gps.heading, d.gps.speed);
              navigationService.pushGps({
                lat: d.gps.latitude,
                lon: d.gps.longitude,
                accuracyM: d.gps.accuracy ?? d.gps.hdop ?? null,
                speedKmh: d.gps.speed,
                courseDeg: d.gps.heading
              });
              setGps((prev) => ({
                ...prev,
                latitude: d.gps.latitude,
                longitude: d.gps.longitude,
                altitude: d.gps.altitude ?? prev.altitude,
                speed: d.gps.speed ?? prev.speed,
                heading: d.gps.heading ?? prev.heading,
                isReal: true,
                status: 'ONLINE',
                timestamp: Date.now()
              }));
            }
            if (d.remote) {
              const r = d.remote as RemoteStatus;
              setRemote(r);
              // Admin buyrug'i jurnalga yoziladi (har 250 ms da emas: buyruq o'zgarganda yoki 3 s dan keyin)
              const last = r.last;
              if (last && last.src === 'admin' && last.ok) {
                const prev = lastAdminLogRef.current;
                if (last.cmd !== prev.cmd || last.t - prev.t > 3) {
                  lastAdminLogRef.current = { cmd: last.cmd, t: last.t };
                  addLogRef.current('RPI', 'info', `Masofaviy admin buyrug'i: ${last.cmd}`);
                }
              }
            }
            if (d.motion) {
              if (d.motion.last_cmd) setLastCommand(d.motion.last_cmd);
              if (d.motion.speed_level) setSpeedLevelState(d.motion.speed_level);
              setIsMoving(d.motion.is_moving ?? false);
            }
          } catch (e) {}
        };

        ws.onclose = () => {
          setSystem((s) => ({ ...s, rpiConnected: false }));
          reconnectTimer = setTimeout(connect, 2000);
        };
        ws.onerror = () => {
          setSystem((s) => ({ ...s, rpiConnected: false }));
        };
      } catch (e) {
        reconnectTimer = setTimeout(connect, 2000);
      }
    };

    connect();
    return () => {
      if (ws) ws.close();
      clearTimeout(reconnectTimer);
    };
  }, [isSimulationMode, system.rpiIp, system.rpiPort, addLog]);

  // Synthetic simulation generator for LiDAR and Sonar telemetry
  const lidarPointsRef = useRef<LidarPoint[]>([]);
  useEffect(() => {
    const updateSensors = () => {
      setSonars((prev) => {
        const isCameraActive = Date.now() - lastCameraObstacleUpdateRef.current < 2500;
        const delta = (Math.random() - 0.5) * 4;
        const frontVal = isCameraActive
          ? prev.front
          : Math.max(16, Math.min(220, Math.round(prev.front + delta)));

        if (frontVal <= 28 && prev.front > 28) {
          tacticalAudio.playObstacleAlert();
          setSystem((s) => ({ ...s, serialWarning: 'WARN:OBSTACLE_FRONT' }));
        } else if (frontVal > 28 && !isCameraActive) {
          setSystem((s) => ({ ...s, serialWarning: null }));
        }
        return {
          front: frontVal,
          rear: Math.max(20, Math.min(250, Math.round(prev.rear + (Math.random() - 0.5) * 3))),
          left: Math.max(15, Math.min(200, Math.round(prev.left + (Math.random() - 0.5) * 3))),
          right: Math.max(15, Math.min(200, Math.round(prev.right + (Math.random() - 0.5) * 3)))
        };
      });

      setBattery((prev) => ({
        ...prev,
        temp: +(27 + Math.sin(Date.now() / 10000) * 1.5).toFixed(1),
        current: isMoving ? 4.2 : 1.4
      }));

      const pts: LidarPoint[] = [];
      for (let angle = 0; angle < 360; angle += 6) {
        let baseDist = 4.5 + Math.sin((angle * Math.PI) / 90) * 2;
        if (angle >= 340 || angle <= 20) baseDist = Math.min(baseDist, 1.8);
        if (angle >= 80 && angle <= 110) baseDist = Math.min(baseDist, 1.2);
        pts.push({
          angle,
          distance: +(baseDist + (Math.random() - 0.5) * 0.2).toFixed(2),
          intensity: Math.floor(180 + Math.random() * 70)
        });
      }
      lidarPointsRef.current = pts;
    };

    if (!isSimulationMode) return;
    const interval = setInterval(updateSensors, 800);
    return () => clearInterval(interval);
  }, [isSimulationMode, isMoving]);

  // Monitor kaliti (kill-switch): masofaviy admin harakat buyruqlarini ruxsat etish yoki taqiqlash. Faqat lokal (LAN) o'zgartira oladi
  const setRemoteAllowed = useCallback(
    (allowed: boolean) => {
      if (isSimulationMode) return;
      fetch(`http://${system.rpiIp}:${system.rpiPort}/api/remote/allow?on=${allowed ? 1 : 0}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((st) => {
          if (st) setRemote(st as RemoteStatus);
          addLog('SYSTEM', allowed ? 'success' : 'warn', allowed ? 'Masofaviy admin boshqaruvi RUXSAT etildi.' : "Masofaviy admin boshqaruvi TAQIQLANDI.");
        })
        .catch(() => addLog('RPI', 'error', "Masofaviy ruxsatni o'zgartirib bo'lmadi: Pi ga ulanib bo'lmadi."));
    },
    [addLog, isSimulationMode, system.rpiIp, system.rpiPort]
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
        sonarFrontCm: s.front
      };
    });
    return () => {
      autopilotService.stop();
      autopilotService.setDriver(null);
      autopilotService.setObstacleProvider(null);
    };
  }, []);

  const setRpiConfig = (ip: string, port: number) => {
    setSystem((prev) => ({ ...prev, rpiIp: ip, rpiPort: port }));
    addLog('SYSTEM', 'info', `RPi konfiguratsiyasi yangilandi: ${ip}:${port}`);
  };

  return (
    <RobotContext.Provider
      value={{
        activeTab,
        setActiveTab,
        lastCommand,
        speedLevel,
        sendMecanumCommand,
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
        lidarPoints: lidarPointsRef.current,
        lidarInfo,
        setLidarMode,
        ptz,
        setPTZ,
        strobeActive,
        sirenActive,
        toggleStrobe,
        toggleSiren,
        patrolMode,
        setPatrolMode,
        detectedObjects,
        setDetectedObjects,
        aiProcessingFps,
        system,
        setRpiConfig,
        logs,
        addLog,
        isMuted,
        toggleMute,
        isSimulationMode,
        toggleSimulationMode,
        gps,
        startRealGPS,
        toggleGPSMode,
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
