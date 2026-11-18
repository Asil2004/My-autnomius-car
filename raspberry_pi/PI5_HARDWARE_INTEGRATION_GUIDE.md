# 🤖 QALQON DASTAVKA ROBOT: RASPBERRY PI 5, LG290P RTK GPS VA MPU-6050 BO'YICHA TO'LIQ QO'LLANMA

Ushbu hujjat yuklangan rasmlar (LG290P RTK GPS moduli, robot shassisi va MPU-6050 datchigi) asosida apparat va dasturiy ta'minotni birlashtirish bo'yicha to'liq qo'llanmadir.

---

## 🛰️ 1. LG290P GNSS RTK Moduli (Waveshare) Tahlili va Tavsiya

**Xulosa: SOTIB OLISH MUTLAQO TAVSIYA ETILADI!**

### Nima uchun aynan shu modul?
1. **Ko'p chastotali (Quad-Band: L1 / L2 / L5 / E5b / B2a)**:
   - Oddiy GPS modullari faqat L1 chastotada ishlaydi va bino yoki daraxtlar tagida signali 5-10 metrga siljib ketadi.
   - LG290P bir vaqtning o'zida GPS, BDS (BeiDou), GLONASS, Galileo va QZSS sun'iy yo'ldoshlarining bir nechta chastotalarini ushlaydi.
2. **Santimetrlik aniqlik (RTK FIXED: 1 - 2 sm)**:
   - Dastavka roboti yo'lakchadan yoki xaritadagi chizilgan chiziq bo'yicha chetga chiqmasdan yurishi uchun aynan santimetrlik aniqlik kerak.
3. **Narxi (1 215 515 so'm ~ 95 USD)**:
   - U-blox ZED-F9P modullari bozorda 250 - 350 dollar turadi. LG290P esa 3 barobar arzon va ko'rsatkichlari bir xil.
4. **Raspberry Pi 5 ga ulanishi**:
   - Modulda **Type-C USB porti** mavjud. Hech qanday lehimlash shart emas — to'g'ridan-to'g'ri Pi 5 ning USB 3.0/2.0 portiga ulanadi. Pi 5 da u avtomatik ravishda `/dev/ttyUSB0` yoki `/dev/ttyACM0` sifatida taniladi.
   - NMEA protokoli (GNGGA, GNRMC) orqali biz yozgan `raspberry_pi/pi5_gps_trackk_bridge.py` skriptiga 100% mos keladi.

---

## 🚗 2. Robot Shassisi va Apparatlarni Joylashtirish Rejasi

Yuklangan 2-rasmda robotning ichki tuzilishi ko'rinmoqda:
- **Old tomonda**: Planshet (haydovchi/mijoz interfeysi va sensor fusion).
- **O'ng tomonda**: 12V akkumulyator (shassi balansi uchun).
- **O'rtada**: 2 ta kuchli DC motor drayveri (BTS7960).
- **Polida**: MPU-6050 giroskop datchigi.

### Raspberry Pi 5 ni joylashtirish:
1. **O'rnatish nuqtasi**: Orqa tarafdagi bo'sh maydonga yoki motor drayverlari ustiga 4 ta plastik/metall ustuncha (standoff) bilan akril taxtacha qo'yib, Pi 5 ni o'sha yerga mahkamlash tavsiya etiladi.
2. **Quvvat manbai (MUHIM!)**: 
   - Raspberry Pi 5 ga barqaror **5V 5A (25W)** quvvat kerak. 
   - 12V akkumulyatordan Pi 5 ga to'g'ridan-to'g'ri ulab bo'lmaydi! 12V -> 5V 5A **DC-DC Step-Down (Buck converter)** qo'yish shart (masalan, XL4015 yoki 5V 5A UBEC).
3. **GNSS Antennasini joylashtirish**:
   - Qora kvadrat GNSS antennani robot korpusi ichiga EMAS, **robotning eng yuqori qismiga** (masalan, ustki qopqog'iga yoki 10-15 sm lik ustunchaga) o'rnatish lozim.
   - Antenna tagiga 10x10 sm metall plastinka (Ground plane) qo'yilsa, sun'iy yo'ldoshlarni tutish tezligi va signali 40% ga yaxshilanadi.

---

## 🧭 3. MPU-6050 Giroskop Yo'nalishi va Saytdan Sozlash

Yuklangan 3-rasmda MPU-6050 sensori shassi poliga termokley bilan qotirilgan.
- **Datchik holati**: Oyoqchalari (VCC, GND, SCL, SDA simlari) **robotning orqa tomoniga** qarab chiqmoqda.
- **Boshqaruv**: Saytimizda to'liq **3D Avtomobil Animatsiyasi** va kalibrovka tizimi mavjud!

### Saytda sozlash qadamlari:
1. Saytga kiring va yuqoridagi **Kompas / Giroskop** tugmasini bosing (yoki Sozlamalar -> Giroskop kalibrlash).
2. Ekranda **3D Real-time Avtomobil Modeli** chiqadi. Mashinani burganingizda animatsiya ham birga buriladi.
3. **Agar giroskop teskari burilayotgan bo'lsa**:
   - **"BURILISH YO'NALISHI (YAW INVERT)"** tugmasini bosing: U `Normal` dan `Inverted (-1)` ga o'tadi va burchak darhol to'g'rilanadi.
4. **Datchik montaj burchagini tanlash**:
   - Datchik simlari orqaga qaragani sababli, **0°**, **90°**, **180°** yoki **270°** tugmalaridan mosini tanlang (odatda 0° yoki 180° to'g'ri keladi).
5. **Nolga sozlash**:
   - Mashinani oldinga to'g'ri qaratib qo'ying va **"Joriy yo'nalishni 0° (To'g'riga) deb belgilash"** tugmasini bosing.
   - Barcha sozlamalar xotirada (`localStorage`) saqlanib qoladi!

---

## ⚡ 4. Raspberry Pi 5 da Barcha Tizimlarni Bir Buyruq Bilan Ishga Tushirish

Raspberry Pi 5 terminalida quyidagi buyruqni ishga tushiring:

```bash
cd ~/repo_autnomius_car
chmod +x raspberry_pi/setup_pi5_all_in_one.sh
./raspberry_pi/setup_pi5_all_in_one.sh
```

Bu skript avtomatik ravishda:
1. `qalqon-hub.service` (Port 8000: LiDAR STL-19P 360° skanerlash + avtotormoz).
2. `qalqon-camera.service` (Port 8090: CP-159-1 3-linzali PTZ kamera oqimi va burish).
3. `qalqon-gps.service` (LG290P RTK GPS -> Trackk Serveri `https://trackk-gl6l.onrender.com/`).
barchasini avtomatik xizmat (systemd service) qilib doimiy fonga qo'yadi. Raspberry Pi yoqilishi bilan hamma narsa o'z-o'zidan ishlab turadi!
