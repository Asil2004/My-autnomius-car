/**
 * =============================================================================
 * QALQON ROBOT — LDROBOT STL-19P (LD19 / D300) 360° LIDAR DRAYVERI
 * Qo'llab-quvvatlaydi:
 *   1. Web Serial API (Desktop Chrome / Edge / Pi Chromium orqali to'g'ridan-to'g'ri USB/COM port);
 *   2. WebSocket Ko'prigi (Raspberry Pi 5 yoki PC lidar_bridge_server.py orqali Wi-Fi tarmoqda).
 * =============================================================================
 */

import type { LidarPoint } from '../types/robot';

export interface LidarFrameData {
  points: LidarPoint[];
  sectors: {
    front: number;
    right: number;
    rear: number;
    left: number;
  };
  rateHz: number;
  speedRpm: number;
  packetsReceived: number;
  crcErrors: number;
}

export interface LidarObstacleInfo {
  frontCm: number;
  rightCm: number;
  rearCm: number;
  leftCm: number;
  minDistM: number;
  minAngleDeg: number;
  isBlocked: boolean;
  evasion: 'CLEAR' | 'LEFT' | 'RIGHT' | 'REVERSE';
  lastUpdated: number;
  source: 'serial' | 'websocket' | 'none';
}

type FrameCallback = (data: LidarFrameData) => void;

class LidarSerialService {
  private port: any = null;
  private reader: any = null;
  private isReading = false;
  private ws: WebSocket | null = null;
  private isWsConnected = false;
  private currentPortName = '';
  private onFrameCallback: FrameCallback | null = null;

  // 360-graduslik kesh
  private distances: number[] = new Array(360).fill(2.5);
  private intensities: number[] = new Array(360).fill(120);

  // Statistika
  private packetsCount = 0;
  private sweepsCount = 0;
  private lastSweepTime = performance.now();
  private measuredHz = 10.0;
  private lastSpeedRpm = 600;
  private lastStartAngle = 0;

  // Eng so'nggi to'siq holati
  private lastObstacleInfo: LidarObstacleInfo = {
    frontCm: 999,
    rightCm: 999,
    rearCm: 999,
    leftCm: 999,
    minDistM: 9.99,
    minAngleDeg: 0,
    isBlocked: false,
    evasion: 'CLEAR',
    lastUpdated: 0,
    source: 'none'
  };

  /**
   * Brauzerda Web Serial API qo'llab-quvvatlanishini tekshirish
   */
  public isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  public isOpen(): boolean {
    return this.isReading || this.isWsConnected;
  }

  public getPortName(): string {
    return this.currentPortName;
  }

  public getObstacleInfo(): LidarObstacleInfo {
    return this.lastObstacleInfo;
  }

