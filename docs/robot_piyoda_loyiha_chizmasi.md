# 🤖 Piyodalar Yo'lagi Avtonom Kuryer/Xizmatchi Roboti — To'liq Texnik Loyiha Chizmasi

````carousel
![To'rtburchak Zirhlangan Asosli Jiddiy IIV Patrul Minorasi: 1.18m Balandlik, Metall Bullbar, Sergak Kiber-Optika va 360° PTZ](/C:/Users/MSI/.gemini/antigravity/brain/784181a7-3162-4a80-8c60-d653098b060a/police_patrol_robot_render_1793213394831.jpg)
<!-- slide -->
![Silliq Aerodinamik Minora Talqini](/C:/Users/MSI/.gemini/antigravity/brain/784181a7-3162-4a80-8c60-d653098b060a/patrol_robot_tower_clean_render_1793213092572.jpg)
<!-- slide -->
![Texnik Ko'rsatkichli Minora Chizmasi: Barcha Sensorlar va Datchiklar Belgisi](/C:/Users/MSI/.gemini/antigravity/brain/784181a7-3162-4a80-8c60-d653098b060a/patrol_robot_tower_render_1793213064210.jpg)
<!-- slide -->
![IIV Patrul Kuryeri: Oq-Ko'k Liveri, 102 SOS](/C:/Users/MSI/.gemini/antigravity/brain/784181a7-3162-4a80-8c60-d653098b060a/police_patrol_robot_render_png_1793212848203.jpg)
````

Ushbu hujjat piyodalar yo'lagida (trotuar), parklarda va insonlar gavjum joylarda mustaqil harakatlana oladigan avtonom mobil robot platformasining to'liq konstruktiv, kinematik va elektron arxitektura chizmasidir.

---

## 1. To'rtburchak Zirhlangan Shassi va Salobatli Minora Konseptsiyasi

Robot nozik o'yinchoq yoki multfilm uslubida emas, balki **jamoat joylarida qat'iy intizom, xavfsizlik va sergaklik hissini uyg'otuvchi rasmiy IIV taktik patrul minorasi** sifatida loyihalandi:
* **Umumiy balandlik:** **\(1.18 \text{ m}\)** (\(1180 \text{ mm}\), odam ko'krak darajasidan baland, nufuzli vertikal salobat).
* **Asos (Shassi) o'lchami:** **\(550 \times 420 \text{ mm}\)** — mustahkam to'rtburchak po'lat/kompozit zirhlangan korpus.
* **Old Himoya Bamperi (Bullbar):** Pastki ultratovush datchiklarini tosh, to'qnashuv va zarbalardan himoyalovchi metall to'siq.
* **G'ildiraklar:** 4 ta yo'ltanlamas rezina shinalar zirhlangan qanotlar (arched armor fenders) ichiga kiritilgan.
* **Yuzi va Ko'zlari:** Multfilm kulgichi o'rniga — **qat'iy, hushyor va fokuslangan kiber-optik skaner ko'zlari (Alert Cybernetic HUD)**.
* **Og'irlik:** Taxminan \(25 - 30 \text{ kg}\) (Zirhlangan po'lat karkas va tubidagi og'ir akkumulyator hisobiga juda mustahkam, ag'darilmaydi).

```
                      ◀─────── 420 mm (Eni) ───────▶
                                ╭─────────────╮
                                │ LD19 LIDAR  │
                         ╭──────┴─────────────┴──────╮  ▲
                         │ 🎥 360° Motorli PTZ Kamera│  │
                      ╭──┴───────────────────────────┴──╮│
                      │ 🚨 360° QIZIL/KO'K POLIKARBONAT ││
                      │    STROBOSKOP HALQASI           ││
                      │─────────────────────────────────││
                      │                                 ││
                      │   📱 ZIRHLI EKRAN (1.0m sath)   ││
                      │      * Hushyor kiber-ko'zlar    ││ 1.18 m
                      │      * [ 🆘 102 ALOQA TUGMASI ] ││ (Balandlik)
                      │                                 ││
                      │   📢 AKUSTIK POLITSIYA SIRENASI ││
                      │─────────────────────────────────││
                      │   🛡️ TO'RTBURCHAK ZIRHLI KORPUS ││
                      │      IIV "PATRUL" (Reflektor)   ││
                      │─────────────────────────────────││
                      │   🔋 12V 25Ah LiFePO4 (Tubda)   ││
                      │─────────────────────────────────││
                      │ [===] METALL HIMOYABAMPER [===] ││
                     [=======]                         [=======]▼
                   Zirhli Shina                      Zirhli Shina
```

---

## 2. Ko'p Qavatli Modulli Korpus Arxitekturasi

Robot korpusi og'irlik markazini yerga maksimal yaqinlashtirish va datchiklarning ko'rish burchaklarini to'liq ochish uchun **4 ta funktsional qavatga** bo'lingan:

```mermaid
flowchart TD
    subgraph TEPASI["4-QAVAT: SENSOR VA HARAKATLANUVCHI MINORA (Balandlik: 850 - 950 mm)"]
        Lidar["📡 LD19 360° LiDAR (Lazerli Xaritalash)"]
        PTZCam["🎥 360° Motorli Harakatlanuvchi PTZ Kamera (360° Gorizontal aylanadi & 90° Egiladi)"]
        Strobe["🚨 Ko'k va Qizil Politsiya Stroboskop Mayoqlari (360° ogohlantirish)"]
        Antenna["📶 Wi-Fi / 4G Telemetriya Antennasi"]
    end

    subgraph OQIL["3-QAVAT: INTELLEKT VA PLANSHET MULOQOT QAVATI (Balandlik: 550 - 850 mm)"]
        Tablet["📱 7 - 10.1\" Zirhli Planshet (Jonli Robot Ko'zlari & PIN-kod Klaviaturasi)"]
        Headlights["💡 Kuchli Zamonaviy LED Faralar (Tunda yo'lni yoritish uchun)"]
        Speaker["📢 Ovozli ogohlantirish karnayi (Trotuardagilarga nutq & signal)"]
        RPi["🧠 Raspberry Pi 4/5 (Asosiy Miya)"]
    end

    subgraph YUK["2-QAVAT: KURYER VA FOYDALI YUK (Balandlik: 250 - 550 mm)"]
        Cargo["📦 Yuk bo'limi (Termo-boks yoki kuryer kassetasi, elektr qulflangan)"]
    end

    subgraph SHASSI["1-QAVAT: KUCH VA SHASSI QAVATI (Balandlik: 0 - 250 mm)"]
        Motors["⚙️ 4x Kuchli DC Reduktorli Motorlar (12V High-Torque)"]
        Tires["🛞 4x 130mm Katta Kauchuk Shinalar"]
        Drivers["⚡ 2x BTS7960 (43A) yoki L298N Motor Drayverlari"]
        Battery["🔋 12V LiFePO4 / Li-ion Akkumulyator (Og'irlik markazi tubda)"]
        Ultrasonic["📡 3x Ultratovush (HC-SR04) Massivi (Chap, Markaz, O'ng)"]
    end

    TEPASI --> OQIL
    OQIL --> YUK
    YUK --> SHASSI
```

---

## 3. Sensorlar Joylashuvi va Qamrov Zonasi (FOV)

Piyodalar yo'lagidagi turli xil to'siqlarni aniqlash uchun datchiklarning o'rnatilish balandligi juda nozik hisob-kitob qilingan:

| Sensor / Yoritish | Joylashuv balandligi | Yo'nalishi | Asosiy vazifasi |
| :--- | :--- | :--- | :--- |
| **LD19 360° Lidar** | **\(900 - 950 \text{ mm}\)** (Eng yuqori) | Gorizontal \(360^\circ\) tekislik | 12 metrgacha to'siqlarni lazerli xaritalash (SLAM navigatsiya). |
| **360° Motorli PTZ Kamera** | **\(850 - 900 \text{ mm}\)** (Lidar ostida) | \(360^\circ\) gorizontal, \(90^\circ\) vertikal | Odamlar va xavflar tomon **faol aylanib qarash**, chorrahalarda o'ng-chapni tekshirish, uy raqamlarini o'qish va operator nazorati. |
| **LED Faralar (Headlights)** | **\(600 \text{ mm}\)** (Old visor ostida) | Oldinga, yerga \(10^\circ\) | Kechasi va qorong'ida yo'lni, piyodalar yo'lagini 10 metrgacha yorqin yoritish. |
| **Politsiya Stroboskoplari**| **\(880 \text{ mm}\)** (Tom chetlarida) | Perimetr bo'ylab | Trotuarda yurayotganda odamlarni sekin yoki tezkor miltillash bilan xavfsiz ogohlantirish. |
| **Ultratovush 1 (Chap)** | **\(180 \text{ mm}\)** | Old-chapga \(35^\circ\) | Chapdagi bordyur, panjara yoki piyodalar oyoqlarini yaqindan payqash. |
| **Ultratovush 2 (Markaz)** | **\(180 \text{ mm}\)** | To'g'riga \(0^\circ\) | Bevosita oldindagi 1 metr masofadagi past to'siqlarni zudlik bilan payqab to'xtash. |
| **Ultratovush 3 (O'ng)** | **\(180 \text{ mm}\)** | Old-o'ngga \(35^\circ\) | O'ngdagi bordyur, o'rindiq yoki devor masofasini o'lchash. |

> [!IMPORTANT]
> **Nega Lidar eng tepada, Ultratovush esa pastda bo'lishi shart?**
> * Agar Lidar pastga qo'yilsa, odamlarning oyoqlari va trotuar chetidagi o'tlar lazer nurini to'sib qo'yadi va u uzoqni ko'ra olmaydi. Eng tepada esa uning nuri \(360^\circ\) erkin aylanadi.
> * Ultratovush esa pastda bo'lishi kerak, chunki Lidar pastdagi \(5-10 \text{ sm}\) balandlikdagi tosh, chuqurlik yoki bordyurni ko'rmay qolishi mumkin. Pastki ultratovush datchiklari robotning tagiga to'siq kirib ketishidan saqlaydi!

---

## 4. Yuqoridan Ko'rinish (Top-Down Kinematik Chizma)

Robot 4 ta mustaqil tishli DC motor bilan harakatlanadi (Skid-Steer / Differensial boshqaruv). Bu unga joyida \(360^\circ\) tank kabi buralish imkonini beradi:

```
                  Oldingi Tomon (Harakat Yo'nalishi)
           ─────────────────────────────────────────────────
             [US-1 (35°)]    [US-2 (0°)]    [US-3 (35°)]
                \                 |                /
                 \                |               /
           ┌───────────────────────────────────────────────┐
   [ G'ildirak FL ]                                [ G'ildirak FR ]
   [   Old-Chap   ]        ┌─────────────┐         [   Old-O'ng   ]
   ┌──────────────┐        │   USB CAM   │         ┌──────────────┐
   │ 12V DC Motor │        └─────────────┘         │ 12V DC Motor │
   └──────────────┘                                └──────────────┘
          │                                               │
          │             📦 KURYER BO'LIMI                 │
          │                (400 x 300 mm)                 │
          │                                               │
          │          ┌───────────────────────┐            │
          │          │  TEPADA: LD19 LIDAR   │            │
          │          │      (360° SKANER)    │            │
          │          └───────────────────────┘            │
          │                                               │
   ┌──────────────┐                                ┌──────────────┐
   │ 12V DC Motor │        ┌─────────────┐         │ 12V DC Motor │
   └──────────────┘        │ RPi 4 / BMS │         └──────────────┘
   [ G'ildirak BL ]        └─────────────┘         [ G'ildirak BR ]
   [   Orqa-Chap  ]                                [   Orqa-O'ng  ]
           └───────────────────────────────────────────────┘
           ─────────────────────────────────────────────────
                               Orqa Tomon
```

---

## 5. To'liq Elektr va Aloqa Ulanish Sxemasi

```mermaid
flowchart LR
    Bat["🔋 12V 15-20Ah LiFePO4 Akkumulyator"]
    Switch["🔴 Asosiy E-Stop & Kalit"]
    UBEC5V["⚡ 12V -> 5V 5A UBEC Step-Down (RPi uchun)"]
    UBECTab["⚡ 12V -> 5V 3A USB-C Quick Charge (Planshet uchun)"]
    Mosfet["⚡ 12V Dual MOSFET Dasturiy Kalit (Stroboskop uchun)"]
    
    Bat --> Switch
    Switch --> UBEC5V
    Switch --> UBECTab
    Switch --> Mosfet
    
    subgraph KUCH["KUCHLI TOK TIZIMI (12V)"]
        Switch --> DriverL["BTS7960 / L298N (Chap Motorlar)"]
        Switch --> DriverR["BTS7960 / L298N (O'ng Motorlar)"]
        DriverL --> M_FL["Motor FL"] & M_BL["Motor BL"]
        DriverR --> M_FR["Motor FR"] & M_BR["Motor BR"]
        Mosfet --> StrobeL["🚨 Ko'k LED Stroboskop"]
        Mosfet --> StrobeR["🚨 Qizil LED Stroboskop"]
    end

    subgraph MIYA["BOSHQARUV VA INTELLEKT (5V)"]
        UBEC5V --> RPi["🧠 Raspberry Pi 4 / 5"]
        RPi -- USB Serial --> Lidar["📡 LD19 LiDAR"]
        RPi -- USB Video --> Cam["📹 USB WebCam"]
        RPi -- GPIO (PWM) --> DriverL & DriverR
        RPi -- GPIO (Strobe Signal) --> Mosfet
        RPi -- GPIO (Trigger/Echo) --> US["📡 3x HC-SR04 Ultratovush"]
        RPi -- 3.5mm AUX --> Audio["📢 Karnay (Kuchaytirgich)"]
    end

    subgraph INTERFEYS["FOYDALANUVCHI INTERFEYSI (PLANSHET)"]
        UBECTab --> TabPower["⚡ USB-C Zaryad"]
        TabPower --> Tablet["📱 7-10\" Planshet (Android / Web App)"]
        Tablet <-- Wi-Fi / Hotspot WebSockets / WebRTC --> RPi
    end
```

---

---

## 8. Talaba Tomonidan Qo'lda Yig'iladigan Konstruksiya (DIY Maker Arxitekturasi)

Murakkab avtomobil prujinalari, richaglar va qimmat amortizatorlarsiz, **universitet laboratoriyasi yoki ustaxonada talaba o'z qo'li bilan yig'a oladigan** eng sodda va ishonchli mekatronik yechim:

```
          [ LD19 LIDAR ] (3D-bosma kronshteynda)
                │
          [ PTZ KAMERA ] (Mini-dome kamera)
                │
     ═══════════╧═══════════  ◄── 2020 Profil Ustki Ramkasi + 12V Stroboskop
     │ ┌─────────────────┐ │
     │ │ PLANSHET (8.7") │ │  ◄── 3D-printerda bosilgan yoki akril ramka
     │ └─────────────────┘ │
     │     [ 102 SOS ]     │
     │                     │  ◄── T-Slot 2020 Alyuminiy Vertikal Ustunlar
     │  IIV "PATRUL" PANEL │      (M5 T-gaykalar bilan qotirilgan oq akril/alucobond)
     │                     │
     ╞═════════════════════╡  ◄── Shassi Plitasi (3 mm Duralyuminiy yoki po'lat)
     │ [RPi 4]  [BMS / BAT]│
     │                     │
   ┌─┴─────────────────────┴─┐  ◄── Amortizatorsiz, to'g'ridan-to'g'ri
   │ [L-Bracket] [L-Bracket] │      metall L-kronshteyn bilan qotirilgan
  [===]                     [===]   4x 12V Tishli DC Reduktorli Motorlar
  Shina                     Shina   (130 mm kauchuk shinalar to'g'ridan-to'g'ri valda)
```

### Amortizatorsiz Shassining Afzalliklari:
1. **Payvandlash va murakkab frezerlash shart emas:** Barcha detallar standart M5 bolt va T-gaykalar bilan 2020 alyuminiy profiliga ulanadi.
2. **Mustahkam va ishonchli:** Prujina va richaglar bo'lmagani sababli sinadigan harakatlanuvchi bo'g'inlar yo'q.
3. **Narxi arzon:** Kerakli barcha profil va burchaklar har qanday qurilish bozori yoki robototexnika do'konidan topiladi.


Robot faqat kuryerlik emas, balki istirohat bog'lari, xiyobonlar, vokzallar va gavjum piyodalar maydonlarida **jamoat xavfsizligini ta'minlovchi avtonom patrul roboti** sifatida xizmat qilishi uchun quyidagi maxsus tizimlar bilan boyitiladi:

### 1. Vizual Liveri va Rasmiy Markirovka:
* **Ranglar:** Rasmiy ikki rangli qoplama — Oq (Gloss White) va To'q Ko'k (Navy Blue).
* **Aks etuvchi chiziqlar:** Kechasi yorug'lik tushganda yorqin ko'rinuvchi ko'k va kumushrang retro-reflektor chiziqlar.
* **Yozuvlar:** Korpus yonlarida aniq o'qiluvchi `"PATRUL"`, `"POLICE"` yozuvlari va xavfsizlik gerbi.

### 2. "102 TEZKOR SOS" — Fuqarolar Yordam Interfeysi:
* Planshet ekranida doimiy ko'rinib turuvchi katta yashil/qizil **`[ 🆘 102 TEZKOR YORDAM ]`** sensorli tugmasi bo'ladi.
* Fuqaro yoki bola xavf ostida qolganda ushbu tugmani bitta bosishi kifoya:
  1. Robot darhol to'xtaydi va politsiya stroboskop chiroqlarini yoqadi.
  2. Planshet orqali to'g'ridan-to'g'ri **IIV Navbatchilik Qismiga (Operatorga)** ikki tomonlama jonli audio va video aloqa ulanadi.
  3. Robot o'zining aniq GPS koordinatalarini xaritada navbatchiga uzatadi.

### 3. Akustik Ogohlantirish va Megafon:
* Korpus ichiga o'rnatilgan kuchli 20W megafon karnay yordamida:
  * Avtonom ovozli e'lonlar berish (*"Hurmatli fuqarolar, jamoat tartibiga rioya qiling"*).
  * Masofaviy navbatchi xodimning to'g'ridan-to'g'ri mikrofon orqali odamlarga murojaat qilishi.
  * Qoidabuzarlik yoki favqulodda vaziyatda politsiya sirenasini chala olishi.

### 4. 360° Aqlli Videonazorat va Yuz Tanish (AI):
* Tepadagi 360° PTZ kamera va old AI kamerasi uzluksiz video yozadi.
* Raspberry Pi-dagi neyron tarmoq quyidagilarni avtomatik tahlil qiladi:
  * Qidiruvda bo'lgan shaxslarning yuzini skaner qilish.
  * Egasi tashlab ketgan shubhali sumka yoki buyumlarni aniqlash.
  * Odamlar to'dalanishi yoki janjal holatlarida navbatchiga avtomatik signal yuborish.

