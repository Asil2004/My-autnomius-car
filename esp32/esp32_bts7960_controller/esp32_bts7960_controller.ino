/*
 * ==============================================================================
 * LOYIHA: «QALQON v1.0» / AVTONOM ROBOT PLATFORMASI
 * MIKROKONTROLLER: ESP32 (WROOM-32 / NodeMCU ESP32)
 * MOTOR DRAYVER: 2x BTS7960 (IBT-2 High-Power H-Bridge, 43A)
 * 
 * ALOQA TOPOLOGIYASI:
 * 1. Robot ustidagi Planshet o'zining "Kirish nuqtasi" (Wi-Fi Hotspot)ni yoqadi.
 *    Planshetning o'zida 4G/5G mobil interneti uzilmaydi va faol qoladi!
 * 2. Ushbu ESP32 planshetning Wi-Fi Hotspotiga Station (WIFI_STA) rejimida ulanadi.
 * 3. Planshet ESP32 ga lokal IP beradi (masalan: 192.168.43.50).
 * 4. Boshqaruv:
 *    A) Lokal rejim: Planshet yoki o'sha tarmoqdagi har qanday telefon brauzerida 
 *       http://<ESP32_IP>/ manzilini ochib to'g'ridan-to'g'ri boshqarish.
 *    B) Masofaviy Web rejim (Internet / MQTT / HTTP Relay): Saytdan kelgan buyruqlar
 *       /move?dir=F, /cmd?c=F yoki MQTT broker orqali bir zumda ijro etiladi.
 * 5. Failsafe (Xavfsizlik taymeri): Agar 800 ms davomida yangi harakat buyrug'i 
 *    kelmasa, motorlar avtomatik to'xtaydi (falokatlarning oldini olish uchun).
 * ==============================================================================
 */

#include <WiFi.h>
#include <WebServer.h>
#include <math.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

// ==============================================================================
// 0. MIGALKA (POLITSIYA STROBOSKOPI) RELESI
// ==============================================================================
// Migalka o'zining miltillash sxemasi bilan ishlaydi: ESP32 faqat rele orqali uning quvvatini yoqadi / o'chiradi.
// Ulanish (avval MPU-6050 giroskopi turgan joyga):
//   Rele VCC -> ESP32 3.3V   |   Rele GND -> ESP32 GND   |   Rele IN -> GPIO 21 (avvalgi giroskop SDA simi)
//   Migalka quvvati rele kontaktlari orqali: COM -> manba (+), NO -> migalka (+)  (NO: rele o'chiq bo'lsa migalka o'chiq)
#define STROBE_RELE_PIN 21
// Rele moduli qaysi signalda yoqiladi: HIGH (yuqori darajali modul) yoki LOW (past darajali, ko'p uchraydigan ko'k modullar).
// Agar migalka teskari ishlasa (o'chiq deganda yonib tursa) shu qiymatni LOW ga almashtiring.
#define RELE_YONIQ HIGH
#define RELE_OCHIQ (RELE_YONIQ == HIGH ? LOW : HIGH)

bool migalkaYoniq = false;

void migalka(bool yoniq) {
  migalkaYoniq = yoniq;
  digitalWrite(STROBE_RELE_PIN, yoniq ? RELE_YONIQ : RELE_OCHIQ);
  Serial.print("MIGALKA:");
  Serial.println(yoniq ? "ON" : "OFF");
}

void initMigalka() {
  // Avval "o'chiq" darajasini yozib, keyin chiqish qilamiz: yoqilganda migalka bir lahza ham yonib ketmasin
  digitalWrite(STROBE_RELE_PIN, RELE_OCHIQ);
  pinMode(STROBE_RELE_PIN, OUTPUT);
  migalkaYoniq = false;
}

// ==============================================================================
// 0.1 WAVESHARE LG290P GNSS RTK DATCHIGI VA TRACKK CLOUD HUB
// ==============================================================================
// Agar LG290P datchigi ESP32 ga 4 ta jumper sim bilan ulangan bo'lsa:
// VCC -> 5V (yoki VIN), GND -> GND, TXD -> GPIO 16 (RX2), RXD -> GPIO 17 (TX2)
// Bu holda robotga hech qanday USB kabel ulanishi shart emas!
#define ENABLE_HARDWARE_GPS 0
#define GPS_RX_PIN 16
#define GPS_TX_PIN 17
#define GPS_BAUD 115200

const char* TRACKK_POST_API = "https://trackk-gl6l.onrender.com/api.php";

double gpsLat = 0.0;
double gpsLng = 0.0;
float  gpsAlt = 0.0f;
float  gpsSpeed = 0.0f;
float  gpsHdop = 99.0f;
int    gpsFix = 0;
int    gpsSat = 0;
String gpsFixStr = "Kutilmoqda";
bool   gpsOnline = false;
unsigned long lastGpsPushTime = 0;
unsigned long lastGpsReadTime = 0;
String nmeaBuffer = "";

double parseNmeaCoord(String val, String hemi) {
  if (val.length() < 4) return 0.0;
  int dot = val.indexOf('.');
  if (dot < 2) return 0.0;
  double raw = val.toDouble();
  int deg = (int)(raw / 100);
  double min = raw - (deg * 100);
  double res = deg + (min / 60.0);
  if (hemi == "S" || hemi == "W") res = -res;
  return res;
}

