/**
 * =============================================================================
 * QALQON — RTK GPS & TRACKK.ONRENDER.COM INTEGRATSIYA XIZMATI
 * =============================================================================
 * Ushbu xizmat https://trackk-gl6l.onrender.com/api.php serveridan real-vaqt
 * santimetrli RTK GNSS ma'lumotlarini (lat, lng, alt, sat, hdop, fix, speed)
 * o'qiydi va markaziy navigationService ga uzatadi.
 * =============================================================================
 */

import { navigationService } from './navigationService';
import { headingService } from './headingService';

export interface RtkGpsData {
  status: 'ok' | 'waiting' | 'error';
  is_online: boolean;
  age_ms: number;
  age_sec: number;
  lat: number;
  lng: number;
  fix: number; // 4 = RTK Fixed, 5 = RTK Float, 1 = GPS Fix, 2 = DGPS Fix, 0 = No Fix
  fix_str: string;
  sat: number;
  hdop: number;
  alt: number;
  speed: number;
  server_time: string;
  target?: { target_lat: number; target_lng: number; set_time: string } | null;
  lastFetchedAt: number;
  latencyMs: number;
}

const STORAGE_KEY_API_URL = 'qalqon.rtk_api_url.v1';
export const DEFAULT_TRACKK_API = 'https://trackk-gl6l.onrender.com/api.php';

class RtkGpsService {
  private apiUrl: string;
  private pollIntervalMs = 800; // Har 800 ms da yangilash
  private timer: any = null;
  private isRunning = false;
  private listeners = new Set<(data: RtkGpsData) => void>();

  private latestData: RtkGpsData = {
    status: 'waiting',
    is_online: false,
    age_ms: 999999,
    age_sec: 999,
    lat: 0,
    lng: 0,
    fix: 0,
    fix_str: 'Kutilmoqda...',
    sat: 0,
    hdop: 99.9,
    alt: 0,
    speed: 0,
    server_time: '',
    target: null,
    lastFetchedAt: 0,
    latencyMs: 0
  };

  constructor() {
    this.apiUrl = typeof window !== 'undefined'
      ? localStorage.getItem(STORAGE_KEY_API_URL) || DEFAULT_TRACKK_API
      : DEFAULT_TRACKK_API;
  }

  public getApiUrl(): string {
    return this.apiUrl;
  }

  public setApiUrl(url: string) {
    this.apiUrl = url.trim() || DEFAULT_TRACKK_API;
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_API_URL, this.apiUrl);
    }
    // Darhol yangi manzil bo'yicha so'rov
    this.fetchOnce();
  }

  public getData(): RtkGpsData {
    return this.latestData;
  }

  public subscribe(cb: (data: RtkGpsData) => void) {
    this.listeners.add(cb);
    cb(this.latestData);
    return () => {
      this.listeners.delete(cb);
    };
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.fetchOnce();
    this.timer = setInterval(() => this.fetchOnce(), this.pollIntervalMs);
  }

  public stop() {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Bitta so'rov orqali GPS ni yangilash
   */
  public async fetchOnce(): Promise<RtkGpsData | null> {
    const startT = performance.now();
    try {
      const sep = this.apiUrl.includes('?') ? '&' : '?';
      const url = `${this.apiUrl}${sep}action=robot&_=${Date.now()}`;
      const res = await fetch(url, { cache: 'no-store' });
      const latency = Math.round(performance.now() - startT);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const json = await res.json();
      const now = Date.now();

      if (json && json.status === 'ok' && isFinite(json.lat) && isFinite(json.lng)) {
        const lat = parseFloat(json.lat);
        const lng = parseFloat(json.lng);
        const fix = parseInt(json.fix) || 0;
        const hdop = parseFloat(json.hdop) || 1.0;
        const speed = parseFloat(json.speed) || 0;

        // RTK aniqligini metrda hisoblash
        // fix: 4 -> RTK FIXED (0.02 m / 2 sm)
        // fix: 5 -> RTK FLOAT (0.25 m / 25 sm)
        // fix: 1 -> Oddiy GPS (HDOP * 2.5 m)
        let accuracyM = 3.0;
        if (fix === 4) accuracyM = 0.02; // Santimetr aniqlik
        else if (fix === 5) accuracyM = 0.25;
        else if (hdop > 0) accuracyM = Math.max(1.0, +(hdop * 2.0).toFixed(2));

        this.latestData = {
          status: 'ok',
          is_online: !!json.is_online,
          age_ms: json.age_ms || 0,
          age_sec: json.age_sec || 0,
          lat,
          lng,
          fix,
          fix_str: json.fix_str || (fix === 4 ? 'RTK FIXED' : fix === 5 ? 'RTK FLOAT' : 'GPS FIX'),
          sat: parseInt(json.sat) || 0,
          hdop,
          alt: parseFloat(json.alt) || 0,
          speed,
          server_time: json.server_time || '',
          target: json.target || null,
          lastFetchedAt: now,
          latencyMs: latency
        };

        // Markaziy navigatsiya tizimiga uzatish
        navigationService.pushGps({
          lat,
          lon: lng,
          accuracyM,
          speedKmh: speed,
          courseDeg: null
        });

        if (speed > 1.0) {
          headingService.pushGps(null, speed);
        }
      } else {
        // Kutish yoki signal yo'q
        this.latestData = {
          ...this.latestData,
          status: 'waiting',
          is_online: false,
          latencyMs: latency,
          lastFetchedAt: now
        };
      }

      this.notify();
      return this.latestData;
    } catch (err: any) {
      this.latestData = {
        ...this.latestData,
        status: 'error',
        is_online: false,
        latencyMs: Math.round(performance.now() - startT),
        lastFetchedAt: Date.now()
      };
      this.notify();
      return null;
    }
  }

  /**
   * Robot uchun serverga maqsad koordinatasi yuborish
   */
  public async setTarget(lat: number, lng: number): Promise<boolean> {
    try {
      const sep = this.apiUrl.includes('?') ? '&' : '?';
      const url = `${this.apiUrl}${sep}action=set_target`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng })
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private notify() {
    this.listeners.forEach((cb) => cb(this.latestData));
  }
}

export const rtkGpsService = new RtkGpsService();
