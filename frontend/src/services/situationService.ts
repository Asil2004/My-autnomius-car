/**
 * Robotning joriy holati: vaqt, sana, GPS joylashuvi, manzil va ob-havo (real vaqtda yangilanadi va saqlanadi).
 *
 * - GPS: brauzer Geolocation API (watchPosition). Ruxsat bo'lmasa, oxirgi saqlangan nuqta yoki Navoiy markazi (taxminiy).
 * - Manzil: OpenStreetMap Nominatim teskari geokodlash (kalitsiz). Robot 80 m dan ko'p siljiganda, ko'pi bilan daqiqada bir marta.
 * - Ob-havo: Open-Meteo (kalitsiz). Har 15 daqiqada yoki 5 km dan ko'p siljiganda.
 * - Oxirgi holat va 10 daqiqalik tarix (200 ta yozuv) localStorage da: internet uzilsa ham oxirgi ma'lumot aytiladi.
 */

export interface GeoFix {
  lat: number;
  lon: number;
  accuracy: number | null;
  t: number;
  /** true: haqiqiy GPS; false: taxminiy (standart nuqta) */
  real: boolean;
}

export interface AddressInfo {
  /** Ovoz bilan aytiladigan qisqa manzil: "Navoiy shahri, Galaba ko'chasi 12" */
  short: string;
  city: string | null;
  district: string | null;
  road: string | null;
  t: number;
  lat: number;
  lon: number;
}

export interface WeatherInfo {
  temp: number;
  feels: number;
  humidity: number;
  wind: number;
  code: number;
  isDay: boolean;
  todayMax: number | null;
  todayMin: number | null;
  todayRain: number | null;
  tomorrowMax: number | null;
  tomorrowMin: number | null;
  tomorrowRain: number | null;
  tomorrowCode: number | null;
  t: number;
  lat: number;
  lon: number;
}

export interface Situation {
  fix: GeoFix | null;
  address: AddressInfo | null;
  weather: WeatherInfo | null;
  gpsError: string | null;
}

interface HistoryEntry {
  t: number;
  lat: number;
  lon: number;
  addr: string | null;
  temp: number | null;
}

const STORAGE_KEY = 'qalqon.situation.v1';
const HISTORY_KEY = 'qalqon.situationHistory.v1';
const HISTORY_MAX = 200;
const HISTORY_EVERY_MS = 10 * 60 * 1000;
// GPS bo'lmasa: Navoiy shahri markazi (RobotContext dagi boshlang'ich nuqta bilan bir xil)
const DEFAULT_FIX: GeoFix = { lat: 40.09985, lon: 65.36835, accuracy: null, t: 0, real: false };
const ADDRESS_MOVE_M = 80;
const ADDRESS_MIN_MS = 60 * 1000;
const WEATHER_EVERY_MS = 15 * 60 * 1000;
const WEATHER_MOVE_M = 5000;

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const WEEKDAYS = ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba'];

/** WMO ob-havo kodlari (Open-Meteo) -> o'zbekcha */
export function weatherText(code: number): string {
  if (code === 0) return 'ochiq, quyoshli';
  if (code === 1) return 'asosan ochiq';
  if (code === 2) return 'qisman bulutli';
  if (code === 3) return 'bulutli';
  if (code === 45 || code === 48) return 'tumanli';
  if (code >= 51 && code <= 57) return 'mayda yomg\'ir';
  if (code >= 61 && code <= 67) return code >= 65 ? 'kuchli yomg\'ir' : 'yomg\'irli';
  if (code >= 71 && code <= 77) return code >= 75 ? 'kuchli qor' : 'qorli';
  if (code >= 80 && code <= 82) return 'jala';
  if (code === 85 || code === 86) return 'qor bo\'roni';
  if (code >= 95) return 'momaqaldiroq';
  return 'o\'zgaruvchan';
}

function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Haroratni o'qishga qulay: "12 daraja issiq", "3 daraja sovuq", "0 daraja" */
function tempWords(v: number): string {
  const n = Math.round(v);
  if (n > 0) return `${n} daraja issiq`;
  if (n < 0) return `${-n} daraja sovuq`;
  return '0 daraja';
}