void parseNmeaSentence(String sentence) {
  sentence.trim();
  if (sentence.startsWith("$GNGGA") || sentence.startsWith("$GPGGA")) {
    int idx = 0;
    String tokens[15];
    int start = 0;
    for (int i = 0; i < sentence.length() && idx < 15; i++) {
      if (sentence.charAt(i) == ',') {
        tokens[idx++] = sentence.substring(start, i);
        start = i + 1;
      }
    }
    if (idx < 15) tokens[idx++] = sentence.substring(start);

    if (idx >= 10 && tokens[2].length() > 0 && tokens[4].length() > 0) {
      gpsLat = parseNmeaCoord(tokens[2], tokens[3]);
      gpsLng = parseNmeaCoord(tokens[4], tokens[5]);
      gpsFix = tokens[6].toInt();
      gpsSat = tokens[7].toInt();
      gpsHdop = tokens[8].toFloat();
      gpsAlt = tokens[9].toFloat();
      gpsFixStr = (gpsFix == 4) ? "RTK FIXED (2 sm)" : (gpsFix == 5) ? "RTK FLOAT (20 sm)" : (gpsFix == 1) ? "GPS 3D" : (gpsFix == 2) ? "DGPS" : "NO FIX";
      gpsOnline = true;
      lastGpsReadTime = millis();
    }
  } else if (sentence.startsWith("$GNRMC") || sentence.startsWith("$GPRMC")) {
    int idx = 0;
    String tokens[12];
    int start = 0;
    for (int i = 0; i < sentence.length() && idx < 12; i++) {
      if (sentence.charAt(i) == ',') {
        tokens[idx++] = sentence.substring(start, i);
        start = i + 1;
      }
    }
    if (idx < 12) tokens[idx++] = sentence.substring(start);

    if (idx >= 8 && tokens[7].length() > 0) {
      gpsSpeed = tokens[7].toFloat() * 1.852f; // Knots -> km/h
    }
  }
}

void yangilashGpsHardware() {
#if ENABLE_HARDWARE_GPS
  while (Serial2.available() > 0) {
    char c = (char)Serial2.read();
    if (c == '\n' || c == '\r') {
      if (nmeaBuffer.length() > 5) {
        parseNmeaSentence(nmeaBuffer);
      }
      nmeaBuffer = "";
    } else {
      if (nmeaBuffer.length() < 120) {
        nmeaBuffer += c;
      }
    }
  }

  // Har 400 ms da Trackk Cloud Hub serveriga uzatish (agar Wi-Fi ulangan va koordinata olingan bo'lsa)
  unsigned long now = millis();
  if (gpsOnline && (now - lastGpsPushTime >= 400) && (WiFi.status() == WL_CONNECTED)) {
    lastGpsPushTime = now;
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;
    if (http.begin(client, TRACKK_POST_API)) {
      http.setTimeout(1200);
      http.addHeader("Content-Type", "application/json");
      http.addHeader("User-Agent", "QalqonESP32-LG290P");

      char payload[256];
      snprintf(payload, sizeof(payload),
        "{\"lat\":%.8f,\"lng\":%.8f,\"fix\":%d,\"fix_str\":\"%s\",\"sat\":%d,\"hdop\":%.2f,\"alt\":%.1f,\"speed\":%.1f}",
        gpsLat, gpsLng, gpsFix, gpsFixStr.c_str(), gpsSat, gpsHdop, gpsAlt, gpsSpeed
      );

      http.POST(payload);
      http.end();
    }
  }
#endif
}

// ==============================================================================
// 1. MASOFAVIY INTERNET BOSHQARUV (MQTT BULUT) TANLOVI
// ==============================================================================
// Agar Internet orqali (boshqa telefondan) boshqarmoqchi bo'lsangiz: 1 qoldiring.
// Buning uchun Arduino IDE da "PubSubClient" kutubxonasi o'rnatilgan bo'lishi kerak.
// Agar faqat lokal Wi-Fi (HTTP) orqali ishlatmoqchi bo'lsangiz: 0 qiling.
#define ENABLE_MQTT 1

#if ENABLE_MQTT
#include <PubSubClient.h>
WiFiClient espClient;
PubSubClient mqttClient(espClient);
const char* mqttServer          = "broker.hivemq.com";       // Ochiq bepul IoT broker
const int   mqttPort            = 1883;
const char* mqttTopic           = "qalqon/robot/cmd";        // Masofaviy buyruqlar mavzusi
const char* mqttTelemetryTopic  = "qalqon/robot/telemetry";  // Robot telemetriyasi (IMU, tezlik, holat)
unsigned long oxirgiTelemetryVaqti = 0;
#endif

// ==============================================================================
// 1. WI-FI SOZLAMALARI (PLANSHET HOTSPOT MA'LUMOTLARI)
// ==============================================================================
// Planshetingizda "Kirish nuqtasi" (Tochka dostupa / Hotspot) nomi va parolini kiriting:
const char* ssid     = "qalqon1";   // Planshet Hotspot nomi
const char* password = "12345679";         // Planshet Hotspot paroli (kamida 8 belgi)

// WebServer porti (Standart HTTP - 80)
WebServer server(80);

// ==============================================================================
// 2. BTS7960 (IBT-2) MOTOR DRAYVER PINLARI
// ==============================================================================
// 1-IBT-2 (Chap tomondagi motorlar)
const int chapOldinga_RPWM = 25;
const int chapOrqaga_LPWM  = 26;

