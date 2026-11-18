/**
 * RTK GNSS Aloqa Servisi - QALQON Patrul Roboti
 * 
 * Server: https://trackk-gl6l.onrender.com/api.php?action=robot
 * Vazifalari:
 *  1. Har 500-1000 ms da serverdan santimetr aniqlikdagi RTK GNSS koordinatalarini oladi.
 *  2. Ma'lumotlarni navigationService (GPS Sensor Fusion) ga uzatadi.
 *  3. Operator veb-xaritadan belgilagan "target" koordinatalarini avtopilotga yetkazadi.
 *  4. Failsafe: aloqa 3 soniyadan ortiq uzilsa yoki is_online=false bo'lsa xabar beradi.
 */

import { navigationService } from './navigationService';
import { autopilotService } from './autopilotService';

export interface RtkTarget {
  target_lat: number;
  target_lng: number;
}

export interface RtkRobotData {
  status: string;
  is_online: boolean;
  age_sec: number;
  lat: number;
  lng: number;
  fix: number;
  fix_str: string;
  hdop: number;
  speed: number;
  alt?: number;
  sat?: number;
  target?: RtkTarget | null;
}

const RTK_API_URL = 'https://trackk-gl6l.onrender.com/api.php?action=robot';
const POLL_INTERVAL_MS = 600;
const FAILSAFE_TIMEOUT_MS = 3000;

class RtkGnssService {
  private active = false;
  private timer: number | null = null;
  private lastRxTime = 0;
  private lastData: RtkRobotData | null = null;
  private listeners = new Set<(data: RtkRobotData | null, connected: boolean) => void>();

  public start() {
    if (this.active) return;
    this.active = true;
    this.poll();
    this.timer = window.setInterval(() => this.poll(), POLL_INTERVAL_MS);
    console.log('[RTK GNSS] Aloqa servisi ishga tushdi:', RTK_API_URL);
  }

  public stop() {
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.notify();
    console.log('[RTK GNSS] Aloqa servisi to\'xtatildi');
  }

  public subscribe(cb: (data: RtkRobotData | null, connected: boolean) => void) {
    this.listeners.add(cb);
    cb(this.lastData, this.isConnected());
    return () => this.listeners.delete(cb);
  }

  public isConnected(): boolean {
    if (!this.active || !this.lastData) return false;
    const now = Date.now();
    return this.lastData.is_online && (now - this.lastRxTime < FAILSAFE_TIMEOUT_MS);
  }

  public getData(): RtkRobotData | null {
    return this.lastData;
  }

  private async poll() {
    try {
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 2500);

      const res = await fetch(RTK_API_URL, {
        signal: ctrl.signal,
        cache: 'no-store'
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data: RtkRobotData = await res.json();
      if (data && data.status === 'ok') {
        this.lastRxTime = Date.now();
        this.lastData = data;

        // 1. NavigationService ga santimetr aniqlikdagi GPS koordinatasini beramiz
        if (data.is_online && typeof data.lat === 'number' && typeof data.lng === 'number') {
          // RTK Fixed (fix=4) bo'lsa aniqlik ~0.02m (2 sm), aks holda hdop
          const accuracy = data.fix === 4 ? 0.02 : (data.hdop > 0 ? data.hdop : 2.5);
          
          navigationService.pushGps({
            lat: data.lat,
            lon: data.lng,
            accuracyM: accuracy,
            speedKmh: data.speed,
            courseDeg: null // Kurs navigationService ichida hisoblanadi
          });

          // 2. Agar serverda Target (maqsad) mavjud bo'lsa va avtopilot bo'sh bo'lsa
          if (data.target && typeof data.target.target_lat === 'number' && typeof data.target.target_lng === 'number') {
            if (!autopilotService.getState().active && data.target.target_lat !== 0) {
              console.log('[RTK GNSS] Yangi maqsad koordinatasi qabul qilindi:', data.target);
            }
          }
        }

        this.notify();
      }
    } catch (err) {
      // Aloqa uzilganda failsafe holatini tekshirish
      if (Date.now() - this.lastRxTime > FAILSAFE_TIMEOUT_MS) {
        this.notify();
      }
    }
  }

  private notify() {
    const conn = this.isConnected();
    for (const listener of this.listeners) {
      try {
        listener(this.lastData, conn);
      } catch (e) {
        console.error(e);
      }
    }
  }
}

export const rtkGnssService = new RtkGnssService();
