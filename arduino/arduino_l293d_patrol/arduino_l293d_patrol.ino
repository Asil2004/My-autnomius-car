/*
 * =====================================================================================
 * QALQON v1.0 IIV Patrul Roboti - Arduino Uno + L293D Motor Shield
 * 4WD Differensial Oddiy Rezina Shinalar, 4 ta Ultratovush (360° Sonar) va Teleskopik Minora
 * 
 * 4 TA ULTRATOVUSH DATCHIKLARI (HC-SR04 - 360° PERIMETR HIMOYASI):
 *   1. OLD (FRONT):  Trig = A0, Echo = A1
 *   2. ORQA (REAR):  Trig = A0, Echo = A2
 *   3. CHAP (LEFT):  Trig = A0, Echo = A3
 *   4. O'NG (RIGHT): Trig = A0, Echo = A4
 *   (Umumiy Trigger arxitekturasi: A0 barcha 4 datchikning TRIG oyog'iga ulanadi,
 *    bu simlarni tejaydi va A5 pinini 12V LiFePO4 batareya nazoratiga bo'shatadi)
 * 
 * Raspberry Pi bilan USB Serial orqali ishlaydi (Baud rate: 115200)
 * =====================================================================================
 */

#include <AFMotor.h>

// 4 ta DC reduktorli motor (L293D portlari)
// M1: Old-Chap, M2: Orqa-Chap, M3: Orqa-O'ng, M4: Old-O'ng
AF_DCMotor motorFL(1); // Front-Left
AF_DCMotor motorRL(2); // Rear-Left
AF_DCMotor motorRR(3); // Rear-Right
AF_DCMotor motorFR(4); // Front-Right

// Teleskopik Minora Aktuatori Pinlari
#define MAST_UP_PIN   9  // SERVO_2 signali / Rele IN1
#define MAST_DOWN_PIN 10 // SERVO_1 signali / Rele IN2

// 4 ta Ultratovush datchiklari pinlari
#define TRIG_PIN   A0 // Umumiy Trigger (4 ta datchikning TRIG oyoqchalari ulangan)
#define ECHO_FRONT A1 // 1. Old datchik (Front)
#define ECHO_REAR  A2 // 2. Orqa datchik (Rear)
#define ECHO_LEFT  A3 // 3. Chap datchik (Left)
#define ECHO_RIGHT A4 // 4. O'ng datchik (Right)
#define BATTERY_PIN A5 // 12V Akkumulyator kuchlanishini o'lchash (Rezistor bo'lgich orqali)

// Xavfsiz to'xtash masofasi (santimetrda)
const int SAFE_STOP_DISTANCE = 25; 

// Dvigatel bazaviy tezligi (0 - 255)
int currentSpeed = 190;

// Kalibrovka balans koeffitsiyentlari (Trim)
int speedTrimLeft  = 190; // Chap g'ildiraklar (M1, M2)
int speedTrimRight = 190; // O'ng g'ildiraklar (M3, M4)

void setup() {
  Serial.begin(115200);
  
  // 4 ta Datchik pinlarini sozlash
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_FRONT, INPUT);
  pinMode(ECHO_REAR,  INPUT);
  pinMode(ECHO_LEFT,  INPUT);
  pinMode(ECHO_RIGHT, INPUT);
  pinMode(BATTERY_PIN, INPUT);

  // Minora aktuatori pinlari
  pinMode(MAST_UP_PIN, OUTPUT);
  pinMode(MAST_DOWN_PIN, OUTPUT);
  stopMast();

  // Dastlabki tezlikni sozlash
  applyTrimmedSpeeds(currentSpeed);
  stopAll();

  Serial.println("STATUS:READY_QALQON_V1_4_SONARS");
}

