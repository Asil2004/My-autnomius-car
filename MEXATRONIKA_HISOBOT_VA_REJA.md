# ⚙️ QALQON v1.0 — Mexatronika va Konstruksiya Bo'yicha Yagona Hisobot va Ish Rejasi

> **Mas'ul xodim (Rol):** Mexatronika va apparat konstruksiyasi bo'yicha bosh muhandis (Mechatronics & Hardware Lead)  
> **Loyiha repozitoriysi:** [https://github.com/Asil2004/My-autnomius-car](https://github.com/Asil2004/My-autnomius-car)  
> **Oxirgi yangilanish sanasi:** 2026-10-31  
> **Holat:** Faol ishlab chiqish bosqichida (Active In-Progress)

---

## 📌 Asosiy Kanonik Dizayn Konsepsiyasi

Jamoamiz tomonidan tasdiqlangan bosh model: **QALQON v1.0 Police Patrol Robot Prototype**

![Qalqon v1.0 Dizayn Posteri](docs/images/qalqon_v1_poster.jpg)

### 📐 Asosiy Konstruktiv Talablar va Gabaritlar:
* **Korpus shakli:** **$\varnothing = 500\text{ mm}$ Yarim shar (Hemisphere dome)** aerodinamik va jiddiy patrul shakli.
* **Tashqi o'lchamlar:** Eni: $450\text{ mm}$ | Bo'yi: $550\text{ mm}$ | Balandligi: $450\text{ mm}$ (yuqori kamera minorasi bilan).
* **Umumiy loyihaviy og'irlik:** $20 - 28\text{ kg}$ (pastga tushirilgan og'irlik markazi bilan).
* **Harakatlanish usuli:** **4WD Mecanum** mustaqil g'ildirakli platforma (joyida 360° burilish va burilmasdan yonboshga strafe harakati).
* **Himoya darajasi:** Chang va chayqaladigan yomg'ir suvidan himoyalangan **IP54** germetiklik standarti.

---

## 🏗️ Mexatronika Qismining Qavatma-Qavat (Exploded View) Arxitekturasi

```mermaid
graph TD
    subgraph 1-Qavat [Eng Yuqori: Sensor va Signal Minorasi]
        CAM360[360° Panoramik Kamera / Fisheye 5MP]
        STROBE[Politsiya Miqalkasi + 12V LED Sirena]
        PROJ[2 dona Boshqariladigan LED Proyektor: Servomotorli]
    end

    subgraph 2-Qavat [Tashqi Gumbaz: 500 mm Yarim Shar]
        DOME[Ø 500 mm ABS / Shisha-plastik Yarim Shar Qoplama]
        FRONTCAM[Old Kamera Moduli: Yuqoriga 15° qiya o'rnatilgan]
        SPEAKER[5W Dinamik + Mikrofon panjarasi]
    end

    subgraph 3-Qavat [Elektronika Steki: Vertikal Raf / Mezonin]
        RPI[Raspberry Pi 3/4/5: Yuqori Aql / AI / Aloqa]
        ARDUINO[Arduino Uno: Quyi Refleks / PWM Boshqaruv]
        DRIVER[Motor Drayveri: L293D / BTS7960]
        STEPDOWN[DC-DC Step-Down UBEC Quvvat Transformatorlari]
    end

    subgraph 4-Qavat [Quvvat va Shassi: Pastki Asos]
        BASE[4 mm Alyuminiy Dural (D16T) Qattiq Asos Plitasi]
        BATTERY[12V LiFePO4 / Li-ion Akkumulyator Batareyasi: 15-20Ah]
        MOTORS[4 ta 12V Reduktorli DC Motor: 60-100 RPM po'lat L-kronshteynda]
        WHEELS[4 ta 100-130 mm Mecanum Rolikli G'ildiraklar]
        SONARS[4 tomonlama HC-SR04 Ultratovush To'siq Datchiklari]
    end

    CAM360 --> DOME
    STROBE --> DOME
    PROJ --> DOME
    DOME --> BASE
    FRONTCAM --> DOME
    SPEAKER --> DOME
    RPI --> BASE
    ARDUINO --> BASE
    DRIVER --> BASE
    BATTERY --> BASE
    MOTORS --> BASE
    MOTORS --> WHEELS
    SONARS --> BASE
```

---

## 📋 Amalga Oshirilgan Ishlar Hisoboti (Changelog)

### [2026-10-31] — 1-Bosqich: Shassi Sinovi va Repozitoriy Tuzilishi
* ✅ **Mecanum test platformasi yig'ildi:** 4 ta motorli L293D drayverli dastlabki maket tayyorlandi va harakat kinematikasi tekshirildi.
* ✅ **Arduino boshqaruv dasturi yozildi:** [`arduino_l293d_patrol.ino`](arduino/arduino_l293d_patrol/arduino_l293d_patrol.ino) orqali oldinga, orqaga, burilish va yonlama strafe harakatlari sozlandi.
* ✅ **Raspberry Pi veb-kontrolleri yaratildi:** Port 8000 da jonli kamera videosi va klaviatura/tugmalar integratsiyasi sinovdan o'tkazildi.
* ✅ **Old ultratovush tormozi ulandi:** 22 sm masofada to'qnashuvdan asrovchi avtomatik tormoz mantig'i kiritildi.
* ✅ **Yangi standart tasdiqlandi:** $\varnothing 500\text{ mm}$ yarim shar gumbazli Qalqon v1.0 dizayniga o'tish belgilandi va GitHub repozitoriyasiga deploy qilindi.

