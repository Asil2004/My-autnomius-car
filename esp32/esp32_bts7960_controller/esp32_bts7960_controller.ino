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
#include <Wire.h>
#include <math.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

// ==============================================================================
// 0. MPU-6050 6-O'QLI DATCHIK (GIROSKOP + AKSELEROMETR) SOZLAMALARI
// ==============================================================================
// ESP32 standart I2C pinlari:
#define MPU_SDA 21
#define MPU_SCL 22

#define MPU_REG_SMPLRT_DIV   0x19
#define MPU_REG_CONFIG       0x1A
#define MPU_REG_GYRO_CONFIG  0x1B
#define MPU_REG_ACCEL_CONFIG 0x1C
#define MPU_REG_ACCEL_XOUT_H 0x3B
#define MPU_REG_PWR_MGMT_1   0x6B
#define MPU_REG_WHO_AM_I     0x75

uint8_t mpuAddr = 0x68;  // Standart I2C manzil (AD0 -> GND: 0x68, AD0 -> VCC: 0x69)
bool mpuMavjud = false;
float gyroX_offset = 0, gyroY_offset = 0, gyroZ_offset = 0;
float yaw = 0.0f;        // 0 .. 360° (Heading / Azimut burchagi)
float pitch = 0.0f;      // -180 .. +180° (Old-Orqa egilish)
float roll = 0.0f;       // -90 .. +90° (Chap-O'ng egilish)
float gyroRateZ = 0.0f;  // °/s (Aylanish tezligi)
float mpuHarorat = 0.0f; // °C
float ax = 0, ay = 0, az = 0;
unsigned long oxirgiImuVaqti = 0;

void i2cWriteByte(uint8_t reg, uint8_t data) {
  Wire.beginTransmission(mpuAddr);
  Wire.write(reg);
  Wire.write(data);
  Wire.endTransmission();
}

uint8_t i2cReadByte(uint8_t reg) {
  Wire.beginTransmission(mpuAddr);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom((uint8_t)mpuAddr, (uint8_t)1);
  if (Wire.available()) {
    return Wire.read();
  }
  return 0;
}

void kalibrlashMPU6050() {
  if (!mpuMavjud) return;
  Serial.println("[MPU6050] Giroskop kalibrlanmoqda (robotni 1 soniya qimirlatmang)...");
  long gx_sum = 0, gy_sum = 0, gz_sum = 0;
  const int NUM_SAMPLES = 250;

  for (int i = 0; i < NUM_SAMPLES; i++) {
    Wire.beginTransmission(mpuAddr);
    Wire.write(0x43); // GYRO_XOUT_H
    Wire.endTransmission(false);
    Wire.requestFrom((uint8_t)mpuAddr, (uint8_t)6);

    if (Wire.available() >= 6) {
      int16_t gx = (Wire.read() << 8) | Wire.read();
      int16_t gy = (Wire.read() << 8) | Wire.read();
      int16_t gz = (Wire.read() << 8) | Wire.read();
      gx_sum += gx;
      gy_sum += gy;
      gz_sum += gz;
    }
    delay(4);
  }

  gyroX_offset = (float)gx_sum / (float)NUM_SAMPLES;
  gyroY_offset = (float)gy_sum / (float)NUM_SAMPLES;
  gyroZ_offset = (float)gz_sum / (float)NUM_SAMPLES;

  yaw = 0.0f;
  oxirgiImuVaqti = micros();
  Serial.print("[MPU6050] Kalibrlash tayyor! Z-dreyf kompensatsiyasi: ");
  Serial.println(gyroZ_offset / 65.5f);
}