// 2-IBT-2 (O'ng tomondagi motorlar)
const int ongOldinga_RPWM  = 27;
const int ongOrqaga_LPWM   = 14;

// DIQQAT: BTS7960 drayverlaridagi R_EN va L_EN pinlarini 
// ESP32 ning 3.3V yoki 5V piniga ulab qo'yish kerak (Drayver doim yoqiq turishi uchun)!

// ==============================================================================
// 3. TEZLIK VA XAVFSIZLIK SOZLAMALARI
// ==============================================================================
int tezlik = 255;                          // Boshlang'ich tezlik (0 - 255)
unsigned long oxirgiBuyruqVaqti = 0;       // Xavfsizlik taymeri uchun vaqt
const unsigned long TIMEOUT_MS = 800;      // 800 ms signal kelmasa avtotormoz
bool harakatda = false;                    // Motorlar aylanayotganini tekshirish

// ==============================================================================
// 4. MOTORLARNI BOSHQARISH FUNKSIYALARI
// ==============================================================================

void oldingaYur(int chapKuch, int ongKuch) {
  analogWrite(chapOldinga_RPWM, constrain(chapKuch, 0, 255));
  analogWrite(chapOrqaga_LPWM, 0);
  analogWrite(ongOldinga_RPWM, constrain(ongKuch, 0, 255));
  analogWrite(ongOrqaga_LPWM, 0);
  harakatda = true;
  oxirgiBuyruqVaqti = millis();
}

void orqagaYur(int chapKuch, int ongKuch) {
  analogWrite(chapOldinga_RPWM, 0);
  analogWrite(chapOrqaga_LPWM, constrain(chapKuch, 0, 255));
  analogWrite(ongOldinga_RPWM, 0);
  analogWrite(ongOrqaga_LPWM, constrain(ongKuch, 0, 255));
  harakatda = true;
  oxirgiBuyruqVaqti = millis();
}

void joyidaChapga(int chapOrqaKuch, int ongOldinKuch) {
  analogWrite(chapOldinga_RPWM, 0);
  analogWrite(chapOrqaga_LPWM, constrain(chapOrqaKuch, 0, 255));
  analogWrite(ongOldinga_RPWM, constrain(ongOldinKuch, 0, 255));
  analogWrite(ongOrqaga_LPWM, 0);
  harakatda = true;
  oxirgiBuyruqVaqti = millis();
}

void joyidaOngga(int chapOldinKuch, int ongOrqaKuch) {
  analogWrite(chapOldinga_RPWM, constrain(chapOldinKuch, 0, 255));
  analogWrite(chapOrqaga_LPWM, 0);
  analogWrite(ongOldinga_RPWM, 0);
  analogWrite(ongOrqaga_LPWM, constrain(ongOrqaKuch, 0, 255));
  harakatda = true;
  oxirgiBuyruqVaqti = millis();
}

void toxta() {
  analogWrite(chapOldinga_RPWM, 0);
  analogWrite(chapOrqaga_LPWM, 0);
  analogWrite(ongOldinga_RPWM, 0);
  analogWrite(ongOrqaga_LPWM, 0);
  harakatda = false;
}

// Silliq burilish nisbati (ichki g'ildiraklar kuchi, 50% sekinroq)
// 4 ta DC motorli skid-steer shassilarda notekis joylarda motorlar qotib (stall) qolmasligi uchun
int burilishNisbati = 50; // %

// Barcha buyruqlarni qayta ishlovchi markaziy funksiya
void buyruqniBajar(char xarf) {
  int yarimKuch = (tezlik * burilishNisbati) / 100;

  switch (xarf) {
    case 'F': oldingaYur(tezlik, tezlik); break;        // To'g'ri oldinga (100% / 100%)
    case 'B': orqagaYur(tezlik, tezlik); break;         // To'g'ri orqaga (100% / 100%)
    case 'L': joyidaChapga(yarimKuch, tezlik); break;   // Tank chapga: chap 50% orqaga, o'ng 100% oldinga
    case 'R': joyidaOngga(tezlik, yarimKuch); break;    // Tank o'ngga: chap 100% oldinga, o'ng 50% orqaga
    case 'G':
    case 'Q': oldingaYur(yarimKuch, tezlik); break;     // Oldinga-chapga yoy: chap 50% oldinga, o'ng 100% oldinga
    case 'I':
    case 'E': oldingaYur(tezlik, yarimKuch); break;     // Oldinga-o'ngga yoy: chap 100% oldinga, o'ng 50% oldinga
    case 'H': orqagaYur(yarimKuch, tezlik); break;      // Orqaga-chapga: chap 50% orqaga, o'ng 100% orqaga
    case 'J': orqagaYur(tezlik, yarimKuch); break;      // Orqaga-o'ngga: chap 100% orqaga, o'ng 50% orqaga
    case 'S': toxta(); break;                           // To'xtash
    case '1': tezlik = 130; break;                      // 1-tezlik (sekin)
    case '2': tezlik = 190; break;                      // 2-tezlik (o'rtacha)
    case '3': tezlik = 255; break;                      // 3-tezlik (maksimal)
    default:  toxta(); break;
  }
  Serial.print("ACK:");
  Serial.println(xarf);
}