void loop() {
  // 1. 4 ta datchikdan masofalarni o'lchash
  long distFront = readSonarDistance(ECHO_FRONT);
  long distRear  = readSonarDistance(ECHO_REAR);
  long distLeft  = readSonarDistance(ECHO_LEFT);
  long distRight = readSonarDistance(ECHO_RIGHT);

  // 2. Raspberry Pi buyruqlarini tekshirish
  if (Serial.available() > 0) {
    char cmd = Serial.read();

    switch (cmd) {
      case 'F': // Oldinga
        if (distFront > 0 && distFront < SAFE_STOP_DISTANCE) {
          stopAll();
          Serial.println("WARN:OBSTACLE_FRONT");
        } else {
          moveForward();
          Serial.println("ACK:FORWARD");
        }
        break;

      case 'I': // Oldinga + O'ngga differensial ravon burilish (Yoy)
        if (distFront > 0 && distFront < SAFE_STOP_DISTANCE) {
          stopAll();
          Serial.println("WARN:OBSTACLE_FRONT");
        } else {
          moveForwardRight();
          Serial.println("ACK:FORWARD_RIGHT");
        }
        break;

      case 'G': // Oldinga + Chapga differensial ravon burilish (Yoy)
        if (distFront > 0 && distFront < SAFE_STOP_DISTANCE) {
          stopAll();
          Serial.println("WARN:OBSTACLE_FRONT");
        } else {
          moveForwardLeft();
          Serial.println("ACK:FORWARD_LEFT");
        }
        break;

      case 'B': // Orqaga
        if (distRear > 0 && distRear < SAFE_STOP_DISTANCE) {
          stopAll();
          Serial.println("WARN:OBSTACLE_REAR");
        } else {
          moveBackward();
          Serial.println("ACK:BACKWARD");
        }
        break;

      case 'J': // Orqaga + O'ngga differensial yoy
        if (distRear > 0 && distRear < SAFE_STOP_DISTANCE) {
          stopAll();
          Serial.println("WARN:OBSTACLE_REAR");
        } else {
          moveBackwardRight();
          Serial.println("ACK:BACKWARD_RIGHT");
        }
        break;

      case 'H': // Orqaga + Chapga differensial yoy
        if (distRear > 0 && distRear < SAFE_STOP_DISTANCE) {
          stopAll();
          Serial.println("WARN:OBSTACLE_REAR");
        } else {
          moveBackwardLeft();
          Serial.println("ACK:BACKWARD_LEFT");
        }
        break;

      case 'L': // Joyida chapga 360° burilish
        turnLeft();
        Serial.println("ACK:LEFT_SPIN");
        break;

      case 'R': // Joyida o'ngga 360° burilish
        turnRight();
        Serial.println("ACK:RIGHT_SPIN");
        break;

      case 'S': // To'xtash
        stopAll();
        Serial.println("ACK:STOP");
        break;

      case 'U': // Teleskopik minorani ko'tarish
        deployMast();
        Serial.println("ACK:MAST_DEPLOYED");
        break;

      case 'D': // Teleskopik minorani tushirish
        retractMast();
        Serial.println("ACK:MAST_RETRACTED");
        break;

      case '1': // Past tezlik (Patrul)
        currentSpeed = 140;
        applyTrimmedSpeeds(currentSpeed);
        Serial.println("ACK:SPEED_PATROL");
        break;

      case '2': // Standart tezlik
        currentSpeed = 190;
        applyTrimmedSpeeds(currentSpeed);
        Serial.println("ACK:SPEED_MED");
        break;

      case '3': // Maksimal tezlik
        currentSpeed = 255;
        applyTrimmedSpeeds(currentSpeed);
        Serial.println("ACK:SPEED_MAX");
        break;

      case 'P': // Barcha 4 ta datchik ma'lumotini yuborish (Ping Telemetriya)
        Serial.print("SONAR:F=");
        Serial.print(distFront);
        Serial.print(",B=");
        Serial.print(distRear);
        Serial.print(",L=");
        Serial.print(distLeft);
        Serial.print(",R=");
        Serial.print(distRight);
        Serial.print(",BAT=");
        Serial.println(readBatteryVoltage(), 2);
        break;

      case 'C': // Kalibrovka ma'lumotlari
        Serial.print("TRIM:L=");
        Serial.print(speedTrimLeft);
        Serial.print(",R=");
        Serial.println(speedTrimRight);
        break;
    }
  }

  // To'satdan to'siq chiqsa tormozlash refleksi
  if (distFront > 0 && distFront < SAFE_STOP_DISTANCE) {
    stopAll();
  }

  delay(20);
}

// ----------------- 4WD DIFFERENSIAL HARAKAT -----------------
// Burilishda ichki g'ildiraklarning kamaytirilgan quvvat koeffitsiyenti (40% quvvat)
const float CURVE_POWER_RATIO = 0.40;

void moveForward() {
  applyTrimmedSpeeds(currentSpeed);
  motorFL.run(FORWARD);
  motorRL.run(FORWARD);
  motorRR.run(FORWARD);
  motorFR.run(FORWARD);
}

// Oldinga + O'ngga ravon yoy (Chap g'ildiraklar 100%, o'ng g'ildiraklar 40% quvvatda oldinga aylanadi, teskari aylanmaydi!)
void moveForwardRight() {
  applyDifferentialSpeeds(currentSpeed, (int)(currentSpeed * CURVE_POWER_RATIO));
  motorFL.run(FORWARD);
  motorRL.run(FORWARD);
  motorRR.run(FORWARD);
  motorFR.run(FORWARD);
}

