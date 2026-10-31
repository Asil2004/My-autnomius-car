# 🛡️ Vandalizm va Hujumlardan Himoyalangan Planshet Montaj Tizimi (Anti-Vandal Kiosk Enclosure)

![Vandalizmga Qarshi Zirhli Planshet Kassetasi va Stroboskop Renderi](/C:/Users/MSI/.gemini/antigravity/brain/784181a7-3162-4a80-8c60-d653098b060a/vandal_proof_tablet_visor_render_1793210021663.jpg)

Piyodalar yo'lagi va jamoat joylarida harakatlanuvchi kuryer/patrul robotlarining eng nozik joyi — bu ularning **ekrani (plansheti)** va **tashqi chiroqlaridir**. 

Ushbu muhandislik qo'llanmasida planshetni tosh, tayoq, zarba, o'g'irlik, yomg'ir va begona aralashuvlardan **100% himoya qiluvchi ichki montaj kassetasi** hamda **himoyalangan politsiya stroboskop chiroqlari** arxitekturasi batafsil keltirilgan.

---

## 1. Hujumlardan Himoyaning 4 Ta Asosiy Qatlami

```
                     TASHQI MUHIT (ZARBA, YOMG'IR, BEGONA ODAMLAR)
                                       │
                                       ▼
    ┌─────────────────────────────────────────────────────────────────────────┐
    │ 1-QATLAM: 4-5 mm ZIRHLI MONOLIT POLIKARBONAT (LEXAN)                    │
    │ * Bolg'a, tosh va metall zarbasiga chidamli (Sinmaydi, egiluvchan)      │
    │ * Tashqi tomondan qirilishga qarshi qoplama (Hard-Coated)               │
    ├─────────────────────────────────────────────────────────────────────────┤
    │ 2-QATLAM: GERMETIK REZINA PROKLADKA (EPDM GASKET)                       │
    │ * Yomg'ir, qor, suv sachrashi va changdan to'liq IP65 himoyasi          │
    ├─────────────────────────────────────────────────────────────────────────┤
    │ 3-QATLAM: 2 mm QALINLIKDAGI PO'LAT/ALYUMINIY KORPUS ROMI                │
    │ * Bitta ham tashqi vint yoki gayka yo'q (O'g'irlab olib bo'lmaydi)      │
    ├─────────────────────────────────────────────────────────────────────────┤
    │ 4-QATLAM: PLANSHET (8 - 10.1 DYUYM)                                      │
    │ * Sensor (Touch) 4 mm polikarbonat orqali ham mukammal ishlaydi         │
    │ * Power va Ovoz tugmalari korpus ichida butunlay yopiq                   │
    └─────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
                  ROBOTNING ICHKI YUK/ELEKTRONIKA BO'LIMI
               (Faqat elektron PIN-kod bilan ichkaridan ochiladi)
```

---

## 2. Planshet Montajining Yon Kesim (Cross-Section) Chizmasi

Planshet tashqaridan emas, **faqat robotning ichki tomondan** o'rnatiladi. Tashqi tomonda hech qanday olinadigan detal bo'lmaydi:

```
TASHQARI (Ko'cha)                                   ICHKARI (Robot ichi)
═════════════════                                   ════════════════════
                        
                        ┌──────────────────────────────────────┐
                        │ Robotning metall korpusi (2 mm)      │
                        └───┬──────────────────────────────┬───┘
                            │                              │
                            │   ┌──────────────────────┐   │
   [ ZARBA / TOSH ] ───────>│   │ 4 mm Polikarbonat    │   │
                            │   │ (Zirhli shisha)      │   │
                            │   └──────────┬───────────┘   │
                            │              │ EPDM Rezina   │
                            │       ═══════╧═══════        │
                            │   ┌──────────────────────┐   │
                            │   │ PLANSHET SENSOREKRAN │   │
                            │   │                      │   │
                            │   │ (Kauchuk tamponlar)  │   │
                            │   └──────────┬───────────┘   │
                            │              │               │
                            │   ┌──────────┴───────────┐   │
                            │   │ Ichki po'lat bosma   │   │
                            │   │ plitasi (Ichki vint) │   │
                            └───┴──────────────────────┴───┘
                                           │
                                           └─► Ichkaridan qisuvchi gaykalar
```