/**
 * Matnli buyruq (MQTT, HTTP /move?dir=..., USB Serial): so'z yoki bitta harf.
 *   STROBE_ON / MIGALKA_ON   -> migalka yonadi
 *   STROBE_OFF / MIGALKA_OFF -> migalka o'chadi
 *   STROBE / MIGALKA         -> almashtiradi
 *   F, B, L, R, S, 1, 2, 3 ... -> harakat (buyruqniBajar)
 * Noma'lum so'zlar (masalan LIGHT_ON, HORN_ON) E'TIBORSIZ qoldiriladi: avval ularning faqat birinchi harfi olinib,
 * robot kutilmaganda burilib ketardi ("LIGHT_ON" -> 'L' chapga, "HORN_ON" -> 'H' orqaga-chapga).
 */
bool matnliBuyruq(String msg) {
  msg.trim();
  msg.toUpperCase();
  if (msg.length() == 0) return false;
  if (msg == "STROBE_ON" || msg == "MIGALKA_ON") migalka(true);
  else if (msg == "STROBE_OFF" || msg == "MIGALKA_OFF") migalka(false);
  else if (msg == "STROBE" || msg == "MIGALKA") migalka(!migalkaYoniq);
  else if (msg.length() == 1) {
    buyruqniBajar(msg.charAt(0));
    return true;
  } else {
    Serial.print("NOMALUM:");
    Serial.println(msg);
    return false;
  }
  Serial.print("ACK:");
  Serial.println(msg);
  return true;
}

/**
 * USB Serial (Raspberry Pi) dan kelgan qism: Pi harflarni qator oxirisiz yuboradi, shuning uchun ketma-ket kelgan
 * harflar birikib qolishi mumkin ("2F"). Ma'lum so'z bo'lsa so'z sifatida; faqat harakat harflaridan iborat bo'lsa har biri
 * alohida; boshqa narsa (masalan "LIGHT_ON") e'tiborsiz.
 */
void serialBuyruq(String s) {
  s.trim();
  s.toUpperCase();
  if (s.length() <= 1 || s.startsWith("STROBE") || s.startsWith("MIGALKA")) {
    matnliBuyruq(s);
    return;
  }
  const char* harflar = "FBLRGQIEHJS123";
  for (unsigned int i = 0; i < s.length(); i++) {
    if (!strchr(harflar, s.charAt(i))) {
      Serial.print("NOMALUM:");
      Serial.println(s);
      return;
    }
  }
  for (unsigned int i = 0; i < s.length(); i++) buyruqniBajar(s.charAt(i));
}

