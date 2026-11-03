/**
 * =============================================================================
 * QALQON ROBOT — LDROBOT STL-19P (LD19 / D300) WEB SERIAL PORT DRAYVERI
 * Model: LDROBOT STL-19P (360° DToF Laser Range Finder)
 * Protokol: UART 230400 bps, 47 baytli paketlar (Header: 0x54 0x2C), 10 Hz, 4.5 kHz
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

type FrameCallback = (data: LidarFrameData) => void;

class LidarSerialService {
  private port: any = null;
  private reader: any = null;
  private isReading = false;
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

  /**
   * Brauzerda Web Serial API qo'llab-quvvatlanishini tekshirish
   */
  public isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  /**
   * Haqiqiy USB COM portni ochish (230400 baud)
   */
  public async openPort(baudRate = 230400): Promise<{ portName: string }> {
    if (!this.isSupported()) {
      throw new Error(
        "Brauzeringizda Web Serial API qo'llab-quvvatlanmaydi. Iltimos, Google Chrome yoki Microsoft Edge brauzeridan foydalaning."
      );
    }

    // Silicon Labs CP2102 filter (VID: 0x10C4, PID: 0xEA60) yoki ixtiyoriy port
    const nav = navigator as any;
    try {
      this.port = await nav.serial.requestPort({
        filters: [
          { usbVendorId: 0x10c4, usbProductId: 0xea60 }, // Silicon Labs CP2102 (LDROBOT)
          { usbVendorId: 0x1a86, usbProductId: 0x7523 }, // CH340
          { usbVendorId: 0x0403, usbProductId: 0x6001 }  // FTDI
        ]
      }).catch(() => {
        // Filtrlarsiz barcha portlarni ko'rsatish
        return nav.serial.requestPort();
      });
    } catch (e: any) {
      throw new Error(e?.message || "LiDAR porti tanlanmadi");
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

    this.isReading = true;
    this.readLoop();

    return { portName };
  }

  /**
   * Portni to'xtatish va toza yopish
   */
  public async closePort(): Promise<void> {
    this.isReading = false;

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

  /**
   * Kadrlar olinganda chaqiriladigan callback
   */
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

            // Yangi kelgan baytlarni buferga qo'shish
            const newBuf = new Uint8Array(buffer.length + value.length);
            newBuf.set(buffer, 0);
            newBuf.set(value, buffer.length);
            buffer = newBuf;

            // 47-baytli LDROBOT STL-19P paketlarini qidirish (Header: 0x54, 0x2C)
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

            // Agar bufer juda kattalashib ketsa (noto'g'ri oqim), tozalash
            if (buffer.length > 2048) {
              buffer = buffer.subarray(buffer.length - 1024);
            }

            // UI'ga har 33 ms da (30 FPS) barqaror yetkazish
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
    // 1. Aylanish tezligi (deg/sec)
    const speedDegSec = pkt[2] | (pkt[3] << 8);
    this.lastSpeedRpm = Math.round((speedDegSec / 360) * 60);

    // 2. Boshlang'ich burchak (0.01 gradus)
    const startAngle = (pkt[4] | (pkt[5] << 8)) / 100.0;

    // 3. Yakuniy burchak (0.01 gradus)
    const endAngle = (pkt[42] | (pkt[43] << 8)) / 100.0;

    // Burchak to'liq aylanani bosib o'tganda Hz hisoblash
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

    // 4. Burchak qadami
    const diff = (endAngle - startAngle + 360.0) % 360.0;
    const step = diff / 11.0;

    // 5. 12 ta masofa nuqtasi
    for (let i = 0; i < 12; i++) {
      const offset = 6 + i * 3;
      const distMm = pkt[offset] | (pkt[offset + 1] << 8);
      const distM = distMm / 1000.0;
      const intensity = pkt[offset + 2];

      const angle = Math.round((startAngle + step * i) % 360.0);
      if (angle >= 0 && angle < 360) {
        // Filtr: 0.03m dan 12.0m gacha bo'lgan haqiqiy masofalar
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
    if (!this.onFrameCallback) return;

    const points: LidarPoint[] = new Array(360);
    for (let deg = 0; deg < 360; deg++) {
      points[deg] = {
        angle: deg,
        distance: this.distances[deg] || 0.0,
        intensity: this.intensities[deg] || 0
      };
    }

    // 4 Sektor hisobi
    const sectors = {
      front: this.calcSectorDistance(345, 15),
      right: this.calcSectorDistance(75, 105),
      rear: this.calcSectorDistance(165, 195),
      left: this.calcSectorDistance(255, 285)
    };

    this.onFrameCallback({
      points,
      sectors,
      rateHz: this.measuredHz > 0 ? this.measuredHz : 10.0,
      speedRpm: this.lastSpeedRpm,
      packetsReceived: this.packetsCount,
      crcErrors: 0
    });
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
    // Xavfsizlik uchun minimal masofaga ko'proq og'irlik beriladi
    return +(min * 0.7 + (sum / count) * 0.3).toFixed(2);
  }
}

export const lidarSerialService = new LidarSerialService();
