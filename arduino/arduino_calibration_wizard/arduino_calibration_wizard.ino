/*
 * =====================================================================================
 * QALQON v1.0 — Arduino Uno + L293D Dvigatel va 4 ta Ultratovush Kalibrovka Ustasi
 * Mas'ul muhandis: Asilbek (Bosh mexatronik)
 * 
 * 4 TA ULTRATOVUSH (HC-SR04):
 *   TRIG (Umumiy): Pin A0
 *   ECHO_FRONT:    Pin A1 (Old)
 *   ECHO_REAR:     Pin A2 (Orqa)
 *   ECHO_LEFT:     Pin A3 (Chap)
 *   ECHO_RIGHT:    Pin A4 (O'ng)
 * =====================================================================================
 */

#include <AFMotor.h>

AF_DCMotor motorFL(1); // M1: Front-Left  (Old-Chap)
AF_DCMotor motorRL(2); // M2: Rear-Left   (Orqa-Chap)
AF_DCMotor motorRR(3); // M3: Rear-Right  (Orqa-O'ng)
AF_DCMotor motorFR(4); // M4: Front-Right (Old-O'ng)

// 4 ta Ultratovush pinlari
#define TRIG_PIN   A0
#define ECHO_FRONT A1
#define ECHO_REAR  A2
#define ECHO_LEFT  A3
#define ECHO_RIGHT A4

int speedLeftTrim = 190;
int speedRightTrim = 190;
int safeStopDistance = 25;

bool continuousSonar = false;
unsigned long lastSonarPrint = 0;

void printMenu() {
  Serial.println(F("\n========================================================"));
  Serial.println(F("🤖 QALQON v1.0: 4 TA SONAR VA MOTOR KALIBROVKA MENYUSI"));
  Serial.println(F("========================================================"));
  Serial.println(F(" [1] - 4 ta datchikni (Old, Orqa, Chap, O'ng) jonli o'qish (ON/OFF)"));
  Serial.println(F(" [2] - Motorlarni BIRMA-BIR yo'nalishini tekshirish (M1 -> M2 -> M3 -> M4)"));
  Serial.println(F(" [3] - Minimal PWM (Deadzone/Stall) chegarasini aniqlash"));
  Serial.println(F(" [4] - To'g'ri chiziq balansi (Oldinga 2 soniya yurib to'xtash)"));
  Serial.println(F(" [5] - Chap motor tezligini +5 oshirish"));
  Serial.println(F(" [6] - Chap motor tezligini -5 kamaytirish"));
  Serial.println(F(" [7] - O'ng motor tezligini +5 oshirish"));
  Serial.println(F(" [8] - O'ng motor tezligini -5 kamaytirish"));
  Serial.println(F(" [9] - Joyida 360 tank burilish testi"));
  Serial.println(F(" [0] - Favqulodda to'xtash (STOP ALL)"));
  Serial.println(F(" [P] - Joriy kalibrovka parametrlarini ekranga chiqarish"));
  Serial.println(F("========================================================"));
  Serial.print(F("Buyruqni kiriting: "));
}

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 3000);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_FRONT, INPUT);
  pinMode(ECHO_REAR,  INPUT);
  pinMode(ECHO_LEFT,  INPUT);
  pinMode(ECHO_RIGHT, INPUT);

  stopAll();
  printMenu();
}

void loop() {
  if (continuousSonar && (millis() - lastSonarPrint > 250)) {
    lastSonarPrint = millis();
    long dF = readSingleSonar(ECHO_FRONT);
    long dB = readSingleSonar(ECHO_REAR);
    long dL = readSingleSonar(ECHO_LEFT);
    long dR = readSingleSonar(ECHO_RIGHT);

    Serial.print(F("📡 [360° SONAR] Old: "));
    printDist(dF);
    Serial.print(F(" | Orqa: "));
    printDist(dB);
    Serial.print(F(" | Chap: "));
    printDist(dL);
    Serial.print(F(" | O'ng: "));
    printDist(dR);

    if (dF <= safeStopDistance) Serial.print(F("  ⚠️ [OLD TO'SIQ]"));
    if (dB <= safeStopDistance) Serial.print(F("  ⚠️ [ORQA TO'SIQ]"));
    Serial.println();
  }

  if (Serial.available() > 0) {
    char cmd = Serial.read();
    if (cmd == '\r' || cmd == '\n' || cmd == ' ') return;
    handleCommand(cmd);
  }
}

void printDist(long d) {
  if (d > 350 || d <= 0) Serial.print(F("Ochiq"));
  else { Serial.print(d); Serial.print(F("cm")); }
}

long readSingleSonar(int echoPin) {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(echoPin, HIGH, 22000);
  if (duration == 0) return 999;
  return (long)((duration * 0.0343) / 2.0);
}

void handleCommand(char cmd) {
  switch (cmd) {
    case '1':
      continuousSonar = !continuousSonar;
      Serial.print(F("\n>>> 4 ta datchik o'qish: "));
      Serial.println(continuousSonar ? F("YOQILDI [ON]") : F("O'CHIRILDI [OFF]"));
      if (!continuousSonar) printMenu();
      break;

    case '2':
      testIndividualMotors();
      printMenu();
      break;

    case '3':
      testDeadzoneRamp();
      printMenu();
      break;

    case '4':
      testStraightDrive();
      printMenu();
      break;

    case '5':
      speedLeftTrim = min(255, speedLeftTrim + 5);
      Serial.print(F("\n>>> Yangi Chap Tezlik: ")); Serial.println(speedLeftTrim);
      break;

    case '6':
      speedLeftTrim = max(60, speedLeftTrim - 5);
      Serial.print(F("\n>>> Yangi Chap Tezlik: ")); Serial.println(speedLeftTrim);
      break;

    case '7':
      speedRightTrim = min(255, speedRightTrim + 5);
      Serial.print(F("\n>>> Yangi O'ng Tezlik: ")); Serial.println(speedRightTrim);
      break;

    case '8':
      speedRightTrim = max(60, speedRightTrim - 5);
      Serial.print(F("\n>>> Yangi O'ng Tezlik: ")); Serial.println(speedRightTrim);
      break;

    case '9':
      testSpinTurns();
      printMenu();
      break;

    case '0':
    case 's':
    case 'S':
      stopAll();
      Serial.println(F("\n🛑 BARCHA MOTORLAR TO'XTATILDI!"));
      break;

    case 'p':
    case 'P':
      printCurrentConfig();
      break;

    default:
      Serial.print(F("\nNoma'lum buyruq: ")); Serial.println(cmd);
      printMenu();
      break;
  }
}