// Oldinga + Chapga ravon yoy (O'ng g'ildiraklar 100%, chap g'ildiraklar 40% quvvatda oldinga aylanadi, teskari aylanmaydi!)
void moveForwardLeft() {
  applyDifferentialSpeeds((int)(currentSpeed * CURVE_POWER_RATIO), currentSpeed);
  motorFL.run(FORWARD);
  motorRL.run(FORWARD);
  motorRR.run(FORWARD);
  motorFR.run(FORWARD);
}

void moveBackward() {
  applyTrimmedSpeeds(currentSpeed);
  motorFL.run(BACKWARD);
  motorRL.run(BACKWARD);
  motorRR.run(BACKWARD);
  motorFR.run(BACKWARD);
}

// Orqaga + O'ngga ravon yoy
void moveBackwardRight() {
  applyDifferentialSpeeds(currentSpeed, (int)(currentSpeed * CURVE_POWER_RATIO));
  motorFL.run(BACKWARD);
  motorRL.run(BACKWARD);
  motorRR.run(BACKWARD);
  motorFR.run(BACKWARD);
}

// Orqaga + Chapga ravon yoy
void moveBackwardLeft() {
  applyDifferentialSpeeds((int)(currentSpeed * CURVE_POWER_RATIO), currentSpeed);
  motorFL.run(BACKWARD);
  motorRL.run(BACKWARD);
  motorRR.run(BACKWARD);
  motorFR.run(BACKWARD);
}

void turnLeft() {
  applyTrimmedSpeeds(currentSpeed);
  motorFL.run(BACKWARD);
  motorRL.run(BACKWARD);
  motorRR.run(FORWARD);
  motorFR.run(FORWARD);
}

void turnRight() {
  applyTrimmedSpeeds(currentSpeed);
  motorFL.run(FORWARD);
  motorRL.run(FORWARD);
  motorRR.run(BACKWARD);
  motorFR.run(BACKWARD);
}

void stopAll() {
  motorFL.run(RELEASE);
  motorRL.run(RELEASE);
  motorRR.run(RELEASE);
  motorFR.run(RELEASE);
}

void applyTrimmedSpeeds(int baseSpeed) {
  applyDifferentialSpeeds(baseSpeed, baseSpeed);
}

void applyDifferentialSpeeds(int leftBase, int rightBase) {
  float lRatio = (float)speedTrimLeft / 200.0;
  float rRatio = (float)speedTrimRight / 200.0;

  int leftSpd  = constrain((int)(leftBase * lRatio), 0, 255);
  int rightSpd = constrain((int)(rightBase * rRatio), 0, 255);

  motorFL.setSpeed(leftSpd);
  motorRL.setSpeed(leftSpd);
  motorRR.setSpeed(rightSpd);
  motorFR.setSpeed(rightSpd);
}

// ----------------- TELESKOPIK MINORA BOSHQARUVI -----------------

void deployMast() {
  digitalWrite(MAST_DOWN_PIN, LOW);
  digitalWrite(MAST_UP_PIN, HIGH);
  delay(1500);
  stopMast();
}

void retractMast() {
  digitalWrite(MAST_UP_PIN, LOW);
  digitalWrite(MAST_DOWN_PIN, HIGH);
  delay(1500);
  stopMast();
}

void stopMast() {
  digitalWrite(MAST_UP_PIN, LOW);
  digitalWrite(MAST_DOWN_PIN, LOW);
}

// ----------------- 4 TA ULTRATOVUSH O'LCHOV FUNKSIYASI -----------------

long readSonarDistance(int echoPin) {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(echoPin, HIGH, 22000); // ~3.7 metr kutish
  if (duration == 0) return 999;
  return (long)((duration * 0.0343) / 2.0);
}

// ----------------- AKKUMULYATOR KUCHLANISHI -----------------

float readBatteryVoltage() {
  // A5 pinidagi analog kuchlanish (0-1023)
  // Masalan: 10k va 2.2k rezistor bo'lgich (Bo'linish koeffitsiyenti: ~5.54)
  int raw = analogRead(BATTERY_PIN);
  float pinVoltage = (raw / 1023.0) * 5.0;
  float batteryVoltage = pinVoltage * ( (10.0 + 2.2) / 2.2 ); // 12.8V gacha
  return batteryVoltage;
}
