# 🛡️ QALQON - Raspberry Pi 3 Model B Uchun Maxsus Kamera Serveri

Ushbu modul **Raspberry Pi 3 Model B** uchun maxsus optimallashtirilgan bo'lib, unga robotning og'ir neyrotarmoqlari yoki LiDAR drayverlarini yuklamasdan, **faqat Wi-Fi Smart Kamerani (CP-159-1-WIFI / V380 Pro / iCSee 3-linzali PTZ)** avtomatik topish, unga ulanish va videoni brauzerga uzatish vazifasini bajaradi.

---

## ⚡ Asosiy Afzalliklari (Pi 3B uchun):
1. **Minimal Resurs Talabi:** Xotiradan atigi ~40 MB RAM oladi, CPU yuklanishi 10-15% dan oshmaydi.
2. **To'liq Avtomatik Ulanish (Auto-Discovery):** Tarmoqdagi kamerani (IP manzilini) o'zi 1-2 soniyada topadi, qo'lda IP yozish shart emas.
3. **3 ta Linzaning barchasini ko'rsatadi:** 
   - Linz 1: Asosiy PTZ kamera
   - Linz 2: Ikkinchi PTZ kamera
   - Linz 3: 360° Panoramik pastki kamera
4. **Veb-interfeys (Web Dashboard):** Telefon, kompyuter yoki planshetdan to'g'ridan-to'g'ri brauzer orqali ko'rish (`http://<PI_IP>:8080`).
5. **Avtomatik qayta ulanish (Watchdog):** Kamera o'chib yonsa yoki Wi-Fi uzilsa, o'zi qayta ulanadi.
6. **Avto-start (Systemd Service):** Raspberry Pi ga tok berishingiz bilan server o'z-o'zidan ishga tushadi.

---

## 📥 Raspberry Pi 3B ga O'rnatish (1 ta buyruq):

Raspberry Pi 3 terminaliga kiring va quyidagi buyruqni bering:

```bash
cd /home/pi/qalqon/pi3_camera_node
chmod +x install_pi3.sh
./install_pi3.sh
```

Ushbu skript:
1. `python3-opencv` va kerakli modullarni o'rnatadi.
2. `qalqon-camera.service` ni tizimga ro'yxatdan o'tkazadi va faollashtiradi.

---

## 🖥️ Qo'lda Ishga Tushirish (Sinov uchun):

Agar xizmat (service) qilmasdan, darhol sinab ko'rmoqchi bo'lsangiz:

```bash
cd /home/pi/qalqon/pi3_camera_node
python3 pi3_camera_server.py
```

Brauzerda oching:
```text
http://<RASPBERRY_PI_IP>:8080
```

---

## ⚙️ Foydali Buyruqlar:

- **Server holatini ko'rish:**
  ```bash
  sudo systemctl status qalqon-camera
  ```
- **Jonli loglarni kuzatish:**
  ```bash
  sudo journalctl -u qalqon-camera -f
  ```
- **To'xtatish yoki qayta ishga tushirish:**
  ```bash
  sudo systemctl restart qalqon-camera
  sudo systemctl stop qalqon-camera
  ```