  /**
   * 1. WebSocket Ko'prigi (Raspberry Pi 5 yoki PC orqali planshetda ishlash)
   */
  public async connectWebSocket(customUrl?: string): Promise<{ portName: string }> {
    await this.closePort();

    const defaultHost = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : 'localhost';
    const storedWs = typeof window !== 'undefined' ? localStorage.getItem('qalqon_lidar_ws') : null;
    const storedPiIp = typeof window !== 'undefined' ? localStorage.getItem('qalqon_pi_ip') : null;
    
    let url = customUrl;
    if (!url) {
      if (storedWs) {
        url = storedWs;
      } else if (storedPiIp) {
        url = `ws://${storedPiIp}:8000/ws`;
      } else if (defaultHost && defaultHost !== 'localhost') {
        url = `ws://${defaultHost}:8000/ws`;
      } else {
        url = 'ws://localhost:8000/ws';
      }
    }

    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(url);
        this.ws = ws;

        const timeout = setTimeout(() => {
          if (!this.isWsConnected) {
            try { ws.close(); } catch (_) {}
            reject(new Error(`LiDAR WebSocket ulanish vaqti tugadi (${url})`));
          }
        }, 5000);

        ws.onopen = () => {
          clearTimeout(timeout);
          this.isWsConnected = true;
          this.currentPortName = `WebSocket: ${url}`;
          if (typeof window !== 'undefined') {
            localStorage.setItem('qalqon_lidar_ws', url);
          }
          resolve({ portName: this.currentPortName });
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.lidar && Array.isArray(data.lidar.points)) {
              for (const pt of data.lidar.points) {
                const deg = Math.round(pt.angle) % 360;
                if (deg >= 0 && deg < 360) {
                  this.distances[deg] = pt.distance;
                  this.intensities[deg] = pt.intensity || 100;
                }
              }
              if (data.rate_hz) this.measuredHz = data.rate_hz;
              if (data.rpm) this.lastSpeedRpm = data.rpm;
              if (data.packets_count) this.packetsCount = data.packets_count;
              this.emitFrame();
            }
          } catch (_) {}
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          this.isWsConnected = false;
          if (this.currentPortName.startsWith('WebSocket')) this.currentPortName = '';
        };

        ws.onclose = () => {
          this.isWsConnected = false;
          this.ws = null;
          if (this.currentPortName.startsWith('WebSocket')) this.currentPortName = '';
        };
      } catch (err: any) {
        reject(new Error(err?.message || "WebSocket ulanishida xatolik"));
      }
    });
  }

  /**
   * 2. Haqiqiy USB COM portni ochish (Web Serial API @ 230400 baud)
   */
  public async openPort(baudRate = 230400): Promise<{ portName: string }> {
    await this.closePort();

    if (!this.isSupported()) {
      throw new Error(
        "Brauzeringizda Web Serial API qo'llab-quvvatlanmaydi. Iltimos, Desktop Chrome/Edge ishlating yoki 'Raspberry Pi WebSocket' orqali ulaning."
      );
    }

    const nav = navigator as any;
    try {
      // 1. Filtrlarsiz ochish: barcha ulangan USB serial qurilmalarni ko'rsatish
      this.port = await nav.serial.requestPort();
    } catch (e: any) {
      // 2. Agar bo'sh filters bo'lmasa, ma'lum chip VID lari bilan urinib ko'rish
      try {
        this.port = await nav.serial.requestPort({
          filters: [
            { usbVendorId: 0x10c4 }, // Silicon Labs CP210x (har qanday PID)
            { usbVendorId: 0x1a86 }, // WCH CH340 / CH341 / CH343
            { usbVendorId: 0x0403 }, // FTDI
            { usbVendorId: 0x067b }, // Prolific PL2303
            { usbVendorId: 0x303a }  // Espressif USB CDC
          ]
        });
      } catch {
        throw new Error(e?.message || "LiDAR porti tanlanmadi yoki bekor qilindi");
      }
    }

    if (!this.port) {
      throw new Error("Port tanlanmadi");
    }

    await this.port.open({
      baudRate,
      bufferSize: 65536,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none'
    });

    const info = this.port.getInfo ? this.port.getInfo() : {};
    const portName = info.usbVendorId
      ? `CP2102 (VID: 0x${info.usbVendorId.toString(16).toUpperCase()})`
      : 'USB Serial Port';

    this.currentPortName = `${portName} @ ${baudRate} bps`;
    this.isReading = true;
    this.readLoop();

    return { portName: this.currentPortName };
  }

  /**
   * Portni to'xtatish va toza yopish (Serial yoki WebSocket)
   */
  public async closePort(): Promise<void> {
    this.isReading = false;
    this.isWsConnected = false;
    this.currentPortName = '';

    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }

    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch (_) {}
      try {
        this.reader.releaseLock();
      } catch (_) {}
      this.reader = null;
    }

    if (this.port) {
      try {
        await this.port.close();
      } catch (_) {}
      this.port = null;
    }
  }

  public onFrame(callback: FrameCallback): void {
    this.onFrameCallback = callback;
  }

  /**
   * Asinxron paket o'qish sikli (47 baytli STL-19P paketlari)
   */
  private async readLoop(): Promise<void> {
    let buffer = new Uint8Array(0);
    let lastEmitTime = performance.now();

    try {
      while (this.isReading && this.port && this.port.readable) {
        this.reader = this.port.readable.getReader();

        try {
          while (this.isReading) {
            const { value, done } = await this.reader.read();
            if (done || !value) break;

            const newBuf = new Uint8Array(buffer.length + value.length);
            newBuf.set(buffer, 0);
            newBuf.set(value, buffer.length);
            buffer = newBuf;

            let idx = 0;
            while (idx <= buffer.length - 47) {
              if (buffer[idx] === 0x54 && buffer[idx + 1] === 0x2c) {
                const pkt = buffer.subarray(idx, idx + 47);
                this.parsePacket(pkt);
                idx += 47;
                this.packetsCount++;
              } else {
                idx++;
              }
            }

            if (idx > 0) {
              buffer = buffer.subarray(idx);
            }

            if (buffer.length > 2048) {
              buffer = buffer.subarray(buffer.length - 1024);
            }

            const now = performance.now();
            if (now - lastEmitTime >= 33) {
              lastEmitTime = now;
              this.emitFrame();
            }
          }
        } finally {
          try {
            this.reader.releaseLock();
          } catch (_) {}
          this.reader = null;
        }
      }
    } catch (err) {
      console.warn('[LiDAR Serial] O\'qish xatosi yoki port uzildi:', err);
    } finally {
      this.isReading = false;
    }
  }

  /**
   * 47-baytli STL-19P paketini dekodlash
   */
  private parsePacket(pkt: Uint8Array): void {
    const speedDegSec = pkt[2] | (pkt[3] << 8);
    this.lastSpeedRpm = Math.round((speedDegSec / 360) * 60);

    const startAngle = (pkt[4] | (pkt[5] << 8)) / 100.0;
    const endAngle = (pkt[42] | (pkt[43] << 8)) / 100.0;

    if (startAngle < this.lastStartAngle && this.lastStartAngle > 270) {
      this.sweepsCount++;
      const now = performance.now();
      const dt = (now - this.lastSweepTime) / 1000.0;
      if (dt > 0.05) {
        this.measuredHz = +(1.0 / dt).toFixed(1);
      }
      this.lastSweepTime = now;
    }
    this.lastStartAngle = startAngle;

    const diff = (endAngle - startAngle + 360.0) % 360.0;
    const step = diff / 11.0;

    for (let i = 0; i < 12; i++) {
      const offset = 6 + i * 3;
      const distMm = pkt[offset] | (pkt[offset + 1] << 8);
      const distM = distMm / 1000.0;
      const intensity = pkt[offset + 2];

      const angle = Math.round((startAngle + step * i) % 360.0);
      if (angle >= 0 && angle < 360) {
        if (distM >= 0.03 && distM <= 12.0) {
          this.distances[angle] = +distM.toFixed(3);
          this.intensities[angle] = intensity;
        }
      }
    }
  }

  /**
   * 360 graduslik ma'lumotlar va 4 sektor masofalarini chiqarish
   */
  private emitFrame(): void {
    const points: LidarPoint[] = new Array(360);
    let minDist = 999;
    let minAngle = 0;

    for (let deg = 0; deg < 360; deg++) {
      const d = this.distances[deg] || 0.0;
      points[deg] = {
        angle: deg,
        distance: d,
        intensity: this.intensities[deg] || 0
      };
      if (d > 0.05 && d < minDist) {
        minDist = d;
        minAngle = deg;
      }
    }

    const frontDistM = this.calcSectorDistance(330, 30);
    const rightDistM = this.calcSectorDistance(60, 120);
    const rearDistM = this.calcSectorDistance(150, 210);
    const leftDistM = this.calcSectorDistance(240, 300);

    const frontCm = Math.round(frontDistM * 100);
    const isBlocked = frontDistM <= 0.45; // 45 sm ichida to'siq
    let evasion: 'CLEAR' | 'LEFT' | 'RIGHT' | 'REVERSE' = 'CLEAR';
    if (isBlocked) {
      if (leftDistM >= rightDistM && leftDistM > 0.40) evasion = 'LEFT';
      else if (rightDistM > leftDistM && rightDistM > 0.40) evasion = 'RIGHT';
      else evasion = 'REVERSE';
    }

    this.lastObstacleInfo = {
      frontCm,
      rightCm: Math.round(rightDistM * 100),
      rearCm: Math.round(rearDistM * 100),
      leftCm: Math.round(leftDistM * 100),
      minDistM: minDist < 900 ? +minDist.toFixed(2) : 9.99,
      minAngleDeg: minAngle,
      isBlocked,
      evasion,
      lastUpdated: Date.now(),
      source: this.isWsConnected ? 'websocket' : this.isReading ? 'serial' : 'none'
    };

    if (this.onFrameCallback) {
      this.onFrameCallback({
        points,
        sectors: {
          front: frontDistM,
          right: rightDistM,
          rear: rearDistM,
          left: leftDistM
        },
        rateHz: this.measuredHz > 0 ? this.measuredHz : 10.0,
        speedRpm: this.lastSpeedRpm,
        packetsReceived: this.packetsCount,
        crcErrors: 0
      });
    }
  }

  private calcSectorDistance(startDeg: number, endDeg: number): number {
    let sum = 0;
    let count = 0;
    let min = 999;

    const checkDeg = (deg: number) => {
      const d = this.distances[deg];
      if (d > 0.04 && d < 12.0) {
        sum += d;
        count++;
        if (d < min) min = d;
      }
    };

    if (startDeg > endDeg) {
      for (let i = startDeg; i < 360; i++) checkDeg(i);
      for (let i = 0; i <= endDeg; i++) checkDeg(i);
    } else {
      for (let i = startDeg; i <= endDeg; i++) checkDeg(i);
    }

    if (count === 0) return 5.0;
    return +(min * 0.7 + (sum / count) * 0.3).toFixed(2);
  }
}

export const lidarSerialService = new LidarSerialService();