---

## 🎯 Mexatronik Muhandisning Kelgusi Vazifalar Rejasi (To-Do List)

Jamoaviy GitHub loyihasida mening zimmamdagi aniq texnik topshiriqlar va ularning bajarilish holati:

### 1. Korpus va Gumbaz Ishlab Chiqarish (Ø 500 mm Yarim Shar)
- [ ] **1.1.** 500 mm tashqi diametrli yarim shar CAD 3D modelini (SolidWorks / Fusion 360) yaratish (`STEP` va `STL` formatlarda).
- [ ] **1.2.** Yarim shar gumbazini tayyorlash texnologiyasini tanlash:
  - *A variant:* 3D printerda 4 ta segmentga bo'lib chop etish (PETG / ABS) va atseton/dikloroetan bilan payvandlab jilvirlash.
  - *B variant:* Vakuumli qoliplash (Vacuum forming) usulida 3 mm shaffof/oq polistirol yoki ABS listdan tortish.
- [ ] **1.3.** Old kamera linzasi va sensorlar uchun texnologik darchalar (oynalar) ochish.
- [ ] **1.4.** Yuqori minoracha o'rnatish uchun gumbaz tepasida tekis gardish (flanets, diametri 120 mm) hosil qilish.

### 2. Pastki Asos Plitasi va Motorlar Montaji
- [ ] **2.1.** 4 mm qalinlikdagi D16T (alyuminiy) asos plitasining lazer/suv oqimida (waterjet) kesish chizmasini (`DXF`) tayyorlash.
- [ ] **2.2.** 4 ta DC reduktorli motorni tebranishga qarshi rezina vtulkalar (rubber dampers) orqali 3 mm po'lat L-kronshteynga bolt bilan qotirish.
- [ ] **2.3.** Mecanum g'ildirak roliklari yo'nalishini yuqoridan qaralganda qat'iy **`X`** shaklida montaj qilish.
- [ ] **2.4.** Pastki shassi tozaligini (klirens = 35–45 mm) saqlash va piyodalar yo'lagidagi notekisliklarga bardoshli qilish.

### 3. Ichki Elektronika Tokchalari (Stoyka Mezonini)
- [ ] **3.1.** Akkumulyator (12V LiFePO4) fiksatori: batareyani shassining eng past markaziga qattiq lenta va kronshteyn bilan mahkamlash (og'irlik markazini tushirish uchun).
- [ ] **3.2.** 2 qavatli akril yoki alyuminiy elektronika mezonini loyihalash:
  - 1-polka: L293D / BTS7960 drayveri, DC-DC stabilizatorlar, saqlagichlar bloki.
  - 2-polka: Arduino Uno va Raspberry Pi (tebranishni yutuvchi silikon podushkalarda).
- [ ] **3.3.** Ichki simlar uchun kabel-kanallar (cable routing) va M12 germetik kabel o'tkazgichlar (cable glands) o'rnatish.

### 4. Yuqori Sensor Minorachasi va Aktuatorlar
- [ ] **4.1.** 360° panoramik kamera va favqulodda stroboskop (qizil/ko'k LED) minora korpusini tayyorlash.
- [ ] **4.2.** 2 dona old LED proyektor uchun 2 o'qli (Pan-Tilt) servomotorli burilish mexanizmini yig'ish.
- [ ] **4.3.** Favqulodda to'xtatish (E-Stop) tugmasini korpusning orqa qismiga, xavfsiz va suv kirmaydigan holatda o'rnatish.

---

## 🤝 Jamoa A'zolari Bilan Integratsiya Nuqtalari

Mexatronik qism jamoaning boshqa yo'nalishlari bilan quyidagi interfeyslar orqali bog'lanadi:

1. **Dasturiy ta'minot (Software / AI Lead) guruhiga:**
   * Kamera balandligi: yerdan $380\text{ mm}$, nishablik burchagi: $15^\circ$ pastga.
   * Enkoder piksellari va motor reduktor koeffitsiyenti: 1 metr yurish uchun g'ildirakning $N$ aylanishi hisobi topshiriladi.
2. **Elektronika va Sxemotexnika (Electronics Lead) guruhiga:**
   * Motorlarning maksimal to'xtash (stall) toki: $3.5\text{ A}$ (har bir motor uchun).
   * Akkumulyator o'lchamlari va sovutish teshiklari joylashuvi kelishiladi.

---

*Eslatma: Har bir yangi mexanik detal tayyorlanganda yoki chizma o'zgarganda ushbu fayl yangilanadi va GitHub-ga commit qilib boriladi.*
