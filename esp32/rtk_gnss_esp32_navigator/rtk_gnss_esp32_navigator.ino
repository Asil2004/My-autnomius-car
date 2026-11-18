/*
 * ==============================================================================
 * 🛡️ QALQON AMR v1.0 — ESP32 AVTONOM RTK GNSS NAVIGATSIYA DASTURI
 * ==============================================================================
 * Mikrokontroller: ESP32 (WROOM-32)
 * Motor Drayver: 2x BTS7960 (43A H-Bridge) yoki L298N
 * Datchik: Serverdan olinadigan santimetr aniqlikdagi RTK GNSS + MPU-6050 Gyro
 * 
 * SERVER ENDPOINT:
 *   GET https://trackk-gl6l.onrender.com/api.php?action=robot
 *   yoki Raw CSV:
 *   GET https://trackk-gl6l.onrender.com/api.php?action=robot_raw
 * 
 * VAZIFASI:
 * 1. Har 500 ms da RTK GNSS serveridan robot va maqsad (target) koordinatalarini olish.
 * 2. Haversine va Bearing (Azimut) formulalari orqali masofa va burchakni hisoblash.
 * 3. Masofa > 0.8 metr bo'lsa: maqsad tomon harakatlanish (to'g'ri, burilish, differensial).
 * 4. Masofa <= 0.8 metr bo'lsa: to'xtash ("Maqsadga yetdik").
 * 5. Failsafe (Xavfsizlik): agar is_online=false yoki serverdan 3 soniya javob kelmasa,
 *    motorlarni zudlik bilan to'xtatish.
 * ==============================================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h> // ArduinoJson v6 yoki v7
#include <math.h>

// -----------------------------------------------------------------------------
// 1. WI-FI SOZLAMALARI (Planshet Hotspot yoki Router)
// -----------------------------------------------------------------------------
const char* WIFI_SSID     = "QALQON_ROBOT_HOTSPOT"; // Planshet Hotspot nomi
const char* WIFI_PASSWORD = "qalqonpasswords";      // Hotspot paroli
const char* RTK_API_URL   = "https://trackk-gl6l.onrender.com/api.php?action=robot";

// -----------------------------------------------------------------------------
// 2. MOTOR PINLARI (2x BTS7960 H-BRIDGE)
// -----------------------------------------------------------------------------
// Chap motorlar
const int PIN_L_EN = 25; // R_EN + L_EN
const int PIN_L_RPWM = 26; // Oldinga
const int PIN_L_LPWM = 27; // Orqaga

// O'ng motorlar
const int PIN_R_EN = 14; // R_EN + L_EN
const int PIN_R_RPWM = 12; // Oldinga
const int PIN_R_LPWM = 13; // Orqaga

// PWM sozlamalari (ESP32 LEDC)
const int PWM_FREQ = 20000;      // 20 kHz (ovozsiz motor ishlashi)
const int PWM_RES  = 8;          // 8-bit (0 .. 255)
const int CH_L_FWD = 0;
const int CH_L_REV = 1;
const int CH_R_FWD = 2;
const int CH_R_REV = 3;

const int BASE_SPEED = 180;      // Asosiy harakat tezligi (0-255)
const int TURN_SPEED = 160;      // Burilish tezligi
const int SLOW_TURN  = 80;       // Egri burilishda ichki g'ildirak tezligi

// -----------------------------------------------------------------------------
// 3. NAVIGATSIYA VA FAILSAFE O'ZGARUVCHILARI
// -----------------------------------------------------------------------------
const float ARRIVAL_DISTANCE_M = 0.8f; // 0.8 metr yetib borish chegarasi
const unsigned long FAILSAFE_TIMEOUT_MS = 3000; // 3 soniya uzilish chegarasi
const unsigned long POLL_INTERVAL_MS = 500;    // 0.5 soniya so'rov davri

unsigned long lastSuccessfulRxTime = 0;
unsigned long lastPollTime = 0;

// Robot joriy holati
double robotLat = 0.0;
double robotLng = 0.0;
double prevLat = 0.0;
double prevLng = 0.0;
double currentHeading = 0.0; // Robotning kurs azimuti (0..360)
bool hasPreviousPos = false;

// -----------------------------------------------------------------------------
// 4. MOTOR DRAYVERI FUNKSIYALARI
// -----------------------------------------------------------------------------
void setMotors(int leftSpeed, int rightSpeed) {
  // Chap motor: -255 .. +255
  if (leftSpeed > 0) {
    ledcWrite(CH_L_FWD, constrain(leftSpeed, 0, 255));
    ledcWrite(CH_L_REV, 0);
  } else if (leftSpeed < 0) {
    ledcWrite(CH_L_FWD, 0);
    ledcWrite(CH_L_REV, constrain(-leftSpeed, 0, 255));
  } else {
    ledcWrite(CH_L_FWD, 0);
    ledcWrite(CH_L_REV, 0);
  }

  // O'ng motor: -255 .. +255
  if (rightSpeed > 0) {
    ledcWrite(CH_R_FWD, constrain(rightSpeed, 0, 255));
    ledcWrite(CH_R_REV, 0);
  } else if (rightSpeed < 0) {
    ledcWrite(CH_R_FWD, 0);
    ledcWrite(CH_R_REV, constrain(-rightSpeed, 0, 255));
  } else {
    ledcWrite(CH_R_FWD, 0);
    ledcWrite(CH_R_REV, 0);
  }
}

void stopMotors() {
  setMotors(0, 0);
}

void moveForward() {
  setMotors(BASE_SPEED, BASE_SPEED);
}

void spinLeft() {
  setMotors(-TURN_SPEED, TURN_SPEED);
}

void spinRight() {
  setMotors(TURN_SPEED, -TURN_SPEED);
}

void curveLeft() {
  setMotors(SLOW_TURN, BASE_SPEED);
}

void curveRight() {
  setMotors(BASE_SPEED, SLOW_TURN);
}

// -----------------------------------------------------------------------------
// 5. HAVERSINE VA BEARING MATEMATIKASI
// -----------------------------------------------------------------------------
const double EARTH_RADIUS = 6371000.0; // Metr

double toRadians(double deg) {
  return deg * (PI / 180.0);
}

double toDegrees(double rad) {
  return rad * (180.0 / PI);
}

// Ikki nuqta orasidagi to'g'ri masofa (metrlarda)
double calculateDistance(double lat1, double lon1, double lat2, double lon2) {
  double dLat = toRadians(lat2 - lat1);
  double dLon = toRadians(lon2 - lon1);
  double rLat1 = toRadians(lat1);
  double rLat2 = toRadians(lat2);

  double a = sin(dLat / 2.0) * sin(dLat / 2.0) +
             cos(rLat1) * cos(rLat2) * sin(dLon / 2.0) * sin(dLon / 2.0);
  double c = 2.0 * atan2(sqrt(a), sqrt(1.0 - a));
  return EARTH_RADIUS * c;
}

// 1-nuqtadan 2-nuqtaga azimut burchagi (0° .. 360°)
double calculateBearing(double lat1, double lon1, double lat2, double lon2) {
  double dLon = toRadians(lon2 - lon1);
  double rLat1 = toRadians(lat1);
  double rLat2 = toRadians(lat2);

  double y = sin(dLon) * cos(rLat2);
  double x = cos(rLat1) * sin(rLat2) - sin(rLat1) * cos(rLat2) * cos(dLon);

  double bearing = toDegrees(atan2(y, x));
  bearing = fmod(bearing + 360.0, 360.0);
  return bearing;
}

// Eng qisqa burchak xatosi (-180° .. +180°)
double normalizeAngleDiff(double target, double current) {
  double diff = fmod(target - current + 540.0, 360.0) - 180.0;
  return diff;
}

// -----------------------------------------------------------------------------
// 6. SETUP
// -----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=======================================================");
  Serial.println("🛡️  QALQON AMR — ESP32 RTK GNSS AVTONOM NAVIGATOR");
  Serial.println("=======================================================");

  // BTS7960 Enable pinlari
  pinMode(PIN_L_EN, OUTPUT);
  pinMode(PIN_R_EN, OUTPUT);
  digitalWrite(PIN_L_EN, HIGH);
  digitalWrite(PIN_R_EN, HIGH);

  // PWM kanallarini ulash
  ledcAttach(PIN_L_RPWM, PWM_FREQ, PWM_RES);
  ledcAttach(PIN_L_LPWM, PWM_FREQ, PWM_RES);
  ledcAttach(PIN_R_RPWM, PWM_FREQ, PWM_RES);
  ledcAttach(PIN_R_LPWM, PWM_FREQ, PWM_RES);

  stopMotors();

  // Wi-Fi ga ulanish
  Serial.print("Wi-Fi ga ulanmoqda: ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✓ Wi-Fi ulandi! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n⚠️ Wi-Fi ulanmadi! Failsafe holatida kutmoqda.");
  }

  lastSuccessfulRxTime = millis();
}

// -----------------------------------------------------------------------------
// 7. ASOSIY SIKL (LOOP)
// -----------------------------------------------------------------------------
void loop() {
  unsigned long now = millis();

  // ---------------------------------------------------------
  // 1. FAILSAFE: Aloqa uzilsa motorlarni to'xtatish
  // ---------------------------------------------------------
  if (now - lastSuccessfulRxTime > FAILSAFE_TIMEOUT_MS) {
    stopMotors();
    Serial.println("⚠️ [FAILSAFE]: Serverdan 3 soniyadan ortiq ma'lumot kelmadi! Motorlar to'xtatildi.");
  }

  // ---------------------------------------------------------
  // 2. DAVRIY SO'ROV (HAR 500 MS)
  // ---------------------------------------------------------
  if (now - lastPollTime >= POLL_INTERVAL_MS) {
    lastPollTime = now;

    if (WiFi.status() != WL_CONNECTED) {
      WiFi.reconnect();
      stopMotors();
      return;
    }

    WiFiClientSecure client;
    client.setInsecure(); // SSL sertifikat tekshiruvini chetlab o'tish
    HTTPClient http;

    if (http.begin(client, RTK_API_URL)) {
      http.setTimeout(2000);
      int httpCode = http.GET();

      if (httpCode == HTTP_CODE_OK) {
        String payload = http.getString();
        
        // JSON ni parse qilish
        StaticJsonDocument<1024> doc;
        DeserializationError error = deserializeJson(doc, payload);

        if (!error && doc["status"] == "ok") {
          bool isOnline = doc["is_online"];
          float ageSec = doc["age_sec"];

          // Xavfsizlik: GPS qurilmasi aloqadami?
          if (!isOnline || ageSec > 3.0f) {
            stopMotors();
            Serial.printf("⚠️ [FAILSAFE]: GPS oflayn (online=%d, age=%.1fs). Motor to'xtadi.\n", isOnline, ageSec);
            return;
          }

          // Ma'lumot qabul qilindi, failsafe taymerini yangilash
          lastSuccessfulRxTime = millis();

          robotLat = doc["lat"];
          robotLng = doc["lng"];
          const char* fixStr = doc["fix_str"];
          float speed = doc["speed"];

          // Robot kursini hisoblash (harakatlanayotganda)
          if (hasPreviousPos) {
            double movedDist = calculateDistance(prevLat, prevLng, robotLat, robotLng);
            if (movedDist > 0.20) { // 20 sm dan ortiq siljisa
              currentHeading = calculateBearing(prevLat, prevLng, robotLat, robotLng);
              prevLat = robotLat;
              prevLng = robotLng;
            }
          } else {
            prevLat = robotLat;
            prevLng = robotLng;
            hasPreviousPos = true;
          }

          // Maqsad (Target) bormi?
          if (doc["target"].isNull() || !doc["target"].containsKey("target_lat")) {
            stopMotors();
            Serial.println("⏳ Maqsad belgilanmagan. Standby rejimida kutmoqda.");
            return;
          }

          double targetLat = doc["target"]["target_lat"];
          double targetLng = doc["target"]["target_lng"];

          // Masofa va azimut
          double distanceM = calculateDistance(robotLat, robotLng, targetLat, targetLng);
          double targetBearing = calculateBearing(robotLat, robotLng, targetLat, targetLng);
          double angleError = normalizeAngleDiff(targetBearing, currentHeading);

          Serial.printf("📍 Masofa: %.2f m | Azimut: %.1f° | Kurs: %.1f° | Xato: %+.1f° | Fix: %s\n",
                        distanceM, targetBearing, currentHeading, angleError, fixStr);

          // -------------------------------------------------------
          // 3. MOTORLARNI BOSHQARISH MANTIG'I
          // -------------------------------------------------------
          if (distanceM <= ARRIVAL_DISTANCE_M) {
            stopMotors();
            Serial.printf("🎉 MAQSADGA YETDIK! (Masofa: %.2f m <= %.1f m)\n", distanceM, ARRIVAL_DISTANCE_M);
          } else {
            // Masofa > 0.8 metr bo'lsa harakatlanish
            if (fabs(angleError) > 40.0) {
              // O'z o'qi atrofida burilish
              if (angleError > 0) {
                spinRight();
              } else {
                spinLeft();
              }
            } else if (fabs(angleError) > 12.0) {
              // Yumshoq egri burilish
              if (angleError > 0) {
                curveRight();
              } else {
                curveLeft();
              }
            } else {
              // To'g'riga oldinga
              moveForward();
            }
          }
        }
      } else {
        Serial.printf("HTTP xatolik kodi: %d\n", httpCode);
      }
      http.end();
    }
  }
}
