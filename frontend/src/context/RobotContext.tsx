import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type {
  MecanumCommand,
  SpeedLevel,
  SonarSensors,
  BatteryState,
  PTZState,
  DetectedObject,
  LidarPoint,
  PatrolMode,
  SystemStatus,
  SOSState,
  GPSState
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
  activeTab: 'hud' | 'sos' | 'ai' | 'telemetry' | 'maps' | 'settings';
  setActiveTab: (tab: 'hud' | 'sos' | 'ai' | 'telemetry' | 'maps' | 'settings') => void;
  
  // Motion & Mecanum
  lastCommand: MecanumCommand;
  speedLevel: SpeedLevel;
  sendMecanumCommand: (cmd: MecanumCommand) => void;
  setSpeedLevel: (lvl: SpeedLevel) => void;
  isMoving: boolean;
  
  // Sensors
  sonars: SonarSensors;
  setSonars: React.Dispatch<React.SetStateAction<SonarSensors>>;
  isFrontBlocked: boolean;
  battery: BatteryState;
  lidarPoints: LidarPoint[];
  
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
  
  // SOS 102
  sos: SOSState;
  triggerSOS: () => void;
  cancelSOS: () => void;
  
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
  const [activeTab, setActiveTab] = useState<'hud' | 'sos' | 'ai' | 'telemetry' | 'maps' | 'settings'>('hud');
  
  const [lastCommand, setLastCommand] = useState<MecanumCommand>('S');
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

  const [sos, setSos] = useState<SOSState>({
    active: false,
    callDuration: 0,
    callerLocation: 'Toshkent sh., Amir Temur xiyoboni (Sektor 4)',
    channel: '102_IIV_DISPETCHER',
    operatorName: 'Katta leytenant Sh. Rahimov'
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

  // SOS handler
  const triggerSOS = () => {
    setSos((prev) => ({ ...prev, active: true, callDuration: 0 }));
    setStrobeActive(true);
    tacticalAudio.startSiren();
    setSirenActive(true);
    addLog('SYSTEM', 'error', 'FAVQULODDA CHAQIRUV! SOS 102 DISPETCHER KANALI ULANDI.');
  };

  const cancelSOS = () => {
    setSos((prev) => ({ ...prev, active: false, callDuration: 0 }));
    tacticalAudio.stopSiren();
    setSirenActive(false);
    tacticalAudio.playClick();
    addLog('SYSTEM', 'info', 'SOS 102 chaqiruvi yakunlandi.');
  };

  // SOS call timer
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    if (sos.active) {
      timer = setInterval(() => {
        setSos((prev) => ({ ...prev, callDuration: prev.callDuration + 1 }));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [sos.active]);

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
            if (d.lidar && d.lidar.points) {
              lidarPointsRef.current = d.lidar.points;
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
        setSpeedLevel,
        isMoving,
        sonars,
        setSonars,
        isFrontBlocked,
        cameraObstacle,
        updateCameraObstacle,
        battery,
        lidarPoints: lidarPointsRef.current,
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
        sos,
        triggerSOS,
        cancelSOS,
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