bool initMPU6050() {
  Wire.begin(MPU_SDA, MPU_SCL, 400000);
  delay(100);

  // 1. Avval 0x68 manzilini sinab ko'ramiz (AD0 -> GND)
  mpuAddr = 0x68;
  uint8_t who = i2cReadByte(MPU_REG_WHO_AM_I);

  // 2. Agar 0x68 javob bermasa, 0x69 manzilini sinaymiz (AD0 -> VCC)
  if (who != 0x68 && who != 0x70 && who != 0x71 && who != 0x72 && who != 0x98) {
    mpuAddr = 0x69;
    who = i2cReadByte(MPU_REG_WHO_AM_I);
  }

  Serial.print("[MPU6050] I2C manzil: 0x");
  Serial.print(mpuAddr, HEX);
  Serial.print(" | WHO_AM_I: 0x");
  Serial.println(who, HEX);

  if (who == 0x00 || who == 0xFF) {
    Serial.println("[-] [OGOHLANTIRISH] MPU-6050 datchigi topilmadi!");
    Serial.println("    Simlarni tekshiring: SDA -> GPIO 21, SCL -> GPIO 22, VCC -> 3.3V/5V, GND -> GND.");
    mpuMavjud = false;
    return false;
  }

  // 1. Sleep rejimdan uyg'otish (PLL with X axis gyroscope reference)
  i2cWriteByte(MPU_REG_PWR_MGMT_1, 0x01);
  delay(50);
  // 2. DLPF - 42Hz (motor tebranishi va elektr shovqinlarni filtrlash)
  i2cWriteByte(MPU_REG_CONFIG, 0x03);
  // 3. Sample Rate: 100Hz (1kHz / (1 + 9) = 100Hz)
  i2cWriteByte(MPU_REG_SMPLRT_DIV, 0x09);
  // 4. Gyro +/- 500 deg/s (65.5 LSB / deg/s)
  i2cWriteByte(MPU_REG_GYRO_CONFIG, 0x08);
  // 5. Accel +/- 2g (16384 LSB / g)
  i2cWriteByte(MPU_REG_ACCEL_CONFIG, 0x00);
  delay(50);

  mpuMavjud = true;
  Serial.println("[+] [OK] MPU-6050 datchigi muvaffaqiyatli ishga tushdi!");
  kalibrlashMPU6050();
  return true;
}

void yangilashMPU6050() {
  if (!mpuMavjud) return;

  unsigned long hozir = micros();
  float dt = (hozir - oxirgiImuVaqti) / 1000000.0f;
  if (dt < 0.005f) return; // 200 Hz dan oshirmaslik
  oxirgiImuVaqti = hozir;

  Wire.beginTransmission(mpuAddr);
  Wire.write(MPU_REG_ACCEL_XOUT_H);
  Wire.endTransmission(false);
  Wire.requestFrom((uint8_t)mpuAddr, (uint8_t)14);

  if (Wire.available() >= 14) {
    int16_t rawAX = (Wire.read() << 8) | Wire.read();
    int16_t rawAY = (Wire.read() << 8) | Wire.read();
    int16_t rawAZ = (Wire.read() << 8) | Wire.read();
    int16_t rawTemp = (Wire.read() << 8) | Wire.read();
    int16_t rawGX = (Wire.read() << 8) | Wire.read();
    int16_t rawGY = (Wire.read() << 8) | Wire.read();
    int16_t rawGZ = (Wire.read() << 8) | Wire.read();

    ax = rawAX / 16384.0f;
    ay = rawAY / 16384.0f;
    az = rawAZ / 16384.0f;
    mpuHarorat = (rawTemp / 340.0f) + 36.53f;

    float gx = (rawGX - gyroX_offset) / 65.5f; // °/s
    float gy = (rawGY - gyroY_offset) / 65.5f;
    float gz = (rawGZ - gyroZ_offset) / 65.5f;

    gyroRateZ = gz;

    // Zero-drift (o'lik zona) filtri: robot qimirlamaganda mayda shovqinlar hisobiga yaw oqib ketmasligi uchun
    if (abs(gz) < 0.25f) {
      gz = 0.0f;
    }

    // Yaw burchagini integrallash (0..360°)
    yaw += gz * dt;
    if (yaw >= 360.0f) yaw -= 360.0f;
    else if (yaw < 0.0f) yaw += 360.0f;

    // Pitch & Roll (Komplementar filtr: 96% giroskop + 4% akselerometr)
    float accelPitch = atan2(-ax, sqrt(ay * ay + az * az)) * 180.0f / PI;
    float accelRoll  = atan2(ay, az) * 180.0f / PI;

    pitch = 0.96f * (pitch + gy * dt) + 0.04f * accelPitch;
    roll  = 0.96f * (roll + gx * dt) + 0.04f * accelRoll;
  }
}

