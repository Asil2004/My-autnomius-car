/**
 * =============================================================================
 * QALQON ROBOT — LDROBOT STL-19P (LD19 / D300) 360° LIDAR DRAYVERI
 * Qo'llab-quvvatlaydi:
 *   1. Web Serial API (Desktop Chrome / Edge / Pi Chromium orqali to'g'ridan-to'g'ri USB/COM port);
 *   2. WebUSB API (Android Chrome / Planshetda to'g'ridan-to'g'ri Type-C OTG orqali CP2102 / CH340);
 *   3. WebSocket Ko'prigi (Raspberry Pi 5 yoki PC lidar_bridge_server.py orqali Wi-Fi tarmoqda).
 * =============================================================================
 */

import type { LidarPoint } from '../types/robot';
import { navigationService } from './navigationService';

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
  source: 'serial' | 'webusb' | 'websocket' | 'none';
}

type FrameCallback = (data: LidarFrameData) => void;

class LidarSerialService {
  private port: any = null;
  private reader: any = null;
  private usbDevice: any = null;
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
   * Brauzerda Web Serial yoki WebUSB API mavjudligini tekshirish
   */
  public isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      (('serial' in navigator) || ('usb' in navigator))
    );
  }

  public isSerialAvailable(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  public isUsbAvailable(): boolean {
    return typeof navigator !== 'undefined' && 'usb' in navigator;
  }

  public getCapabilities(): {
    hasSerial: boolean;
    hasUsb: boolean;
    isSecureContext: boolean;
    origin: string;
  } {
    const isSecureContext = typeof window !== 'undefined' && !!window.isSecureContext;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return {
      hasSerial: typeof navigator !== 'undefined' && 'serial' in navigator,
      hasUsb: typeof navigator !== 'undefined' && 'usb' in navigator,
      isSecureContext,
      origin
    };
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
   * Avval ruxsat berilgan (juftlangan) portlar yoki USB datchiklarni olish
   */
  public async getKnownPorts(): Promise<Array<{ id: string; name: string; type: 'serial' | 'usb'; raw: any }>> {
    const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
    if (!nav) return [];
    const list: Array<{ id: string; name: string; type: 'serial' | 'usb'; raw: any }> = [];

    // 1. Web Serial orqali oldin ruxsat olingan portlar
    if ('serial' in nav && nav.serial.getPorts) {
      try {
        const ports = await nav.serial.getPorts();
        ports.forEach((p: any, idx: number) => {
          const info = p.getInfo ? p.getInfo() : {};
          const vid = info.usbVendorId ? `0x${info.usbVendorId.toString(16).toUpperCase()}` : '';
          const pid = info.usbProductId ? `0x${info.usbProductId.toString(16).toUpperCase()}` : '';
          const label = vid
            ? `USB Serial (VID: ${vid}${pid ? ` PID: ${pid}` : ''})`
            : `Serial Port #${idx + 1}`;
          list.push({ id: `serial-${idx}`, name: label, type: 'serial', raw: p });
        });
      } catch (_) {}
    }

    // 2. WebUSB orqali oldin ruxsat olingan datchiklar
    if ('usb' in nav && nav.usb.getDevices) {
      try {
        const devs = await nav.usb.getDevices();
        devs.forEach((d: any, idx: number) => {
          const vid = `0x${d.vendorId.toString(16).toUpperCase()}`;
          const label = d.productName || `USB Datchik #${idx + 1} (VID: ${vid})`;
          list.push({ id: `usb-${idx}`, name: label, type: 'usb', raw: d });
        });
      } catch (_) {}
    }

    return list;
  }

  /**
   * Raspberry Pi 5 LiDAR Serveri holatini tekshirish (Ping REST /api/status)
   */
  public async pingPiStatus(baseUrl: string): Promise<{ ok: boolean; status?: any; error?: string }> {
    try {
      const clean = baseUrl.trim().replace(/\/+$/, '');
      const httpUrl = clean
        .replace(/^ws:\/\//i, 'http://')
        .replace(/^wss:\/\//i, 'https://')
        .replace(/\/ws$/i, '');

      const urlToFetch = httpUrl.startsWith('http') ? `${httpUrl}/api/status` : `http://${httpUrl}/api/status`;
      const resp = await fetch(urlToFetch, {
        signal: AbortSignal.timeout ? AbortSignal.timeout(3500) : undefined
      });
      if (!resp.ok) {
        return { ok: false, error: `HTTP ${resp.status}: Server javob bermadi` };
      }
      const data = await resp.json();
      return { ok: true, status: data };
    } catch (err: any) {
      return { ok: false, error: err?.message || "Serverga ulanib bo'lmadi" };
    }
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
              this.emitFrame('websocket');
            }

            // Agar WebSocket orqali Pi 5 dan GPS ma'lumoti kelsa
            if (data.gps && data.gps.status === 'ok' && isFinite(data.gps.lat) && isFinite(data.gps.lng)) {
              const fix = parseInt(data.gps.fix) || 0;
              const hdop = parseFloat(data.gps.hdop) || 1.0;
              const acc = fix === 4 ? 0.02 : fix === 5 ? 0.25 : (hdop * 2.0);
              navigationService.pushGps({
                lat: parseFloat(data.gps.lat),
                lon: parseFloat(data.gps.lng),
                accuracyM: acc,
                speedKmh: parseFloat(data.gps.speed) || 0,
                courseDeg: null
              });
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
   * 2. USB COM portni ochish:
   *  - Web Serial (Desktop yoki Android flags) bo'lsa: Web Serial API orqali
   *  - Aks holda (Android standart Chrome): WebUSB API orqali bevosita CP2102/CH340 chipiga ulanadi
   */
  public async openPort(baudRate = 230400): Promise<{ portName: string }> {
    await this.closePort();

    const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
    if (!nav) throw new Error("Brauzer muhiti topilmadi");

    // A) WEB SERIAL API (Desktop Chrome / Edge / Pi Chromium / Android flags)
    if ('serial' in nav) {
      let selectedPort: any = null;
      try {
        try {
          selectedPort = await nav.serial.requestPort();
        } catch (firstErr: any) {
          if (firstErr?.name === 'NotFoundError' || firstErr?.message?.includes('No port selected')) {
            throw new Error("Port tanlash bekor qilindi");
          }
          // Agar parametrsiz requestPort rad etilsa, ma'lum filterlar bilan chaqiramiz
          selectedPort = await nav.serial.requestPort({
            filters: [
              { usbVendorId: 0x10c4 }, // CP210x (LD19 / STL-19P)
              { usbVendorId: 0x1a86 }, // CH340 / CH341
              { usbVendorId: 0x0403 }, // FTDI
              { usbVendorId: 0x067b }  // PL2303
            ]
          });
        }
      } catch (serialErr: any) {
        if (serialErr?.name === 'NotFoundError' || serialErr?.message?.includes('No port selected') || serialErr?.message?.includes('bekor qilindi')) {
          throw new Error("Port tanlash bekor qilindi");
        }
        // Agar Web Serial xatolik bersa (masalan Androidda WebUSB imkoni bo'lsa)
        if (!('usb' in nav)) {
          throw new Error(`Serial port xatosi: ${serialErr?.message || serialErr}`);
        }
      }

      if (selectedPort) {
        this.port = selectedPort;
        await this.port.open({
          baudRate,
          bufferSize: 65536,
          dataBits: 8,
          stopBits: 1,
          parity: 'none',
          flowControl: 'none'
        });

        const info = this.port.getInfo ? this.port.getInfo() : {};
        const vid = info.usbVendorId ? `0x${info.usbVendorId.toString(16).toUpperCase()}` : '';
        const portName = vid ? `CP2102/Serial (VID: ${vid})` : 'USB Serial Port';

        this.currentPortName = `${portName} @ ${baudRate} bps`;
        this.isReading = true;
        this.readLoop();

        return { portName: this.currentPortName };
      }
    }

    // B) WEBUSB API (Android Chrome — OTG orqali to'g'ridan-to'g'ri planshetda ishlaydi)
    if ('usb' in nav) {
      let dev: any = null;
      const usbFilters = [
        { vendorId: 0x10c4 }, // Silicon Labs CP2102 / CP2104 (LDROBOT STL-19P datchigi)
        { vendorId: 0x1a86 }, // WCH CH340 / CH341
        { vendorId: 0x0403 }, // FTDI FT232
        { vendorId: 0x067b }, // Prolific PL2303
        { vendorId: 0x2341 }, // Arduino
        { vendorId: 0x303a }, // Espressif ESP32
        { vendorId: 0x2e8a }, // Raspberry Pi Pico
        { vendorId: 0x1366 }  // Segger
      ];

      try {
        dev = await nav.usb.requestDevice({ filters: usbFilters });
      } catch (usbErr: any) {
        if (usbErr?.name === 'NotFoundError' || usbErr?.message?.includes('No device selected')) {
          throw new Error("USB datchik tanlash bekor qilindi");
        }
        throw new Error(usbErr?.message || "USB datchik topilmadi");
      }

      if (!dev) throw new Error("USB datchik tanlanmadi");

      await dev.open();
      if (dev.configuration === null) {
        await dev.selectConfiguration(1);
      }
      await dev.claimInterface(0);

      // CP2102 UART baud rate sozlash
      try {
        await dev.controlTransferOut(
          { requestType: 'vendor', recipient: 'interface', request: 0x1e, value: 0, index: 0 },
          new Uint32Array([baudRate]).buffer
        );
        await dev.controlTransferOut(
          { requestType: 'vendor', recipient: 'interface', request: 0x00, value: 1, index: 0 }
        );
      } catch (_) {}

      this.usbDevice = dev;
      const portName = dev.productName || `CP2102 USB (VID: 0x${dev.vendorId.toString(16).toUpperCase()})`;
      this.currentPortName = `${portName} @ ${baudRate} bps (WebUSB)`;
      this.isReading = true;

      this.readUsbLoop(dev);

      return { portName: this.currentPortName };
    }

    throw new Error(
      "Brauzeringizda USB/Serial portni ochish imkoni topilmadi. Iltimos, Raspberry Pi WebSocket orqali ulaning yoki Chrome sozlamalaridan Web Serial/USB ruxsatini yoqing."
    );
  }

  /**
   * Avval ruxsat olingan ma'lum bir portni to'g'ridan-to'g'ri ochish
   */
  public async openExistingPort(item: { type: 'serial' | 'usb'; raw: any }, baudRate = 230400): Promise<{ portName: string }> {
    await this.closePort();

    if (item.type === 'serial') {
      const port = item.raw;
      await port.open({
        baudRate,
        bufferSize: 65536,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none'
      });
      this.port = port;
      const info = port.getInfo ? port.getInfo() : {};
      const vid = info.usbVendorId ? `0x${info.usbVendorId.toString(16).toUpperCase()}` : '';
      this.currentPortName = `CP2102/Serial ${vid ? `(${vid})` : ''} @ ${baudRate} bps`;
      this.isReading = true;
      this.readLoop();
      return { portName: this.currentPortName };
    }

    if (item.type === 'usb') {
      const dev = item.raw;
      await dev.open();
      if (dev.configuration === null) {
        await dev.selectConfiguration(1);
      }
      await dev.claimInterface(0);

      try {
        await dev.controlTransferOut(
          { requestType: 'vendor', recipient: 'interface', request: 0x1e, value: 0, index: 0 },
          new Uint32Array([baudRate]).buffer
        );
        await dev.controlTransferOut(
          { requestType: 'vendor', recipient: 'interface', request: 0x00, value: 1, index: 0 }
        );
      } catch (_) {}

      this.usbDevice = dev;
      const portName = dev.productName || `CP2102 USB (VID: 0x${dev.vendorId.toString(16).toUpperCase()})`;
      this.currentPortName = `${portName} @ ${baudRate} bps (WebUSB)`;
      this.isReading = true;
      this.readUsbLoop(dev);
      return { portName: this.currentPortName };
    }

    throw new Error("Noma'lum port turi");
  }

  /**
   * Portni to'xtatish va toza yopish (Serial, WebUSB yoki WebSocket)
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

    if (this.usbDevice) {
      try {
        await this.usbDevice.close();
      } catch (_) {}
      this.usbDevice = null;
    }
  }

  public onFrame(callback: FrameCallback): void {
    this.onFrameCallback = callback;
  }

  /**
   * Web Serial asinxron paket o'qish sikli (47 baytli STL-19P paketlari)
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
              this.emitFrame('serial');
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
   * WebUSB (Android OTG) o'qish sikli
   */
  private async readUsbLoop(device: any): Promise<void> {
    let buffer = new Uint8Array(0);
    let lastEmitTime = performance.now();

    try {
      while (this.isReading && device.opened) {
        const endpoints = device.configuration?.interfaces?.[0]?.alternate?.endpoints || [];
        const inEndpoint = endpoints.find((ep: any) => ep.direction === 'in')?.endpointNumber || 1;

        const result = await device.transferIn(inEndpoint, 512);
        if (result.status !== 'ok' || !result.data || result.data.byteLength === 0) {
          continue;
        }

        const value = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);

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
          this.emitFrame('webusb');
        }
      }
    } catch (err) {
      console.warn('[LiDAR WebUSB] O\'qish xatosi yoki port uzildi:', err);
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
  private emitFrame(source: 'serial' | 'webusb' | 'websocket'): void {
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
      source
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
