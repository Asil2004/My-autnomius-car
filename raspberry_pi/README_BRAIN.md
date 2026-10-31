# 🛡️ QALQON v1.0 — Raspberry Pi 4 "Miya" (Brain Core) Tizimi

Ushbu modul **"QALQON" IIV Avtonom Patrul Roboti**ning asosiy yuqori bosqich markaziy boshqaruv ("Miya") qismi hisoblanadi.

U Raspberry Pi 4 (Linux), kompyuter yoki telefon orqali sinovdan o'tkazish uchun to'liq moslashuvchan (cross-platform) qilib ishlab chiqilgan.

---

## 1. Modullar Tuzilishi

```
repo_autnomius_car/raspberry_pi/
├── qalqon_brain.py       # Asosiy markaziy server (FastAPI, WebSockets, REST, Taktik Cockpit)
├── lidar_module.py       # 360° LiDAR drayveri (STL-19P / LD19 / RPLiDAR) + Smart Simulyator
├── camera_module.py      # Web-kamera / Yo'lak (Lane Follower) / Odam deteksiyasi / MJPEG
├── arduino_bridge.py     # Arduino Uno L293D bilan ikki tomonlama USB Serial ko'prigi
└── README_BRAIN.md       # Foydalanish va ishga tushirish qo'llanmasi
```

---

## 2. Asosiy Imkoniyatlar

1. **LiDAR Integratsiyasi & Smart Simulyator (`lidar_module.py`)**:
   - **Haqiqiy LiDAR rejimi:** STL-19P / LD19 yoki RPLiDAR USB-ga ulansa, 230400 baudda avtomatik tanib oladi, CRC8 tekshiruvi bilan 360° masofa massivini o'qiydi (10 Hz).
   - **Smart Simulyator rejimi (Hozirgi holat):** Qo'lda jismoniy LiDAR bo'lmasa, dastur to'xtab qolmaydi yoki xato bermaydi! U virtual xona va realistik 360° radar to'lqinlarini hosil qiladi.
   - **Avtotormoz:** Oldingi 0° ±30° sektorda to'siq 0.45 m dan yaqinlashsa, robot avtomatik to'xtaydi.

2. **Kamera & Yo'lni Ko'rish (`camera_module.py`)**:
   - USB Veb-kamera (640x480, 25-30 FPS) yoki sintetik video generatori.
   - **Yo'lak (Lane Follower):** Pol/yo'l chizig'ining markazdan og'ishini hisoblab, avtomatik `F`, `L`, `R`, `S` buyruqlarini beradi.
   - **Yuz / Piyoda (Person) deteksiyasi:** Kadrda inson ko'rinsa yashil taktik quti va ogohlantirish beradi.
   - **MJPEG oqimi:** Ham `/stream.mjpg` (frontend uchun), ham `/video_feed` (cockpit uchun).

3. **Arduino Uno L293D Ko'prigi (`arduino_bridge.py`)**:
   - Linux'da `/dev/ttyACM*`, `/dev/ttyUSB*` yoki Windows'da `COM*` portini avtomatik qidiradi.
   - Arduino ulanmaganda to'xtab qolmaydi — virtual simulyator rejimida buyruqlarni qabul qiladi, sonarlar va batareyani simulyatsiya qiladi.
   - Buyruqlar: `F, B, L, R, Q, E, S`, tezlik `1, 2, 3`, teleskopik minora `U, D`.

4. **Yagona Web Server & Taktik Cockpit (`qalqon_brain.py`)**:
   - Port `8000` da ishlaydi.
   - Telefon yoki kompyuter brauzerida to'liq interaktiv pult, jonli video, aylanuvchi 360° LiDAR radari, sonarlar ko'rsatkichi va xavf signallari.

---

## 3. Ishga Tushirish

### A. Kompyuterda sinab ko'rish:
```bash
cd "D:\Dastavka robot\repo_autnomius_car\raspberry_pi"
python qalqon_brain.py
```

### B. Telefonda ochish:
Telefoningiz kompyuter bilan bir xil Wi-Fi tarmog'ida bo'lsa, telefon brauzerida (Chrome / Safari):
```
http://<KOMPYUTER_IP>:8000
```
(Masalan: `http://10.255.89.119:8000`)

### C. Raspberry Pi 4 da ishga tushirish:
Aynan shu papkani Raspberry Pi 4 ga nusxalang va terminalda:
```bash
sudo apt update && sudo apt install -y python3-opencv python3-serial python3-pip
pip3 install fastapi uvicorn websockets
python3 qalqon_brain.py
```

---

## 4. API Yo'llari (Endpoints)

| Yo'l | Turi | Tavsif |
| :--- | :--- | :--- |
| `/` | GET (HTML) | Smartfon va kompyuter uchun Taktik Cockpit HUD |
| `/stream.mjpg` | GET (Stream) | Jonli MJPEG video oqimi (Frontend uchun) |
| `/video_feed` | GET (Stream) | Jonli video oqimi (Cockpit uchun) |
| `/cmd?c=F` | GET | Harakat buyrug'i (`F`, `B`, `L`, `R`, `Q`, `E`, `S`, `U`, `D`) |
| `/cmd?speed=2` | GET | Tezlik darajasini o'rnatish (`1`, `2`, `3`) |
| `/toggle_mode` | GET | `MANUAL` va `AUTO_LANE` rejimlari orasida almashish |
| `/api/telemetry` | GET (JSON) | LiDAR 360° nuqtalari, sonarlar, batareya, robot holati |
| `/api/obstacle?dist=0.35` | GET | Oldinda virtual to'siq hosil qilish / sinash |
| `/ws` | WebSocket | 10 Hz real-vaqtli telemetriya oqimi |
| `/face` | GET (HTML) | Planshet yuzi (kiber-ko'zlar va SOS 102 ekrani) |