// ==============================================================================
// 5. O'RNATILGAN BOSHQARUV VEB-SAHIFASI (HTML + CSS + JAVASCRIPT)
// ==============================================================================
const char index_html[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Qalqon Robot Control</title>
  <style>
    * {
      box-sizing: border-box;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
    }
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #0f172a;
      color: #f8fafc;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    /* Yuqori panel */
    .header {
      background: linear-gradient(135deg, #0d9488, #115e59);
      color: white;
      height: 52px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      font-size: 18px;
      font-weight: 600;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .status-badge {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 12px;
      background: rgba(255,255,255,0.2);
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 18px;
    }
    /* Asosiy 3 ustunli qism */
    .main {
      flex: 1;
      display: grid;
      grid-template-columns: 1.2fr 1fr 1.2fr;
      gap: 16px;
      padding: 16px;
      height: calc(100vh - 52px);
      max-width: 900px;
      margin: 0 auto;
      width: 100%;
    }
    /* Chap va O'ng ustunlar */
    .left-col, .right-col {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    /* Katta boshqaruv tugmalari */
    .ctrl-btn {
      flex: 1;
      background: #1e293b;
      border: 2px solid #334155;
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 6px 14px rgba(0,0,0,0.4);
      touch-action: none;
      transition: all 0.1s ease;
      cursor: pointer;
    }
    .ctrl-btn:active, .ctrl-btn.active {
      background: #0d9488;
      border-color: #14b8a6;
      transform: scale(0.96);
      box-shadow: 0 0 20px rgba(20, 184, 166, 0.6);
    }
    .ctrl-btn svg {
      width: 64px;
      height: 64px;
      fill: #f8fafc;
    }
    /* O'rta ustun */
    .center-col {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
    }
    .speed-box {
      width: 100%;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 12px;
      text-align: center;
    }
    .speed-title {
      font-size: 13px;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }
    .speed-val {
      font-size: 22px;
      font-weight: 700;
      color: #14b8a6;
    }
    input[type=range] {
      width: 100%;
      margin-top: 10px;
      accent-color: #14b8a6;
      height: 6px;
      cursor: pointer;
    }
    /* Markaziy to'xtatish doirasi */
    .car-circle {
      width: 90px;
      height: 90px;
      border-radius: 50%;
      background: radial-gradient(circle, #334155 30%, #1e293b 100%);
      border: 3px solid #ef4444;
      box-shadow: 0 4px 16px rgba(239, 68, 68, 0.3);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: transform 0.15s ease;
    }
    .car-circle:active {
      transform: scale(0.92);
      background: #ef4444;
    }
    .car-circle svg {
      width: 40px;
      height: 40px;
      fill: #f8fafc;
    }
    .car-circle span {
      font-size: 10px;
      font-weight: 700;
      color: #ef4444;
      margin-top: 2px;
    }
    .car-circle:active span {
      color: #fff;
    }
    /* Qo'shimcha tugmalar (Signal / Fara) */
    .aux-row {
      display: flex;
      gap: 14px;
      width: 100%;
      justify-content: center;
    }
    .aux-btn {
      width: 52px;
      height: 52px;
      border-radius: 12px;
      background: #1e293b;
      border: 1px solid #334155;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .aux-btn:active {
      background: #334155;
      transform: scale(0.95);
    }
    .aux-btn svg {
      width: 24px;
      height: 24px;
      fill: #94a3b8;
    }
    /* Migalka (politsiya stroboskopi) tugmasi */
    .strobe-btn {
      width: 100%;
      background: #1e293b;
      border: 1px solid #475569;
      color: #f8fafc;
      border-radius: 12px;
      padding: 10px;
      font-size: 13px;
      font-weight: 800;
      cursor: pointer;
    }
    .strobe-btn.on {
      background: linear-gradient(90deg, #dc2626, #2563eb);
      border-color: #f8fafc;
    }
    .deg {
      font-size: 13px;
      color: #94a3b8;
    }
  </style>
</head>
<body>

  <div class="header">
    <div class="header-left">
      <span>🛡️ QALQON</span>
      <span class="status-badge" id="pingBadge">ONLINE</span>
    </div>
    <div class="header-right">
      <span id="connIcon">📶</span>
      <span>⚡ ESP32</span>
    </div>
  </div>

  <div class="main">
    <!-- Chap ustun: Oldinga va Orqaga -->
    <div class="left-col">
      <div class="ctrl-btn" id="btnU" data-cmd="F">
        <svg viewBox="0 0 24 24"><path d="M12 3L4 20l8-4 8 4z"/></svg>
      </div>
      <div class="ctrl-btn" id="btnD" data-cmd="B">
        <svg viewBox="0 0 24 24"><path d="M12 21L4 4l8 4 8-4z"/></svg>
      </div>
    </div>

    <!-- O'rta ustun: Tezlik, IMU, Stop, Qo'shimchalar -->
    <div class="center-col">
      <div class="speed-box">
        <div class="speed-title">Tezlik</div>
        <div class="speed-val"><span id="spdTxt">100</span>%</div>
        <input type="range" min="20" max="100" value="100" id="spdRange" oninput="changeSpeed(this.value)">
      </div>

      <!-- Migalka (politsiya stroboskopi) -->
      <button type="button" id="strobeBtn" class="strobe-btn" onclick="toggleStrobe()">рџљЁ MIGALKA</button>

      <div class="car-circle" onclick="sendCmd('S')">
        <svg viewBox="0 0 24 24">
          <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>
        </svg>
        <span>STOP</span>
      </div>

      <div class="aux-row">
        <div class="aux-btn" onclick="sendCmd('HORN')">
          <svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
        </div>
        <div class="aux-btn" onclick="sendCmd('LIGHT')">
          <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H7c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.04-.42 1.99-1.07 2.75z"/></svg>
        </div>
      </div>
    </div>

    <!-- O'ng ustun: Chapga va O'ngga -->
    <div class="right-col">
      <div class="ctrl-btn" id="btnL" data-cmd="L">
        <svg viewBox="0 0 24 24" style="transform: rotate(-90deg);"><path d="M12 3L4 20l8-4 8 4z"/></svg>
      </div>
      <div class="ctrl-btn" id="btnR" data-cmd="R">
        <svg viewBox="0 0 24 24" style="transform: rotate(90deg);"><path d="M12 3L4 20l8-4 8 4z"/></svg>
      </div>
    </div>
  </div>

  <script>
    let heartbeatTimer = null;
    let currentCmd = 'S';

    function sendCmd(cmd) {
      currentCmd = cmd;
      fetch('/move?dir=' + cmd).catch(e => console.warn('Signal yuborishda xato:', e));
    }

    function changeSpeed(val) {
      document.getElementById('spdTxt').innerText = val;
      const pwm = Math.round((val / 100) * 255);
      fetch('/speed?val=' + pwm).catch(e => console.warn(e));
    }

    // Migalka (politsiya stroboskopi) relesi
    function refreshStrobe() {
      fetch('/status').then(r => r.json()).then(d => {
        const b = document.getElementById('strobeBtn');
        if (b) { b.classList.toggle('on', !!d.strobe); b.innerText = d.strobe ? 'рџљЁ MIGALKA YONIQ' : 'рџљЁ MIGALKA'; }
      }).catch(() => {});
    }
    function toggleStrobe() {
      const on = !document.getElementById('strobeBtn').classList.contains('on');
      fetch('/move?dir=' + (on ? 'STROBE_ON' : 'STROBE_OFF')).then(refreshStrobe).catch(() => {});
    }
    setInterval(refreshStrobe, 1500);
    refreshStrobe();

    // Bosib turganda uzluksiz yuborish (Keep-alive)
    function startMovement(cmd, btnElem) {
      btnElem.classList.add('active');
      sendCmd(cmd);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (currentCmd !== 'S') {
          sendCmd(currentCmd);
        }
      }, 300);
    }

    function stopMovement(btnElem) {
      if (btnElem) btnElem.classList.remove('active');
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      sendCmd('S');
    }

    // Tugmalarga hodisalarni ulash
    document.querySelectorAll('.ctrl-btn').forEach(btn => {
      const cmd = btn.getAttribute('data-cmd');
      
      // Touch (Sensor ekranlar uchun)
      btn.addEventListener('touchstart', (e) => { e.preventDefault(); startMovement(cmd, btn); }, {passive: false});
      btn.addEventListener('touchend', (e) => { e.preventDefault(); stopMovement(btn); }, {passive: false});
      btn.addEventListener('touchcancel', (e) => { e.preventDefault(); stopMovement(btn); }, {passive: false});
      
      // Sichqoncha (Kompyuter / Noutbuk uchun)
      btn.addEventListener('mousedown', (e) => { startMovement(cmd, btn); });
      btn.addEventListener('mouseup', (e) => { stopMovement(btn); });
      btn.addEventListener('mouseleave', (e) => { if (btn.classList.contains('active')) stopMovement(btn); });
    });

    // Klaviatura tugmalari (W, A, S, D, ArrowKeys)
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') startMovement('F', document.getElementById('btnU'));
      else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') startMovement('B', document.getElementById('btnD'));
      else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') startMovement('L', document.getElementById('btnL'));
      else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') startMovement('R', document.getElementById('btnR'));
      else if (e.key === ' ') stopMovement(null);
    });

    window.addEventListener('keyup', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'W', 's', 'S', 'a', 'A', 'd', 'D'].includes(e.key)) {
        stopMovement(document.getElementById('btnU'));
        stopMovement(document.getElementById('btnD'));
        stopMovement(document.getElementById('btnL'));
        stopMovement(document.getElementById('btnR'));
      }
    });
  </script>
