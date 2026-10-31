# 🧠 QALQON v1.0 — "Miya" (Raspberry Pi 4) Dasturiy Ta'minoti Bo'yicha Yagona Rasmiy Hisobot va Ish Rejasi

> 👤 **Mas'ul muhandis (Kim):** Boburjon — "Miya" (Raspberry Pi 4) dasturiy ta'minoti, xavfsizlik arxitekturasi va tizim integratori (Software & Brain Core Lead)  
> 📅 **Oxirgi yangilanish (Qachon):** 31-Oktabr, 2026-yil | 22:40 (Toshkent vaqti, UTC+5)  
> 🔗 **Loyiha repozitoriysi:** [https://github.com/Asil2004/My-autnomius-car](https://github.com/Asil2004/My-autnomius-car)  
> 📌 **Eslatma:** Ushbu fayl Asilbekning [`MEXATRONIKA_HISOBOT_VA_REJA.md`](MEXATRONIKA_HISOBOT_VA_REJA.md) hamda Sarvarning [`UI_uchun_bajarilgan_ishlar.md`](UI_uchun_bajarilgan_ishlar.md) hujjatlari qatorida **"Miya" (Brain Core) bo'yicha yagona rasmiy hisobot hujjati** hisoblanadi. Barcha yangilanishlar va qilingan ishlar muntazam ravishda shu faylga qayd etib boriladi.

---

## 🕒 QADAMMA-QADAM YANGILANISHLAR VA IJRO JURNALI (AUDIT LOG)

Quyidagi jadvalda "Miya" (Raspberry Pi 4) yo'nalishida amalga oshirilgan har bir dasturiy yangilanish, kim tomonidan va qaysi vaqtda bajarilgani qayd etib boriladi:

| № | Qachon (Sana va Vaqt) | Kim (Mas'ul xodim) | Bajarilgan vazifa va Yangilanish mazmuni | Holat / Natija |
| :---: | :---: | :---: | :--- | :---: |
| **01** | 2026-10-31 \| 15:10 | **Boburjon** (Miya Lead) | **LiDAR Moduli (`lidar_module.py`):** STL-19P/LD19 apparat drayveri va 360° virtual to'siq hosil qiluvchi aqliy simulyator yaratildi | `Bajarildi` |
| **02** | 2026-10-31 \| 15:15 | **Boburjon** (Miya Lead) | **Kamera Moduli (`camera_module.py`):** USB kamera drayveri, ko'p oqimli MJPEG video strimi (`/stream.mjpg`) va piyodalar deteksiyasi yaratildi | `Bajarildi` |
| **03** | 2026-10-31 \| 15:20 | **Boburjon** (Miya Lead) | **Arduino Ko'prigi (`arduino_bridge.py`):** 115200 baudda avtomatik port qidiruvchi va simulyatsiya rejimiga ega xavfsiz drayver ishlab chiqildi | `Bajarildi` |
| **04** | 2026-10-31 \| 15:35 | **Boburjon** (Miya Lead) | **Boshqaruv Yadrosi (`qalqon_brain.py`):** FastAPI, WebSocket telemetriya (`/ws`), REST API va mobil smartfon HUD kodi yaratildi | `Bajarildi` |
| **05** | 2026-10-31 \| 20:34 | **Boburjon** (Miya Lead) | **Xavfsizlik Nazorati (Safety Supervisor):** To'siq < 0.45m bo'lganda avto-tormoz, oldinga harakatni qulflash (`🔒 BLOK`) va chekinish yo'llarini ochiq qoldirish joriy etildi | `Bajarildi` |
| **06** | 2026-10-31 \| 20:35 | **Boburjon** (Miya Lead) | **Dual-Port Server (8000 & 8080):** Mobil Wi-Fi hotspot tarmoqlarida uzluksiz ochilish uchun parallel portlar va Windows xavfsizlik devori qoidalari sozlandi | `Bajarildi` |
| **07** | 2026-10-31 \| 21:08 | **Boburjon** (Miya Lead) | **GitHub integratsiyasi va push:** `bozorovboburjon408-art` akkaunti orqali barcha Miya kodlari asosiy repoga jo'natildi (`commit: 10cf676`) | `Bajarildi` |
| **08** | 2026-10-31 \| 21:23 | **Boburjon** (Miya Lead) | **Butun Loyihani Birlashtirish (Full Integration):** Sarvarning planshet frontendiga jonli WebSocket ulandi, Asilbekning teleskopik minorasi (`U`/`D`) HUD'ga kiritildi (`commit: 72225c0`) | `Bajarildi` |
| **09** | 2026-10-31 \| 22:40 | **Boburjon** (Miya Lead) | **Yagona hisobot standarti:** `MIYA_UCHUN_BAJARILGAN_ISHLAR.md` rasmiy hujjati joriy etildi va repozitoriya boshqaruviga ulandi | `Bajarildi` |

---

## 🏛️ 1. "Miya" (Raspberry Pi 4) Tizim Arxitekturasi

QALQON roboti "Miya"si markazlashtirilgan asinxron ko'p oqimli arxitekturaga ega:

```mermaid
graph TD
    subgraph Datchiklar va Tashqi Qurilmalar
        CAM[USB Web-Kamera /dev/video0]
        LIDAR_HW[360° LiDAR STL-19P / LD19: 230400 baud]
        ARDUINO_HW[Arduino Uno L293D Shield: 115200 baud]
    end

    subgraph Raspberry Pi 4 Miya Yadrosi
        CAM_MOD[CameraModule: OpenCV MJPEG Stream 30 FPS]
        LIDAR_MOD[LidarModule: 360° Radar & Smart Simulator]
        ARD_MOD[ArduinoBridge: Serial Bridge & Telemetry]
        
        SAFETY[Safety Supervisor: 20 Hz Xavfsizlik Nazorati]
        API_SERVER[FastAPI & WebSockets: Port 8000 & 8080]
    end

    subgraph Foydalanuvchi va Boshqaruv Interfeyslari
        TABLET[Sarvar: 8.7" Planshet Frontend UI]
        PHONE[Smartfon / Noutbuk Taktik Cockpit]
    end

    CAM --> CAM_MOD
    LIDAR_HW --> LIDAR_MOD
    ARDUINO_HW <--> ARD_MOD

    LIDAR_MOD --> SAFETY
    ARD_MOD --> SAFETY
    SAFETY -->|Favqulodda Avto-Tormoz| ARD_MOD

    CAM_MOD --> API_SERVER
    LIDAR_MOD --> API_SERVER
    ARD_MOD --> API_SERVER

    API_SERVER <-->|WebSocket: /ws & MJPEG: /stream.mjpg| TABLET
    API_SERVER <-->|REST & WebSocket| PHONE
```

---

## 🛡️ 2. Xavfsizlik va To'siqqa Reaksiya Mantiqi (Safety Supervisor)

Jamoamiz kelishuviga ko'ra, robot harakati **to'liq qo'lda tugmalar orqali boshqariladi**, ammo to'siq chiqqanda **avtomatik himoya refleksi** ishga tushadi:

```mermaid
flowchart TD
    SensorLoop["Har 50 ms (20 Hz) Datchiklar Tekshiruvi"] --> Check{"Oldinda to'siq bormi? (LiDAR < 0.45m yoki Sonar < 25sm)"}
    Check -- "YO'Q (Yo'l ochiq)" --> ClearState["Yo'l ochiq: barcha buyruqlar (F, B, L, R, Q, E) faol"]
    Check -- "HA (Xavfli to'siq!)" --> Action1["1. Robot oldinga ketayotgan bo'lsa -> Darhol Avto-Tormoz ('S')"]
    Action1 --> Action2["2. 'F' (Oldinga) buyrug'i qat'iy QULFLANADI (🔒 BLOKLANDI)"]
    Action2 --> Action3["3. Qizil xavf banneri va brauzer/planshetda buzzer ovozi yangraydi"]
    Action3 --> Escape["4. Chekinish yo'llari OCHIQ QOLADI: 'B' (Orqaga), 'L'/'R' (Burilish)"]
    Escape --> Recheck{"Robot to'siqdan uzoqlashdimi?"}
    Recheck -- "HA" --> Unlock["'F' (Oldinga) harakati avtomatik ravishda qayta ochiladi"]
```

---

## 🤝 3. Jamoadoshlar Bilan Integratsiya Shartnomasi (API Contract)

### 📱 A. Sarvar bilan integratsiya (Planshet / Frontend):
1. **Jonli Video Oqimi:** `http://<RPI_IP>:8000/stream.mjpg`
2. **Real-Vaqt Telemetriya (WebSocket):** `ws://<RPI_IP>:8000/ws`
   - Har 100 ms da to'liq telemetriya JSON uzatiladi:
     ```json
     {
       "sonars": { "front": 65, "rear": 120, "left": 80, "right": 85 },
       "battery": { "voltage": 12.8, "percentage": 90, "temp": 28.0, "current": 1.3, "isCharging": false },
       "lidar": { "mode": "SIMULATION", "rate_hz": 10.0, "points": [ { "angle": 0, "distance": 2.5, "intensity": 200 } ] },
       "motion": { "last_cmd": "S", "speed_level": 2, "is_moving": false, "obstacle_warning": false },
       "is_front_blocked": false,
       "strobe": false,
       "siren": false
     }
     ```
3. **Boshqaruv Buyruqlari:** `http://<RPI_IP>:8000/cmd?c=<F|B|L|R|Q|E|S|U|D>&speed=<1|2|3>`
4. **Stroboskop va Sirena:** `http://<RPI_IP>:8000/strobe` va `http://<RPI_IP>:8000/siren`

### ⚙️ B. Asilbek bilan integratsiya (Mexatronika va Arduino Uno):
1. **Aloqa kanali:** USB Serial kabeli orqali `115200` baud.
2. **Miya uzatadigan buyruqlar:**
   - `F` — Oldinga, `B` — Orqaga, `L` — Chapga (tank burilishi), `R` — O'ngga.
   - `S` — To'xtash (tormoz).
   - `1`, `2`, `3` — Tezlik bosqichlari (140, 190, 255 PWM).
   - `U` — Teleskopik minorani ko'tarish (Pin 9).
   - `D` — Teleskopik minorani tushirish (Pin 10).
3. **Arduino qaytaradigan signallar:** `ACK:FORWARD`, `WARN:OBSTACLE_FRONT`, `ACK:STOP`.

---

## 📁 4. "Miya" Papkasining Strukturasi

```text
raspberry_pi/
├── qalqon_brain.py        <-- Asosiy boshqaruv serveri, dual-port, WebSocket va xavfsizlik nazorati
├── lidar_module.py        <-- STL-19P/LD19 LiDAR drayveri va 360° virtual simulyator
├── camera_module.py       <-- Web-kamera MJPEG oqimi va odam deteksiyasi
├── arduino_bridge.py      <-- Arduino Uno L293D serial aloqa drayveri
├── start_brain.sh         <-- 1-bosishda tizimni to'liq ishga tushirish skripti
├── requirements.txt       <-- Zarur Python kutubxonalari
└── README_BRAIN.md        <-- Modullarning texnik yo'riqnomasi
```

---

## 🚀 5. Ertangi Real Robot Sinovining Bosh Rejasi

1. **Stol ustida (havoda) sinov:** G'ildiraklarni havoda ushlab, `F`, `B`, `L`, `R` yo'nalishlarini va `U`, `D` minora aktuatorini tekshirish.
2. **Datchik refleksi:** `F` ketayotganda datchik oldiga qo'l qo'yib, robot 20 sm dan avtomatik tormozlanishini va oldinga qulflanishini sinash.
3. **Pol ustida erkin patrul:** Robotni polga qo'yib, planshet va telefon orqali erkin haydash.