// ==============================================================================
// 0.1 WAVESHARE LG290P GNSS RTK DATCHIGI VA TRACKK CLOUD HUB
// ==============================================================================
// Agar LG290P datchigi ESP32 ga 4 ta jumper sim bilan ulangan bo'lsa:
// VCC -> 5V (yoki VIN), GND -> GND, TXD -> GPIO 16 (RX2), RXD -> GPIO 17 (TX2)
// Bu holda robotga hech qanday USB kabel ulanishi shart emas!
#define ENABLE_HARDWARE_GPS 1
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
    default:  toxta(); break;
  }
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
    /* IMU MPU-6050 Ko'rsatkichlar kartasi */
    .imu-card {
      width: 100%;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .imu-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: #94a3b8;
      font-weight: 600;
    }
    .imu-badge {
      font-size: 9px;
      padding: 2px 6px;
      border-radius: 8px;
      background: #334155;
      color: #94a3b8;
    }
    .imu-badge.active {
      background: #0f766e;
      color: #5eead4;
    }
    .imu-main {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 4px;
    }
    .imu-yaw-box {
      font-size: 20px;
      font-weight: 800;
      color: #38bdf8;
      font-family: monospace;
    }
    .deg {
      font-size: 13px;
      color: #94a3b8;
    }
    .imu-angles {
      font-size: 10px;
      color: #cbd5e1;
      text-align: right;
      line-height: 1.3;
    }
    .imu-btns {
      display: flex;
      gap: 6px;
    }
    .imu-btn {
      flex: 1;
      background: #334155;
      border: 1px solid #475569;
      color: #f8fafc;
      border-radius: 6px;
      padding: 4px;
      font-size: 10px;
      font-weight: 600;
      cursor: pointer;
    }
    .imu-btn:active {
      background: #0d9488;
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

      <!-- IMU MPU-6050 Ko'rsatkichlari -->
      <div class="imu-card">
        <div class="imu-head">
          <span>🧭 MPU-6050 IMU</span>
          <span id="imuStatus" class="imu-badge">KUTILMOQDA</span>
        </div>
        <div class="imu-main">
          <div class="imu-yaw-box">
            <span id="imuYaw">0.0</span><span class="deg">°</span>
          </div>
          <div class="imu-angles">
            <div>Pitch: <b id="imuPitch">0.0°</b></div>
            <div>Roll: <b id="imuRoll">0.0°</b></div>
          </div>
        </div>
        <div class="imu-btns">
          <button type="button" class="imu-btn" onclick="zeroImu()">🎯 0° Qilish</button>
          <button type="button" class="imu-btn" onclick="calibImu()">⚙️ Kalibrlash</button>
        </div>
      </div>

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

    // IMU datchik ma'lumotlarini o'qib borish
    function fetchImuData() {
      fetch('/imu')
        .then(r => r.json())
        .then(d => {
          if (!d) return;
          const badge = document.getElementById('imuStatus');
          if (badge) {
            if (d.connected) {
              badge.innerText = 'FAOL';
              badge.className = 'imu-badge active';
            } else {
              badge.innerText = 'ULANMAGAN';
              badge.className = 'imu-badge';
            }
          }
          const y = document.getElementById('imuYaw');
          if (y) y.innerText = (+d.yaw).toFixed(1);
          const p = document.getElementById('imuPitch');
          if (p) p.innerText = (+d.pitch).toFixed(1) + '°';
          const r = document.getElementById('imuRoll');
          if (r) r.innerText = (+d.roll).toFixed(1) + '°';
        })
        .catch(() => {});
    }
    setInterval(fetchImuData, 300);

    function zeroImu() {
      fetch('/imu/zero').then(() => fetchImuData());
    }

    function calibImu() {
      if (confirm("Robot 1 soniya qimirlamasdan turishi kerak. Kalibrlashni boshlaymizmi?")) {
        fetch('/imu/calibrate').then(() => fetchImuData());
      }
    }

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
    char c = cmdStr.charAt(0);
    buyruqniBajar(c);
    server.send(200, "application/json", "{\"status\":\"ok\",\"cmd\":\"" + String(c) + "\"}");
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

// Robot holati: /status (IMU ma'lumotlari bilan boyitilgan)
void handleStatus() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  String json = "{";
  json += "\"status\":\"online\",";
  json += "\"moving\":" + String(harakatda ? "true" : "false") + ",";
  json += "\"speed\":" + String(tezlik) + ",";
  json += "\"ip\":\"" + WiFi.localIP().toString() + "\",";
  json += "\"rssi\":" + String(WiFi.RSSI()) + ",";
  json += "\"imu\":{";
  json += "\"connected\":" + String(mpuMavjud ? "true" : "false") + ",";
  json += "\"yaw\":" + String(yaw, 1) + ",";
  json += "\"pitch\":" + String(pitch, 1) + ",";
  json += "\"roll\":" + String(roll, 1) + ",";
  json += "\"rate\":" + String(gyroRateZ, 1) + ",";
  json += "\"temp\":" + String(mpuHarorat, 1);
  json += "}";
  json += "}";
  server.send(200, "application/json", json);
}

