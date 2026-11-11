/**
 * QALQON v1.0 - ESP32 To'g'ridan-to'g'ri Wi-Fi Boshqaruv Xizmati
 * 
 * Ushbu xizmat planshet/telefon Hotspotiga ulangan ESP32 motor drayveri moduliga
 * harfli yo'nalish buyruqlari (F, B, L, R, G, I, H, J, S) va 360° analog joystik (X, Y)
 * koordinatalarini xavfsiz va tarmoqni to'ldirib yubormasdan (Throttled) uzatadi.
 */

import type { MecanumCommand } from '../types/robot';

const STORAGE_KEY_IP = 'qalqon_esp32_ip';
const STORAGE_KEY_ENABLED = 'qalqon_esp32_enabled';
const DEFAULT_ESP32_IP = 'http://192.168.43.50';

class ESP32Service {
  private baseIp: string = DEFAULT_ESP32_IP;
  private isEnabled: boolean = true;
  private lastJoystickTime: number = 0;
  private lastSentX: number = 0;
  private lastSentY: number = 0;
  private lastSentCmd: string = '';
  private throttleIntervalMs: number = 50; // ESP32 ni qotirib qo'ymaslik uchun 20Hz (50ms)
  private abortController: AbortController | null = null;

  constructor() {
    this.loadSettings();
  }

  private loadSettings() {
    try {
      const savedIp = localStorage.getItem(STORAGE_KEY_IP);
      if (savedIp) this.baseIp = savedIp;

      const savedEnabled = localStorage.getItem(STORAGE_KEY_ENABLED);
      if (savedEnabled !== null) this.isEnabled = savedEnabled === 'true';
    } catch {
      // localStorage xatosi bo'lsa default qiymatlar qoladi
    }
  }

  public getIp(): string {
    return this.baseIp;
  }

  public setIp(ip: string) {
    let cleanIp = ip.trim();
    if (!cleanIp.startsWith('http://') && !cleanIp.startsWith('https://')) {
      cleanIp = `http://${cleanIp}`;
    }
    // Oxiridagi slashni olib tashlaymiz
    if (cleanIp.endsWith('/')) {
      cleanIp = cleanIp.slice(0, -1);
    }
    this.baseIp = cleanIp;
    try {
      localStorage.setItem(STORAGE_KEY_IP, this.baseIp);
    } catch {}
  }

  public getEnabled(): boolean {
    return this.isEnabled;
  }

  public setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
    try {
      localStorage.setItem(STORAGE_KEY_ENABLED, String(enabled));
    } catch {}
  }

  /**
   * 1. Harfli buyruq yuborish (Strelkalar va maxsus tugmalar uchun: F, B, L, R, G, I, H, J, S)
   */
  public sendCommand(cmd: MecanumCommand) {
    if (!this.isEnabled) return;

    // Takroriy bir xil buyruqni qayta-qayta yubormaslik (STOP buyrug'i bundan mustasno)
    if (cmd !== 'S' && cmd === this.lastSentCmd) {
      return;
    }
    this.lastSentCmd = cmd;

    const url = `${this.baseIp}/move?dir=${cmd}`;
    this.dispatchRequest(url);
  }

  /**
   * 2. 360° Joystik koordinatalarini yuborish (X va Y: -100 dan +100 gacha)
   * HTTP Flooding (tarmoqni tiqilib qolishi) ning oldini olish uchun 50ms throttle qo'llaniladi.
   * Markazga qaytganda (0, 0) kechikishsiz DARHOL to'xtash signali yuboriladi.
   */
  public sendJoystick(rawX: number, rawY: number) {
    if (!this.isEnabled) return;

    // Koordinatalarni qat'iy -100 dan +100 gacha yaxlitlaymiz
    let x = Math.round(Math.max(-100, Math.min(100, rawX)));
    let y = Math.round(Math.max(-100, Math.min(100, rawY)));

    // Deadzone (kichik titrashlarni 0 deb hisoblash)
    if (Math.abs(x) < 5 && Math.abs(y) < 5) {
      x = 0;
      y = 0;
    }

    const isStop = (x === 0 && y === 0);
    const now = Date.now();

    // Agar o'zgarmagan bo'lsa yubormaymiz
    if (x === this.lastSentX && y === this.lastSentY) {
      return;
    }

    // Stop bo'lsa kechiktirmasdan darhol yuboramiz, harakatda esa 50ms oraliqni saqlaymiz
    if (!isStop && (now - this.lastJoystickTime < this.throttleIntervalMs)) {
      return;
    }

    this.lastJoystickTime = now;
    this.lastSentX = x;
    this.lastSentY = y;

    const url = `${this.baseIp}/move?x=${x}&y=${y}`;
    this.dispatchRequest(url);
  }

  /**
   * ESP32 ga no-cors va timeout nazorati bilan so'rov jo'natish
   */
  private dispatchRequest(url: string) {
    // Oldingi kutib turgan eski so'rovni bekor qilish (Navbat tiqilib qolmasligi uchun)
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {}
    }

    this.abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      try { this.abortController?.abort(); } catch {}
    }, 600); // 600ms timeout

    fetch(url, {
      method: 'GET',
      mode: 'no-cors', // ESP32 CORS xatosi bermasligi uchun
      cache: 'no-store',
      signal: this.abortController.signal
    })
      .catch(() => {
        // Tarmoq uzilsa yoki bekor qilinsa xatolik UI ni qotirmasligi uchun tinch o'tkaziladi
      })
      .finally(() => {
        clearTimeout(timeoutId);
      });
  }
}

export const esp32Service = new ESP32Service();