</body>
</html>
)rawliteral";

// ==============================================================================
// 6. WEBSERVER ROUTE HANDLERLARI (HTTP SO'ROV QABUL QILISH)
// ==============================================================================

// Bosh sahifa
void handleRoot() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send_P(200, "text/html", index_html);
}

// Harakat buyrug'i: /move?dir=F, /move?x=0&y=100, /cmd?c=F yoki /cmd?speed=3
void handleMove() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  
  // Agar /cmd orqali tezlik yuborilgan bo'lsa
  if (server.hasArg("speed")) {
    int v = server.arg("speed").toInt();
    if (v == 1) tezlik = 130;
    else if (v == 2) tezlik = 190;
    else if (v == 3) tezlik = 255;
    else tezlik = constrain(v, 0, 255);
    server.send(200, "application/json", "{\"status\":\"ok\",\"speed\":" + String(tezlik) + "}");
    return;
  }

  // 360° analog joystik koordinatalari: /move?x=-100..100&y=-100..100
  if (server.hasArg("x") && server.hasArg("y")) {
    int jx = constrain(server.arg("x").toInt(), -100, 100);
    int jy = constrain(server.arg("y").toInt(), -100, 100);
    if (abs(jx) < 5 && abs(jy) < 5) {
      toxta();
      server.send(200, "application/json", "{\"status\":\"ok\",\"cmd\":\"S\"}");
      return;
    }

    float mag = constrain(sqrt((float)(jx * jx + jy * jy)) / 100.0f, 0.0f, 1.0f);
    int baseKuch = (int)(tezlik * mag);

    if (abs(jy) < 20 && abs(jx) > abs(jy)) {
      int yarimKuch = (baseKuch * burilishNisbati) / 100;
      if (jx < 0) {
        joyidaChapga(yarimKuch, baseKuch);
      } else {
        joyidaOngga(baseKuch, yarimKuch);
      }
      server.send(200, "application/json", "{\"status\":\"ok\",\"x\":" + String(jx) + ",\"y\":" + String(jy) + "}");
      return;
    }

    float turnRatio = abs(jx) / 100.0f;
    float maxKamayish = (100 - burilishNisbati) / 100.0f;

    int chapKuch = baseKuch;
    int ongKuch = baseKuch;
    if (jx < 0) {
      chapKuch = (int)(baseKuch * (1.0f - turnRatio * maxKamayish));
    } else if (jx > 0) {
      ongKuch = (int)(baseKuch * (1.0f - turnRatio * maxKamayish));
    }

    if (jy < -15) {
      orqagaYur(chapKuch, ongKuch);
    } else {
      oldingaYur(chapKuch, ongKuch);
    }
    server.send(200, "application/json", "{\"status\":\"ok\",\"x\":" + String(jx) + ",\"y\":" + String(jy) + "}");
    return;
  }

  String cmdStr = "";
  if (server.hasArg("dir")) cmdStr = server.arg("dir");
  else if (server.hasArg("c")) cmdStr = server.arg("c");

  if (cmdStr.length() > 0) {
    bool ok = matnliBuyruq(cmdStr);
    server.send(ok ? 200 : 400, "application/json",
                String("{\"status\":\"") + (ok ? "ok" : "unknown") + "\",\"cmd\":\"" + cmdStr + "\",\"strobe\":" + (migalkaYoniq ? "true" : "false") + "}");
  } else {
    server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Missing 'dir', 'c' or 'x'/'y' argument\"}");
  }
}

