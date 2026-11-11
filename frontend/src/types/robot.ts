export type MecanumCommand = 'F' | 'B' | 'L' | 'R' | 'Q' | 'E' | 'G' | 'I' | 'H' | 'J' | 'S' | 'U' | 'D';
export type SpeedLevel = 1 | 2 | 3;

/** Masofa datchiklari, sm. null = datchik yo'q / ma'lumot kelmagan (soxta qiymat ko'rsatilmaydi).
 *  front: kamera "robot ko'zi" to'siq masofasi (HUD aniqlashi yozadi) */
export interface SonarSensors {
  front: number | null;
  rear: number | null;
  left: number | null;
  right: number | null;
}

export interface BatteryState {
  voltage: number;   // e.g. 13.2 V
  percentage: number;// 0 - 100%
  temp: number;      // °C
  current: number;   // Amps
  isCharging: boolean;
}

export interface PTZState {
  pan: number;       // -180 to +180
  tilt: number;      // -30 to +60
  zoom: number;      // 1x to 5x
  mode: 'AUTO_CAMERA' | 'MANUAL';
}

export interface DetectedObject {
  id: string;
  label: string;
  confidence: number; // 0 - 1
  distance: number;   // meters (pinhole: real size * focal / pixel size, sonar bilan tuzatilgan)
  distanceSource?: 'face' | 'body' | 'vehicle' | 'sonar';
  distanceApprox?: boolean; // ramka kadr chetida kesilgan, masofa taxminiy
  distanceUpperBound?: boolean; // odam kadrni to'ldirgan: haqiqiy masofa ko'rsatilganidan kichik
  box: { x: number; y: number; width: number; height: number }; // percentages 0-100
  color: string;
  category?: 'person' | 'car' | 'vehicle' | 'sign' | 'other';
  personName?: string;
  isIdentifiedPerson?: boolean;
}

export interface GPSState {
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number | null; // meters
  speed: number | null;    // km/h
  heading: number | null;  // degrees
  timestamp: number;
  isReal: boolean;
  status: 'ONLINE' | 'SEARCHING' | 'DENIED' | 'UNAVAILABLE';
  error?: string;
}

export interface LidarPoint {
  angle: number;    // 0 - 359 deg
  distance: number; // meters
  intensity: number;
}

export interface LidarInfo {
  model: string;            // 'LDROBOT STL-19P'
  type: string;             // '360° DToF Laser Scanner'
  mode: 'HARDWARE' | 'SIMULATION';
  isHardware: boolean;
  port: string;             // e.g. 'COM4' or '/dev/ttyUSB0'
  baudrate: number;         // 230400
  rateHz: number;           // 10.0 Hz
  sampleRate: number;       // 4500 pts/s
  rangeMin: number;         // 0.05m
  rangeMax: number;         // 12.0m
  accuracyMm: number;       // 15 mm
  pointsCount: number;
  sectors: {
    front: number;
    rear: number;
    left: number;
    right: number;
  };
  isBlocked: boolean;
  status: 'ONLINE' | 'SCANNING' | 'STANDBY' | 'ERROR';
}

export type PatrolMode = 'AUTONOMOUS' | 'MANUAL' | 'GAP_FOLLOW' | 'SENTRY_STATIONARY';

export interface SystemStatus {
  /** Oxirgi xavfsizlik ogohlantirishi (masalan kamera to'siqni yaqin ko'rdi) */
  serialWarning: string | null;
}

/** Pi telemetriyasidagi masofaviy admin holati (raspberry_pi/remote_control.py) */
export interface RemoteEvent {
  t: number;
  src: 'admin' | 'local' | 'system';
  cmd: string;
  ok: boolean;
  reason?: string;
}

export interface RemoteStatus {
  /** Pi da admin token o'rnatilgan (masofaviy kirish yoqilgan) */
  enabled: boolean;
  /** Monitor kalit (kill-switch): false bo'lsa admin harakat buyruqlari rad etiladi */
  allowed: boolean;
  /** Oxirgi 2 soniyada admin buyrug'i kelgan */
  admin_active: boolean;
  /** Lokal operator yaqinda buyruq bergan: admin harakati vaqtincha to'xtatilgan */
  local_hold: boolean;
  lease_ms: number;
  max_speed: number;
  last: RemoteEvent | null;
  events: RemoteEvent[];
}