### Muhim konstruktiv qoidalar:
1. **Tashqi vintlarning yo'qligi:** Korpus tashqarisida bitta ham burab olinadigan bolt/gayka bo'lmaydi. Barcha ushlagichlar robot ichidagi kuryer qutisi ichidan qotiriladi.
2. **Kauchuk damping (Silkitilishga qarshi):** Planshet korpusga qattiq metall bilan tegmaydi, orqasiga 3 mm qalinlikdagi ko'pikli kauchuk (EVA foam) qo'yiladi. Bu trotuar toshlari ustida yurayotganda titrashlarni yutib oladi.
3. **USB-C quvvat qisqichi:** USB kabeli planshetga ulangan joyida maxsus metall kronshteyn bilan qisib qo'yiladi, shunda kuchli zarba bo'lsa ham kabel portdan chiqib ketmaydi.

---

## 3. Zirhli Politsiya Stroboskop Chiroqlari Joylashuvi

Chiroqlar robot yuzasidan bo'rtib chiqib tursa, zarba paytida oson sinishi mumkin. Shuning uchun ular **ichkariga chuqurlashtirilgan (Recessed Pocket)** uslubda o'rnatiladi:

```
                 [ LD19 360° LIDAR TEPADA ]
            ═════════════════╤═════════════════
                             │
     ┌───────────────────────┴───────────────────────┐
     │ ┌──────────────┐             ┌──────────────┐ │ ◄── Tepa Himoya Visori
     │ │ 🚨 KO'K LED  │             │ 🚨 QIZIL LED │ │
     │ │ (Ichki nisha)│  [KAMERA]   │ (Ichki nisha)│ │
     │ └──────────────┘             └──────────────┘ │
     ├───────────────────────────────────────────────┤
     │                                               │
     │     🛡️ [ ZIRHLI OYNA OSTIDAGI PLANSHET ]      │
     │         * Jonli Ko'zlar                       │
     │         * Kuryer PIN Klaviaturasi             │
     │                                               │
     ├───────────────────────────────────────────────┤
     │           📦 KURYER ELEKTRON BO'LIMI          │
```

* **Stroboskop himoyasi:** 12V LED modullari metall ramka ichiga 15 mm chuqurlikka kiritilgan bo'lib, ustidan qalin qizil va ko'k rangli zarbaga chidamli shaffof qalpoq bilan yopiladi.
* **Ko'rish burchagi:** Chiroqlar burchakli reflektor orqali aks ettiriladi, natijada ular uzoqdan va yon tomondan juda yorqin ko'rinadi, lekin to'g'ridan-to'g'ri zarba berilganda metall karkas zarbani o'ziga oladi.

---

## 4. Dasturiy Himoya (Kiosk Mode & Anti-Hack)

Faqat jismoniy himoyaning o'zi yetarli emas, o'tkinchilar planshet sozlamalarini buzmasligi uchun dasturiy himoya o'rnatiladi:

1. **Fully Kiosk Browser (yoki Android Kiosk Mode):**
   * Planshet faqat bitta dasturni (Robot Yuzi & PIN interfeys) to'liq ekranda ko'rsatadi.
   * "Home", "Back", "Recent Apps" tugmalari o'chiriladi.
   * Yuqori status-bar (Wi-Fi, Sozlamalar) surib tushirilmaydigan qilib qulflanadi.
2. **Ekran teginish sezgirligi (Touch Sensitivity):**
   * Zamonaviy planshetlarda (Samsung, Xiaomi, Lenovo) "Glove Mode" (Qo'lqop rejimi) yoqiladi. Bu rejim 4 mm polikarbonat shisha ortidan ham barmoq teginishini mukammal sezish imkonini beradi.
3. **Ekran yorug'ligi avtomatik moslashuvi:**
   * Kunduzi quyoshda maksimal yorug'lik (100%), kechasi esa piyodalar ko'zini qamashtirmaslik uchun 30% ga pasaytiriladi.

---

## 5. Kerakli Materiallar va O'lchamlar Ro'yxati

| Komponent | Tavsiya etiladigan model / material | O'lcham / Xususiyati |
| :--- | :--- | :--- |
| **Planshet** | Samsung Galaxy Tab A9 (8.7") yoki Redmi Pad SE (8.7") | Metall korpusli, ixcham, USB-C |
| **Zirhli Shisha** | Monolit Polikarbonat (Makrolon / Lexan) | Qalinligi: \(4 \text{ mm}\), 240x160 mm |
| **Himoya qistirmasi**| EPDM o'z-o'zidan yopishuvchi kauchuk tasma | Qalinligi: \(2 - 3 \text{ mm}\), suv o'tkazmaydi |
| **Stroboskop LED** | 12V 4-LED Ultra-Bright Flash Module (Qizil + Ko'k) | Suv o'tkazmaydigan (IP67), metall korpus |
| **MOSFET drayver** | Dual LR7843 yoki IRF520 MOSFET moduli | Raspberry Pi GPIO bilan 12V strobni boshqarish |