// Tezlikni o'zgartirish: /speed?val=200 yoki /speed?speed=255
void handleSpeed() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  
  int v = -1;
  if (server.hasArg("val")) v = server.arg("val").toInt();
  else if (server.hasArg("speed")) v = server.arg("speed").toInt();

  if (v >= 0) {
    if (v == 1) tezlik = 130;
    else if (v == 2) tezlik = 190;
    else if (v == 3) tezlik = 255;
    else tezlik = constrain(v, 0, 255);
    server.send(200, "application/json", "{\"status\":\"ok\",\"speed\":" + String(tezlik) + "}");
  } else {
    server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Missing 'val' or 'speed' argument\"}");
  }
}

// Robot holati: /status
void handleStatus() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  String json = "{";
  json += "\"status\":\"online\",";
  json += "\"moving\":" + String(harakatda ? "true" : "false") + ",";
  json += "\"speed\":" + String(tezlik) + ",";
  json += "\"strobe\":" + String(migalkaYoniq ? "true" : "false") + ",";
  json += "\"ip\":\"" + WiFi.localIP().toString() + "\",";
  json += "\"rssi\":" + String(WiFi.RSSI());
  json += "}";
  server.send(200, "application/json", json);
}

// Migalka: /strobe?on=1 | /strobe?on=0 | /strobe (almashtirish)
void handleStrobe() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  if (server.hasArg("on")) migalka(server.arg("on") == "1" || server.arg("on").equalsIgnoreCase("true"));
  else migalka(!migalkaYoniq);
  server.send(200, "application/json", String("{\"status\":\"ok\",\"strobe\":") + (migalkaYoniq ? "true" : "false") + "}");
}

// RTK GNSS ma'lumotlarini JSON qilib berish: /gps
void handleGps() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  char buf[300];
  snprintf(buf, sizeof(buf),
    "{\"status\":\"ok\",\"is_online\":%s,\"lat\":%.8f,\"lng\":%.8f,\"fix\":%d,\"fix_str\":\"%s\",\"sat\":%d,\"hdop\":%.2f,\"alt\":%.1f,\"speed\":%.1f}",
    gpsOnline ? "true" : "false", gpsLat, gpsLng, gpsFix, gpsFixStr.c_str(), gpsSat, gpsHdop, gpsAlt, gpsSpeed
  );
  server.send(200, "application/json", buf);
}

// Topilmagan sahifa (404)
void handleNotFound() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(404, "text/plain", "Not Found");
}

// ==============================================================================
// 7. MQTT CALLBACK VA RECONNECT (INTERNET ORQALI BOSHQARUV)
// ==============================================================================
#if ENABLE_MQTT
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) {
    msg += (char)payload[i];
  }
  msg.trim();

  // Joystik analog koordinatalari (masalan: "J:50,-80")
  if (msg.startsWith("J:")) {
    int comma = msg.indexOf(',');
    if (comma > 2) {
      int jx = constrain(msg.substring(2, comma).toInt(), -100, 100);
      int jy = constrain(msg.substring(comma + 1).toInt(), -100, 100);
      if (abs(jx) < 5 && abs(jy) < 5) {
        toxta();
      } else {
        float mag = constrain(sqrt((float)(jx * jx + jy * jy)) / 100.0f, 0.0f, 1.0f);
        int baseKuch = (int)(tezlik * mag);
        if (abs(jy) < 20 && abs(jx) > abs(jy)) {
          int yarimKuch = (baseKuch * burilishNisbati) / 100;
          if (jx < 0) joyidaChapga(yarimKuch, baseKuch);
          else joyidaOngga(baseKuch, yarimKuch);
        } else {
          float turnRatio = abs(jx) / 100.0f;
          float maxKamayish = (100 - burilishNisbati) / 100.0f;
          int chapKuch = baseKuch;
          int ongKuch = baseKuch;
          if (jx < 0) chapKuch = (int)(baseKuch * (1.0f - turnRatio * maxKamayish));
          else if (jx > 0) ongKuch = (int)(baseKuch * (1.0f - turnRatio * maxKamayish));
          if (jy < -15) orqagaYur(chapKuch, ongKuch);
          else oldingaYur(chapKuch, ongKuch);
        }
      }
    }
    return;
  }

  // Agar tezlik bo'lsa (masalan: V:200)
  if (msg.startsWith("V:")) {
    int v = msg.substring(2).toInt();
    tezlik = constrain(v, 0, 255);
  } 
  // Oddiy buyruq (F, B, L, R, S ...) yoki so'z (STROBE_ON / STROBE_OFF)
  else {
    matnliBuyruq(msg);
  }
}

void reconnectMQTT() {
  static unsigned long lastMqttRetry = 0;
  if (millis() - lastMqttRetry > 5000) {
    lastMqttRetry = millis();
    String clientId = "QalqonRobot-" + String(random(0xffff), HEX);
    Serial.print("[MQTT] HiveMQ bulutiga ulanmoqda...");
    if (mqttClient.connect(clientId.c_str())) {
      Serial.println(" ULANDI!");
      mqttClient.subscribe(mqttTopic);
      Serial.print("[MQTT] Obuna bo'lingan mavzu: ");
      Serial.println(mqttTopic);
    } else {
      Serial.print(" Xatolik: ");
      Serial.println(mqttClient.state());
    }
  }
}
#endif

