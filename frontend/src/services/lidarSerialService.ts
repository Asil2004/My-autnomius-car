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
  source: 'serial' | 'webusb' | 'websocket' | 'mqtt' | 'none';
}

type FrameCallback = (data: LidarFrameData) => void;

const STOP_CM_STORAGE_KEY = 'qalqon_lidar_stop_cm';

// LDROBOT STL-19P / LD19 standart CRC-8 jadvali (polinom 0x4D)
const CRC_TABLE = (() => {
  const tbl = new Uint8Array(256);
  const poly = 0x4d;
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 0x80 ? ((c << 1) ^ poly) & 0xff : (c << 1) & 0xff;
    }
    tbl[i] = c;
  }
  return tbl;
})();

function calcCrc8(pkt: Uint8Array, lenWithoutCrc: number): number {
  let c = 0;
  for (let i = 0; i < lenWithoutCrc; i++) {
    c = CRC_TABLE[(c ^ pkt[i]) & 0xff];
  }
  return c;
}

class LidarSerialService {
  private port: any = null;
  private reader: any = null;
  private usbDevice: any = null;
  private isReading = false;
  private ws: WebSocket | null = null;
  private isWsConnected = false;
  private currentPortName = '';
  private frameListeners = new Set<FrameCallback>();
  private stopCm = 35;

  // 360-graduslik kesh (0 = bo'sh / to'siq yo'q)
  private distances: number[] = new Array(360).fill(0);
  private intensities: number[] = new Array(360).fill(0);
  private pointUpdatedAt: number[] = new Array(360).fill(0);

  // Statistika
  private packetsCount = 0;
  private crcErrorsCount = 0;
  private lastMqttAt = 0;
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