// IMU telemetriyasi: /imu
void handleImu() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  String json = "{";
  json += "\"connected\":" + String(mpuMavjud ? "true" : "false") + ",";
  json += "\"yaw\":" + String(yaw, 2) + ",";
  json += "\"pitch\":" + String(pitch, 2) + ",";
  json += "\"roll\":" + String(roll, 2) + ",";
  json += "\"rate\":" + String(gyroRateZ, 2) + ",";
  json += "\"ax\":" + String(ax, 2) + ",";
  json += "\"ay\":" + String(ay, 2) + ",";
  json += "\"az\":" + String(az, 2) + ",";
  json += "\"temp\":" + String(mpuHarorat, 1);
  json += "}";
  server.send(200, "application/json", json);
}

// IMU yaw burchagini 0° ga tenglash (Zero / Tara): /imu/zero
void handleImuZero() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  yaw = 0.0f;
  server.send(200, "application/json", "{\"status\":\"ok\",\"yaw\":0.0}");
}

// IMU datchigini to'liq kalibrlash: /imu/calibrate
void handleImuCalibrate() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  toxta();
  kalibrlashMPU6050();
  server.send(200, "application/json", "{\"status\":\"ok\",\"message\":\"MPU6050 kalibrlandi\"}");
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

  // IMU kalibrlash yoki nolga tenglash buyruqlari
  if (msg.equalsIgnoreCase("ZERO_IMU") || msg.equalsIgnoreCase("ZERO")) {
    yaw = 0.0f;
    Serial.println("[MQTT] IMU Yaw 0° ga tenglandi.");
    return;
  }
  if (msg.equalsIgnoreCase("CALIBRATE_IMU") || msg.equalsIgnoreCase("CALIB")) {
    toxta();
    kalibrlashMPU6050();
    return;
  }

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
  // Agar oddiy buyruq bo'lsa (F, B, L, R, S)
  else if (msg.length() > 0) {
    char c = msg.charAt(0);
    buyruqniBajar(c);
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

  // 0. MPU-6050 datchigini ishga tushirish
  mpuMavjud = initMPU6050();

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
  server.on("/imu", HTTP_GET, handleImu);
  server.on("/imu/zero", HTTP_GET, handleImuZero);
  server.on("/imu/calibrate", HTTP_GET, handleImuCalibrate);
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
  // 1. MPU-6050 giroskop va akselerometrni uzluksiz o'qib borish
  yangilashMPU6050();

  // 1.1 LG290P GNSS RTK datchigini o'qish va Trackk Cloud Hub'ga uzatish
  yangilashGpsHardware();

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

        char teleJson[280];
        snprintf(teleJson, sizeof(teleJson),
          "{\"status\":\"online\",\"moving\":%s,\"speed\":%d,\"yaw\":%.1f,\"pitch\":%.1f,\"roll\":%.1f,\"rate\":%.1f,\"lat\":%.7f,\"lng\":%.7f,\"fix\":%d}",
          harakatda ? "true" : "false",
          tezlik,
          yaw,
          pitch,
          roll,
          gyroRateZ,
          gpsLat,
          gpsLng,
          gpsFix
        );
        mqttClient.publish(mqttTelemetryTopic, teleJson);
      }
    }
  }
#endif
          harakatda ? "true" : "false",
          tezlik,
          yaw,
          pitch,
          roll,
          gyroRateZ,
          mpuHarorat
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