// ==============================================================================
// 8. SETUP VA LOOP
// ==============================================================================

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n\n==========================================");
  Serial.println("  QALQON ROBOT - ESP32 BTS7960 CONTROLLER ");
  Serial.println("==========================================");

  // Pinlarni chiqish (OUTPUT) holatiga o'tkazish
  pinMode(chapOldinga_RPWM, OUTPUT);
  pinMode(chapOrqaga_LPWM, OUTPUT);
  pinMode(ongOldinga_RPWM, OUTPUT);
  pinMode(ongOrqaga_LPWM, OUTPUT);

  // Dastlab motorlarni to'xtatish
  toxta();

  // 0. Migalka relesi (o'chiq holatda boshlanadi)
  initMigalka();

#if ENABLE_HARDWARE_GPS
  // 0.1 LG290P GNSS RTK datchigini Serial2 da ishga tushirish (RX=16, TX=17)
  Serial2.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.println("[GPS] Waveshare LG290P GNSS RTK (Serial2 RX=16, TX=17, 115200) faol!");
#endif

  // Wi-Fi Station (STA) rejimini yoqish
  // ESP32 o'zi tarmoq tarqatmaydi, balki planshetning Hotspotiga ulanadi!
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  Serial.print("Planshet Hotspotiga ulanmoqda (SSID: ");
  Serial.print(ssid);
  Serial.print(")");

  int urinish = 0;
  while (WiFi.status() != WL_CONNECTED && urinish < 30) {
    delay(500);
    Serial.print(".");
    urinish++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[MUVAFFAQIN!] Planshet Hotspotiga ulandi!");
    Serial.print("ESP32 IP manzili: http://");
    Serial.println(WiFi.localIP());
    Serial.println("Boshqarish uchun brauzerda shu IP manzilni oching!");
  } else {
    Serial.println("\n[OGOHLANTIRISH] Wi-Fi ga ulanib bo'lmadi!");
    Serial.println("Planshetda 'Kirish nuqtasi' (Hotspot) yoqilgani va SSID/parol to'g'riligini tekshiring.");
  }

  // Web server marshrutlarini sozlash
  server.on("/", HTTP_GET, handleRoot);
  server.on("/move", HTTP_GET, handleMove);
  server.on("/cmd", HTTP_GET, handleMove);
  server.on("/speed", HTTP_GET, handleSpeed);
  server.on("/status", HTTP_GET, handleStatus);
  server.on("/strobe", HTTP_GET, handleStrobe);
  server.on("/gps", HTTP_GET, handleGps);
  server.onNotFound(handleNotFound);

  // Serverni ishga tushirish
  server.begin();
  Serial.println("HTTP WebServer port 80 da ishga tushdi.");

#if ENABLE_MQTT
  mqttClient.setServer(mqttServer, mqttPort);
  mqttClient.setCallback(mqttCallback);
#endif
}

void loop() {
  // 1.1 LG290P GNSS RTK datchigini o'qish va Trackk Cloud Hub'ga uzatish
  yangilashGpsHardware();

  // 1.2 UART (USB Serial) orqali Raspberry Pi dan kelgan buyruqlarni qabul qilish (115200 bod)
  //  Bitta harf (F, S ...) yoki so'z (STROBE_ON). So'z yaxlit bajarilishi uchun belgilar yig'iladi va qator oxiri
  //  ('\n') kelganda yoki 25 ms yangi belgi kelmaganda bajariladi ("STROBE_ON" harflari alohida buyruq bo'lib ketmasin)
  static String serialBuf = "";
  static unsigned long serialOxirgi = 0;
  while (Serial.available()) {
    char c = (char)Serial.read();
    serialOxirgi = millis();
    if (c == '\r' || c == '\n' || c == ' ') {
      if (serialBuf.length()) serialBuyruq(serialBuf);
      serialBuf = "";
      continue;
    }
    if (serialBuf.length() < 32) serialBuf += c;
  }
  if (serialBuf.length() && millis() - serialOxirgi > 25) {
    serialBuyruq(serialBuf);
    serialBuf = "";
  }

  // 2. HTTP so'rovlarni qabul qilish
  server.handleClient();

#if ENABLE_MQTT
  if (WiFi.status() == WL_CONNECTED) {
    if (!mqttClient.connected()) {
      reconnectMQTT();
    } else {
      mqttClient.loop();

      // Telemetriyani MQTT ga uzatish (harakatda 120ms, tinch turganda 300ms)
      unsigned long telemetryInterval = harakatda ? 120 : 300;
      if (millis() - oxirgiTelemetryVaqti >= telemetryInterval) {
        oxirgiTelemetryVaqti = millis();

        char teleJson[256];
        snprintf(teleJson, sizeof(teleJson),
          "{\"status\":\"online\",\"moving\":%s,\"speed\":%d,\"strobe\":%s}",
          harakatda ? "true" : "false",
          tezlik,
          migalkaYoniq ? "true" : "false"
        );
        mqttClient.publish(mqttTelemetryTopic, teleJson);
      }
    }
  }
#endif

  // Failsafe (Avtotormoz): agar 800 ms yangi signal kelmasa, motorlarni to'xtatish
  if (harakatda && (millis() - oxirgiBuyruqVaqti > TIMEOUT_MS)) {
    toxta();
  }

  // Wi-Fi aloqasi uzilib qolsa avtomatik qayta ulanish
  if (WiFi.status() != WL_CONNECTED) {
    static unsigned long lastReconnect = 0;
    if (millis() - lastReconnect > 5000) {
      lastReconnect = millis();
      Serial.println("Wi-Fi uzildi. Qayta ulanishga urinilmoqda...");
      WiFi.reconnect();
    }
  }
}
