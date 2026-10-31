export type MecanumCommand = 'F' | 'B' | 'L' | 'R' | 'Q' | 'E' | 'S';
export type SpeedLevel = 1 | 2 | 3;

export interface SonarSensors {
  front: number; // cm
  rear: number;  // cm
  left: number;  // cm
  right: number; // cm
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
  label: 'Odam (Piyoda)' | 'STOP Belgisi' | 'Qizil Svetofor' | 'Yashil Svetofor' | 'Tezlik 25' | 'Tezlik 40' | 'Noma\'lum To\'siq';
  confidence: number; // 0 - 1
  distance: number;   // meters (calculated via Known Object Size / Focal)
  box: { x: number; y: number; width: number; height: number }; // percentages 0-100
  color: string;
}

export interface LidarPoint {
  angle: number;    // 0 - 359 deg
  distance: number; // meters
  intensity: number;
}

export type PatrolMode = 'AUTONOMOUS' | 'MANUAL' | 'GAP_FOLLOW' | 'SENTRY_STATIONARY';

export interface SystemStatus {
  rpiConnected: boolean;
  arduinoConnected: boolean;
  rpiIp: string;
  rpiPort: number;
  arduinoPort: string;
  pingMs: number;
  cpuUsage: number;
  ramUsage: number;
  uptimeSeconds: number;
  serialWarning: string | null;
}

export interface SOSState {
  active: boolean;
  callDuration: number;
  callerLocation: string;
  channel: '102_IIV_DISPETCHER' | '103_MEDIC' | '101_FIRE';
  operatorName: string;
}