void testIndividualMotors() {
  Serial.println(F("\n🔍 MOTORLARNI BIRMA-BIR TEKSHIRISH (ROBOTNI KO'TARIB QO'YING!):"));
  delay(1200);

  Serial.println(F("1/4. [M1: Old-Chap] Oldinga..."));
  motorFL.setSpeed(180);
  motorFL.run(FORWARD);
  delay(1200);
  motorFL.run(RELEASE);
  delay(400);

  Serial.println(F("2/4. [M2: Orqa-Chap] Oldinga..."));
  motorRL.setSpeed(180);
  motorRL.run(FORWARD);
  delay(1200);
  motorRL.run(RELEASE);
  delay(400);

  Serial.println(F("3/4. [M3: Orqa-O'ng] Oldinga..."));
  motorRR.setSpeed(180);
  motorRR.run(FORWARD);
  delay(1200);
  motorRR.run(RELEASE);
  delay(400);

  Serial.println(F("4/4. [M4: Old-O'ng] Oldinga..."));
  motorFR.setSpeed(180);
  motorFR.run(FORWARD);
  delay(1200);
  motorFR.run(RELEASE);
  delay(400);

  Serial.println(F("✅ Test yakunlandi. Teskari aylanayotgan motor simlarini almashtiring."));
}

void testDeadzoneRamp() {
  Serial.println(F("\n⚡ MINIMAL START TEZLIGI (DEADZONE) SINOVI (60 dan 255 gacha):"));
  delay(800);

  for (int pwm = 60; pwm <= 255; pwm += 15) {
    Serial.print(F("Joriy PWM: ")); Serial.print(pwm); Serial.println(F(" / 255"));
    setLeftSpeed(pwm);
    setRightSpeed(pwm);
    motorFL.run(FORWARD);
    motorRL.run(FORWARD);
    motorRR.run(FORWARD);
    motorFR.run(FORWARD);
    delay(400);

    if (Serial.available()) {
      char c = Serial.read();
      if (c == '0' || c == 's') break;
    }
  }

  stopAll();
  Serial.println(F("✅ Tugadi. Rezina shinalar uchun tavsiya: 130-150 PWM."));
}

void testStraightDrive() {
  Serial.println(F("\n🚀 TO'G'RI CHIZIQ SINOVI (2 SONIYA OLDINGA):"));
  setLeftSpeed(speedLeftTrim);
  setRightSpeed(speedRightTrim);

  motorFL.run(FORWARD);
  motorRL.run(FORWARD);
  motorRR.run(FORWARD);
  motorFR.run(FORWARD);

  unsigned long startTime = millis();
  while (millis() - startTime < 2000) {
    long dist = readSingleSonar(ECHO_FRONT);
    if (dist > 0 && dist < safeStopDistance) {
      stopAll();
      Serial.println(F("⚠️ TO'SIQ ANIQLANDI! Favqulodda to'xtatildi!"));
      return;
    }
    delay(20);
  }

  stopAll();
  Serial.println(F("✅ 2 soniya yurish tugadi. Chapga og'sa [5], o'ngga og'sa [7] bosing."));
}

void testSpinTurns() {
  Serial.println(F("\n🔄 JOYIDA BURILISH SINOVI:"));
  setLeftSpeed(speedLeftTrim);
  setRightSpeed(speedRightTrim);

  Serial.println(F("1. Chapga spin (800ms)..."));
  motorFL.run(BACKWARD);
  motorRL.run(BACKWARD);
  motorRR.run(FORWARD);
  motorFR.run(FORWARD);
  delay(800);
  stopAll();
  delay(500);

  Serial.println(F("2. O'ngga spin (800ms)..."));
  motorFL.run(FORWARD);
  motorRL.run(FORWARD);
  motorRR.run(BACKWARD);
  motorFR.run(BACKWARD);
  delay(800);
  stopAll();
  Serial.println(F("✅ Burilish tugadi."));
}

void printCurrentConfig() {
  Serial.println(F("\n📋 JORIY KALIBROVKA NATIJALARI:"));
  Serial.print(F("  - speedLeftTrim:      ")); Serial.println(speedLeftTrim);
  Serial.print(F("  - speedRightTrim:     ")); Serial.println(speedRightTrim);
  Serial.print(F("  - safeStopDistance:   ")); Serial.print(safeStopDistance); Serial.println(F(" cm"));
}

void setLeftSpeed(int spd) {
  motorFL.setSpeed(spd);
  motorRL.setSpeed(spd);
}

void setRightSpeed(int spd) {
  motorFR.setSpeed(spd);
  motorRR.setSpeed(spd);
}

void stopAll() {
  motorFL.run(RELEASE);
  motorRL.run(RELEASE);
  motorRR.run(RELEASE);
  motorFR.run(RELEASE);
}
