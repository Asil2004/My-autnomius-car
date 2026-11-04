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
}

const RobotContext = createContext<RobotContextType | null>(null);

export const RobotProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<'hud' | 'ai' | 'telemetry' | 'maps' | 'settings'>('hud');
  
  const [lastCommand, setLastCommand] = useState<MecanumCommand>('S');
  const [remote, setRemote] = useState<RemoteStatus | null>(null);
  const lastAdminLogRef = useRef({ cmd: '', t: 0 });
  const [speedLevel, setSpeedLevelState] = useState<SpeedLevel>(2);
  const [isMoving, setIsMoving] = useState<boolean>(false);

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

  const setSpeedLevel = (lvl: SpeedLevel) => {
    setSpeedLevelState(lvl);
    tacticalAudio.playClick();
    const pwmMap = { 1: 130, 2: 190, 3: 250 };
    addLog('SERIAL', 'info', `Tezlik rejimiga o'tildi: ${lvl} (${pwmMap[lvl]} PWM)`);
    if (!isSimulationMode) {
      fetch(`http://${system.rpiIp}:${system.rpiPort}/cmd?speed=${lvl}`).catch(() => {});
    }
  };

  const isFrontBlocked = sonars.front <= 28 || cameraObstacle.isBlocked;

  // Mecanum Command Handler
  const sendMecanumCommand = useCallback((cmd: MecanumCommand) => {
    setLastCommand(cmd);
    setIsMoving(cmd !== 'S');

    if (cmd === 'S') {
      tacticalAudio.playClick();
      addLog('SERIAL', 'info', 'STOP (S) komandasi yuborildi. Shassi to\'xtadi.');
    } else {
      tacticalAudio.playCommandBeep();
      const cmdNames: Record<MecanumCommand, string> = {
        F: 'Oldinga (F)',
        B: 'Orqaga (B)',
        L: 'Chapga Burilish (L)',
        R: 'O\'ngga Burilish (R)',
        Q: 'Chapga Strafe Yonlama (Q)',
        E: 'O\'ngga Strafe Yonlama (E)',
        S: 'To\'xtash (S)',
        U: 'Minora Yuqoriga (U)',
        D: 'Minora Pastga (D)'
      };
      addLog('SERIAL', 'info', `Buyruq uzatildi: ${cmdNames[cmd]}`);
    }

    if (cmd === 'F' && (sonars.front <= 28 || cameraObstacle.isBlocked)) {
      tacticalAudio.playObstacleAlert();
      addLog('AI', 'error', `🛑 AVTOTORMOZ: Kamera "Ko'zi" to'siqni aniqladi (${sonars.front} sm)! Oldinga harakat qulflandi!`);
      setLastCommand('S');
      setIsMoving(false);
      return;
    }

    if (!isSimulationMode) {
      fetch(`http://${system.rpiIp}:${system.rpiPort}/cmd?c=${cmd}`).catch((err) => {
        console.error('RPi connection err:', err);
      });
    }
  }, [addLog, isSimulationMode, sonars.front, system.rpiIp, system.rpiPort]);

  // Keyboard navigation listener (W, A, S, D, Q, E, Space, 1, 2, 3)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

      const key = e.key.toUpperCase();
      if (key === 'W' || key === 'ARROWUP') sendMecanumCommand('F');
      else if (key === 'S' && e.key !== 's') sendMecanumCommand('B');
      else if (key === 'ARROWDOWN') sendMecanumCommand('B');
      else if (key === 'A' || key === 'ARROWLEFT') sendMecanumCommand('L');
      else if (key === 'D' || key === 'ARROWRIGHT') sendMecanumCommand('R');
      else if (key === 'Q') sendMecanumCommand('Q');
      else if (key === 'E') sendMecanumCommand('E');
      else if (key === ' ') {
        e.preventDefault();
        sendMecanumCommand('S');
      } else if (key === '1') setSpeedLevel(1);
      else if (key === '2') setSpeedLevel(2);
      else if (key === '3') setSpeedLevel(3);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sendMecanumCommand]);

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
            if (d.gps && d.gps.has_fix) {
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
        toggleGPSMode
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
