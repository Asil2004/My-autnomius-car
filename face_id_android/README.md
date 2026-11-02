# QALQON Face ID — On-Device Tactical Biometric Vision Module

Production-grade, modular, native on-device Android Face ID application built for autonomous security robot systems.

---

## 1. Key Architectural Features

- **TFLite MobileFaceNet Engine:**
  - 112×112 RGB input tensor with `(pixel - 127.5) / 128.0` normalization.
  - 192-dimensional unit-norm L2 embeddings.
  - Optimized 4-thread CPU inference (sub-25ms per face on mid-range ARM64).
  - Cosine similarity matching via normalized dot product.

- **Google ML Kit Face Detection:**
  - Fast performance mode with 60 FPS camera tracking.
  - Landmark extraction (eyes, nose, mouth) & Euler rotation angles.
  - Dynamic eye-blink detection & micro-motion liveness verification.

- **Offline Biometric Database (Room SQLite):**
  - Encrypted/local persistence of face embeddings and identities.
  - Preloaded with authorized personnel (Qo'ldoshev Sarvar, Asilbek Ravshanov, Bozorov Boburjon).
  - Complete CRUD support with millisecond search times.

- **6 Dedicated Tactical UI Screens:**
  1. `MainActivity`: Real-time camera feed, tactical cyber HUD, telemetry, instant identity recognition.
  2. `AddPersonActivity`: Multi-sample biometric registration with camera guidance.
  3. `RegisteredPeopleActivity`: Database view, search filter, and quick navigation.
  4. `PersonDetailsActivity`: Biometric vector stats (192-d preview), timestamps, and deletion.
  5. `SettingsActivity`: Similarity threshold tuning (40% - 95%), liveness toggle, frame throttling.
  6. `AdminLoginActivity`: Protected PIN authorization (Default: `102102`).

---

## 2. Package Structure

```
face_id_android/
├── app/
│   ├── src/main/
│   │   ├── assets/
│   │   │   ├── mobile_face_net.tflite
│   │   │   └── preload/
│   │   ├── java/uz/iiv/faceid/
│   │   │   ├── camera/          # CameraX lifecycle, overlays, bitmap utils
│   │   │   ├── database/        # Room Database, FaceEntity, FaceDao
│   │   │   ├── detection/       # ML Kit face detector engine
│   │   │   ├── embedding/       # TFLite MobileFaceNet model inference
│   │   │   ├── recognition/     # Biometric vector matcher & scoring
│   │   │   ├── registration/    # Person enrollment pipeline
│   │   │   ├── security/        # Liveness & anti-spoofing detector
│   │   │   ├── settings/        # SharedPreferences config
│   │   │   └── ui/              # 6 UI Activities
```

---

## 3. Build & Installation

### Prerequisites
- Android SDK 34 (API 24+)
- JDK 17
- Gradle 8.13+

### Command Line Build
```bash
cd face_id_android
./gradlew assembleDebug
```

### Install to Connected Device
```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n uz.iiv.faceid/.ui.main.MainActivity
```
