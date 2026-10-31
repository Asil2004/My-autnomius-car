/*
 * QALQON v1.0 IIV Patrul Roboti - Arduino Uno + L293D Motor Shield
 * 4WD Differensial (Skid-Steer) Oddiy Rezina Shinalar va Teleskopik Minora Boshqaruvi
 * 
 * Raspberry Pi bilan USB Serial orqali ishlaydi (Baud rate: 115200)
 * 
 * Kutubxona: Adafruit Motor Shield V1 (AFMotor.h)
 */

#include <AFMotor.h>

// 4 ta DC reduktorli motor (L293D portlari)
// M1: Old-Chap, M2: Orqa-Chap, M3: Orqa-O'ng, M4: Old-O'ng
AF_DCMotor motorFL(1); // Front-Left
AF_DCMotor motorRL(2); // Rear-Left
AF_DCMotor motorRR(3); // Rear-Right
AF_DCMotor motorFR(4); // Front-Right

// Teleskopik Minora Aktuatori Pinlari (Servo yoki Rele/Drayver portlari)
#define MAST_UP_PIN   9  // SERVO_2 signali / Rele IN1
#define MAST_DOWN_PIN 10 // SERVO_1 signali / Rele IN2

// Ultratovush datchiklari (L293D analog pinlar)
#define TRIG_FRONT A0
#define ECHO_FRONT A1
#define TRIG_BACK  A2
#define ECHO_BACK  A3

// Xavfsiz to'xtash masofasi (santimetrda)
const int SAFE_STOP_DISTANCE = 25; 

// Dvigatel tezligi (0 - 255)
int currentSpeed = 190;

void setup() {
  Serial.begin(115200);
  
  // Datchik pinlari
  pinMode(TRIG_FRONT, OUTPUT);
  pinMode(ECHO_FRONT, INPUT);
  pinMode(TRIG_BACK, OUTPUT);
  pinMode(ECHO_BACK, INPUT);

  // Minora aktuatori pinlari
  pinMode(MAST_UP_PIN, OUTPUT);
  pinMode(MAST_DOWN_PIN, OUTPUT);
  stopMast();

  // Dastlabki tezlikni sozlash
  setMotorsSpeed(currentSpeed);
  stopAll();

  Serial.println("STATUS:READY_QALQON_V1_DIFFERENTIAL");
}

void loop() {
  // 1. Old to'siqni o'lchash (Xavfsizlik refleksi)
  long distFront = readDistance(TRIG_FRONT, ECHO_FRONT);

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

      case 'B': // Orqaga
        moveBackward();
        Serial.println("ACK:BACKWARD");
        break;

      case 'L': // Joyida chapga 360° burilish (Tank burilishi)
        turnLeft();
        Serial.println("ACK:LEFT_SPIN");
        break;

      case 'R': // Joyida o'ngga 360° burilish (Tank burilishi)
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

      case 'D': // Teleskopik minorani tushirish (yashirish)
        retractMast();
        Serial.println("ACK:MAST_RETRACTED");
        break;

      case '1': // Past tezlik (Patrul)
        currentSpeed = 140;
        setMotorsSpeed(currentSpeed);
        Serial.println("ACK:SPEED_LOW");
        break;

      case '2': // Standart tezlik
        currentSpeed = 190;
        setMotorsSpeed(currentSpeed);
        Serial.println("ACK:SPEED_MED");
        break;

      case '3': // Maksimal tezlik
        currentSpeed = 255;
        setMotorsSpeed(currentSpeed);
        Serial.println("ACK:SPEED_MAX");
        break;
    }
  }

  // To'satdan to'siq chiqsa tormozlash
  if (distFront > 0 && distFront < SAFE_STOP_DISTANCE) {
    stopAll();
  }

  delay(20);
}

// ----------------- 4WD DIFFERENSIAL HARAKAT -----------------

void moveForward() {
  motorFL.run(FORWARD);
  motorRL.run(FORWARD);
  motorRR.run(FORWARD);
  motorFR.run(FORWARD);
}

void moveBackward() {
  motorFL.run(BACKWARD);
  motorRL.run(BACKWARD);
  motorRR.run(BACKWARD);
  motorFR.run(BACKWARD);
}

// Chap motorlar orqaga, o'ng motorlar oldinga -> Chapga 360° burilish
void turnLeft() {
  motorFL.run(BACKWARD);
  motorRL.run(BACKWARD);
  motorRR.run(FORWARD);
  motorFR.run(FORWARD);
}

// Chap motorlar oldinga, o'ng motorlar orqaga -> O'ngga 360° burilish
void turnRight() {
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

void setMotorsSpeed(int spd) {
  motorFL.setSpeed(spd);
  motorRL.setSpeed(spd);
  motorRR.setSpeed(spd);
  motorFR.setSpeed(spd);
}

// ----------------- TELESKOPIK MINORA BOSHQARUVI -----------------

void deployMast() {
  digitalWrite(MAST_DOWN_PIN, LOW);
  digitalWrite(MAST_UP_PIN, HIGH);
  delay(1500); // Aktuator ko'tarilish vaqti
  stopMast();
}

void retractMast() {
  digitalWrite(MAST_UP_PIN, LOW);
  digitalWrite(MAST_DOWN_PIN, HIGH);
  delay(1500); // Aktuator tushish vaqti
  stopMast();
}

void stopMast() {
  digitalWrite(MAST_UP_PIN, LOW);
  digitalWrite(MAST_DOWN_PIN, LOW);
}

// ----------------- DATCHIK -----------------

long readDistance(int trigPin, int echoPin) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  long duration = pulseIn(echoPin, HIGH, 20000);
  if (duration == 0) return 999;
  return duration * 0.034 / 2;
}