function hhmm(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function load(): Situation {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Situation;
      return { fix: s.fix ?? null, address: s.address ?? null, weather: s.weather ?? null, gpsError: null };
    }
  } catch {
    /* bo'sh */
  }
  return { fix: null, address: null, weather: null, gpsError: null };
}

class SituationService {
  private state: Situation = load();
  private listeners = new Set<(s: Situation) => void>();
  private watchId: number | null = null;
  private started = false;
  private addressBusy = false;
  private weatherBusy = false;
  private lastAddressTry = 0;
  private lastWeatherTry = 0;
  private timer: number | null = null;

  /** Kuzatishni boshlash (bir marta). Ilova ochilganda chaqiriladi */
  public start(): void {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;

    if ('geolocation' in navigator) {
      this.watchId = navigator.geolocation.watchPosition(
        (pos) => this.onFix({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy, t: Date.now(), real: true }),
        (err) => {
          this.state.gpsError =
            err.code === 1 ? "GPS ruxsati berilmagan" : err.code === 2 ? "GPS signali topilmadi" : "GPS javob bermadi";
          this.emit();
          // GPS bo'lmasa ham ob-havo oxirgi yoki standart nuqta bo'yicha olinadi
          void this.refresh();
        },
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 }
      );
    } else {
      this.state.gpsError = "Qurilmada GPS yo'q";
    }