  constructor() {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem(STOP_CM_STORAGE_KEY) : null;
      if (saved) {
        const v = parseInt(saved, 10);
        if (isFinite(v) && v >= 20 && v <= 150) this.stopCm = v;
      }
    } catch {}
  }

  public getStopCm(): number {
    return this.stopCm;
  }

  public setStopCm(cm: number): void {
    const clamped = Math.max(20, Math.min(150, Math.round(cm)));
    this.stopCm = clamped;
    try {
      if (typeof window !== 'undefined') localStorage.setItem(STOP_CM_STORAGE_KEY, String(clamped));
    } catch {}
  }

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
    return this.isReading || this.isWsConnected || (Date.now() - this.lastMqttAt < 3000);
  }

  /** WebSocket (/ws) yoki lokal USB/Serial port ochiqmi (MQTT hisobga olinmaydi) */
  public hasDirectLink(): boolean {
    return this.isReading || this.isWsConnected;
  }

  public getPortName(): string {
    if (this.currentPortName) return this.currentPortName;
    if (Date.now() - this.lastMqttAt < 3000) return 'Cloud MQTT LiDAR Ko‘prigi';
    return '';
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
   * Sahifa qayta yuklanganda avval ruxsat berilgan USB/Serial portga avtomatik qayta ulanish
   */
  public async tryAutoReconnect(): Promise<boolean> {
    if (this.isReading || this.isWsConnected) return true;
    try {
      const known = await this.getKnownPorts();
      if (known.length > 0) {
        await this.openExistingPort(known[0], 230400);
        return true;
      }
    } catch (_) {}
    return false;
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
   * Tashqi (WebSocket yoki Cloud MQTT) skan paketini xavfsiz qabul qilish
   * Eslatma: Har kadrda eski burchaklar tozalanadi, aks holda "arvoh to'siq" qolib ketadi!
   */
  public ingestRemoteLidar(data: any, source: 'websocket' | 'mqtt' = 'websocket'): void {
    if (!data || typeof data !== 'object') return;
    // Mahalliy USB/Serial port allaqachon ulangan bo'lsa, masofaviy MQTT ustiga tushmasin
    if (source === 'mqtt' && (this.isReading || this.isWsConnected)) return;

    const now = performance.now();
    if (data.lidar && Array.isArray(data.lidar.points)) {
      this.distances.fill(0);
      this.intensities.fill(0);
      for (const pt of data.lidar.points) {
        const deg = Math.round(Number(pt.angle)) % 360;
        const d = Number(pt.distance);
        if (deg >= 0 && deg < 360 && isFinite(d) && d >= 0.05 && d <= 12.0) {
          this.distances[deg] = +d.toFixed(3);
          this.intensities[deg] = Number(pt.intensity) || 100;
          this.pointUpdatedAt[deg] = now;
        }
      }
      if (data.rate_hz) this.measuredHz = Number(data.rate_hz) || 10.0;
      if (data.rpm) this.lastSpeedRpm = Number(data.rpm) || 600;
      if (data.packets_count) this.packetsCount = Number(data.packets_count) || this.packetsCount + 1;
      if (typeof data.crc_errors === 'number') this.crcErrorsCount = data.crc_errors;
      if (source === 'mqtt') this.lastMqttAt = Date.now();
      this.emitFrame(source);
    }
  }

  /**
   * Aktiv WebSocket (/ws) orqali robotga tezkor JSON buyruq (joystik/PTZ/cmd) yuborish
   */
  public sendWsJson(payload: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 1. WebSocket Ko'prigi (VPS Cloud Hub wss://DOMAIN/ws yoki Raspberry Pi 5 ws://IP:8000/ws)
   */
  public async connectWebSocket(customUrl?: string): Promise<{ portName: string }> {
    await this.closePort();

    const isBrowser = typeof window !== 'undefined';
    const isHttps = isBrowser && window.location.protocol === 'https:';
    const host = isBrowser ? window.location.host : 'localhost:8000';
    const hostname = isBrowser ? window.location.hostname : 'localhost';
    const port = isBrowser ? window.location.port : '8000';
    const isGithubPages = hostname.endsWith('.github.io');
    const storedWs = isBrowser ? localStorage.getItem('qalqon_lidar_ws') : null;
    const storedPiIp = isBrowser ? localStorage.getItem('qalqon_pi_ip') : null;

    let url = customUrl;
    if (!url) {
      if (isHttps && !isGithubPages && host) {
        // VPS HTTPS domenda doim shifrlangan same-origin wss://DOMAIN/ws ishlatiladi (Mixed Content siz!)
        url = storedWs && storedWs.startsWith('wss://') ? storedWs : `wss://${host}/ws`;
      } else if (storedWs && (!isHttps || storedWs.startsWith('wss://'))) {
        url = storedWs;
      } else if (storedPiIp && !isHttps) {
        url = `ws://${storedPiIp}:8000/ws`;
      } else if (port === '5173' || port === '4173') {
        url = `ws://${hostname}:8000/ws`;
      } else if (host && !isGithubPages) {
        url = `${isHttps ? 'wss' : 'ws'}://${host}/ws`;
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
            this.ingestRemoteLidar(data, 'websocket');
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

      await this.openUsbDevice(dev, baudRate);

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
   * CP2102 / CH340 / FTDI USB-UART ko'priklarini WebUSB orqali ishga tushirish
   */
  private async openUsbDevice(dev: any, baudRate: number): Promise<void> {
    await dev.open();
    if (dev.configuration === null) {
      await dev.selectConfiguration(1);
    }
    const ifaceNum = dev.configuration?.interfaces?.[0]?.interfaceNumber ?? 0;
    await dev.claimInterface(ifaceNum);

    try {
      const vid = dev.vendorId;
      if (vid === 0x10c4) {
        // Silicon Labs CP2102 / CP2104 (LDROBOT STL-19P): avval UART yoqiladi, so'ng baudrate + 8N1 + DTR/RTS
        await dev.controlTransferOut(
          { requestType: 'vendor', recipient: 'interface', request: 0x00, value: 0x0001, index: ifaceNum }
        );
        const baudBuf = new ArrayBuffer(4);
        new DataView(baudBuf).setUint32(0, baudRate, true);
        await dev.controlTransferOut(
          { requestType: 'vendor', recipient: 'interface', request: 0x1e, value: 0, index: ifaceNum },
          baudBuf
        );
        await dev.controlTransferOut(
          { requestType: 'vendor', recipient: 'interface', request: 0x03, value: 0x0800, index: ifaceNum }
        );
        await dev.controlTransferOut(
          { requestType: 'vendor', recipient: 'interface', request: 0x07, value: 0x0303, index: ifaceNum }
        );
      } else if (vid === 0x0403) {
        // FTDI: Reset + DTR/RTS
        await dev.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 0x00, value: 0, index: 0 });
        await dev.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 0x01, value: 0x0303, index: 0 });
      }
    } catch (_) {}
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
      await this.openUsbDevice(dev, baudRate);

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

  public onFrame(callback: FrameCallback): () => void {
    return this.subscribeFrame(callback);
  }

  public subscribeFrame(callback: FrameCallback): () => void {
    this.frameListeners.add(callback);
    return () => {
      this.frameListeners.delete(callback);
    };
  }

  /**
   * Serial va WebUSB oqimlari uchun umumiy 47-baytli STL-19P kadr ajratuvchi
   */
  private feedSerialChunk(
    buffer: Uint8Array,
    chunk: Uint8Array,
    lastEmitTimeRef: { t: number },
    source: 'serial' | 'webusb'
  ): Uint8Array {
    const newBuf = new Uint8Array(buffer.length + chunk.length);
    newBuf.set(buffer, 0);
    newBuf.set(chunk, buffer.length);
    let buf: Uint8Array = newBuf;

    let idx = 0;
    while (idx <= buf.length - 47) {
      if (buf[idx] === 0x54 && buf[idx + 1] === 0x2c) {
        const pkt = buf.subarray(idx, idx + 47);
        if (this.parsePacket(pkt)) {
          this.packetsCount++;
          idx += 47;
        } else {
          // CRC xato bo'lsa, noto'g'ri sinxro-baytdan keyingi baytdan qayta qidiramiz
          idx++;
        }
      } else {
        idx++;
      }
    }

    if (idx > 0) {
      buf = buf.subarray(idx);
    }
    if (buf.length > 2048) {
      buf = buf.subarray(buf.length - 1024);
    }

    const now = performance.now();
    if (now - lastEmitTimeRef.t >= 33) {
      lastEmitTimeRef.t = now;
      this.emitFrame(source);
    }
    return buf;
  }

  /**
   * Web Serial asinxron paket o'qish sikli (47 baytli STL-19P paketlari)
   */
  private async readLoop(): Promise<void> {
    let buffer: Uint8Array = new Uint8Array(0);
    const lastEmit = { t: performance.now() };

    try {
      while (this.isReading && this.port && this.port.readable) {
        this.reader = this.port.readable.getReader();

        try {
          while (this.isReading) {
            const { value, done } = await this.reader.read();
            if (done || !value) break;
            buffer = this.feedSerialChunk(buffer, value, lastEmit, 'serial');
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
    let buffer: Uint8Array = new Uint8Array(0);
    const lastEmit = { t: performance.now() };

    try {
      while (this.isReading && device.opened) {
        const endpoints = device.configuration?.interfaces?.[0]?.alternate?.endpoints || [];
        const inEndpoint = endpoints.find((ep: any) => ep.direction === 'in')?.endpointNumber || 1;

        const result = await device.transferIn(inEndpoint, 512);
        if (result.status !== 'ok' || !result.data || result.data.byteLength === 0) {
          continue;
        }

        const value = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
        buffer = this.feedSerialChunk(buffer, value, lastEmit, 'webusb');
      }
    } catch (err) {
      console.warn('[LiDAR WebUSB] O\'qish xatosi yoki port uzildi:', err);
    } finally {
      this.isReading = false;
    }
  }

  /**
   * 47-baytli STL-19P paketini CRC-8 tekshiruvi bilan dekodlash
   */
  private parsePacket(pkt: Uint8Array): boolean {
    if (calcCrc8(pkt, 46) !== pkt[46]) {
      this.crcErrorsCount++;
      return false;
    }

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
    const now = performance.now();

    for (let i = 0; i < 12; i++) {
      const offset = 6 + i * 3;
      const distMm = pkt[offset] | (pkt[offset + 1] << 8);
      const distM = distMm / 1000.0;
      const intensity = pkt[offset + 2];

      const angle = Math.round((startAngle + step * i) % 360.0);
      if (angle >= 0 && angle < 360) {
        this.pointUpdatedAt[angle] = now;
        if (distM >= 0.05 && distM <= 12.0) {
          this.distances[angle] = +distM.toFixed(3);
          this.intensities[angle] = intensity;
        } else {
          // Ochiq joy (>12m yoki 0mm): eski to'siq xotirada qolib ketmasligi uchun 0 ga tozalanadi
          this.distances[angle] = 0;
          this.intensities[angle] = 0;
        }
      }
    }
    return true;
  }

  /**
   * 360 graduslik ma'lumotlar va 4 sektor masofalarini chiqarish
   */
  private emitFrame(source: 'serial' | 'webusb' | 'websocket' | 'mqtt'): void {
    const now = performance.now();
    const points: LidarPoint[] = new Array(360);
    let minDist = 999;
    let minAngle = 0;

    for (let deg = 0; deg < 360; deg++) {
      // 600 ms dan eski nuqtalarni avtomatik tozalash
      if (this.pointUpdatedAt[deg] > 0 && now - this.pointUpdatedAt[deg] > 600) {
        this.distances[deg] = 0;
        this.intensities[deg] = 0;
      }
      const d = this.distances[deg] || 0.0;
      points[deg] = {
        angle: deg,
        distance: d,
        intensity: this.intensities[deg] || 0
      };
      if (d >= 0.06 && d < minDist) {
        minDist = d;
        minAngle = deg;
      }
    }

    const frontDistM = this.calcSectorDistance(335, 25);
    const rightDistM = this.calcSectorDistance(40, 120);
    const rearDistM = this.calcSectorDistance(145, 215);
    const leftDistM = this.calcSectorDistance(240, 320);

    const stopM = this.stopCm / 100;
    const frontCm = Math.round(frontDistM * 100);
    const isBlocked = frontDistM <= stopM;
    let evasion: 'CLEAR' | 'LEFT' | 'RIGHT' | 'REVERSE' = 'CLEAR';
    if (isBlocked) {
      const clearSideMin = Math.max(0.4, stopM - 0.05);
      if (leftDistM >= rightDistM && leftDistM > clearSideMin) evasion = 'LEFT';
      else if (rightDistM > leftDistM && rightDistM > clearSideMin) evasion = 'RIGHT';
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

    const frame: LidarFrameData = {
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
      crcErrors: this.crcErrorsCount
    };

    this.frameListeners.forEach((cb) => {
      try {
        cb(frame);
      } catch (_) {}
    });
  }

  /**
   * Sektor ichidagi eng yaqin xavfsiz masofa:
   * - Fon (5m) bilan o'rtachalanmaydi (aks holda ingichka ustun / oyoq ko'rinmay qoladi)
   * - Yagona tasodifiy shovqin nuqtasini filtrlash uchun kamida 2 ta qo'shni nur yoki ikkinchi eng kichik qiymat olinadi
   */
  private calcSectorDistance(startDeg: number, endDeg: number): number {
    const vals: number[] = [];

    const checkDeg = (deg: number) => {
      const d = this.distances[deg];
      // 0.18m (18 sm) dan kichik masofalar robotning o'z korpusi/ustuni/kabeli (Blind zone)
      if (d >= 0.18 && d < 12.0) {
        vals.push(d);
      }
    };

    if (startDeg > endDeg) {
      for (let i = startDeg; i < 360; i++) checkDeg(i);
      for (let i = 0; i <= endDeg; i++) checkDeg(i);
    } else {
      for (let i = startDeg; i <= endDeg; i++) checkDeg(i);
    }

    if (vals.length === 0) return 5.0;
    if (vals.length === 1) return vals[0] >= 0.25 ? +vals[0].toFixed(2) : 5.0;

    vals.sort((a, b) => a - b);
    // Agar eng yaqin ikki nuqta bir-biriga yaqin (haqiqiy ob'ekt) bo'lsa -> eng yaqinini qaytaramiz
    if (vals[1] - vals[0] <= 0.2) {
      return +vals[0].toFixed(2);
    }
    return +vals[1].toFixed(2);
  }
}

export const lidarSerialService = new LidarSerialService();
