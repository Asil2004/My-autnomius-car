/*
 * QALQON IIV Patrul Roboti - Arduino Uno + L293D Motor Shield (HW-130)
 * 4WD Mecanum Shassi va Ultratovush Datchiklari Boshqaruvi
 * 
 * Raspberry Pi bilan USB Serial orqali ishlaydi (Baud rate: 115200)
 * 
 * Kutubxona: Adafruit Motor Shield V1 (AFMotor.h)
 * O'rnatish: Arduino IDE -> Sketch -> Include Library -> Manage Libraries -> "Adafruit Motor Shield library" (V1)
 */

#include <AFMotor.h>

// 4 ta DC motor konfiguratsiyasi (L293D shielddagi portlar)
// M1: Old-Chap, M2: Orqa-Chap, M3: Orqa-O'ng, M4: Old-O'ng
AF_DCMotor motorFL(1); // Front-Left  (Old-Chap)
AF_DCMotor motorRL(2); // Rear-Left   (Orqa-Chap)
AF_DCMotor motorRR(3); // Rear-Right  (Orqa-O'ng)
AF_DCMotor motorFR(4); // Front-Right (Old-O'ng)

// Datchik pinlari (L293D shieldda bo'sh turgan Analog pinlar)
#define TRIG_FRONT A0
#define ECHO_FRONT A1

#define TRIG_BACK  A2
#define ECHO_BACK  A3

// Xavfsiz to'xtash masofasi (santimetrda)
const int SAFE_STOP_DISTANCE = 22; 

// Tezlik (0 dan 255 gacha)
int currentSpeed = 180;

void setup() {
  Serial.begin(115200);
  
  // Datchik pinlarini sozlash
  pinMode(TRIG_FRONT, OUTPUT);
  pinMode(ECHO_FRONT, INPUT);
  pinMode(TRIG_BACK, OUTPUT);
  pinMode(ECHO_BACK, INPUT);

  // Dastlabki motor tezligini o'rnatish
  setMotorsSpeed(currentSpeed);
  stopAll();

  Serial.println("STATUS:READY_L293D");
}

void loop() {
  // 1. Old to'siqni doimiy o'lchash (Xavfsizlik refleski)
  long distFront = readDistance(TRIG_FRONT, ECHO_FRONT);

  // 2. Raspberry Pi-dan buyruq tekshirish
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

      case 'L': // Chapga burilish (joyida)
        turnLeft();
        Serial.println("ACK:LEFT");
        break;

      case 'R': // O'ngga burilish (joyida)
        turnRight();
        Serial.println("ACK:RIGHT");
        break;

      case 'Q': // Chapga yonlama (Mecanum Strafe Left)
        strafeLeft();
        Serial.println("ACK:STRAFE_LEFT");
        break;

      case 'E': // O'ngga yonlama (Mecanum Strafe Right)
        strafeRight();
        Serial.println("ACK:STRAFE_RIGHT");
        break;

      case 'S': // To'xtash
        stopAll();
        Serial.println("ACK:STOP");
        break;

      case '1': // Past tezlik
        currentSpeed = 130;
        setMotorsSpeed(currentSpeed);
        Serial.println("ACK:SPEED_LOW");
        break;

      case '2': // O'rta tezlik
        currentSpeed = 190;
        setMotorsSpeed(currentSpeed);
        Serial.println("ACK:SPEED_MED");
        break;

      case '3': // Yuqori tezlik
        currentSpeed = 250;
        setMotorsSpeed(currentSpeed);
        Serial.println("ACK:SPEED_HIGH");
        break;

      case 'D': // Masofa so'rovi (Ping)
        Serial.print("DIST:");
        Serial.print(distFront);
        Serial.println("cm");
        break;
    }
  }

  // Harakat vaqtida to'satdan to'siq chiqib qolsa avtomatik to'xtatish
  if (distFront > 0 && distFront < SAFE_STOP_DISTANCE) {
    // Agar oldinga ketayotgan bo'lsa darhol to'xtatadi
    stopAll();
  }

  delay(20);
}

// ----------------- MECANUM KINEMATIKASI -----------------

// Oldinga harakat: barcha g'ildiraklar oldinga
void moveForward() {
  motorFL.run(FORWARD);
  motorRL.run(FORWARD);
  motorRR.run(FORWARD);
  motorFR.run(FORWARD);
}

// Orqaga harakat: barcha g'ildiraklar orqaga
void moveBackward() {
  motorFL.run(BACKWARD);
  motorRL.run(BACKWARD);
  motorRR.run(BACKWARD);
  motorFR.run(BACKWARD);
}

// Joyida chapga burilish: chaplar orqaga, o'nglar oldinga
void turnLeft() {
  motorFL.run(BACKWARD);
  motorRL.run(BACKWARD);
  motorRR.run(FORWARD);
  motorFR.run(FORWARD);
}

// Joyida o'ngga burilish: chaplar oldinga, o'nglar orqaga
void turnRight() {
  motorFL.run(FORWARD);
  motorRL.run(FORWARD);
  motorRR.run(BACKWARD);
  motorFR.run(BACKWARD);
}

// Mecanum: Chapga yonlama yurish (burilmasdan parallel)
void strafeLeft() {
  motorFL.run(BACKWARD);
  motorRL.run(FORWARD);
  motorRR.run(BACKWARD);
  motorFR.run(FORWARD);
}

// Mecanum: O'ngga yonlama yurish (burilmasdan parallel)
void strafeRight() {
  motorFL.run(FORWARD);
  motorRL.run(BACKWARD);
  motorRR.run(FORWARD);
  motorFR.run(BACKWARD);
}

// To'liq to'xtatish
void stopAll() {
  motorFL.run(RELEASE);
  motorRL.run(RELEASE);
  motorRR.run(RELEASE);
  motorFR.run(RELEASE);
}

// Barcha motorlarga tezlik o'rnatish
void setMotorsSpeed(int spd) {
  motorFL.setSpeed(spd);
  motorRL.setSpeed(spd);
  motorRR.setSpeed(spd);
  motorFR.setSpeed(spd);
}

// Ultratovush datchigidan masofani o'qish (sm da)
long readDistance(int trigPin, int echoPin) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  // 15ms kutish (maksimum ~2.5 metr)
  long duration = pulseIn(echoPin, HIGH, 20000);
  if (duration == 0) return 999; // To'siq yo'q
  return duration * 0.034 / 2;
}