    void this.refresh();
    // Ob-havo va manzilni davriy yangilash, tarixga yozish
    this.timer = window.setInterval(() => void this.refresh(), 60 * 1000);
    window.addEventListener('online', () => void this.refresh(true));
  }

  public stop(): void {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    if (this.timer !== null) window.clearInterval(this.timer);
    this.watchId = null;
    this.timer = null;
    this.started = false;
  }

  public get(): Situation {
    return this.state;
  }

  public subscribe(fn: (s: Situation) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  public getHistory(): HistoryEntry[] {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') as HistoryEntry[];
    } catch {
      return [];
    }
  }

  private onFix(fix: GeoFix) {
    this.state.fix = fix;
    this.state.gpsError = null;
    this.emit();
    void this.refresh();
  }

  /** Joriy nuqta: haqiqiy GPS, bo'lmasa oxirgi saqlangan, bo'lmasa Navoiy markazi */
  private point(): GeoFix {
    return this.state.fix ?? DEFAULT_FIX;
  }

  /** Manzil va ob-havoni kerak bo'lsa yangilash */
  public async refresh(force = false): Promise<void> {
    const p = this.point();
    const now = Date.now();
    const a = this.state.address;
    const needAddress =
      p.real &&
      (force || !a || distanceM(a.lat, a.lon, p.lat, p.lon) > ADDRESS_MOVE_M) &&
      now - this.lastAddressTry > ADDRESS_MIN_MS;
    const w = this.state.weather;
    const needWeather =
      (force || !w || now - w.t > WEATHER_EVERY_MS || distanceM(w.lat, w.lon, p.lat, p.lon) > WEATHER_MOVE_M) &&
      now - this.lastWeatherTry > ADDRESS_MIN_MS;

    await Promise.all([needAddress ? this.fetchAddress(p) : null, needWeather ? this.fetchWeather(p) : null]);
    this.appendHistory();
  }

  private async fetchAddress(p: GeoFix) {
    if (this.addressBusy) return;
    this.addressBusy = true;
    this.lastAddressTry = Date.now();
    try {
      const url =
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=uz` +
        `&lat=${p.lat.toFixed(6)}&lon=${p.lon.toFixed(6)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const j = (await res.json()) as { address?: Record<string, string>; display_name?: string };
      const ad = j.address ?? {};
      const city = ad.city || ad.town || ad.village || ad.hamlet || null;
      const district = ad.suburb || ad.neighbourhood || ad.quarter || ad.city_district || ad.county || null;
      const road = ad.road || ad.pedestrian || ad.footway || null;
      const house = ad.house_number || null;
      const parts = [
        city ? (/(shahri|shahar|tumani)$/i.test(city) ? city : `${city} shahri`) : ad.state || null,
        district && district !== city ? district : null,
        road ? `${road}${house ? ` ${house}` : ''}` : null
      ].filter(Boolean) as string[];
      this.state.address = {
        short: parts.join(', ') || (j.display_name ?? '').split(',').slice(0, 3).join(',').trim(),
        city,
        district,
        road,
        t: Date.now(),
        lat: p.lat,
        lon: p.lon
      };
      this.save();
      this.emit();
    } catch (err) {
      console.warn('[Holat] Manzil aniqlanmadi:', err);
    } finally {
      this.addressBusy = false;
    }
  }

  private async fetchWeather(p: GeoFix) {
    if (this.weatherBusy) return;
    this.weatherBusy = true;
    this.lastWeatherTry = Date.now();
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(4)}&longitude=${p.lon.toFixed(4)}` +
        `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
        `&timezone=auto&forecast_days=2&wind_speed_unit=ms`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const j = await res.json();
      const c = j.current ?? {};
      const d = j.daily ?? {};
      const at = (arr: unknown, i: number): number | null => (Array.isArray(arr) && typeof arr[i] === 'number' ? arr[i] : null);
      this.state.weather = {
        temp: c.temperature_2m,
        feels: c.apparent_temperature,
        humidity: c.relative_humidity_2m,
        wind: c.wind_speed_10m,
        code: c.weather_code,
        isDay: c.is_day === 1,
        todayMax: at(d.temperature_2m_max, 0),
        todayMin: at(d.temperature_2m_min, 0),
        todayRain: at(d.precipitation_probability_max, 0),
        tomorrowMax: at(d.temperature_2m_max, 1),
        tomorrowMin: at(d.temperature_2m_min, 1),
        tomorrowRain: at(d.precipitation_probability_max, 1),
        tomorrowCode: at(d.weather_code, 1),
        t: Date.now(),
        lat: p.lat,
        lon: p.lon
      };
      this.save();
      this.emit();
    } catch (err) {
      console.warn("[Holat] Ob-havo olinmadi:", err);
    } finally {
      this.weatherBusy = false;
    }
  }

  private appendHistory() {
    const h = this.getHistory();
    const last = h[h.length - 1];
    if (last && Date.now() - last.t < HISTORY_EVERY_MS) return;
    const p = this.point();
    // Manzil yoki ob-havo hali olinmagan bo'lsa, bo'sh yozuv qo'shmaymiz
    if (!this.state.weather && !(p.real && this.state.address)) return;
    h.push({
      t: Date.now(),
      lat: +p.lat.toFixed(5),
      lon: +p.lon.toFixed(5),
      addr: this.state.address?.short ?? null,
      temp: this.state.weather ? Math.round(this.state.weather.temp) : null
    });
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-HISTORY_MAX)));
    } catch {
      /* xotira yo'q */
    }
  }

  private save() {
    try {
      const { fix, address, weather } = this.state;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ fix, address, weather }));
    } catch {
      /* xotira yo'q */
    }
  }

  private emit() {
    const snap = { ...this.state };
    this.listeners.forEach((fn) => fn(snap));
  }

  // ---------------------------------------------------------------- Ovozli javoblar

  public timeAnswer(): string {
    return `Hozir soat ${hhmm(Date.now())}.`;
  }

  public dateText(d = new Date()): string {
    return `${d.getFullYear()}-yil ${d.getDate()}-${MONTHS[d.getMonth()]}, ${WEEKDAYS[d.getDay()]}`;
  }

  public dateAnswer(): string {
    return `Bugun ${this.dateText()}.`;
  }

  public weekdayAnswer(): string {
    return `Bugun ${WEEKDAYS[new Date().getDay()]}.`;
  }

  /** Joy nomi: "Navoiy shahri" yoki taxminiy */
  private placeName(): string {
    const a = this.state.address;
    if (a?.city) return /(shahri|shahar|tumani)$/i.test(a.city) ? a.city : `${a.city} shahri`;
    return this.state.fix?.real ? 'shu hudud' : 'Navoiy';
  }

  public weatherAnswer(tomorrow = false): string {
    const w = this.state.weather;
    if (!w) {
      return "Hozircha ob-havo ma'lumotini ololmadim. Internet ulanishini tekshirib ko'raman, birozdan keyin qayta so'rang.";
    }
    const age = Date.now() - w.t;
    const stale = age > 60 * 60 * 1000 ? ` Bu ma'lumot soat ${hhmm(w.t)} holatiga ko'ra.` : '';
    const place = this.placeName();
    if (tomorrow) {
      if (w.tomorrowMax === null || w.tomorrowMin === null) return "Ertangi ob-havo ma'lumoti hozircha yo'q.";
      const rain = w.tomorrowRain !== null && w.tomorrowRain >= 30 ? ` Yog'ingarchilik ehtimoli ${w.tomorrowRain} foiz.` : '';
      return (
        `Ertaga ${place}da ${w.tomorrowCode !== null ? weatherText(w.tomorrowCode) + ', ' : ''}` +
        `kunduzi ${tempWords(w.tomorrowMax)}, kechasi ${tempWords(w.tomorrowMin)} kutilmoqda.${rain}${stale}`
      );
    }
    const feels = Math.abs(Math.round(w.feels) - Math.round(w.temp)) >= 2 ? `, his qilinishi ${tempWords(w.feels)}` : '';
    const range =
      w.todayMax !== null && w.todayMin !== null
        ? ` Bugun eng yuqori ${tempWords(w.todayMax)}, eng past ${tempWords(w.todayMin)}.`
        : '';
    const rain = w.todayRain !== null && w.todayRain >= 30 ? ` Yog'ingarchilik ehtimoli ${w.todayRain} foiz.` : '';
    const advice =
      w.temp >= 35 ? " Ko'proq suv iching va soyada yuring." : w.temp <= 0 ? ' Issiq kiyining, yo\'llar sirpanchiq bo\'lishi mumkin.' : '';
    return (
      `Hozir ${place}da havo ${tempWords(w.temp)}, ${weatherText(w.code)}${feels}. ` +
      `Shamol sekundiga ${Math.round(w.wind)} metr.${range}${rain}${advice}${stale}`
    );
  }

  public locationAnswer(): string {
    const a = this.state.address;
    const fix = this.state.fix;
    if (a && fix?.real) {
      const age = Date.now() - a.t;
      const stale = age > 15 * 60 * 1000 ? ` Bu manzil soat ${hhmm(a.t)} da aniqlangan.` : '';
      return `Biz hozir ${a.short} yaqinidamiz.${stale}`;
    }
    if (fix?.real) {
      return `GPS bo'yicha koordinatamiz: shimoliy kenglik ${fix.lat.toFixed(4)}, sharqiy uzunlik ${fix.lon.toFixed(4)}. Ko'cha nomini hozircha aniqlay olmadim.`;
    }
    return `GPS ma'lumoti hozircha yo'q${this.state.gpsError ? ` (${this.state.gpsError})` : ''}. Men Navoiy shahrida patrul qilyapman. Aniq manzil kerak bo'lsa, atrofdagi bino yoki do'kon nomini ayting.`;
  }

  public coordsAnswer(): string {
    const fix = this.state.fix;
    if (!fix?.real) return this.locationAnswer();
    return `Koordinatalar: shimoliy kenglik ${fix.lat.toFixed(5)}, sharqiy uzunlik ${fix.lon.toFixed(5)}${fix.accuracy ? `, aniqlik ${Math.round(fix.accuracy)} metr` : ''}.`;
  }

  /** Gemini uchun qisqa holat matni */
  public contextForAi(): string {
    const parts = [`Hozir: ${this.dateText()}, soat ${hhmm(Date.now())}.`];
    if (this.state.address && this.state.fix?.real) parts.push(`Robot joylashuvi: ${this.state.address.short}.`);
    else parts.push('Robot joylashuvi: Navoiy shahri (GPS aniq emas).');
    const w = this.state.weather;
    if (w) parts.push(`Ob-havo (${hhmm(w.t)}): ${tempWords(w.temp)}, ${weatherText(w.code)}, shamol ${Math.round(w.wind)} m/s.`);
    return parts.join(' ');
  }
}

export const situationService = new SituationService();
